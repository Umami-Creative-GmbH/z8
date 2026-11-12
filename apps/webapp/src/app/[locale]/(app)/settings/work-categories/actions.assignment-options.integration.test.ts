/**
 * The work category assignment dialog lists the teams and employees of the
 * organization it was opened for. Only a caller with settings access to that
 * organization gets them. The real actions run against a disposable database;
 * only the request/session, Next cache and logger are replaced.
 */
import { randomUUID } from "node:crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
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
							user: { id: harness.userId, role: "user", name: "Caller" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock(
	"@/lib/organization-mfa/organization-access",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("@/lib/organization-mfa/organization-access")
		>()),
		canAccessOrganization: async () => true,
	}),
);

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({
			error: () => {},
			warn: () => {},
			info: () => {},
			debug: () => {},
		}),
	}),
}));

const { getEmployeesForAssignment, getTeamsForAssignment } = await import(
	"./actions"
);

describe("work category assignment options on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let outsiderUserId: string;
	let pendingAdminUserId: string;
	let inactiveOwner: SeededEmployee;
	let ownerWithoutEmployeeUserId: string;
	let manager: SeededEmployee;
	const teamId = randomUUID();
	const otherTeamId = randomUUID();

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		const otherOrganizationId = await fixture.createOrganization();
		outsiderUserId = (
			await fixture.seedEmployee({
				organizationId: otherOrganizationId,
				role: "owner",
			})
		).userId;

		const pendingAdmin = await fixture.seedEmployee({ role: "admin" });
		pendingAdminUserId = pendingAdmin.userId;
		await fixture.pool.query(
			`update member set status = 'pending' where id = $1`,
			[pendingAdmin.memberId],
		);

		inactiveOwner = await fixture.seedEmployee({
			role: "owner",
			isActive: false,
		});

		const ownerWithoutEmployee = await fixture.seedEmployee({
			role: "owner",
			withPeriod: false,
		});
		ownerWithoutEmployeeUserId = ownerWithoutEmployee.userId;
		await fixture.pool.query(`delete from employee where id = $1`, [
			ownerWithoutEmployee.employeeId,
		]);

		for (const [id, name] of [
			[teamId, "Ops"],
			[otherTeamId, "Sales"],
		]) {
			await fixture.pool.query(
				`insert into team (id, organization_id, name, updated_at) values ($1, $2, $3, now())`,
				[id, fixture.organizationId, name],
			);
		}

		manager = await fixture.seedEmployee();
		await fixture.pool.query(
			`update employee set role = 'manager' where id = $1`,
			[manager.employeeId],
		);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[fixture.employeeId, manager.employeeId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into team_permissions
			 (employee_id, organization_id, team_id, can_manage_team_settings, granted_by, updated_at)
			 values ($1, $2, $3, true, $4, now())`,
			[
				manager.employeeId,
				fixture.organizationId,
				teamId,
				fixture.ownerEmployeeId,
			],
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		harness.organizationId = fixture.organizationId;
	});

	it("refuses the teams of an organization the caller does not belong to", async () => {
		harness.userId = outsiderUserId;

		const result = await getTeamsForAssignment();

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it("refuses the employees of an organization the caller does not belong to", async () => {
		harness.userId = outsiderUserId;

		const result = await getEmployeesForAssignment();

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it("refuses a pending admin membership", async () => {
		harness.userId = pendingAdminUserId;

		expect(await getTeamsForAssignment()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			await getEmployeesForAssignment(),
		).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it("refuses an owner who is a former employee", async () => {
		harness.userId = inactiveOwner.userId;

		expect(await getTeamsForAssignment()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			await getEmployeesForAssignment(),
		).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it.each([
		["an owner with an employee record", () => fixture.ownerUserId],
		["an owner without an employee record", () => ownerWithoutEmployeeUserId],
	])("gives %s every team and current employee", async (_case, userId) => {
		harness.userId = userId();

		const teams = await getTeamsForAssignment();
		const employees = await getEmployeesForAssignment();

		expect(teams).toEqual({
			success: true,
			data: [
				{ id: teamId, name: "Ops" },
				{ id: otherTeamId, name: "Sales" },
			],
		});
		if (!employees.success) throw new Error(employees.error);
		const employeeIds = employees.data.map((row) => row.id);
		expect(employeeIds).toEqual(
			expect.arrayContaining([
				fixture.ownerEmployeeId,
				fixture.employeeId,
				manager.employeeId,
			]),
		);
		expect(employeeIds).not.toContain(inactiveOwner.employeeId);
	});

	it("gives a scoped manager only the employees they manage", async () => {
		harness.userId = manager.userId;

		const employees = await getEmployeesForAssignment();

		if (!employees.success) throw new Error(employees.error);
		expect(employees.data.map((row) => row.id)).toEqual([fixture.employeeId]);
	});

	it("gives a scoped manager only the teams the team settings let them manage", async () => {
		harness.userId = manager.userId;

		const teams = await getTeamsForAssignment();

		expect(teams).toEqual({
			success: true,
			data: [{ id: teamId, name: "Ops" }],
		});
	});
});
