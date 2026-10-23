/**
 * PostgreSQL contract for former employees on `/team` and in the calendar
 * selector (#1438, Organization ADR 0006). `/team` lists the current roster
 * and shows former reports, marked, only on request. The calendar selector is
 * a view of the past: it keeps former reports, marked.
 */
import { randomUUID } from "node:crypto";
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
								id: `t1438-team-${harness.userId}`,
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

const { getCalendarManagedEmployees, getCurrentEmployee, getManagedEmployees } = await import(
	"./actions"
);

/**
 * A departure cutoff in the past, so that a pending departure is due. 13:00 UTC
 * is already the next day in Auckland, the organization's timezone (#1439).
 */
const PAST_CUTOFF = "2026-09-14T13:00:00Z";
const PAST_CUTOFF_LOCAL_DATE = "2026-09-15";

describe("former employees on /team and in the calendar selector (#1438)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	let organizationB: string;
	let manager: SeededEmployee;
	let current: string;
	let deactivated: string;
	let departed: SeededEmployee;
	let otherOrganizationReport: string;
	let formerManager: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'Pacific/Auckland' where id = $1`, [
			fixture.organizationId,
		]);
		organizationB = await fixture.createOrganization();
		manager = await fixture.seedEmployee();
		await setRole(manager.employeeId, "manager");
		current = fixture.employeeId;
		deactivated = (await fixture.seedEmployee({ isActive: false })).employeeId;
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
		for (const report of [current, deactivated, departed.employeeId]) {
			await link(report, manager.employeeId);
		}
		// The same manager also works in organization B, with a report there.
		const managerInB = randomUUID();
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, 'member', 'approved', now())`,
			[randomUUID(), organizationB, manager.userId],
		);
		await fixture.pool.query(
			`insert into employee (id, user_id, organization_id, role, is_active, start_date, updated_at)
			 values ($1, $2, $3, 'manager', true, now(), now())`,
			[managerInB, manager.userId, organizationB],
		);
		otherOrganizationReport = (await fixture.seedEmployee({ organizationId: organizationB }))
			.employeeId;
		await link(otherOrganizationReport, managerInB);
		formerManager = await fixture.seedEmployee({ isActive: false });
		await setRole(formerManager.employeeId, "manager");
		await link(current, formerManager.employeeId);
	});

	beforeEach(() => {
		harness.userId = manager.userId;
		harness.organizationId = fixture.organizationId;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function setRole(employeeId: string, role: "manager" | "admin" | "employee") {
		await fixture.pool.query(`update employee set role = $1 where id = $2`, [role, employeeId]);
	}

	async function link(employeeId: string, managerId: string) {
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[employeeId, managerId, fixture.ownerUserId],
		);
	}

	async function team(options?: { includeFormer?: boolean }) {
		const result = await getManagedEmployees(options);
		if (!result.success) throw new Error(String(result.error));
		return new Map(result.data.map((entry) => [entry.id, entry.isFormer]));
	}

	it("lists the viewer and current reports only by default", async () => {
		const listed = await team();

		expect([...listed.keys()].toSorted()).toEqual([manager.employeeId, current].toSorted());
		expect([...listed.values()]).toEqual([false, false]);
	});

	it("adds former reports, marked, when asked to show them", async () => {
		const listed = await team({ includeFormer: true });

		expect(Object.fromEntries(listed)).toEqual({
			[manager.employeeId]: false,
			[current]: false,
			[deactivated]: true,
			[departed.employeeId]: true,
		});
	});

	it("dates former reports by when they left, in the organization's timezone (#1439)", async () => {
		const result = await getManagedEmployees({ includeFormer: true });
		if (!result.success) throw new Error(String(result.error));
		const since = Object.fromEntries(result.data.map((entry) => [entry.id, entry.formerSince]));

		expect(since[departed.employeeId]).toBe(PAST_CUTOFF_LOCAL_DATE);
		// Deactivated before the instant was stored: the date isn't recorded.
		expect(since[deactivated]).toBeNull();
		expect(since[current]).toBeUndefined();
		expect(since[manager.employeeId]).toBeUndefined();
	});

	it("keeps former reports in the calendar selector, marked and dated, inside the organization", async () => {
		const result = await getCalendarManagedEmployees({ fresh: true });
		if (!result.success) throw new Error(String(result.error));

		expect(Object.fromEntries(result.data.map((entry) => [entry.id, entry.isFormer]))).toEqual({
			[current]: false,
			[deactivated]: true,
			[departed.employeeId]: true,
		});
		const since = Object.fromEntries(result.data.map((entry) => [entry.id, entry.formerSince]));
		expect(since).toEqual({
			[current]: undefined,
			[deactivated]: null,
			[departed.employeeId]: PAST_CUTOFF_LOCAL_DATE,
		});
		expect(Object.hasOwn(result.data.find((entry) => entry.id === current) ?? {}, "formerSince")).toBe(
			false,
		);
	});

	it("follows the active organization", async () => {
		harness.organizationId = organizationB;

		const listed = await team({ includeFormer: true });

		expect(listed.has(otherOrganizationReport)).toBe(true);
		expect(listed.has(current)).toBe(false);
		expect(listed.has(deactivated)).toBe(false);
	});

	it("refuses /team and the selector to a viewer who is a former employee", async () => {
		harness.userId = formerManager.userId;

		expect(await getCurrentEmployee()).toBeNull();
		expect((await getManagedEmployees()).success).toBe(false);
		expect((await getCalendarManagedEmployees({ fresh: true })).success).toBe(false);
	});
});
