/**
 * Contractor Time & Fee Statements on PostgreSQL (#2000): real work periods
 * with captured offsets, real terms through the #1998 writer, real projects
 * and tasks. The statement's days and totals are the pricing engine's
 * (`priceContractorDays`), in the CSV and the PDF too; only contractor
 * engagements appear, never the employee period of a converted contractor.
 */
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { avvPdfText as pdfText } from "@/lib/avv/avv-pdf.test.fixture";
import { unitsToDecimal } from "@/lib/contractor-compensation/pricing";
import { priceContractorDays } from "@/lib/contractor-compensation/pricing-loader";
import { changeContractorTerms } from "@/lib/contractor-compensation/store";
import type { ContractorCompensationInput } from "@/lib/contractor-compensation/terms";
import { saveContractorProfile } from "@/lib/engagement/contractor-profile";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { loadContractorStatement } from "./loader";
import { contractorStatementCsv } from "./statement-csv";
import { renderContractorStatementPdf } from "./statement-pdf";
import { catalogT } from "./testing/statement.test.fixture";

const generatedAt = Temporal.Instant.from("2026-07-01T08:00:00Z");

describe("contractor statements on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	let personnelNumber = 100;

	async function contractor(
		name = "Jo Freelance",
		organizationId = fixture.organizationId,
		number = `C-${personnelNumber++}`,
	) {
		const seeded = await fixture.seedEmployee({ organizationId, engagementKind: "contractor" });
		const [firstName, lastName] = name.split(" ");
		await fixture.pool.query(
			`update employee set first_name = $2, last_name = $3, employee_number = $4 where id = $1`,
			[seeded.employeeId, firstName, lastName, number],
		);
		return seeded;
	}

	async function setTerms(
		employeeId: string,
		effectiveFrom: string,
		compensation: ContractorCompensationInput,
	) {
		const outcome = await changeContractorTerms(db, {
			organizationId: fixture.organizationId,
			actorUserId: fixture.ownerUserId,
			employeeId,
			change: { kind: "set", effectiveFrom, compensation },
		});
		if (!outcome.ok) throw new Error(outcome.reason);
	}

	async function project(name: string, taskName?: string) {
		const projectId = randomUUID();
		await fixture.pool.query(
			`insert into project (id, organization_id, name, status, created_by, updated_at)
			 values ($1, $2, $3, 'active', $4, now())`,
			[projectId, fixture.organizationId, name, fixture.ownerUserId],
		);
		if (!taskName) return { projectId, taskId: null };
		const taskId = randomUUID();
		await fixture.pool.query(
			`insert into project_task (id, organization_id, project_id, name, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, now())`,
			[taskId, fixture.organizationId, projectId, taskName, fixture.ownerUserId],
		);
		return { projectId, taskId };
	}

	async function completedWork(input: {
		employeeId: string;
		start: string;
		end: string;
		offset?: number;
		projectId?: string | null;
		taskId?: string | null;
		approvalStatus?: "approved" | "pending";
	}) {
		const clockIn = randomUUID();
		const clockOut = randomUUID();
		const minutes = Temporal.Instant.from(input.end)
			.since(Temporal.Instant.from(input.start))
			.total("minutes");
		await withCanonicalRecords(fixture.pool, async (client) => {
			for (const [id, type, timestamp] of [
				[clockIn, "clock_in", input.start],
				[clockOut, "clock_out", input.end],
			]) {
				await client.query(
					`insert into time_entry (id, employee_id, organization_id, type, timestamp,
					 utc_offset_minutes, timezone, timezone_source, hash, created_by)
					 values ($1::uuid, $2, $3, $4, $5, $6, 'UTC', 'user_setting', $1::uuid::text, $7)`,
					[
						id,
						input.employeeId,
						fixture.organizationId,
						type,
						timestamp,
						input.offset ?? 0,
						fixture.ownerUserId,
					],
				);
			}
			await client.query(
				`insert into work_period (employee_id, organization_id, clock_in_id, clock_out_id,
				 start_time, end_time, duration_minutes, is_active, project_id, task_id,
				 approval_status, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, now())`,
				[
					input.employeeId,
					fixture.organizationId,
					clockIn,
					clockOut,
					input.start,
					input.end,
					minutes,
					input.projectId ?? null,
					input.taskId ?? null,
					input.approvalStatus ?? "approved",
				],
			);
		});
	}

	async function statementOf(employeeId: string, fromDay: string, toDay: string) {
		const result = await loadContractorStatement(db, fixture.organizationId, {
			employeeId,
			fromDay,
			toDay,
			generatedAt,
		});
		if (!result.ok) throw new Error(result.reason);
		return result.statement;
	}

	/** The engine's own totals for the same contractor and days. */
	async function engineTotals(employeeId: string, fromDay: string, toDay: string) {
		const pricing = await priceContractorDays(db, fixture.organizationId, {
			employeeIds: [employeeId],
			fromDay: Temporal.PlainDate.from(fromDay),
			toDay: Temporal.PlainDate.from(toDay),
		});
		return pricing.totals.map((total) => ({
			currency: total.currency,
			amountMinor: Number(total.amountMinor),
			hours: unitsToDecimal(total.hourUnits, 4),
			days: unitsToDecimal(total.dayUnits, 4),
		}));
	}

	it("itemizes hourly work by day, project and task across a rate change and local midnight", async () => {
		const { employeeId } = await contractor("Jo Freelance", fixture.organizationId, "C-7");
		const website = await project("Website", "Design");
		const shop = await project("Shop");
		await saveContractorProfile(db, {
			organizationId: fixture.organizationId,
			employeeId,
			details: { companyName: "Jo Consulting UG", vatId: "DE123456789", referenceCode: "PO-4711" },
			updatedBy: fixture.ownerUserId,
		});
		await setTerms(employeeId, "2026-03-01", {
			basis: "hourly",
			rateAmount: "80",
			currency: "EUR",
		});
		await setTerms(employeeId, "2026-03-15", {
			basis: "hourly",
			rateAmount: "90.50",
			currency: "EUR",
		});
		// Berlin (+01:00): 09:00–12:00 local on the website's design task.
		await completedWork({
			employeeId,
			start: "2026-03-02T08:00:00Z",
			end: "2026-03-02T11:00:00Z",
			offset: 60,
			...website,
		});
		// Tokyo (+09:00): 22:00 on 14 March to 02:00 on 15 March, across the rate change.
		await completedWork({
			employeeId,
			start: "2026-03-14T13:00:00Z",
			end: "2026-03-14T17:00:00Z",
			offset: 540,
			projectId: shop.projectId,
			approvalStatus: "pending",
		});

		const statement = await statementOf(employeeId, "2026-03-01", "2026-03-31");

		expect(statement.contractor).toMatchObject({
			name: "Jo Freelance",
			employeeNumber: "C-7",
			companyName: "Jo Consulting UG",
			vatId: "DE123456789",
			referenceCode: "PO-4711",
		});
		expect(statement.organizationName).toBe(`Lifecycle ${fixture.organizationId}`);
		expect(
			statement.days.map((day) => ({
				date: day.date,
				rate: day.pricing?.rate,
				units: day.pricing?.units,
				amount: day.pricing?.amount,
				lines: day.lines.map((line) => [
					line.start,
					line.end,
					line.projectName,
					line.taskName,
					line.awaitingApproval,
					line.amount,
				]),
			})),
		).toEqual([
			{
				date: "2026-03-02",
				rate: "80.00",
				units: "3.0000",
				amount: "240.00",
				lines: [
					[
						"2026-03-02T09:00+01:00",
						"2026-03-02T12:00+01:00",
						"Website",
						"Design",
						false,
						"240.00",
					],
				],
			},
			{
				date: "2026-03-14",
				rate: "80.00",
				units: "2.0000",
				amount: "160.00",
				lines: [["2026-03-14T22:00+09:00", "2026-03-15T00:00+09:00", "Shop", null, true, "160.00"]],
			},
			{
				date: "2026-03-15",
				rate: "90.50",
				units: "2.0000",
				amount: "181.00",
				lines: [["2026-03-15T00:00+09:00", "2026-03-15T02:00+09:00", "Shop", null, true, "181.00"]],
			},
		]);
		expect(statement.totals).toEqual([
			{ currency: "EUR", amount: "581.00", hours: "7.0000", days: "0.0000", workedMinutes: 420 },
		]);
		expect(await engineTotals(employeeId, "2026-03-01", "2026-03-31")).toEqual([
			{ currency: "EUR", amountMinor: 58_100, hours: "7.0000", days: "0.0000" },
		]);
		expect(statement.awaitingApprovalLines).toBe(2);

		const csv = contractorStatementCsv(statement, { t: catalogT("en") });
		expect(csv).toContain('"Total","","","","","",420,"","","","","EUR",7.0000,"Hours",581.00');
		const pdf = (
			await pdfText(
				await renderContractorStatementPdf(statement, { t: catalogT("en"), locale: "en" }),
			)
		).replace(/\s+/g, " ");
		expect(pdf).toContain("€581.00");
		expect(pdf).toContain("Not an invoice");
	});

	it("totals all three daily rules exactly as the pricing engine does", async () => {
		const cases = [
			{
				rule: { dayUnitRule: "any_work_full_day" as const },
				// 1 min and 10 h: two full days.
				expected: { amount: "1300.00", days: "2.0000" },
			},
			{
				rule: { dayUnitRule: "half_and_full_day" as const, halfDayThresholdMinutes: 240 },
				// 4 h is half a day (up to and including the threshold), 10 h a full day.
				expected: { amount: "975.00", days: "1.5000" },
			},
			{
				rule: {
					dayUnitRule: "prorated_by_standard_day" as const,
					standardDayMinutes: 480,
					capAtOneDay: true,
				},
				// 4 h = 0.5 day, 10 h capped at 1.0.
				expected: { amount: "975.00", days: "1.5000" },
			},
			{
				rule: {
					dayUnitRule: "prorated_by_standard_day" as const,
					standardDayMinutes: 480,
					capAtOneDay: false,
				},
				// 4 h = 0.5 day, 10 h = 1.25 days.
				expected: { amount: "1137.50", days: "1.7500" },
			},
		];
		for (const { rule, expected } of cases) {
			const { employeeId } = await contractor();
			await setTerms(employeeId, "2026-04-01", {
				basis: "daily",
				rateAmount: "650",
				currency: "EUR",
				...rule,
			});
			const firstDay =
				rule.dayUnitRule === "any_work_full_day"
					? { start: "2026-04-06T09:00:00Z", end: "2026-04-06T09:01:00Z" }
					: { start: "2026-04-06T09:00:00Z", end: "2026-04-06T13:00:00Z" };
			await completedWork({ employeeId, ...firstDay });
			await completedWork({
				employeeId,
				start: "2026-04-07T08:00:00Z",
				end: "2026-04-07T18:00:00Z",
			});

			const statement = await statementOf(employeeId, "2026-04-01", "2026-04-30");
			expect(statement.totals).toEqual([
				expect.objectContaining({ currency: "EUR", amount: expected.amount, days: expected.days }),
			]);
			const [engine] = await engineTotals(employeeId, "2026-04-01", "2026-04-30");
			expect(engine.days).toBe(statement.totals[0].days);
			expect(engine.amountMinor / 100).toBe(Number(statement.totals[0].amount));
			expect(
				statement.days.every((day) => day.pricing?.dayUnitRule?.kind === rule.dayUnitRule),
			).toBe(true);
		}
	});

	it("exports only the contractor period of a contractor converted to an employee", async () => {
		const seeded = await contractor("Kim Convert");
		const employeeId = seeded.employeeId;
		await setTerms(employeeId, "2026-05-01", {
			basis: "hourly",
			rateAmount: "100",
			currency: "EUR",
		});
		// Effective departure at 12:00 on 4 May, rehired as an employee at 13:00.
		await fixture.pool.query(
			`update employee_employment_period set status = 'closed', ended_at = '2026-05-04T12:00:00Z'
			 where employee_id = $1 and status = 'open'`,
			[employeeId],
		);
		await fixture.pool.query(
			`insert into employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance, engagement_kind)
			 values ($1, $2, 'open', '2026-05-04T13:00:00Z', 'recorded', 'employee')`,
			[fixture.organizationId, employeeId],
		);
		await fixture.pool.query(`update employee set engagement_kind = 'employee' where id = $1`, [
			employeeId,
		]);
		await completedWork({ employeeId, start: "2026-05-04T09:00:00Z", end: "2026-05-04T12:00:00Z" });
		await completedWork({ employeeId, start: "2026-05-04T13:00:00Z", end: "2026-05-04T17:00:00Z" });
		await completedWork({ employeeId, start: "2026-05-05T09:00:00Z", end: "2026-05-05T17:00:00Z" });

		const statement = await statementOf(employeeId, "2026-05-01", "2026-05-31");
		expect(statement.days.map((day) => [day.date, day.workedMinutes])).toEqual([
			["2026-05-04", 180],
		]);
		expect(statement.totals).toEqual([
			{ currency: "EUR", amount: "300.00", hours: "3.0000", days: "0.0000", workedMinutes: 180 },
		]);
		expect(statement.unpriced).toEqual({ workedMinutes: 0, days: 0 });
	});

	it("lists contractor work without terms unpriced, never at zero", async () => {
		const { employeeId } = await contractor();
		await setTerms(employeeId, "2026-06-10", {
			basis: "hourly",
			rateAmount: "70",
			currency: "EUR",
		});
		await completedWork({ employeeId, start: "2026-06-05T09:00:00Z", end: "2026-06-05T10:00:00Z" });
		await completedWork({ employeeId, start: "2026-06-11T09:00:00Z", end: "2026-06-11T11:00:00Z" });

		const statement = await statementOf(employeeId, "2026-06-01", "2026-06-30");
		expect(statement.days.map((day) => [day.date, day.pricing?.amount ?? null])).toEqual([
			["2026-06-05", null],
			["2026-06-11", "140.00"],
		]);
		expect(statement.unpriced).toEqual({ workedMinutes: 60, days: 1 });
		expect(statement.totals).toEqual([
			{ currency: "EUR", amount: "140.00", hours: "2.0000", days: "0.0000", workedMinutes: 120 },
		]);
	});

	it("refuses people who were never contractors, other organizations' people and bad periods", async () => {
		const employee = await fixture.seedEmployee();
		const load = (employeeId: string, fromDay = "2026-03-01", toDay = "2026-03-31") =>
			loadContractorStatement(db, fixture.organizationId, {
				employeeId,
				fromDay,
				toDay,
				generatedAt,
			});

		expect(await load(employee.employeeId)).toEqual({ ok: false, reason: "not_contractor" });

		const otherOrganization = await fixture.createOrganization();
		const stranger = await contractor("Other Org", otherOrganization);
		expect(await load(stranger.employeeId)).toEqual({ ok: false, reason: "employee_not_found" });

		const { employeeId } = await contractor();
		expect(await load(employeeId, "2026-03-31", "2026-03-01")).toEqual({
			ok: false,
			reason: "invalid_period",
		});
		expect(await load(employeeId, "2026-01-01", "2027-01-02")).toEqual({
			ok: false,
			reason: "invalid_period",
		});
		expect(await load(employeeId, "2026-02-30", "2026-03-01")).toEqual({
			ok: false,
			reason: "invalid_period",
		});
	});
});
