/**
 * #1992: the read-only § 12 Abs. 4–5 TzBfG / § 4 EFZG reference-period calculator against real
 * PostgreSQL. Expected values are worked out by hand from the seeded calendar below.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { calculateOnCallReferencePeriod, listOnCallReferenceEvents } from "./reference-period";
import { onCallFixture } from "./testing/on-call-fixture";
import { loadOnCallEmployeeStatus } from "./views";

describe("§ 12 TzBfG reference-period calculator (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1992-reference");
	const onCall = onCallFixture(admin, fx);

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	/**
	 * Hired 2026-04-01 (Berlin), on call throughout. 4 h worked on ten days; 3 h worked during
	 * unpaid leave (05-04 … 05-08); vacation 05-18 … 05-19; public holiday 05-25; sick from 06-10.
	 */
	async function seededWorker() {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		const periodId = await onCall.employmentPeriod(org, worker, "2026-03-31T22:00:00Z");
		await onCall.onCallTerms(org, worker, {
			kind: "unspecified",
			from: "2026-04-01",
			employmentPeriodId: periodId,
		});
		for (const date of [
			"2026-04-07",
			"2026-04-14",
			"2026-04-21",
			"2026-04-28",
			"2026-05-12",
			"2026-05-26",
			"2026-06-02",
			"2026-06-03",
			"2026-06-04",
			"2026-06-05",
		]) {
			await onCall.work(org, worker, { date, startTime: "09:00", endTime: "13:00" });
		}
		await onCall.absence(org, worker, {
			type: "unpaid",
			startDate: "2026-05-04",
			endDate: "2026-05-08",
		});
		await onCall.work(org, worker, { date: "2026-05-05", startTime: "09:00", endTime: "12:00" });
		await onCall.absence(org, worker, {
			type: "vacation",
			startDate: "2026-05-18",
			endDate: "2026-05-19",
		});
		await onCall.holiday(org, worker, "2026-05-25");
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-06-10",
			endDate: "2026-06-12",
		});
		// A rejected-to-be pending sick note is no event.
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-06-20",
			endDate: "2026-06-20",
			status: "pending",
		});
		await onCall.holiday(org, worker, "2026-06-15");
		return { org, worker };
	}

	it("averages the 3 months before sick leave, leaving out pre-hire days and every absence", async () => {
		const { org, worker } = await seededWorker();

		const breakdown = await calculateOnCallReferencePeriod(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			eventDate: "2026-06-10",
			method: "three_months",
		});

		expect(breakdown).toMatchObject({
			employeeId: worker.employeeId,
			eventDate: "2026-06-10",
			method: "three_months",
			referenceStart: "2026-03-10",
			referenceEndExclusive: "2026-06-10",
			calendarDays: 92,
			denominatorDays: 62,
			workedDays: 10,
			numeratorMinutes: 2400,
			averageMinutesPerDay: 39,
			averageMinutesPerWeek: 271,
			averageMinutesPerWorkedDay: 240,
			onCallOnEventDate: true,
			employmentShortened: true,
		});
		expect(breakdown.excludedPeriods).toEqual([
			{ from: "2026-03-10", untilExclusive: "2026-04-01", reason: "not_employed", days: 22 },
			{ from: "2026-05-04", untilExclusive: "2026-05-09", reason: "unpaid_absence", days: 5 },
			{ from: "2026-05-18", untilExclusive: "2026-05-20", reason: "paid_absence", days: 2 },
			{ from: "2026-05-25", untilExclusive: "2026-05-26", reason: "public_holiday", days: 1 },
		]);
	});

	it("offers the 13-week reference period", async () => {
		const { org, worker } = await seededWorker();

		const breakdown = await calculateOnCallReferencePeriod(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			eventDate: "2026-06-10",
			method: "thirteen_weeks",
		});

		expect(breakdown).toMatchObject({
			referenceStart: "2026-03-11",
			referenceEndExclusive: "2026-06-10",
			calendarDays: 91,
			denominatorDays: 62,
			numeratorMinutes: 2400,
			averageMinutesPerDay: 39,
		});
		expect(breakdown.excludedPeriods[0]).toEqual({
			from: "2026-03-11",
			untilExclusive: "2026-04-01",
			reason: "not_employed",
			days: 21,
		});
	});

	it("lists approved sick-leave starts and public holidays with their reference periods", async () => {
		const { org, worker } = await seededWorker();

		const events = await listOnCallReferenceEvents(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			from: "2026-06-01",
			untilExclusive: "2026-07-01",
			method: "three_months",
		});

		expect(events.map((event) => [event.kind, event.eventDate])).toEqual([
			["sick_leave", "2026-06-10"],
			["public_holiday", "2026-06-15"],
		]);
		expect(events[0]?.breakdown.averageMinutesPerDay).toBe(39);
		// The holiday's own reference period contains the three sick days.
		expect(events[1]?.breakdown.excludedPeriods).toContainEqual({
			from: "2026-06-10",
			untilExclusive: "2026-06-13",
			reason: "paid_absence",
			days: 3,
		});
	});

	it("lists sick leave that started before the period and runs into it, from its own start", async () => {
		const { org, worker } = await seededWorker();
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-05-29",
			endDate: "2026-06-01",
		});
		// Over before the period began: not one of the period's events.
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-04-20",
			endDate: "2026-04-22",
		});

		const events = await listOnCallReferenceEvents(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			from: "2026-06-01",
			untilExclusive: "2026-07-01",
			method: "three_months",
		});

		expect(events.map((event) => [event.kind, event.eventDate])).toEqual([
			["sick_leave", "2026-05-29"],
			["sick_leave", "2026-06-10"],
			["public_holiday", "2026-06-15"],
		]);
		const fromMay = await calculateOnCallReferencePeriod(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			eventDate: "2026-05-29",
			method: "three_months",
		});
		expect(events[0]?.breakdown).toEqual(fromMay);
		expect(fromMay.referenceStart).toBe("2026-02-28");
	});

	it("lists no event for days after the employment ended, though the on-call terms run on", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		const periodId = await onCall.employmentPeriod(
			org,
			worker,
			"2026-03-31T22:00:00Z",
			"2026-06-12T22:00:00Z",
		);
		await onCall.onCallTerms(org, worker, {
			kind: "unspecified",
			from: "2026-04-01",
			employmentPeriodId: periodId,
		});
		await onCall.work(org, worker, { date: "2026-06-02", startTime: "09:00", endTime: "13:00" });
		await onCall.holiday(org, worker, "2026-06-04");
		await onCall.holiday(org, worker, "2026-06-15");
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: "2026-06-16",
			endDate: "2026-06-17",
		});

		const events = await listOnCallReferenceEvents(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			from: "2026-06-01",
			untilExclusive: "2026-07-01",
			method: "three_months",
		});
		const afterLeaving = await calculateOnCallReferencePeriod(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			eventDate: "2026-06-15",
			method: "three_months",
		});

		expect(events.map((event) => [event.kind, event.eventDate])).toEqual([
			["public_holiday", "2026-06-04"],
		]);
		expect(afterLeaving.onCallOnEventDate).toBe(false);

		const status = await loadOnCallEmployeeStatus(db, {
			organizationId: org.id,
			employeeId: worker.employeeId,
			timezone: org.timezone,
			now: Temporal.Instant.from("2026-06-20T10:00:00Z"),
			audience: "full",
			method: "three_months",
		});
		expect(status).toMatchObject({ hasOnCallTerms: true, terms: null });
		expect(status.referenceEvents.map((event) => event.eventDate)).toEqual(["2026-06-04"]);
	});

	it("never writes: it runs inside a READ ONLY transaction and leaves settled days untouched", async () => {
		const { org, worker } = await seededWorker();
		await admin.query(
			`INSERT INTO payroll_settled_day (organization_id, employee_id, date, timezone, credited_minutes, method)
			 VALUES ($1, $2, '2026-04-07', 'Europe/Berlin', 240, 'manual')`,
			[org.id, worker.employeeId],
		);
		const before = await admin.query(
			`SELECT * FROM payroll_settled_day WHERE organization_id = $1 ORDER BY id`,
			[org.id],
		);

		const client = await admin.connect();
		try {
			await client.query("BEGIN READ ONLY");
			const readOnly = drizzle({ client, schema: { ...authSchema, ...schema } });
			const breakdown = await calculateOnCallReferencePeriod(readOnly as unknown as typeof db, {
				organizationId: org.id,
				employeeId: worker.employeeId,
				eventDate: "2026-06-10",
				method: "three_months",
			});
			expect(breakdown.numeratorMinutes).toBe(2400);
			await client.query("COMMIT");
		} finally {
			client.release();
		}

		const after = await admin.query(
			`SELECT * FROM payroll_settled_day WHERE organization_id = $1 ORDER BY id`,
			[org.id],
		);
		expect(after.rows).toEqual(before.rows);
	});

	it("refuses an employee of another organization", async () => {
		const { worker } = await seededWorker();
		const other = await onCall.organization("b");

		await expect(
			calculateOnCallReferencePeriod(db, {
				organizationId: other.id,
				employeeId: worker.employeeId,
				eventDate: "2026-06-10",
				method: "three_months",
			}),
		).rejects.toMatchObject({ _tag: "NotFoundError" });
	});
});
