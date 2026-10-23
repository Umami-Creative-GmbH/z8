import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
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
								id: `t1436-managed-${harness.userId}`,
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

const { getManagedEmployees } = await import("./actions");
const { runtime } = await import("@/lib/effect/runtime");
const { ManagerService } = await import("@/lib/effect/services/manager.service");

/** A departure cutoff in the past, so that a pending departure is due (#1438). */
const PAST_CUTOFF = "2026-09-15T00:00:00Z";

/** The action as a forged client call could invoke it, with extra arguments. */
const callWithForgedArguments = getManagedEmployees as unknown as (
	...args: unknown[]
) => ReturnType<typeof getManagedEmployees>;

describe("Your team lists only the caller's reports in the active organization (#1436)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	let organizationA: string;
	let organizationB: string;
	let managerUserId: string;
	let managerInA: string;
	let managerInB: string;
	let reportInA: string;
	let reportInB: string;
	let otherManagerUserId: string;
	let otherManagerInA: string;
	let otherReportInA: string;
	let teamInA: string;
	let deactivatedReportInA: string;
	let departedReportInA: string;
	let formerManagerInA: string;
	let reportOfFormerManagerInA: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationA = fixture.organizationId;
		organizationB = await fixture.createOrganization();

		const manager = await fixture.seedEmployee();
		managerUserId = manager.userId;
		managerInA = manager.employeeId;
		managerInB = await seedSecondEmployment(managerUserId, organizationB);
		await setRole(managerInA, "manager");
		await setRole(managerInB, "manager");

		reportInA = (await fixture.seedEmployee()).employeeId;
		reportInB = (await fixture.seedEmployee({ organizationId: organizationB })).employeeId;

		const otherManager = await fixture.seedEmployee();
		otherManagerUserId = otherManager.userId;
		otherManagerInA = otherManager.employeeId;
		await setRole(otherManagerInA, "manager");
		otherReportInA = (await fixture.seedEmployee()).employeeId;

		teamInA = randomUUID();
		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Ops', now())`,
			[teamInA, organizationA],
		);
		await fixture.pool.query(
			`update employee set team_id = $1, position = 'Designer' where id = $2`,
			[teamInA, reportInA],
		);

		await link(reportInA, managerInA);
		await link(reportInB, managerInB);
		await link(otherReportInA, otherManagerInA);

		// Former employees (#1438): a deactivated report, a report whose departure
		// is due, and a deactivated manager whose current report stays linked.
		deactivatedReportInA = (await fixture.seedEmployee({ isActive: false })).employeeId;
		const departed = await fixture.seedEmployee();
		departedReportInA = departed.employeeId;
		await dueDeparture(departed);
		await link(deactivatedReportInA, managerInA);
		await link(departedReportInA, managerInA);
		formerManagerInA = (await fixture.seedEmployee({ isActive: false })).employeeId;
		await setRole(formerManagerInA, "manager");
		reportOfFormerManagerInA = (await fixture.seedEmployee()).employeeId;
		await link(reportOfFormerManagerInA, formerManagerInA);
	});

	async function dueDeparture(target: { employeeId: string; employmentPeriodId: string }) {
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', $4, $5, gen_random_uuid(), 'test', 1, 'pending')`,
			[organizationA, target.employeeId, target.employmentPeriodId, PAST_CUTOFF, fixture.ownerUserId],
		);
	}

	async function serviceReports(
		managerId: string,
		organizationId: string,
		roster: "current" | "all",
	) {
		const service = await runtime.runPromise(ManagerService);
		const employees = await runtime.runPromise(
			service.getManagedEmployees(managerId, organizationId, { roster }),
		);
		return employees.map((employee) => employee.id).toSorted();
	}

	beforeEach(() => {
		harness.userId = managerUserId;
		harness.organizationId = organizationA;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function seedSecondEmployment(userId: string, organizationId: string) {
		const employeeId = randomUUID();
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, 'member', 'approved', now())`,
			[randomUUID(), organizationId, userId],
		);
		await fixture.pool.query(
			`insert into employee (id, user_id, organization_id, role, is_active, start_date, updated_at)
			 values ($1, $2, $3, 'employee', true, now(), now())`,
			[employeeId, userId, organizationId],
		);
		return employeeId;
	}

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

	async function load() {
		const result = await getManagedEmployees();
		if (!result.success) throw new Error(String(result.error));
		return result.data;
	}

	it("lists the caller's reports in the active organization only", async () => {
		const data = await load();

		expect(data.isManager).toBe(true);
		expect(data.employees.map((employee) => employee.id)).toEqual([reportInA]);
	});

	it("follows the active organization when the caller manages in several", async () => {
		harness.organizationId = organizationB;

		const data = await load();

		expect(data.employees.map((employee) => employee.id)).toEqual([reportInB]);
	});

	it("ignores a forged manager id and lists only the caller's own reports", async () => {
		for (const forged of [otherManagerInA, managerInB, { managerId: otherManagerInA }]) {
			const result = await callWithForgedArguments(forged);
			if (!result.success) throw new Error(String(result.error));
			expect(result.data.employees.map((employee) => employee.id)).toEqual([reportInA]);
		}
	});

	it("never lists another manager's reports", async () => {
		harness.userId = otherManagerUserId;

		const data = await load();

		expect(data.employees.map((employee) => employee.id)).toEqual([otherReportInA]);
	});

	it("returns nothing to a caller without an employee in the active organization", async () => {
		const outsider = await fixture.seedEmployee({ organizationId: organizationB });
		harness.userId = outsider.userId;
		harness.organizationId = organizationA;

		const data = await load();

		expect(data).toEqual({ isManager: false, employees: [] });
	});

	it("returns nothing without an active organization", async () => {
		harness.organizationId = null;

		const data = await load();

		expect(data).toEqual({ isManager: false, employees: [] });
	});

	it("still shows the widget to an admin without reports", async () => {
		harness.userId = fixture.ownerUserId;

		const data = await load();

		expect(data).toEqual({ isManager: true, employees: [] });
	});

	it("leaves out a deactivated report and one past a due departure (#1438)", async () => {
		const data = await load();

		expect(data.employees.map((employee) => employee.id)).toEqual([reportInA]);
	});

	it("lists no reports for a manager who is a former employee (#1438)", async () => {
		expect(await serviceReports(formerManagerInA, organizationA, "current")).toEqual([]);
	});

	it("keeps every link for manager authority, former employees included (#1438)", async () => {
		expect(await serviceReports(managerInA, organizationA, "all")).toEqual(
			[reportInA, deactivatedReportInA, departedReportInA].toSorted(),
		);
		expect(await serviceReports(formerManagerInA, organizationA, "all")).toEqual([
			reportOfFormerManagerInA,
		]);
	});

	it("keeps both roster readings inside the organization (#1438)", async () => {
		expect(await serviceReports(managerInA, organizationB, "current")).toEqual([]);
		expect(await serviceReports(managerInA, organizationB, "all")).toEqual([]);
		expect(await serviceReports(managerInB, organizationB, "current")).toEqual([reportInB]);
	});

	it("returns only the fields the widget renders", async () => {
		const [employee] = (await load()).employees;

		expect(employee).toEqual({
			id: reportInA,
			position: "Designer",
			user: {
				id: expect.any(String),
				name: "Lifecycle",
				email: expect.stringMatching(/@lifecycle\.test$/),
				image: null,
			},
			team: { name: "Ops" },
		});
	});
});
