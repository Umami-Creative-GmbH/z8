/**
 * PostgreSQL contract for the dashboard widgets that answer "who works here
 * now" (#1438, Organization ADR 0006): who's out today, upcoming time off, the
 * team calendar and the team overview count only the current roster of the
 * caller's active organization.
 */
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t1438-dashboard-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const { getTeamCalendarData, getTeamOverviewStats, getUpcomingAbsences, getWhosOutToday } =
	await import("./actions");

/** A departure cutoff in the past, so that a pending departure is due. */
const PAST_CUTOFF = "2026-09-15T00:00:00Z";

// The actions read "today" from the server's clock and zone, as this does.
const today = Temporal.Now.plainDateISO();
const day = (days: number) => today.add({ days }).toString();

describe("dashboard widgets count only the current roster (#1438)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	let organizationB: string;
	let current: string;
	let deactivated: SeededEmployee;
	let departed: SeededEmployee;
	let outsider: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationB = await fixture.createOrganization();
		current = fixture.employeeId;
		deactivated = await fixture.seedEmployee({ isActive: false });
		departed = await fixture.seedEmployee();
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', $4, $5, gen_random_uuid(), 'test', 1, 'pending')`,
			[
				fixture.organizationId,
				departed.employeeId,
				departed.employmentPeriodId,
				PAST_CUTOFF,
				fixture.ownerUserId,
			],
		);
		outsider = await fixture.seedEmployee({ organizationId: organizationB });

		const categoryA = await seedCategory(fixture.organizationId);
		const categoryB = await seedCategory(organizationB);
		for (const employeeId of [current, deactivated.employeeId, departed.employeeId]) {
			await seedAbsence(employeeId, fixture.organizationId, categoryA, day(-1), day(2));
			await seedAbsence(employeeId, fixture.organizationId, categoryA, day(5), day(6));
		}
		await seedAbsence(outsider.employeeId, organizationB, categoryB, day(-1), day(2));
		await seedAbsence(outsider.employeeId, organizationB, categoryB, day(5), day(6));

		// Weekly hours: 30 for the current employee, 10 for each former one.
		const thirty = await seedSchedulePolicy("Thirty", "30.00");
		const ten = await seedSchedulePolicy("Ten", "10.00");
		await assignPolicy(thirty, current);
		await assignPolicy(ten, deactivated.employeeId);
		await assignPolicy(ten, departed.employeeId);
	});

	beforeEach(() => {
		harness.userId = fixture.ownerUserId;
		harness.organizationId = fixture.organizationId;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function seedCategory(organizationId: string) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, requires_work_time, counts_against_vacation, is_active, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', true, false, true, true, now())`,
			[id, organizationId],
		);
		return id;
	}

	async function seedAbsence(
		employeeId: string,
		organizationId: string,
		categoryId: string,
		startDate: string,
		endDate: string,
	) {
		await fixture.pool.query(
			`insert into absence_entry
			 (employee_id, category_id, start_date, end_date, status, organization_id, updated_at)
			 values ($1, $2, $3, $4, 'approved', $5, now())`,
			[employeeId, categoryId, startDate, endDate, organizationId],
		);
	}

	async function seedSchedulePolicy(name: string, hoursPerCycle: string) {
		const policyId = randomUUID();
		await fixture.pool.query(
			`insert into work_policy (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, $4, now())`,
			[policyId, fixture.organizationId, name, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule (policy_id, schedule_cycle, schedule_type, hours_per_cycle, updated_at)
			 values ($1, 'weekly', 'simple', $2, now())`,
			[policyId, hoursPerCycle],
		);
		return policyId;
	}

	async function assignPolicy(policyId: string, employeeId: string) {
		await fixture.pool.query(
			`insert into work_policy_assignment
			 (policy_id, organization_id, assignment_type, employee_id, priority, created_by, updated_at)
			 values ($1, $2, 'employee', $3, 2, $4, now())`,
			[policyId, fixture.organizationId, employeeId, fixture.ownerUserId],
		);
	}

	async function unwrap<T>(
		result: Promise<{ success: true; data: T } | { success: false; error: unknown }>,
	) {
		const settled = await result;
		if (!settled.success) throw new Error(String(settled.error));
		return settled.data;
	}

	it("lists only current employees as out today", async () => {
		const data = await unwrap(getWhosOutToday());

		expect(data.outToday.map((entry) => entry.id)).toEqual([current]);
		expect(data.totalOut).toBe(1);
	});

	it("lists only current employees' upcoming time off", async () => {
		const absences = (await unwrap(getUpcomingAbsences(50))) as Array<{ employeeId: string }>;

		expect([...new Set(absences.map((absence) => absence.employeeId))]).toEqual([current]);
	});

	it("keeps former employees on past calendar days and drops their later absences", async () => {
		type CalendarData = { absenceDays: Array<{ date: string; employees: Array<{ id: string }> }> };
		const onDate = async (date: string) => {
			const plain = Temporal.PlainDate.from(date);
			const data = (await unwrap(getTeamCalendarData(plain.month, plain.year))) as CalendarData;
			return new Set(
				data.absenceDays
					.filter((entry) => entry.date === date)
					.flatMap((entry) => entry.employees.map((e) => e.id)),
			);
		};

		// Started yesterday: a view of the past keeps everyone who was here.
		expect(await onDate(day(-1))).toEqual(
			new Set([current, deactivated.employeeId, departed.employeeId]),
		);
		// Starts after today: only the current roster.
		expect(await onDate(day(5))).toEqual(new Set([current]));
	});

	it("counts and averages the current roster only", async () => {
		const stats = await unwrap(getTeamOverviewStats());

		// The owner and the current employee; the owner has no schedule.
		expect(stats.currentEmployees).toBe(2);
		expect(stats.avgWorkHours).toBe(30);
	});

	it("reads the other organization's roster when it is the active one", async () => {
		harness.userId = outsider.userId;
		harness.organizationId = organizationB;

		const out = await unwrap(getWhosOutToday());
		const stats = await unwrap(getTeamOverviewStats());

		expect(out.outToday.map((entry) => entry.id)).toEqual([outsider.employeeId]);
		expect(stats.currentEmployees).toBe(1);
	});
});
