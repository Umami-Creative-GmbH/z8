/**
 * #1893: the payroll period read model against a disposable PostgreSQL database.
 * `readPeriod` resolves the actor's payroll access grant itself, so these tests seed
 * grants, employees, canonical work and absences in two organizations and check what
 * a grant holder can read.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

const { readPeriod } = await import("./read-period");
const { readPeriodDay } = await import("./read-day");

const admin = integrationAdminPool();
const ORG = "t1893-org";
const OTHER_ORG = "t1893-other";
const users = ["t1893-owner", "t1893-holder", "t1893-anna", "t1893-ben", "t1893-foreign"];
const ids = {
	owner: "d1893000-0000-4000-8000-000000000001",
	holder: "d1893000-0000-4000-8000-000000000002",
	anna: "d1893000-0000-4000-8000-000000000003",
	ben: "d1893000-0000-4000-8000-000000000004",
	foreign: "d1893000-0000-4000-8000-000000000005",
} as const;
const november = { startDate: "2026-11-01", endDate: "2026-11-30", label: "November 2026" };
const holder = { employeeId: ids.holder, name: "Holder" };

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
	await admin.query(
		`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
		   duration_minutes, approval_state, origin, created_by, updated_by, updated_at)
		 values (gen_random_uuid(), $1, $2, 'work', $3, $4, $5, 'approved', 'manual',
		   't1893-owner', 't1893-owner', now())`,
		[organizationId, employeeId, startAt, endAt, minutes],
	);
}

/** A pending full-day canonical absence, encoded as the absence writers store it. */
async function pendingAbsence(organizationId: string, employeeId: string, date: string) {
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
		   ($3::date + interval '1 day' - interval '1 millisecond'), 'pending', 'manual',
		   't1893-owner', now()) returning id`,
		[organizationId, employeeId, date],
	);
	await admin.query(
		`insert into time_record_absence (record_id, organization_id, record_kind, absence_category_id)
		 values ($1, $2, 'absence', $3)`,
		[record[0].id, organizationId, category[0].id],
	);
}

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
		 values ($1, 't1893-owner', $2, 'admin', 'OWN-1', now())`,
		[ids.owner, ORG],
	);
	await employee(ids.holder, "t1893-holder", ORG, "HLD-1");
	await employee(ids.anna, "t1893-anna", ORG, "ANN-1");
	await employee(ids.ben, "t1893-ben", ORG, "BEN-1");
	await employee(ids.foreign, "t1893-foreign", OTHER_ORG, "FOR-1");

	// The holder's grant covers Anna only.
	const { rows: grant } = await admin.query(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'specific', 't1893-owner', now()) returning id`,
		[ORG, ids.holder],
	);
	await admin.query(
		`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
		 values ($1, $2, $3, 't1893-owner')`,
		[ORG, grant[0].id, ids.anna],
	);

	// 22:00-06:00 Berlin on 9/10 November.
	await work(ORG, ids.anna, "2026-11-09T21:00:00Z", "2026-11-10T05:00:00Z", 480);
	await work(ORG, ids.ben, "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
	await work(OTHER_ORG, ids.foreign, "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
	await pendingAbsence(ORG, ids.anna, "2026-11-12");
	await pendingAbsence(OTHER_ORG, ids.foreign, "2026-11-12");
}

describe("readPeriod on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	beforeEach(seed);
	afterAll(cleanup);

	it("reads the grant's employees with their local days", async () => {
		const read = await readPeriod(ORG, holder, november);

		expect(read.employees.map((row) => row.id)).toEqual([ids.anna]);
		const days = read.employees[0]?.days ?? [];
		expect(days).toHaveLength(30);
		expect(
			days.filter((day) => day.creditedMinutes > 0).map((day) => [day.date, day.creditedMinutes]),
		).toEqual([
			["2026-11-09", 120],
			["2026-11-10", 360],
		]);
		expect(days.find((day) => day.date === "2026-11-12")?.absences).toMatchObject([
			{ categoryName: "Vacation", period: "full_day", approvalState: "pending" },
		]);
		expect(read.absences.map((row) => [row.employeeId, row.startDate])).toEqual([
			[ids.anna, "2026-11-12"],
		]);
		expect(read.summary.employees.map((row) => [row.id, row.workedHours])).toEqual([[ids.anna, 8]]);
	});

	it("shows the required hours of the employee's work policy per day", async () => {
		const { rows: policy } = await admin.query(
			`insert into work_policy (id, organization_id, name, schedule_enabled, regulation_enabled, created_by, updated_at)
			 values (gen_random_uuid(), $1, '40 hour week', true, false, 't1893-owner', now()) returning id`,
			[ORG],
		);
		await admin.query(
			`insert into work_policy_schedule (id, policy_id, schedule_cycle, schedule_type, working_days_preset, hours_per_cycle, updated_at)
			 values (gen_random_uuid(), $1, 'weekly', 'simple', 'weekdays', '40.00', now())`,
			[policy[0].id],
		);
		await admin.query(
			`insert into work_policy_assignment (policy_id, organization_id, assignment_type, employee_id, priority, created_by, updated_at)
			 values ($1, $2, 'employee', $3, 2, 't1893-owner', now())`,
			[policy[0].id, ORG, ids.anna],
		);
		await admin.query(
			`insert into organization_tracking_settings (organization_id, tracking_start_date, activated_at)
			 values ($1, '2026-01-01', now())`,
			[ORG],
		);

		const read = await readPeriod(ORG, holder, november);

		const days = read.employees[0]?.days ?? [];
		// Monday 9 November needs eight hours; Sunday 8 November none.
		expect(days.find((day) => day.date === "2026-11-09")).toMatchObject({
			creditedMinutes: 120,
			requiredMinutes: 480,
			differenceMinutes: -360,
		});
		expect(days.find((day) => day.date === "2026-11-08")?.requiredMinutes).toBe(0);
	});

	it("never widens the grant's scope to requested employees outside it", async () => {
		const read = await readPeriod(ORG, holder, november, {
			employeeIds: [ids.anna, ids.ben, ids.foreign],
		});

		expect(read.employees.map((row) => row.id)).toEqual([ids.anna]);
	});

	describe("employees who left (#1894)", () => {
		const left = {
			mid: "d1893000-0000-4000-8000-000000000011",
			before: "d1893000-0000-4000-8000-000000000012",
			uncovered: "d1893000-0000-4000-8000-000000000013",
		} as const;

		async function departedEmployee(
			id: string,
			userId: string,
			number: string,
			lastWorkingDay: string,
		) {
			await admin.query(
				`insert into "user" (id, name, email, created_at, updated_at)
				 values ($1, $1, $1 || '@example.test', now(), now()) on conflict (id) do nothing`,
				[userId],
			);
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, employee_number, is_active, updated_at)
				 values ($1, $2, $3, 'employee', $4, false, now())`,
				[id, userId, ORG, number],
			);
			// The next local midnight in Berlin winter time.
			const cutoff = `${lastWorkingDay}T23:00:00Z`;
			const { rows } = await admin.query(
				`insert into employee_employment_period
				   (organization_id, employee_id, status, started_at, ended_at, start_provenance)
				 values ($1, $2, 'closed', '2026-01-01T00:00:00Z', $3, 'recorded') returning id`,
				[ORG, id, cutoff],
			);
			await admin.query(
				`insert into employee_departure
				   (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
				    cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
				 values ($1, $2, $3, 'scheduled', $4, 'Europe/Berlin', $5, 't1893-owner', gen_random_uuid(),
				         'test', 1, 'effective', $5)`,
				[ORG, id, rows[0].id, lastWorkingDay, cutoff],
			);
		}

		beforeEach(async () => {
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ('t1893-m-holder', $1, 't1893-holder', 'member', 'approved', now())`,
				[ORG],
			);
			await departedEmployee(left.mid, "t1893-left-mid", "LMD-1", "2026-11-13");
			await departedEmployee(left.before, "t1893-left-before", "LBF-1", "2026-10-30");
			await departedEmployee(left.uncovered, "t1893-left-uncovered", "LUN-1", "2026-11-13");
			const { rows: grant } = await admin.query(
				"select id from payroll_access_grant where organization_id = $1",
				[ORG],
			);
			await admin.query(
				`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
				 values ($1, $2, $3, 't1893-owner'), ($1, $2, $4, 't1893-owner')`,
				[ORG, grant[0].id, left.mid, left.before],
			);
			await work(ORG, left.mid, "2026-11-12T08:00:00Z", "2026-11-12T12:00:00Z", 240);
			await work(ORG, left.before, "2026-10-29T08:00:00Z", "2026-10-29T12:00:00Z", 240);
			await work(ORG, left.uncovered, "2026-11-12T08:00:00Z", "2026-11-12T12:00:00Z", 240);
		});

		afterAll(async () => {
			await admin.query('delete from "user" where id like $1', ["t1893-left-%"]);
		});

		it("reads a covered employee who left mid-period, marked with the last working day", async () => {
			const read = await readPeriod(ORG, holder, november);

			expect(read.employees.map((row) => [row.id, row.departure ?? null])).toEqual([
				[ids.anna, null],
				[left.mid, { lastWorkingDay: "2026-11-13" }],
			]);
			const leftMid = read.employees.find((row) => row.id === left.mid);
			expect(leftMid?.days.find((day) => day.date === "2026-11-12")?.creditedMinutes).toBe(240);
			expect(read.summary.employees.map((row) => row.id)).toContain(left.mid);
		});

		it("never reads an employee who left before the period or outside the grant", async () => {
			const read = await readPeriod(ORG, holder, november, {
				employeeIds: [ids.anna, left.mid, left.before, left.uncovered],
			});

			expect(read.employees.map((row) => row.id)).not.toContain(left.before);
			expect(read.employees.map((row) => row.id)).not.toContain(left.uncovered);
		});
	});

	describe("the records of one employee-day (#1894)", () => {
		it("lists work and break records touching the local day, with local times", async () => {
			await admin.query(
				`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
				   duration_minutes, approval_state, origin, created_by, updated_by, updated_at)
				 values (gen_random_uuid(), $1, $2, 'break', '2026-11-10T01:00:00Z', '2026-11-10T01:30:00Z',
				   30, 'approved', 'manual', 't1893-owner', 't1893-owner', now())`,
				[ORG, ids.anna],
			);

			const day = await readPeriodDay(ORG, holder, { employeeId: ids.anna, date: "2026-11-10" });

			expect(day).toMatchObject({
				employeeId: ids.anna,
				date: "2026-11-10",
				timezone: "Europe/Berlin",
			});
			expect(
				day?.records.map((record) => [
					record.kind,
					record.start,
					record.end,
					record.durationMinutes,
					record.approvalState,
				]),
			).toEqual([
				["work", "2026-11-09T22:00", "2026-11-10T06:00", 480, "approved"],
				["break", "2026-11-10T02:00", "2026-11-10T02:30", 30, "approved"],
			]);
		});

		it("reads nothing for an employee outside the grant or the organization", async () => {
			expect(
				await readPeriodDay(ORG, holder, { employeeId: ids.ben, date: "2026-11-10" }),
			).toBeNull();
			expect(
				await readPeriodDay(OTHER_ORG, holder, { employeeId: ids.foreign, date: "2026-11-10" }),
			).toBeNull();
		});
	});

	it("reads nobody for an actor without a grant in the organization", async () => {
		const ownerRead = await readPeriod(ORG, { employeeId: ids.owner, name: "Owner" }, november);
		const foreignRead = await readPeriod(OTHER_ORG, holder, november, {
			employeeIds: [ids.foreign],
		});

		expect(ownerRead.employees).toEqual([]);
		expect(foreignRead.employees).toEqual([]);
		expect(foreignRead.absences).toEqual([]);
	});
});
