/**
 * Team settings serve only callers with settings access to the organization:
 * an approved membership, and not a former employee there. The real actions
 * run against a disposable database; only the request/session, Next cache and
 * logger are replaced.
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

const { getTeam, listTeams } = await import("./actions");

describe("team settings actor on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let pendingAdminUserId: string;
	let inactiveOwnerUserId: string;
	let ownerWithoutEmployeeUserId: string;
	const teamId = randomUUID();
	const foreignTeamId = randomUUID();

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();

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

		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Ops', now())`,
			[teamId, fixture.organizationId],
		);
		const foreignOrganizationId = await fixture.createOrganization();
		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Elsewhere', now())`,
			[foreignTeamId, foreignOrganizationId],
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		harness.organizationId = fixture.organizationId;
	});

	it.each([
		["a pending admin membership", () => pendingAdminUserId],
		["an owner who is a former employee", () => inactiveOwnerUserId],
	])("refuses %s", async (_case, userId) => {
		harness.userId = userId();

		expect(await listTeams()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await getTeam(teamId)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it("serves an owner without an employee record as an org admin", async () => {
		harness.userId = ownerWithoutEmployeeUserId;

		const result = await listTeams();

		if (!result.success) throw new Error(result.error);
		expect(result.data.map((teamRecord) => teamRecord.id)).toEqual([teamId]);
	});

	it("reports another organization's team as not found", async () => {
		harness.userId = ownerWithoutEmployeeUserId;

		expect(await getTeam(foreignTeamId)).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
	});
});
