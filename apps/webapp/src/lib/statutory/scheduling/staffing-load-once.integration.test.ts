/**
 * #1934: a Staffing suggestion judges every candidate twice, without and with the proposed shift.
 * Only the proposal differs, so each monitor's persisted data (shifts, work, terms, offsets,
 * acknowledgements over its lookback) is read once per request, not once per run.
 */
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, organization as organizationTable } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { recordApprenticeRelease } from "../employee-context";
import { minijobFixture } from "../minijob/__tests__/minijob-database-fixture";
import { onCallFixture } from "../on-call/__tests__/on-call-fixture";
import { shortTermFixture } from "../short-term/__tests__/short-term-fixture";
import { workingStudentFixture } from "../working-student/working-student.test.fixture";
import { youthSeed } from "../youth/testing/youth-seed";
import { statutoryScheduleContributors } from "./contributors";
import { addedStatutoryScheduleFindings } from "./evaluate";
import { memoizedReader } from "./read-memo";

describe("Staffing statutory reads per suggestion request (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = workingStudentFixture(admin, "t1934-load-once");
	const onCall = onCallFixture(admin, fx);
	const mj = minijobFixture(admin, fx);
	const st = shortTermFixture(admin, () => fx.user("creator"));
	const youth = youthSeed(admin);

	beforeEach(async () => {
		mj.reset();
		st.reset();
		await fx.cleanup();
	});
	afterAll(fx.cleanup);

	/** The database, logging every statement it runs with its parameters. */
	function loggingDb() {
		const statements: string[] = [];
		const logged = drizzle({
			client: db.$client,
			schema: db._.fullSchema,
			logger: { logQuery: (query, params) => statements.push(JSON.stringify([query, params])) },
		});
		return { db: logged, statements };
	}

	it("reads each monitor's data once for the run without and the run with the proposal", async () => {
		const org = await fx.organization("a");
		const owner = await fx.user("owner");
		await fx.membership(org, owner, "owner");
		const subareaId = await fx.subarea(org, await fx.employee(org, "planner"));
		const shift = (who: { employeeId: string; userId: string }, date: string) =>
			fx.shift(
				org,
				subareaId,
				{ ...who, organizationId: org.id },
				{
					date,
					start: "09:00",
					end: "15:00",
				},
			);

		// One candidate in each monitor's scope, each with planned work in the judged week.
		const minijobber = await fx.employee(org, "minijob", { contractType: "hourly" });
		await mj.terms(minijobber, owner, { from: "2026-01-01", hourlyRate: 13.37 });
		const seasonal = await fx.employee(org, "short", { contractType: "hourly" });
		await st.terms(seasonal, { from: "2026-01-01", hourlyRate: 20 });
		const student = await fx.workingStudent(org, "student");
		const onCallWorker = await fx.employee(org, "oncall");
		await onCall.onCallTerms({ ...org, subareaId, plannerUserId: owner.userId }, onCallWorker, {
			kind: "unspecified",
		});
		const minor = await fx.employee(org, "minor", { birthday: "2011-01-01" });
		const apprentice = await fx.employee(org, "apprentice", { birthday: "2005-05-05" });
		await youth.terms(apprentice, {
			from: "2026-01-01",
			createdBy: owner.userId,
			employmentProfile: "apprentice",
		});
		await recordApprenticeRelease(db, {
			organizationId: org.id,
			employeeId: apprentice.employeeId,
			actorUserId: owner.userId,
			releaseKind: "exam_day",
			startsOn: "2027-03-03",
			endsOn: "2027-03-03",
		});
		const candidates = [minijobber, seasonal, student, onCallWorker, minor, apprentice];
		for (const who of candidates) await shift(who, "2027-03-01");

		const logging = loggingDb();
		await addedStatutoryScheduleFindings(logging.db, {
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2027-03-03", endExclusive: "2027-03-04" },
			employeeIds: candidates.map((who) => who.employeeId),
			now: Temporal.Instant.from("2027-02-20T09:00:00Z"),
			proposedShift: { date: "2027-03-03", startTime: "09:00", endTime: "17:00" },
			replacesShiftId: null,
		});

		expect(statutoryScheduleContributors).toHaveLength(6);
		// Every monitor read its own facts: Minijob offsets, study periods, on-call terms, birthdays,
		// apprentice releases, and the shifts and work of the lookbacks.
		const read = logging.statements.join("\n");
		for (const table of [
			"employee_statutory_offset",
			"employee_study_period",
			"on_call_hours_kind",
			"birthday",
			"employee_apprentice_release",
			"work_period",
			"shift",
		]) {
			expect(read).toContain(table);
		}
		const repeated = logging.statements.filter(
			(statement, index) => logging.statements.indexOf(statement) !== index,
		);
		expect(repeated).toEqual([]);
	});

	describe("memoizedReader", () => {
		it("reads a statement once and gives every caller its own rows", async () => {
			const org = await fx.organization("a");
			const logging = loggingDb();
			const reader = memoizedReader(logging.db);
			const load = () =>
				reader
					.select({ id: organizationTable.id, timezone: organizationTable.timezone })
					.from(organizationTable)
					.where(eq(organizationTable.id, org.id));

			const first = await load();
			first[0].timezone = "changed by the first caller";
			first.push({ id: "pushed", timezone: "UTC" });

			expect(await load()).toEqual([{ id: org.id, timezone: org.timezone }]);
			expect(logging.statements).toHaveLength(1);
		});

		it("keeps reads apart that differ only in the keys their rows are mapped to", async () => {
			const org = await fx.organization("a");
			const reader = memoizedReader(loggingDb().db);
			const where = eq(organizationTable.id, org.id);

			expect(
				await reader.select({ a: organizationTable.id }).from(organizationTable).where(where),
			).toEqual([{ a: org.id }]);
			expect(
				await reader.select({ b: organizationTable.id }).from(organizationTable).where(where),
			).toEqual([{ b: org.id }]);
			expect(
				await reader.query.organization.findFirst({
					columns: { id: true },
					where: (table, { eq: equals }) => equals(table.id, org.id),
				}),
			).toEqual({ id: org.id });
		});

		it("lets a memoized query serve as a subquery", async () => {
			const org = await fx.organization("a");
			const reader = memoizedReader(loggingDb().db);
			const ids = reader
				.select({ id: organizationTable.id })
				.from(organizationTable)
				.where(eq(organizationTable.id, org.id));

			expect(
				await reader
					.select({ id: organizationTable.id })
					.from(organizationTable)
					.where(inArray(organizationTable.id, ids)),
			).toEqual([{ id: org.id }]);
		});
	});
});
