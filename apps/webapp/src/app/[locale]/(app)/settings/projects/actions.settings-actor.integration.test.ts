/**
 * Project settings serve only callers with settings access to the
 * organization: an owner or admin who is a former employee there has none. The
 * real actions run against a disposable database; only the request/session,
 * SSO proof, billing, notification delivery, Next cache and logger are replaced.
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

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(
		importOriginal,
	),
);

vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = {
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
	};
	return {
		...original,
		logger: { ...original.logger, ...quiet },
		createLogger: () => ({ ...original.logger, ...quiet }),
	};
});

const { getTeamsForSelection } = await import("./actions");

describe("project settings actor on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let inactiveOwnerUserId: string;
	let inactiveAdminUserId: string;
	let ownerWithoutEmployeeUserId: string;
	const teamId = randomUUID();

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		inactiveOwnerUserId = (
			await fixture.seedEmployee({ role: "owner", isActive: false })
		).userId;
		inactiveAdminUserId = (
			await fixture.seedEmployee({ role: "admin", isActive: false })
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
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		harness.organizationId = fixture.organizationId;
	});

	it.each([
		["owner", () => inactiveOwnerUserId],
		["admin", () => inactiveAdminUserId],
	])("refuses an %s who is a former employee", async (_role, userId) => {
		harness.userId = userId();

		const result = await getTeamsForSelection(fixture.organizationId);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it.each([
		["an active owner", () => fixture.ownerUserId],
		["an owner without an employee record", () => ownerWithoutEmployeeUserId],
	])("serves %s as an org admin", async (_case, userId) => {
		harness.userId = userId();

		const result = await getTeamsForSelection(fixture.organizationId);

		expect(result).toEqual({
			success: true,
			data: [{ id: teamId, name: "Ops" }],
		});
	});
});
