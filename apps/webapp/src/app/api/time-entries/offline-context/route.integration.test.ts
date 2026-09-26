/**
 * #267 runtime evidence for the read-only browser clock recovery context.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real route, membership/employee lookups, SSO admission, principal loader and
 * CASL ability run against that database. Only the session and request headers
 * are replaced.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 4,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t267-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

const { GET } = await import("./route");

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`offline context PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t267-offline-context-org",
	otherOrganization: "t267-offline-context-other-org",
	ownerUser: "t267-owner-user",
	managerUser: "t267-manager-user",
	workerUser: "t267-worker-user",
	owner: "d2670000-0000-4000-8000-000000000001",
	manager: "d2670000-0000-4000-8000-000000000002",
	worker: "d2670000-0000-4000-8000-000000000003",
} as const;

describeIntegration("browser clock recovery context on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });

	async function contextAs(userId: string | null, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
		const response = await GET();
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		return { status: response.status, body: await response.json() };
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id in ($1, $2, $3)', [
			ids.ownerUser,
			ids.managerUser,
			ids.workerUser,
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T267 offline context', $1, $3), ($2, 'T267 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Owner', 't267-owner@example.test', $4, $4),
			 ($2, 'Manager', 't267-manager@example.test', $4, $4),
			 ($3, 'Worker', 't267-worker@example.test', $4, $4)`,
			[ids.ownerUser, ids.managerUser, ids.workerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t267-member-owner', $1, $2, 'owner', 'approved', $5),
			 ('t267-member-manager', $1, $3, 'member', 'approved', $5),
			 ('t267-member-worker', $1, $4, 'member', 'approved', $5)`,
			[ids.organization, ids.ownerUser, ids.managerUser, ids.workerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'admin', $8), ($3, $4, $7, 'manager', $8), ($5, $6, $7, 'employee', $8)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.manager,
				ids.managerUser,
				ids.worker,
				ids.workerUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[ids.worker, ids.manager, ids.ownerUser],
		);
	}

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await admin.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") {
			throw new Error("Offline context PostgreSQL is disabled");
		}
	});

	beforeEach(seed);

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("refuses a signed-out request", async () => {
		await expect(contextAs(null)).resolves.toEqual({
			status: 401,
			body: { error: "Unauthorized" },
		});
	});

	it("lets only organization-wide time-entry management review unattributed records", async () => {
		await expect(contextAs(ids.ownerUser)).resolves.toEqual({
			status: 200,
			body: { userId: ids.ownerUser, organizationId: ids.organization, canReviewLegacy: true },
		});
		// A manager's direct-report grant cannot match a record without actor evidence.
		await expect(contextAs(ids.managerUser)).resolves.toEqual({
			status: 200,
			body: {
				userId: ids.managerUser,
				organizationId: ids.organization,
				canReviewLegacy: false,
			},
		});
		await expect(contextAs(ids.workerUser)).resolves.toEqual({
			status: 200,
			body: { userId: ids.workerUser, organizationId: ids.organization, canReviewLegacy: false },
		});
	});

	it("denies recovery access as soon as membership is revoked, without a cached grant", async () => {
		await expect(contextAs(ids.workerUser)).resolves.toMatchObject({ status: 200 });

		await admin.query("update member set status = 'pending' where id = 't267-member-worker'");
		await expect(contextAs(ids.workerUser)).resolves.toEqual({
			status: 403,
			body: { error: "Clock recovery access unavailable" },
		});

		await admin.query("delete from member where id = 't267-member-worker'");
		await expect(contextAs(ids.workerUser)).resolves.toMatchObject({ status: 403 });
	});

	it("denies recovery access when the employee is deactivated", async () => {
		await admin.query("update employee set is_active = false where id = $1", [ids.worker]);

		await expect(contextAs(ids.workerUser)).resolves.toEqual({
			status: 403,
			body: { error: "Clock recovery access unavailable" },
		});
	});

	it("follows granted and withdrawn organization-wide management on the next read", async () => {
		await admin.query("update member set role = 'admin' where id = 't267-member-worker'");
		await admin.query("update employee set role = 'admin' where id = $1", [ids.worker]);
		await expect(contextAs(ids.workerUser)).resolves.toMatchObject({
			status: 200,
			body: { canReviewLegacy: true },
		});

		await admin.query("update member set role = 'member' where id = 't267-member-worker'");
		await admin.query("update employee set role = 'employee' where id = $1", [ids.worker]);
		await expect(contextAs(ids.workerUser)).resolves.toMatchObject({
			status: 200,
			body: { canReviewLegacy: false },
		});
	});

	it("never grants context for an active organization the user does not belong to", async () => {
		await expect(contextAs(ids.ownerUser, ids.otherOrganization)).resolves.toEqual({
			status: 403,
			body: { error: "Clock recovery access unavailable" },
		});
	});

	it("denies recovery access when the organization is deleted", async () => {
		await admin.query("delete from organization where id = $1", [ids.organization]);

		await expect(contextAs(ids.workerUser)).resolves.toMatchObject({ status: 403 });
	});
});
