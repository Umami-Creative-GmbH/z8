/**
 * #1896: settling and unsettling employee-days against a disposable PostgreSQL
 * database. The settlement operations resolve the actor's payroll access grant
 * themselves, so these tests seed grants, employees, work and absences in two
 * organizations, and read the result back through `readPeriod` and the history.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

const { readPeriod } = await import("./read-period");
const { previewSettleDays, settleDays, settlementHistory, unsettleDays } =
	await import("./settlement");

const admin = integrationAdminPool();
const ORG = "t1896-org";
const OTHER_ORG = "t1896-other";
const users = ["t1896-owner", "t1896-holder", "t1896-anna", "t1896-ben", "t1896-foreign"];
const ids = {
	owner: "d1896000-0000-4000-8000-000000000001",
	holder: "d1896000-0000-4000-8000-000000000002",
	anna: "d1896000-0000-4000-8000-000000000003",
	ben: "d1896000-0000-4000-8000-000000000004",
	foreign: "d1896000-0000-4000-8000-000000000005",
} as const;
const november = { startDate: "2026-11-01", endDate: "2026-11-30", label: "November 2026" };
const holder = { employeeId: ids.holder, userId: "t1896-holder", name: "Holder" };
const week = { startDate: "2026-11-09", endDate: "2026-11-15" };

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [ORG, OTHER_ORG]);
	await admin.query('delete from "user" where id = any($1::text[])', [users]);
}

async function employee(id: string, userId: string, organizationId: string, number: string) {
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, employee_number, is_active, updated_at)
		 values ($1, $2, $3, 'employee', $4, true, now())`,
		[id, userId, organizationId, number],
	);
}

async function work(
	organizationId: string,
	employeeId: string,
	startAt: string,
	endAt: string,
	minutes: number,
) {
	const { rows } = await admin.query(
		`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
		   duration_minutes, approval_state, origin, created_by, updated_by, updated_at)
		 values (gen_random_uuid(), $1, $2, 'work', $3, $4, $5, 'approved', 'manual',
		   't1896-owner', 't1896-owner', now()) returning id`,
		[organizationId, employeeId, startAt, endAt, minutes],
	);
	return rows[0].id as string;
}

/** An approved full-day canonical absence, encoded as the absence writers store it. */
async function approvedAbsence(organizationId: string, employeeId: string, date: string) {
	const { rows: category } = await admin.query(
		`insert into absence_category
		 (organization_id, type, name, color, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, 'vacation', 'Vacation', '#22c55e', true, true, true, now()) returning id`,
		[organizationId],
	);
	const { rows: record } = await admin.query(
		`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
		   approval_state, origin, created_by, updated_at)
		 values (gen_random_uuid(), $1, $2, 'absence', $3::date,
		   ($3::date + interval '1 day' - interval '1 millisecond'), 'approved', 'manual',
		   't1896-owner', now()) returning id`,
		[organizationId, employeeId, date],
	);
	await admin.query(
		`insert into time_record_absence (record_id, organization_id, record_kind, absence_category_id)
		 values ($1, $2, 'absence', $3)`,
		[record[0].id, organizationId, category[0].id],
	);
	return category[0].id as string;
}

let annaWorkId = "";
let vacationId = "";

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', '2026-01-01'), ($2, $2, $2, 'Europe/Berlin', '2026-01-01')`,
		[ORG, OTHER_ORG],
	);
	await admin.query(
		`insert into "user" (id, name, email, created_at, updated_at)
		 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
		[users],
	);
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, employee_number, updated_at)
		 values ($1, 't1896-owner', $2, 'admin', 'OWN-1', now())`,
		[ids.owner, ORG],
	);
	await employee(ids.holder, "t1896-holder", ORG, "HLD-1");
	await employee(ids.anna, "t1896-anna", ORG, "ANN-1");
	await employee(ids.ben, "t1896-ben", ORG, "BEN-1");
	await employee(ids.foreign, "t1896-foreign", OTHER_ORG, "FOR-1");

	// The holder's grant covers Anna only.
	const { rows: grant } = await admin.query(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'specific', 't1896-owner', now()) returning id`,
		[ORG, ids.holder],
	);
	await admin.query(
		`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
		 values ($1, $2, $3, 't1896-owner')`,
		[ORG, grant[0].id, ids.anna],
	);

	annaWorkId = await work(ORG, ids.anna, "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
	await work(ORG, ids.ben, "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
	await work(OTHER_ORG, ids.foreign, "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
	vacationId = await approvedAbsence(ORG, ids.anna, "2026-11-12");
}

/** Closes November for Anna, as a closed month covers her. */
async function closeNovemberForAnna() {
	const { rows } = await admin.query(
		`insert into closed_month (organization_id, month, scope, actor_kind)
		 values ($1, '2026-11-01', 'organization', 'system') returning id`,
		[ORG],
	);
	await admin.query(
		`insert into closed_month_employee (organization_id, closed_month_id, employee_id, month,
		   range_start, range_end, timezone)
		 values ($1, $2, $3, '2026-11-01', '2026-10-31T23:00:00Z', '2026-11-30T23:00:00Z', 'Europe/Berlin')`,
		[ORG, rows[0].id, ids.anna],
	);
}

async function annaDay(date: string) {
	const read = await readPeriod(ORG, holder, november);
	return read.employees[0]?.days.find((day) => day.date === date);
}

async function settledRowCount(organizationId = ORG) {
	const { rows } = await admin.query(
		"select count(*)::int as count from payroll_settled_day where organization_id = $1",
		[organizationId],
	);
	return rows[0].count as number;
}

describe("settling payroll days on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	beforeEach(seed);
	afterAll(cleanup);

	it("settles the grant's employees for a date range, keeping a copy of each day", async () => {
		const result = await settleDays(ORG, holder, { employeeIds: [ids.anna] }, week);

		expect(result).toMatchObject({ status: "settled", alreadySettled: [] });
		expect(result.status === "settled" && result.newlySettled).toHaveLength(7);

		expect((await annaDay("2026-11-10"))?.settlement).toMatchObject({
			state: "settled",
			method: "manual",
			payrollExportJobId: null,
			paid: { creditedMinutes: 480, absences: [] },
		});
		expect((await annaDay("2026-11-12"))?.settlement).toMatchObject({
			state: "settled",
			paid: {
				creditedMinutes: 0,
				absences: [
					{
						categoryId: vacationId,
						categoryName: "Vacation",
						categoryType: "vacation",
						period: "full_day",
					},
				],
			},
		});
		expect((await annaDay("2026-11-16"))?.settlement).toEqual({ state: "unsettled" });
		expect((await readPeriod(ORG, holder, november)).settlement).toEqual({
			settledDays: 7,
			unsettledDays: 23,
		});
	});

	it("settles the whole grant when no employees are selected", async () => {
		const result = await settleDays(ORG, holder, {}, week);

		expect(result.status === "settled" && result.newlySettled.map((day) => day.employeeId)).toEqual(
			Array(7).fill(ids.anna),
		);
	});

	it("reports days settled before as already settled, without a duplicate", async () => {
		await settleDays(ORG, holder, {}, { startDate: "2026-11-09", endDate: "2026-11-10" });

		const preview = await previewSettleDays(ORG, holder, {}, week);
		const again = await settleDays(ORG, holder, {}, week);

		for (const result of [preview, again]) {
			expect(result.status !== "out_of_scope" && result.status !== "invalid_range").toBe(true);
			if (result.status === "out_of_scope" || result.status === "invalid_range") continue;
			expect(result.newlySettled).toHaveLength(5);
			expect(result.alreadySettled).toEqual([
				{ employeeId: ids.anna, date: "2026-11-09" },
				{ employeeId: ids.anna, date: "2026-11-10" },
			]);
		}
		expect(await settledRowCount()).toBe(7);
	});

	it("previews without settling anything", async () => {
		const preview = await previewSettleDays(ORG, holder, {}, week);

		expect(preview.status).toBe("ready");
		expect(await settledRowCount()).toBe(0);
	});

	it("warns about days in months that are not closed, and settles them anyway", async () => {
		await closeNovemberForAnna();

		const result = await settleDays(
			ORG,
			holder,
			{},
			{ startDate: "2026-10-30", endDate: "2026-11-02" },
		);

		expect(result).toMatchObject({
			status: "settled",
			inUnclosedMonths: [
				{ employeeId: ids.anna, date: "2026-10-30" },
				{ employeeId: ids.anna, date: "2026-10-31" },
			],
		});
		expect(await settledRowCount()).toBe(4);
	});

	it("rejects employees outside the grant or the organization on the server", async () => {
		const outside = await settleDays(ORG, holder, { employeeIds: [ids.anna, ids.ben] }, week);
		const foreign = await settleDays(ORG, holder, { employeeIds: [ids.foreign] }, week);
		const otherOrganization = await settleDays(
			OTHER_ORG,
			holder,
			{ employeeIds: [ids.foreign] },
			week,
		);
		const noGrant = await settleDays(
			ORG,
			{ ...holder, employeeId: ids.owner, userId: "t1896-owner" },
			{},
			week,
		);

		expect(outside).toEqual({ status: "out_of_scope", employeeIds: [ids.ben] });
		expect(foreign).toEqual({ status: "out_of_scope", employeeIds: [ids.foreign] });
		expect(otherOrganization.status).toBe("out_of_scope");
		expect(noGrant.status).toBe("out_of_scope");
		expect(await settledRowCount()).toBe(0);
		expect(await settledRowCount(OTHER_ORG)).toBe(0);
	});

	it("never blocks an edit to the time data of a settled day", async () => {
		await settleDays(ORG, holder, {}, week);

		await admin.query("update time_record set end_at = $2, duration_minutes = 540 where id = $1", [
			annaWorkId,
			"2026-11-10T17:00:00Z",
		]);

		const day = await annaDay("2026-11-10");
		expect(day?.creditedMinutes).toBe(540);
		expect(day?.settlement).toMatchObject({ state: "settled", paid: { creditedMinutes: 480 } });
	});

	it("rejects unsettling without a reason", async () => {
		await settleDays(ORG, holder, {}, week);

		const result = await unsettleDays(
			ORG,
			holder,
			[{ employeeId: ids.anna, date: "2026-11-10" }],
			"  ",
		);

		expect(result).toEqual({ status: "reason_required" });
		expect((await annaDay("2026-11-10"))?.settlement?.state).toBe("settled");
	});

	it("unsettles with a reason and keeps both events in the history", async () => {
		await settleDays(ORG, holder, {}, week);

		const result = await unsettleDays(
			ORG,
			holder,
			[
				{ employeeId: ids.anna, date: "2026-11-10" },
				{ employeeId: ids.anna, date: "2026-11-20" },
			],
			"Settled the wrong week",
		);

		expect(result).toEqual({
			status: "unsettled",
			unsettled: [{ employeeId: ids.anna, date: "2026-11-10" }],
			notSettled: [{ employeeId: ids.anna, date: "2026-11-20" }],
		});
		expect((await annaDay("2026-11-10"))?.settlement).toEqual({ state: "unsettled" });

		const history = await settlementHistory(
			ORG,
			holder,
			{ employeeIds: [ids.anna] },
			{
				startDate: "2026-11-10",
				endDate: "2026-11-10",
			},
		);
		expect(history).toMatchObject([
			{
				employeeId: ids.anna,
				date: "2026-11-10",
				kind: "unsettled",
				method: "manual",
				actorUserId: "t1896-holder",
				actorName: "t1896-holder",
				reason: "Settled the wrong week",
				paid: { creditedMinutes: 480, absences: [] },
			},
			{
				employeeId: ids.anna,
				date: "2026-11-10",
				kind: "settled",
				method: "manual",
				actorUserId: "t1896-holder",
				reason: null,
				paid: { creditedMinutes: 480, absences: [] },
			},
		]);

		// The day can be settled again, with its current values.
		const again = await settleDays(
			ORG,
			holder,
			{},
			{ startDate: "2026-11-10", endDate: "2026-11-10" },
		);
		expect(again.status === "settled" && again.newlySettled).toHaveLength(1);
	});

	it("never unsettles or shows the history of days outside the grant", async () => {
		await settleDays(ORG, holder, {}, week);
		await admin.query(
			`insert into payroll_settled_day (organization_id, employee_id, date, timezone, credited_minutes, method)
			 values ($1, $2, '2026-11-10', 'Europe/Berlin', 480, 'manual')`,
			[OTHER_ORG, ids.foreign],
		);

		const foreign = await unsettleDays(
			ORG,
			holder,
			[{ employeeId: ids.foreign, date: "2026-11-10" }],
			"Mistake",
		);
		const otherOrganization = await unsettleDays(
			OTHER_ORG,
			holder,
			[{ employeeId: ids.foreign, date: "2026-11-10" }],
			"Mistake",
		);
		const history = await settlementHistory(ORG, holder, { employeeIds: [ids.foreign] }, week);

		expect(foreign).toEqual({ status: "out_of_scope", employeeIds: [ids.foreign] });
		expect(otherOrganization.status).toBe("out_of_scope");
		expect(history).toEqual([]);
		const { rows } = await admin.query(
			"select count(*)::int as count from payroll_settled_day where unsettled_at is null",
		);
		expect(rows[0].count).toBeGreaterThanOrEqual(8);
	});

	it("keeps the history append-only", async () => {
		await settleDays(ORG, holder, {}, { startDate: "2026-11-10", endDate: "2026-11-10" });

		await expect(
			admin.query("update payroll_settled_day_event set reason = 'x' where organization_id = $1", [
				ORG,
			]),
		).rejects.toThrow(/append-only/);
	});
});
