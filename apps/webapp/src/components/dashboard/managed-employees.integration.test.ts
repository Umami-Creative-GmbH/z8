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
	});

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
