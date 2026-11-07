/**
 * The work policy assignment dialog lists the teams of the organization it was
 * opened for. Only a caller with settings access to that organization gets
 * them. The real actions run against a disposable database; only the
 * request/session, Next cache and logger are replaced.
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

const { getTeamsForAssignment } = await import("./actions");

describe("work policy assignment teams on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let outsiderUserId: string;
	let pendingAdminUserId: string;
	let inactiveOwnerUserId: string;
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

		inactiveOwnerUserId = (
			await fixture.seedEmployee({ role: "owner", isActive: false })
		).userId;

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
			`insert into team_permissions
			 (employee_id, organization_id, team_id, can_manage_team_members, granted_by, updated_at)
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

	it.each([
		["an organization the caller does not belong to", () => outsiderUserId],
		["a pending admin membership", () => pendingAdminUserId],
		["an owner who is a former employee", () => inactiveOwnerUserId],
	])("refuses the teams for %s", async (_case, userId) => {
		harness.userId = userId();

		const result = await getTeamsForAssignment(fixture.organizationId);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it.each([
		["an owner with an employee record", () => fixture.ownerUserId],
		["an owner without an employee record", () => ownerWithoutEmployeeUserId],
	])("gives %s every team", async (_case, userId) => {
		harness.userId = userId();

		const result = await getTeamsForAssignment(fixture.organizationId);

		expect(result).toEqual({
			success: true,
			data: [
				{ id: teamId, name: "Ops" },
				{ id: otherTeamId, name: "Sales" },
			],
		});
	});

	it("gives a scoped manager only the teams the team settings let them manage", async () => {
		harness.userId = manager.userId;

		const result = await getTeamsForAssignment(fixture.organizationId);

		expect(result).toEqual({
			success: true,
			data: [{ id: teamId, name: "Ops" }],
		});
	});
});
