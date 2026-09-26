/**
 * #314 / T49 runtime evidence: Better Auth, SCIM and SSO writers of membership,
 * role, active state and global access participate in the manual work
 * transaction's configuration/access protocol. #429: multi-user SCIM
 * projections take every projected user's guard in user-ID order first.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real public `createManualTimeEntry` action races real Better Auth
 * endpoints (organization, admin and SCIM plugins, called through `auth.api`
 * and through the HTTP handler) configured with the production coordination
 * hooks and plugin, and the production SSO provisioning functions. Only the
 * manual action's request/session, billing, notification, secondary storage
 * and Next cache boundaries are replaced. Each race pauses one side on a lock
 * it takes after its protection, then proves the other side waits on the
 * exact protection key rather than on an unrelated lock.
 */

import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth/minimal";
import { admin as adminPlugin } from "better-auth/plugins/admin";
import { bearer } from "better-auth/plugins/bearer";
import { organization } from "better-auth/plugins/organization";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	billingReconciled: [] as string[],
	provisioned: [] as string[],
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
			max: 16,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

// The manual action's session. Better Auth itself is a real instance below.
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: { activeOrganizationId: harness.organizationId },
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...original,
		getPrincipalContext: async () =>
			harness.userId && harness.organizationId
				? loadOrganizationPrincipalContext(db, {
						userId: harness.userId,
						organizationId: harness.organizationId,
					})
				: null,
	};
});

// The mocked session has no stored SSO provenance to admit.
vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async (organizationId: string) => {
		harness.billingReconciled.push(organizationId);
	},
	syncBillingSeatsAfterMemberChange: async () => undefined,
}));

vi.mock("@/lib/redis", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/redis")>()),
	secondaryStorage: { deleteOrThrow: async () => undefined },
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" ? async () => undefined : value,
		]),
	);
});

vi.mock("./approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./approvals")>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return { ...original, createLogger: () => quiet };
});

const { createManualTimeEntry } = await import("../actions");
const { db } = await import("@/db");
const { captureAuthTransactions, runCoordinatedAuthMutation, UncoordinatedAuthMutationError } =
	await import("@/lib/auth/auth-transaction");
const {
	authMutationCoordinationPlugin,
	createCoordinatedOrganizationHooks,
	handleCoordinatedAuthRequest,
} = await import("@/lib/auth/auth-mutation-coordination");
const { assignSsoOrganizationByVerifiedDomain, provisionSsoProviderOrganization } = await import(
	"@/lib/auth/sso-organization-provisioning"
);
const { authDatabaseSchema } = await import("@/lib/auth-database-schema");
const { createSCIMCallbackModelRegistration, createZ8SCIMPlugin } = await import(
	"@/lib/scim/auth-configuration"
);
const { guardSCIMSubjectAcquisitions } = await import("@/lib/scim/projection-guards");
const { getSCIMCredentialExpiresAt, SCIM_SCOPES } = await import("@/lib/scim/constants");

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
	describe.skip(`manual auth/SCIM PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const origin = "http://localhost:3000";
const ids = {
	organization: "t314-auth-org",
	ownerUser: "t314-owner-user",
	adminUser: "t314-admin-user",
	employeeUser: "t314-employee-user",
	platformAdminUser: "t314-platform-admin-user",
	inviteeUser: "t314-invitee-user",
	ssoUser: "t314-sso-user",
	owner: "e3140000-0000-4000-8000-000000000001",
	admin: "e3140000-0000-4000-8000-000000000002",
	employee: "e3140000-0000-4000-8000-000000000003",
	invitation: "t314-invitation",
	connection: "t314-scim-connection",
	roleTemplate: "e3140000-0000-4000-8000-000000000010",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.employeeUser,
	ids.platformAdminUser,
	ids.inviteeUser,
	ids.ssoUser,
];
const members = [ids.ownerUser, ids.adminUser, ids.employeeUser];
const token = (userId: string) => `${userId}-session-token`;
const memberId = (userId: string) => `m-${userId}`;

const organizationGuard = JSON.stringify(["work-organization-configuration", ids.organization]);
const userGuard = (userId: string) => JSON.stringify(["work-user-configuration-access", userId]);

const at = (time: string) => ({ time, occurrence: null, displayedOffsetMinutes: 120 });

/** An on-behalf Berlin summer entry for the employee, by the organization admin. */
function manualCommand(overrides: Partial<ManualTimeEntryCommand> = {}): ManualTimeEntryCommand {
	return {
		version: 2,
		submissionId: randomUUID(),
		targetEmployeeId: ids.employee,
		date: "2026-09-01",
		clockIn: at("08:00"),
		clockOut: at("12:30"),
		zone: { basis: "target", timezone: "Europe/Berlin" },
		browserTimezone: null,
		reason: "Forgot to clock in",
		projectId: null,
		workCategoryId: null,
		...overrides,
	};
}

/** The key the manual transaction takes after its protection and employee coordination. */
const submissionIdentity = (command: ManualTimeEntryCommand) =>
	JSON.stringify([ids.organization, "manual_time_submission", "time_entry", command.submissionId]);

describeIntegration("Better Auth, SCIM and SSO writers on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 12 });

	// A real Better Auth instance with the production coordination wiring.
	const auth = betterAuth({
		baseURL: origin,
		secret: "t314-auth-coordination-integration-secret",
		database: guardSCIMSubjectAcquisitions(
			drizzleAdapter(captureAuthTransactions(db), {
				provider: "pg",
				schema: authDatabaseSchema,
				transaction: true,
			}),
		),
		session: { cookieCache: { enabled: false } },
		plugins: [
			bearer(),
			createZ8SCIMPlugin("s".repeat(32)),
			adminPlugin({ defaultRole: "user", adminRole: "admin" }),
			organization({
				schema: {
					member: {
						additionalFields: {
							status: {
								type: "string",
								required: false,
								defaultValue: "approved",
								input: false,
							},
						},
					},
				},
				organizationHooks: createCoordinatedOrganizationHooks({
					beforeUpdateOrganization: async () => undefined,
					afterAcceptInvitation: async ({ user }) => {
						harness.provisioned.push(`accepted:${user.id}`);
					},
					afterAddMember: async ({ user }) => {
						harness.provisioned.push(`added:${user.id}`);
					},
				}),
			}),
			sso({
				domainVerification: { enabled: true },
				organizationProvisioning: { disabled: true },
			}),
			authMutationCoordinationPlugin(),
			createSCIMCallbackModelRegistration(),
		],
	});

	const as = (userId: string) => new Headers({ authorization: `Bearer ${token(userId)}` });
	const coordinated = <T>(mutation: () => Promise<T>) =>
		runCoordinatedAuthMutation(auth.$context, mutation);
	const post = (path: string, userId: string, body: unknown) =>
		handleCoordinatedAuthRequest(
			auth.$context,
			new Request(`${origin}/api/auth${path}`, {
				method: "POST",
				headers: {
					origin,
					authorization: `Bearer ${token(userId)}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			}),
			(request) => auth.handler(request),
		);

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	function submit(command: ManualTimeEntryCommand, actor: string) {
		actAs(actor);
		return createManualTimeEntry(command);
	}

	const openHolds = new Set<PoolClient>();

	/** Opens a transaction holding the result of `statement`, released on demand. */
	async function hold(statement: string, params: unknown[]) {
		const client: PoolClient = await admin.connect();
		openHolds.add(client);
		await client.query("begin");
		await client.query(statement, params);
		return {
			async release() {
				if (!openHolds.delete(client)) return;
				await client.query("commit");
				client.release();
			},
		};
	}

	const holdAdvisoryLock = (key: string) =>
		hold("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);

	/** Waits until `count` transactions wait on exactly this advisory key. */
	async function waitForWaiterOn(key: string, count = 1) {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const { rows } = await admin.query<{ waiting: number }>(
				`select count(*)::int as waiting from pg_locks l, (select hashtextextended($1, 0) as k) h
				 where l.locktype = 'advisory' and not l.granted
				   and l.classid = ((h.k >> 32) & 4294967295)::oid
				   and l.objid = (h.k & 4294967295)::oid`,
				[key],
			);
			if ((rows[0]?.waiting ?? 0) >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(`No transaction waited on ${key}`);
	}

	/** Waits until a transaction waits on one of these advisory keys. */
	async function waitForWaiterOnAny(keys: string[]) {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			for (const key of keys) {
				if ((await advisoryLocks(key, false)) > 0) return;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(`No transaction waited on any of ${keys.join(", ")}`);
	}

	async function advisoryLocks(key: string, granted: boolean) {
		const { rows } = await admin.query<{ locks: number }>(
			`select count(*)::int as locks from pg_locks l, (select hashtextextended($1, 0) as k) h
			 where l.locktype = 'advisory' and l.granted = $2
			   and l.classid = ((h.k >> 32) & 4294967295)::oid
			   and l.objid = (h.k & 4294967295)::oid`,
			[key, granted],
		);
		return rows[0]?.locks ?? 0;
	}

	/** Which of these users' configuration/access guards some transaction holds. */
	async function guardedUsers(userIds: string[]) {
		const guarded: string[] = [];
		for (const userId of userIds) {
			if ((await advisoryLocks(userGuard(userId), true)) > 0) guarded.push(userId);
		}
		return guarded;
	}

	/** Waits until some transaction waits on a row or transaction lock. */
	async function waitForRowWaiter() {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const { rows } = await admin.query(
				"select 1 from pg_locks where locktype <> 'advisory' and not granted limit 1",
			);
			if (rows.length > 0) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error("No transaction waited on a row lock");
	}

	/**
	 * Starts a submission and pauses it on its identity key, after it holds its
	 * shared configuration/access protection and employee coordination.
	 */
	async function pausedSubmission(command: ManualTimeEntryCommand, actor: string) {
		const identity = await holdAdvisoryLock(submissionIdentity(command));
		const pending = submit(command, actor);
		await waitForWaiterOn(submissionIdentity(command));
		return { pending, release: () => identity.release() };
	}

	async function workFor(employeeId: string) {
		const { rows } = await admin.query(
			"select id from work_period where organization_id = $1 and employee_id = $2",
			[ids.organization, employeeId],
		);
		return rows;
	}

	async function membership(userId: string) {
		const { rows } = await admin.query<{ role: string; status: string | null }>(
			"select role, status from member where organization_id = $1 and user_id = $2",
			[ids.organization, userId],
		);
		return rows[0] ?? null;
	}

	async function employeeActive(userId: string) {
		const { rows } = await admin.query<{ is_active: boolean }>(
			"select is_active from employee where organization_id = $1 and user_id = $2",
			[ids.organization, userId],
		);
		return rows[0]?.is_active ?? null;
	}

	async function cleanup() {
		await admin.query("delete from scim_group where provisioning_domain_id = $1", [
			ids.organization,
		]);
		await admin.query("delete from scim_connection_binding where provisioning_domain_id = $1", [
			ids.organization,
		]);
		await admin.query("delete from scim_managed_connection where provisioning_domain_id = $1", [
			ids.organization,
		]);
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
		await admin.query("drop trigger if exists t314_fail_employee_update on employee");
		await admin.query("drop function if exists t314_fail_employee_update()");
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, sso_requires_approval, created_at)
			 values ($1, 'T314 auth', $1, 'Europe/Berlin', false, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, email_verified, role, created_at, updated_at)
			 select user_id, user_id, user_id || '@t314.example.test', true,
			        case when user_id = $2 then 'admin' else 'user' end, $3, $3
			 from unnest($1::text[]) as user_id`,
			[users, ids.platformAdminUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 'm-' || user_id, $1, user_id,
			        case user_id when $3 then 'owner' when $4 then 'admin' else 'member' end,
			        'approved', $5
			 from unnest($2::text[]) as user_id`,
			[ids.organization, members, ids.ownerUser, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'employee', $8),
			 ($3, $4, $7, 'employee', $8),
			 ($5, $6, $7, 'employee', $8)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.admin,
				ids.adminUser,
				ids.employee,
				ids.employeeUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'Europe/Berlin', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into session (id, token, user_id, expires_at, created_at, updated_at, active_organization_id)
			 select 's-' || user_id, user_id || '-session-token', user_id,
			        now() + interval '1 day', now(), now(),
			        case when user_id = any($3::text[]) then $2 end
			 from unnest($1::text[]) as user_id`,
			[users, ids.organization, members],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'manual_time_submission', 'legacy', 'legacy', now(), now())`,
			[ids.organization],
		);
		await admin.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
	}

	/** An active SCIM connection whose source for the employee is now inactive. */
	async function seedScimDeprovisioning() {
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into role_template (id, organization_id, name, is_global, is_active, employee_role,
				team_permissions, created_at, created_by, updated_at)
			 values ($1, $2, 'T314 SCIM default', false, true, 'employee', '{}'::jsonb, $3, $4, $3)`,
			[ids.roleTemplate, ids.organization, timestamp, ids.ownerUser],
		);
		await admin.query(
			`insert into scim_provider_config (organization_id, creation_request_id, connection_id, state,
				auto_activate_users, deprovision_action, default_role_template_id, created_at, created_by, updated_at)
			 values ($1, 't314-scim-request', $2, 'active', true, 'suspend', $3, $4, $5, $4)`,
			[ids.organization, ids.connection, ids.roleTemplate, timestamp, ids.ownerUser],
		);
		await admin.query(
			`insert into scim_subject (id, user_id, revision, created_at, updated_at)
			 values ('t314-scim-subject', $1, 0, $2, $2)`,
			[ids.employeeUser, timestamp],
		);
		await admin.query(
			`insert into scim_user (id, connection_id, provisioning_domain_id, user_id, connection_user_key,
				user_name, user_name_key, primary_email, work_email_value_index, email_value_index,
				display_name, formatted_name, serialized_emails, active, order_key, created_at, updated_at)
			 values ('t314-scim-user', $1, $2, $3, 't314-connection-user', $4, 't314-user-name', $4,
				't314-email-index', 't314-email-index', 'T314 employee', 'T314 employee', '[]', false,
				't314-order', $5, $5)`,
			[
				ids.connection,
				ids.organization,
				ids.employeeUser,
				`${ids.employeeUser}@t314.example.test`,
				timestamp,
			],
		);
	}

	/** SCIM users projected in one transaction, in ascending user-ID order. */
	const scimMembers = [ids.adminUser, ids.employeeUser];
	const scimSource = (userId: string) => `t429-scim-user-${userId}`;

	/** A managed SCIM connection with an active source for the admin and the employee. */
	async function seedScimManagedSources() {
		const timestamp = new Date("2026-01-01T00:00:00Z");
		const created = await auth.api.createSCIMManagedConnection({
			body: {
				creationRequestId: "t429-scim-request",
				provisioningDomainId: ids.organization,
				actorId: ids.ownerUser,
				scopes: SCIM_SCOPES,
				expiresAt: getSCIMCredentialExpiresAt(),
			},
		});
		const { connectionId } = created.connection;
		await admin.query(
			`insert into role_template (id, organization_id, name, is_global, is_active, employee_role,
				team_permissions, created_at, created_by, updated_at)
			 values ($1, $2, 'T429 SCIM default', false, true, 'employee', '{}'::jsonb, $3, $4, $3)`,
			[ids.roleTemplate, ids.organization, timestamp, ids.ownerUser],
		);
		await admin.query(
			`insert into scim_provider_config (organization_id, creation_request_id, connection_id, state,
				auto_activate_users, deprovision_action, default_role_template_id, created_at, created_by, updated_at)
			 values ($1, 't429-scim-request', $2, 'active', true, 'suspend', $3, $4, $5, $4)`,
			[ids.organization, connectionId, ids.roleTemplate, timestamp, ids.ownerUser],
		);
		for (const userId of scimMembers) {
			await admin.query(
				`insert into scim_subject (id, user_id, revision, created_at, updated_at)
				 values ('t429-scim-subject-' || $1, $1, 0, $2, $2)`,
				[userId, timestamp],
			);
			await admin.query(
				`insert into scim_user (id, connection_id, provisioning_domain_id, user_id, connection_user_key,
					user_name, user_name_key, primary_email, work_email_value_index, email_value_index,
					display_name, formatted_name, serialized_emails, active, order_key, created_at, updated_at)
				 values ($1, $2, $3, $4, 't429-connection-user-' || $4, $5, 't429-user-name-' || $4, $5,
					't429-email-index', 't429-email-index', $4, $4, '[]', true, 't429-order-' || $4, $6, $6)`,
				[
					scimSource(userId),
					connectionId,
					ids.organization,
					userId,
					`${userId}@t314.example.test`,
					timestamp,
				],
			);
		}
		return { connectionId, token: created.token };
	}

	const scimRequest = (token: string, path: string, body: unknown) =>
		auth.handler(
			new Request(`${origin}/api/auth/scim/v2${path}`, {
				method: "POST",
				headers: { authorization: `Bearer ${token}`, "content-type": "application/scim+json" },
				body: JSON.stringify(body),
			}),
		);

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
			throw new Error("Manual auth/SCIM PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.billingReconciled.length = 0;
		harness.provisioned.length = 0;
		await seed();
	});

	// A failed race must not leave its paused side holding locks for the next test.
	afterEach(async () => {
		for (const client of openHolds) {
			await client.query("rollback");
			client.release();
		}
		openHolds.clear();
		await new Promise((resolve) => setTimeout(resolve, 200));
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("lets an organization admin create on behalf of the employee before any mutation", async () => {
		await expect(submit(manualCommand(), ids.adminUser)).resolves.toMatchObject({ success: true });
		expect(await workFor(ids.employee)).toHaveLength(1);
	});

	describe("organization member roles", () => {
		it("holds a role demotion until an in-flight submission commits under the authority it validated", async () => {
			const submission = await pausedSubmission(manualCommand(), ids.adminUser);

			const demotion = coordinated(() =>
				auth.api.updateMemberRole({
					body: {
						organizationId: ids.organization,
						memberId: memberId(ids.adminUser),
						role: "member",
					},
					headers: as(ids.ownerUser),
				}),
			);
			await waitForWaiterOn(userGuard(ids.adminUser));
			expect(await membership(ids.adminUser)).toMatchObject({ role: "admin" });

			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(demotion).resolves.toMatchObject({ role: "member" });
			expect(await membership(ids.adminUser)).toMatchObject({ role: "member" });
			expect(await workFor(ids.employee)).toHaveLength(1);
		});

		it("makes a submission wait for an in-flight demotion and then refuses it", async () => {
			const row = await hold("select id from member where id = $1 for update", [
				memberId(ids.adminUser),
			]);
			const demotion = coordinated(() =>
				auth.api.updateMemberRole({
					body: {
						organizationId: ids.organization,
						memberId: memberId(ids.adminUser),
						role: "member",
					},
					headers: as(ids.ownerUser),
				}),
			);
			await waitForRowWaiter();

			// The demotion holds the admin's protection; the submission waits for it.
			const pending = submit(manualCommand(), ids.adminUser);
			await waitForWaiterOn(userGuard(ids.adminUser));
			await row.release();

			await expect(demotion).resolves.toMatchObject({ role: "member" });
			await expect(pending).resolves.toMatchObject({
				success: false,
				code: "target_not_authorized",
			});
			expect(await workFor(ids.employee)).toEqual([]);
		});

		it("orders the HTTP role endpoint the same way and rolls back a refused request", async () => {
			const submission = await pausedSubmission(manualCommand(), ids.adminUser);
			const demotion = post("/organization/update-member-role", ids.ownerUser, {
				organizationId: ids.organization,
				memberId: memberId(ids.adminUser),
				role: "member",
			});
			await waitForWaiterOn(userGuard(ids.adminUser));
			await submission.release();

			await expect(submission.pending).resolves.toMatchObject({ success: true });
			expect((await demotion).status).toBe(200);
			expect(await membership(ids.adminUser)).toMatchObject({ role: "member" });

			// A member may not change roles: the request fails and writes nothing.
			const refused = await post("/organization/update-member-role", ids.employeeUser, {
				organizationId: ids.organization,
				memberId: memberId(ids.adminUser),
				role: "admin",
			});
			expect(refused.status).toBe(403);
			expect(await membership(ids.adminUser)).toMatchObject({ role: "member" });
		});

		it("refuses role updates and removals outside a coordinated transaction without writing", async () => {
			await expect(
				auth.api.updateMemberRole({
					body: {
						organizationId: ids.organization,
						memberId: memberId(ids.adminUser),
						role: "member",
					},
					headers: as(ids.ownerUser),
				}),
			).rejects.toBeInstanceOf(UncoordinatedAuthMutationError);
			await expect(
				auth.api.removeMember({
					body: { organizationId: ids.organization, memberIdOrEmail: memberId(ids.employeeUser) },
					headers: as(ids.ownerUser),
				}),
			).rejects.toBeInstanceOf(UncoordinatedAuthMutationError);
			await expect(
				auth.api.leaveOrganization({
					body: { organizationId: ids.organization },
					headers: as(ids.employeeUser),
				}),
			).rejects.toBeInstanceOf(UncoordinatedAuthMutationError);

			expect(await membership(ids.adminUser)).toMatchObject({ role: "admin" });
			expect(await membership(ids.employeeUser)).toMatchObject({ status: "approved" });
		});
	});

	describe("membership removal", () => {
		it("holds a removal on the target's protection and deactivates the employee in the same commit", async () => {
			const submission = await pausedSubmission(manualCommand(), ids.adminUser);

			const removal = coordinated(() =>
				auth.api.removeMember({
					body: { organizationId: ids.organization, memberIdOrEmail: memberId(ids.employeeUser) },
					headers: as(ids.ownerUser),
				}),
			);
			await waitForWaiterOn(userGuard(ids.employeeUser));
			expect(await membership(ids.employeeUser)).not.toBeNull();

			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(removal).resolves.toBeTruthy();
			expect(await membership(ids.employeeUser)).toBeNull();
			expect(await employeeActive(ids.employeeUser)).toBe(false);
			expect(harness.billingReconciled).toEqual([ids.organization]);
			const { rows } = await admin.query("select id from session where user_id = $1", [
				ids.employeeUser,
			]);
			expect(rows).toEqual([]);
		});

		it("rolls the removal back when its in-transaction cleanup fails", async () => {
			await admin.query(
				`create function t314_fail_employee_update() returns trigger language plpgsql as
				 $$ begin raise exception 't314 cleanup failure'; end $$`,
			);
			await admin.query(
				`create trigger t314_fail_employee_update before update on employee for each row
				 when (old.user_id = '${ids.employeeUser}') execute function t314_fail_employee_update()`,
			);

			await expect(
				coordinated(() =>
					auth.api.removeMember({
						body: { organizationId: ids.organization, memberIdOrEmail: memberId(ids.employeeUser) },
						headers: as(ids.ownerUser),
					}),
				),
			).rejects.toBeTruthy();

			expect(await membership(ids.employeeUser)).toMatchObject({ status: "approved" });
			expect(await employeeActive(ids.employeeUser)).toBe(true);
			expect(harness.billingReconciled).toEqual([]);
		});

		// #359: over HTTP, Better Auth's handler resets its adapter context; its own
		// membership delete still commits or rolls back with the coordinated request.
		it("rolls an HTTP removal back, membership included, when its cleanup fails", async () => {
			await admin.query(
				`create function t314_fail_employee_update() returns trigger language plpgsql as
				 $$ begin raise exception 't314 cleanup failure'; end $$`,
			);
			await admin.query(
				`create trigger t314_fail_employee_update before update on employee for each row
				 when (old.user_id = '${ids.employeeUser}') execute function t314_fail_employee_update()`,
			);

			const removal = await post("/organization/remove-member", ids.ownerUser, {
				organizationId: ids.organization,
				memberIdOrEmail: memberId(ids.employeeUser),
			});

			expect(removal.status).toBe(500);
			expect(await membership(ids.employeeUser)).toMatchObject({ status: "approved" });
			expect(await employeeActive(ids.employeeUser)).toBe(true);
			expect(harness.billingReconciled).toEqual([]);
		});

		it("holds leaving over HTTP on the leaver's protection and runs the same cleanup", async () => {
			const submission = await pausedSubmission(manualCommand(), ids.adminUser);

			const leaving = post("/organization/leave", ids.employeeUser, {
				organizationId: ids.organization,
			});
			await waitForWaiterOn(userGuard(ids.employeeUser));
			await submission.release();

			await expect(submission.pending).resolves.toMatchObject({ success: true });
			expect((await leaving).status).toBe(200);
			expect(await membership(ids.employeeUser)).toBeNull();
			expect(await employeeActive(ids.employeeUser)).toBe(false);
			expect(harness.billingReconciled).toEqual([ids.organization]);
		});
	});

	describe("membership grants", () => {
		it("holds invitation acceptance on the invitee's protection and provisions after commit", async () => {
			await admin.query(
				`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
				 values ($1, $2, $3, 'member', 'pending', now() + interval '1 day', $4)`,
				[ids.invitation, ids.organization, `${ids.inviteeUser}@t314.example.test`, ids.ownerUser],
			);
			const guard = await holdAdvisoryLock(userGuard(ids.inviteeUser));

			const acceptance = post("/organization/accept-invitation", ids.inviteeUser, {
				invitationId: ids.invitation,
			});
			await waitForWaiterOn(userGuard(ids.inviteeUser));
			expect(await membership(ids.inviteeUser)).toBeNull();
			await guard.release();

			expect((await acceptance).status).toBe(200);
			expect(await membership(ids.inviteeUser)).toMatchObject({ role: "member" });
			expect(harness.provisioned).toEqual([`accepted:${ids.inviteeUser}`]);
		});

		it("holds provider-bound SSO provisioning and creates the member and employee together", async () => {
			const guard = await holdAdvisoryLock(userGuard(ids.ssoUser));

			const provisioning = provisionSsoProviderOrganization(db, {
				user: { id: ids.ssoUser, email: `${ids.ssoUser}@t314.example.test` },
				userInfo: { attributes: { role: "manager" } },
				provider: { organizationId: ids.organization },
			});
			await waitForWaiterOn(userGuard(ids.ssoUser));
			expect(await membership(ids.ssoUser)).toBeNull();
			await guard.release();

			await provisioning;
			expect(await membership(ids.ssoUser)).toMatchObject({ role: "admin", status: "approved" });
			// The organization does not require SSO approval.
			expect(await employeeActive(ids.ssoUser)).toBe(true);
		});

		it("holds verified-domain SSO membership on the user's protection", async () => {
			await admin.query(
				`insert into sso_provider (id, issuer, user_id, provider_id, organization_id, domain, domain_verified)
				 values ($1, 'https://idp.t314.example.test', $2, 't314-idp', $3, 't314.example.test', true)`,
				[randomUUID(), ids.ownerUser, ids.organization],
			);
			const guard = await holdAdvisoryLock(userGuard(ids.ssoUser));

			const assignment = assignSsoOrganizationByVerifiedDomain(db, ids.ssoUser);
			await waitForWaiterOn(userGuard(ids.ssoUser));
			await guard.release();

			await assignment;
			expect(await membership(ids.ssoUser)).toMatchObject({ role: "member" });
			expect(await employeeActive(ids.ssoUser)).toBeNull();
		});
	});

	describe("global access", () => {
		it("holds an admin ban on the user's protection while a submission for them is in flight", async () => {
			const submission = await pausedSubmission(manualCommand(), ids.adminUser);

			const ban = coordinated(() =>
				auth.api.banUser({
					body: { userId: ids.employeeUser, banReason: "t314" },
					headers: as(ids.platformAdminUser),
				}),
			);
			await waitForWaiterOn(userGuard(ids.employeeUser));
			await submission.release();

			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(ban).resolves.toBeTruthy();
			const { rows } = await admin.query<{ banned: boolean }>(
				'select banned from "user" where id = $1',
				[ids.employeeUser],
			);
			expect(rows[0]?.banned).toBe(true);
		});

		it("holds an admin role change on the user's protection", async () => {
			const submission = await pausedSubmission(manualCommand(), ids.adminUser);

			const change = post(adminPlugin().endpoints.setRole.path, ids.platformAdminUser, {
				userId: ids.adminUser,
				role: "admin",
			});
			await waitForWaiterOn(userGuard(ids.adminUser));
			await submission.release();

			await expect(submission.pending).resolves.toMatchObject({ success: true });
			expect((await change).status).toBe(200);
		});
	});

	describe("SCIM", () => {
		it("holds a deprovisioning replay on the target's protection, then suspends and deactivates", async () => {
			await seedScimDeprovisioning();
			const submission = await pausedSubmission(manualCommand(), ids.adminUser);

			const replay = auth.api.reconcileSCIMProjection({
				body: { provisioningDomainId: ids.organization },
			});
			await waitForWaiterOn(userGuard(ids.employeeUser));
			expect(await employeeActive(ids.employeeUser)).toBe(true);

			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await replay;
			expect(await membership(ids.employeeUser)).toMatchObject({ status: "suspended" });
			expect(await employeeActive(ids.employeeUser)).toBe(false);
		});

		it("makes a submission wait for an in-flight deprovisioning and then refuses it", async () => {
			await seedScimDeprovisioning();
			const row = await hold("select id from employee where id = $1 for update", [ids.employee]);
			const replay = auth.api.reconcileSCIMProjection({
				body: { provisioningDomainId: ids.organization },
			});
			await waitForRowWaiter();

			const pending = submit(manualCommand(), ids.adminUser);
			await waitForWaiterOn(userGuard(ids.employeeUser));
			await row.release();

			await replay;
			await expect(pending).resolves.toMatchObject({ success: false });
			expect(await workFor(ids.employee)).toEqual([]);
		});

		describe("multi-user projections (#429)", () => {
			it("orders a group change listing members in descending ID order against their submission", async () => {
				const scim = await seedScimManagedSources();
				expect([ids.employeeUser, ids.adminUser].sort()).toEqual(scimMembers);
				// Pauses the group change on the first member it projects, the employee.
				const row = await hold("select id from employee where id = $1 for update", [ids.employee]);
				const groupChange = scimRequest(scim.token, "/Groups", {
					schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
					displayName: "T429 descending members",
					members: [{ value: scimSource(ids.employeeUser) }, { value: scimSource(ids.adminUser) }],
				});
				await waitForRowWaiter();
				const guardedDuringFirstProjection = await guardedUsers(scimMembers);

				// The admin submits for the employee: shared guards on both members, in ID order.
				const pending = submit(manualCommand(), ids.adminUser);
				await waitForWaiterOnAny(scimMembers.map(userGuard));
				await row.release();

				// Without sorted guards, PostgreSQL aborts one side here as a deadlock.
				expect((await groupChange).status).toBe(201);
				await expect(pending).resolves.toMatchObject({ success: true });
				expect(await workFor(ids.employee)).toHaveLength(1);
				expect(guardedDuringFirstProjection).toEqual(scimMembers);
			});

			it("holds every replayed user's guard before projecting the first", async () => {
				await seedScimManagedSources();
				const row = await hold("select id from employee where id = $1 for update", [ids.admin]);
				const replay = auth.api.reconcileSCIMProjection({
					body: { provisioningDomainId: ids.organization },
				});
				await waitForRowWaiter();
				const guardedDuringFirstProjection = await guardedUsers(scimMembers);
				await row.release();

				await replay;
				expect(guardedDuringFirstProjection).toEqual(scimMembers);
			});

			it("holds every decommissioned user's guard before deprovisioning the first", async () => {
				const scim = await seedScimManagedSources();
				// The connection's first request binds it and projects both members.
				const grouped = await scimRequest(scim.token, "/Groups", {
					schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
					displayName: "T429 members",
					members: scimMembers.map((userId) => ({ value: scimSource(userId) })),
				});
				expect(grouped.status).toBe(201);
				const row = await hold("select id from member where id = $1 for update", [
					memberId(ids.adminUser),
				]);
				const decommission = auth.api.decommissionSCIMManagedConnection({
					body: {
						connectionId: scim.connectionId,
						provisioningDomainId: ids.organization,
						actorId: ids.ownerUser,
					},
				});
				await waitForRowWaiter();
				const guardedDuringFirstProjection = await guardedUsers(scimMembers);
				await row.release();

				await decommission;
				expect(guardedDuringFirstProjection).toEqual(scimMembers);
				expect(await membership(ids.adminUser)).toMatchObject({ status: "suspended" });
				expect(await membership(ids.employeeUser)).toMatchObject({ status: "suspended" });
			});
		});
	});

	describe("organization deletion", () => {
		// The owner-retention trigger refuses deleting the last owner's membership,
		// so a hard deletion of an owned organization fails; it still waits first.
		it("holds a Better Auth organization deletion organization-wide and rolls it back", async () => {
			const guard = await holdAdvisoryLock(organizationGuard);

			const deletion = post("/organization/delete", ids.ownerUser, {
				organizationId: ids.organization,
			});
			await waitForWaiterOn(organizationGuard);
			const { rows: before } = await admin.query("select id from organization where id = $1", [
				ids.organization,
			]);
			expect(before).toHaveLength(1);
			await guard.release();

			expect((await deletion).status).toBe(500);
			const { rows: after } = await admin.query("select id from organization where id = $1", [
				ids.organization,
			]);
			expect(after).toHaveLength(1);
			expect(await membership(ids.employeeUser)).toMatchObject({ status: "approved" });
		});
	});
});
