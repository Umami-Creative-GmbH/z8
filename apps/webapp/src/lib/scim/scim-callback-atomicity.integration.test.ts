/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The existing runner owns, migrates, and removes the disposable database.
 */
import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { scim } from "@better-auth/scim";
import { betterAuth } from "better-auth/minimal";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { authDatabaseSchema } from "@/lib/auth-database-schema";
import { createZ8SCIMPlugin } from "./auth-configuration";

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired =
	process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration =
	resolveApprovalWorkflowRepositoryTestConfiguration({
		databaseUrl,
		required: integrationRequired,
		sentinel: testSentinel,
	});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid SCIM callback integration test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`SCIM callback PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const runId = randomUUID();
const seededOrganizationIds: string[] = [];
const seededUserIds: string[] = [];
const projectionFaultConstraintName = `scim_callback_projection_fault_${runId.replaceAll("-", "")}`;
const tombstoneSubjectLinks = new Map<string, string>();

interface SeededGraph {
	organizationId: string;
	userId: string;
	connectionId: string;
	templateId: string;
	teamId: string;
}

describeIntegration("SCIM projected-user callback PostgreSQL atomicity", () => {
	const pool = new Pool({ connectionString: databaseUrl, max: 8 });
	let projectionFaultInstalled = false;
	const database = drizzle({ client: pool, schema: authDatabaseSchema });
	const auth = betterAuth({
		baseURL: "http://localhost:3000",
		secret: "scim-callback-integration-secret-value",
		database: drizzleAdapter(database, {
			provider: "pg",
			schema: authDatabaseSchema,
			transaction: true,
		}),
		plugins: [createZ8SCIMPlugin("s".repeat(32))],
	});
	const externalIdPolicyAuth = betterAuth({
		baseURL: "http://localhost:3000",
		secret: "scim-external-id-policy-integration-secret-value",
		database: drizzleAdapter(database, {
			provider: "pg",
			schema: authDatabaseSchema,
			transaction: true,
		}),
		plugins: [
			scim({
				connections: [
					{
						id: "external-id-policy-connection",
						provisioningDomainId: "external-id-policy-domain",
						credentials: [{ id: "external-id-policy-credential", token: "external-id-policy-token" }],
					},
				],
				identity: {
					resolveUser: async () => ({ action: "create" }),
					// The patched package rejects a tombstone replay unless this verified
					// subject resolution selects the tombstoned user exactly.
					externalIdPolicy: {
						immutable: true,
						resolveTombstoneUser: async (input) => {
							const userId = tombstoneSubjectLinks.get(
								input.resource.externalId ?? "",
							);
							return userId ? { action: "link", userId } : { action: "create" };
						},
					},
				},
			}),
		],
	});

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await pool.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") {
			throw new Error("SCIM callback integration test is not enabled");
		}
	});

	afterAll(async () => {
		try {
			if (projectionFaultInstalled) {
				await pool.query(
					`alter table scim_role_projection_state drop constraint if exists "${projectionFaultConstraintName}"`,
				);
			}
			for (const organizationId of seededOrganizationIds) {
				await pool.query("delete from organization where id = $1", [
					organizationId,
				]);
			}
			for (const userId of seededUserIds) {
				await pool.query('delete from "user" where id = $1', [userId]);
			}
		} finally {
			await pool.end();
		}
	});

	async function seedGraph(input: {
		templateActive: boolean;
	}): Promise<SeededGraph> {
		const suffix = `${runId}-${seededOrganizationIds.length}`;
		const organizationId = `scim-callback-org-${suffix}`;
		const userId = `scim-callback-user-${suffix}`;
		const connectionId = `scim-callback-connection-${suffix}`;
		const scimUserId = `scim-callback-source-${suffix}`;
		const templateId = randomUUID();
		const teamId = randomUUID();
		const now = new Date("2026-08-25T12:00:00.000Z");
		seededOrganizationIds.push(organizationId);
		seededUserIds.push(userId);

		await pool.query(
			`insert into "user" (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'SCIM Callback User', $2, true, $3, $3)`,
			[userId, `${userId}@example.test`, now],
		);
		await pool.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'SCIM Callback Organization', $2, $3)`,
			[organizationId, organizationId, now],
		);
		await pool.query(
			`insert into team (id, organization_id, name, created_at, updated_at)
			 values ($1, $2, 'Provisioned Team', $3, $3)`,
			[teamId, organizationId, now],
		);
		await pool.query(
			`insert into role_template (
				id, organization_id, name, is_global, is_active, employee_role,
				default_team_id, team_permissions, created_at, created_by, updated_at
			) values ($1, $2, 'SCIM Default', false, $3, 'manager', $4,
				'{"canManageTeamMembers":true}'::jsonb, $5, $6, $5)`,
			[templateId, organizationId, input.templateActive, teamId, now, userId],
		);
		await pool.query(
			`insert into scim_provider_config (
				organization_id, creation_request_id, connection_id, state,
				auto_activate_users, deprovision_action, default_role_template_id,
				created_at, created_by, updated_at
			) values ($1, $2, $3, 'active', true, 'suspend', $4, $5, $6, $5)`,
			[
				organizationId,
				`scim-callback-request-${suffix}`,
				connectionId,
				templateId,
				now,
				userId,
			],
		);
		await pool.query(
			`insert into scim_subject (id, user_id, revision, created_at, updated_at)
			 values ($1, $2, 0, $3, $3)`,
			[`scim-callback-subject-${suffix}`, userId, now],
		);
		await pool.query(
			`insert into scim_user (
				id, connection_id, provisioning_domain_id, user_id,
				connection_user_key, user_name, user_name_key, primary_email,
				work_email_value_index, email_value_index, display_name,
				formatted_name, serialized_emails, active, order_key, created_at, updated_at
			) values ($1, $2, $3, $4, $5, $6, $7, $6, $8, $8,
				'SCIM Callback User', 'SCIM Callback User', '[]', true, $9, $10, $10)`,
			[
				scimUserId,
				connectionId,
				organizationId,
				userId,
				`connection-user-${suffix}`,
				`${userId}@example.test`,
				`user-name-${suffix}`,
				`email-index-${suffix}`,
				`order-${suffix}`,
				now,
			],
		);

		return { organizationId, userId, connectionId, templateId, teamId };
	}

	async function replay(organizationId: string) {
		return auth.api.reconcileSCIMProjection({
			body: { provisioningDomainId: organizationId },
		});
	}

	async function waitForSubjectCASBlockers() {
		const deadline = Date.now() + 5_000;
		while (Date.now() < deadline) {
			const result = await pool.query<{ count: number }>(`
				select count(*)::int as count
				from pg_stat_activity
				where datname = current_database()
					and pid <> pg_backend_pid()
					and wait_event_type = 'Lock'
					and query ilike '%scim_subject%'
			`);
			if ((result.rows[0]?.count ?? 0) >= 2) return;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error("Timed out waiting for both SCIM subject CAS attempts");
	}

	async function installFinalProjectionFault(organizationId: string) {
		const quoted = await pool.query<{ organization_id: string }>(
			"select quote_literal($1) as organization_id",
			[organizationId],
		);
		const quotedOrganizationId = quoted.rows[0]?.organization_id;
		if (!quotedOrganizationId) {
			throw new Error("Failed to quote SCIM callback test organization ID");
		}
		await pool.query(
			`alter table scim_role_projection_state
			 add constraint "${projectionFaultConstraintName}"
			 check (
				organization_id <> ${quotedOrganizationId}
				or applied_role_template_id is null
			 ) not valid`,
		);
		projectionFaultInstalled = true;
	}

	async function removeFinalProjectionFault() {
		await pool.query(
			`alter table scim_role_projection_state drop constraint if exists "${projectionFaultConstraintName}"`,
		);
		projectionFaultInstalled = false;
	}

	async function counts(graph: SeededGraph) {
		const result = await pool.query<{ entity: string; count: number }>(
			`select 'member' entity, count(*)::int count from member
				where organization_id = $1 and user_id = $2
			union all select 'employee', count(*)::int from employee
				where organization_id = $1 and user_id = $2
			union all select 'lifecycle', count(*)::int from scim_user_lifecycle_state
				where organization_id = $1 and user_id = $2
			union all select 'projection', count(*)::int from scim_role_projection_state
				where organization_id = $1 and user_id = $2
			union all select 'assignment', count(*)::int from user_role_template_assignment
				where organization_id = $1 and user_id = $2
			union all select 'team_permission', count(*)::int from team_permissions permissions
				join employee on employee.id = permissions.employee_id
					and employee.organization_id = permissions.organization_id
				where permissions.organization_id = $1 and employee.user_id = $2
			union all select 'team_membership', count(*)::int from team_membership membership
				join employee on employee.id = membership.employee_id
					and employee.organization_id = membership.organization_id
				where membership.organization_id = $1 and employee.user_id = $2
			union all select 'lifecycle_audit', count(*)::int from user_lifecycle_event
				where organization_id = $1 and user_id = $2
			union all select 'provisioning_audit', count(*)::int from scim_provisioning_log
				where organization_id = $1 and user_id = $2
			union all select 'outbox', count(*)::int from scim_billing_seat_sync_outbox
				where organization_id = $1 and user_id = $2`,
			[graph.organizationId, graph.userId],
		);
		return Object.fromEntries(
			result.rows.map(({ entity, count }) => [entity, count]),
		);
	}

	async function lifecycleMembershipRevision(graph: SeededGraph) {
		const result = await pool.query<{ membership_revision: number }>(
			`select membership_revision
			from scim_user_lifecycle_state
			where organization_id = $1 and user_id = $2`,
			[graph.organizationId, graph.userId],
		);
		return result.rows;
	}

	async function subjectRevision(graph: SeededGraph) {
		const result = await pool.query<{ revision: number }>(
			"select revision from scim_subject where user_id = $1",
			[graph.userId],
		);
		return result.rows;
	}

	async function scimPolicyRequest(
		path: string,
		method: "POST" | "PUT" | "PATCH" | "DELETE",
		body?: unknown,
	) {
		return externalIdPolicyAuth.handler(
			new Request(`http://localhost:3000${path}`, {
				method,
				headers: {
					authorization: "Bearer external-id-policy-token",
					...(body === undefined ? {} : { "content-type": "application/scim+json" }),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
		);
	}

	function userResource(externalId: string) {
		return {
			schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
			userName: `${externalId}@example.test`,
			name: { formatted: "External ID Policy" },
			emails: [{ value: `${externalId}@example.test`, primary: true }],
			externalId,
		};
	}

	it("rejects externalId replacement through installed SCIM PUT and PATCH handlers", async () => {
		const created = await scimPolicyRequest("/scim/v2/Users", "POST", userResource("subject-original"));
		expect(created.status).toBe(201);
		const createdUser = (await created.json()) as { id: string };

		const replaced = await scimPolicyRequest(
			`/scim/v2/Users/${createdUser.id}`,
			"PUT",
			userResource("subject-replaced"),
		);
		expect(replaced.status).toBe(409);
		expect(await replaced.json()).toEqual({
			schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
			status: "409",
			detail: "The SCIM identity cannot be linked",
		});

		const removed = await scimPolicyRequest(
			`/scim/v2/Users/${createdUser.id}`,
			"PATCH",
			{
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [{ op: "remove", path: "externalId" }],
			},
		);
		expect(removed.status).toBe(409);
		expect(await removed.json()).toEqual({
			schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
			status: "409",
			detail: "The SCIM identity cannot be linked",
		});
	});

	it("reprovisions a tombstone only when its external subject still validates to the same user", async () => {
		const subject = "tombstone-subject";
		const created = await scimPolicyRequest("/scim/v2/Users", "POST", userResource(subject));
		expect(created.status).toBe(201);
		const createdUser = (await created.json()) as { id: string };
		const createdUserIdResult = await pool.query<{ user_id: string }>(
			"select user_id from scim_user where id = $1",
			[createdUser.id],
		);
		const createdUserId = createdUserIdResult.rows[0]?.user_id;
		if (!createdUserId) throw new Error("Created SCIM user has no persisted user ID");
		const changedSubject = await scimPolicyRequest(
			"/scim/v2/Users",
			"POST",
			userResource("tombstone-changed-subject"),
		);
		expect(changedSubject.status).toBe(201);
		const changedUser = (await changedSubject.json()) as { id: string };
		const changedUserIdResult = await pool.query<{ user_id: string }>(
			"select user_id from scim_user where id = $1",
			[changedUser.id],
		);
		const changedUserId = changedUserIdResult.rows[0]?.user_id;
		if (!changedUserId) throw new Error("Changed SCIM user has no persisted user ID");
		const foreignOrganizationId = `scim-external-id-policy-org-${runId}`;
		const foreignUserId = `scim-external-id-policy-user-${runId}`;
		const now = new Date("2026-08-25T12:00:00.000Z");
		seededOrganizationIds.push(foreignOrganizationId);
		seededUserIds.push(foreignUserId);
		await pool.query(
			`insert into "user" (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'Foreign SCIM Subject', $2, true, $3, $3)`,
			[foreignUserId, `${foreignUserId}@example.test`, now],
		);
		await pool.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'Foreign SCIM Subject Organization', $2, $3)`,
			[foreignOrganizationId, foreignOrganizationId, now],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, created_at)
			 values ($1, $2, $3, 'member', $4)`,
			[
				`scim-external-id-policy-member-${runId}`,
				foreignOrganizationId,
				foreignUserId,
				now,
			],
		);

		const remove = async () => {
			const deleted = await scimPolicyRequest(
				`/scim/v2/Users/${createdUser.id}`,
				"DELETE",
			);
			expect(deleted.status).toBe(204);
		};
		const reprovision = async () =>
			scimPolicyRequest("/scim/v2/Users", "POST", userResource(subject));
		const assertUnchangedTombstone = async () => {
			const tombstone = await pool.query<{
				user_id: string;
				provisioning_domain_id: string;
			}>(
				`select user_id, provisioning_domain_id from scim_identity_tombstone
				 where user_id = $1`,
				[createdUserId],
			);
			expect(tombstone.rows).toEqual([
				{
					user_id: createdUserId,
					provisioning_domain_id: "external-id-policy-domain",
				},
			]);
			const source = await pool.query<{ count: number }>(
				"select count(*)::int as count from scim_user where user_id = $1",
				[createdUserId],
			);
			expect(source.rows).toEqual([{ count: 0 }]);
		};

		tombstoneSubjectLinks.set(subject, createdUserId);
		await remove();
		const sameSubject = await reprovision();
		expect(sameSubject.status).toBe(201);
		expect((await sameSubject.json()) as { id: string }).toMatchObject({
			id: createdUser.id,
		});

		await remove();
		tombstoneSubjectLinks.delete(subject);
		const unbound = await reprovision();
		expect(unbound.status).toBe(409);
		expect(await unbound.json()).toMatchObject({
			detail: "The SCIM identity cannot be linked",
		});
		await assertUnchangedTombstone();

		tombstoneSubjectLinks.set(subject, changedUserId);
		const changed = await reprovision();
		expect(changed.status).toBe(409);
		expect(await changed.json()).toMatchObject({
			detail: "The SCIM identity cannot be linked",
		});
		await assertUnchangedTombstone();

		tombstoneSubjectLinks.set(subject, foreignUserId);
		const crossOrganization = await reprovision();
		expect(crossOrganization.status).toBe(409);
		expect(await crossOrganization.json()).toMatchObject({
			detail: "The SCIM identity cannot be linked",
		});
		await assertUnchangedTombstone();
		tombstoneSubjectLinks.delete(subject);
	});

	it("rolls back every effect when final applied-projection persistence fails", async () => {
		const graph = await seedGraph({ templateActive: true });
		await installFinalProjectionFault(graph.organizationId);
		let failure: unknown;
		try {
			await replay(graph.organizationId);
		} catch (error) {
			failure = error;
		} finally {
			await removeFinalProjectionFault();
		}
		expect(failure).toMatchObject({
			message: "SCIM projection reconciliation failed",
			cause: {
				code: "23514",
				constraint: projectionFaultConstraintName,
			},
		});
		const remainingFault = await pool.query<{ count: number }>(
			"select count(*)::int as count from pg_constraint where conname = $1",
			[projectionFaultConstraintName],
		);
		expect(remainingFault.rows).toEqual([{ count: 0 }]);

		expect(await counts(graph)).toEqual({
			member: 0,
			employee: 0,
			lifecycle: 0,
			projection: 0,
			assignment: 0,
			team_permission: 0,
			team_membership: 0,
			lifecycle_audit: 0,
			provisioning_audit: 0,
			outbox: 0,
		});
		const subject = await pool.query<{ revision: number }>(
			"select revision from scim_subject where user_id = $1",
			[graph.userId],
		);
		expect(subject.rows).toEqual([{ revision: 0 }]);
	});

	it("commits the organization-qualified lifecycle and role projection atomically", async () => {
		const graph = await seedGraph({ templateActive: true });

		await expect(replay(graph.organizationId)).resolves.toMatchObject({
			provisioningDomainId: graph.organizationId,
			reconciledUsers: 1,
		});

		expect(await counts(graph)).toEqual({
			member: 1,
			employee: 1,
			lifecycle: 1,
			projection: 1,
			assignment: 1,
			team_permission: 1,
			team_membership: 1,
			lifecycle_audit: 1,
			provisioning_audit: 2,
			outbox: 1,
		});
		const effects = await pool.query<{
			organization_id: string;
			role: string;
			team_id: string;
			can_manage_team_members: boolean;
			actor_type: string;
			created_by: string | null;
		}>(
			`select employee.organization_id, employee.role, membership.team_id,
				permissions.can_manage_team_members, audit.actor_type, audit.created_by
			from employee
			join team_membership membership
				on membership.employee_id = employee.id
				and membership.organization_id = employee.organization_id
			join team_permissions permissions
				on permissions.employee_id = employee.id
				and permissions.organization_id = employee.organization_id
				and permissions.team_id is null
			join user_lifecycle_event audit
				on audit.employee_id = employee.id
				and audit.organization_id = employee.organization_id
			where employee.organization_id = $1 and employee.user_id = $2`,
			[graph.organizationId, graph.userId],
		);
		expect(effects.rows).toEqual([
			{
				organization_id: graph.organizationId,
				role: "manager",
				team_id: graph.teamId,
				can_manage_team_members: true,
				actor_type: "system",
				created_by: null,
			},
		]);
	});

	it("subject CAS prevents a downstream outbox check-then-insert race", async () => {
		const graph = await seedGraph({ templateActive: true });
		let lockClient: PoolClient | undefined;
		let lockReleased = false;
		const attempts: Promise<unknown>[] = [];
		try {
			lockClient = await pool.connect();
			await lockClient.query("begin");
			await lockClient.query(
				"select id from scim_subject where user_id = $1 for update",
				[graph.userId],
			);

			attempts.push(replay(graph.organizationId), replay(graph.organizationId));
			await waitForSubjectCASBlockers();
			await lockClient.query("commit");
			lockReleased = true;

			const results = await Promise.allSettled(attempts);
			const failures = results.filter(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			expect(
				results.filter((result) => result.status === "fulfilled"),
			).toHaveLength(1);
			expect(failures).toHaveLength(1);
			expect(failures[0]?.reason).toMatchObject({
				message:
					"The SCIM projection subject changed concurrently; retry the request.",
			});

			await expect(replay(graph.organizationId)).resolves.toMatchObject({
				provisioningDomainId: graph.organizationId,
				reconciledUsers: 1,
			});
		} finally {
			if (lockClient) {
				try {
					if (!lockReleased) await lockClient.query("rollback");
				} finally {
					lockClient.release();
				}
			}
			await Promise.allSettled(attempts);
		}

		expect(await lifecycleMembershipRevision(graph)).toEqual([
			{ membership_revision: 1 },
		]);
		expect(await subjectRevision(graph)).toEqual([{ revision: 2 }]);
		expect(await counts(graph)).toMatchObject({
			team_permission: 1,
			team_membership: 1,
			lifecycle_audit: 1,
			provisioning_audit: 2,
			outbox: 1,
		});
	});
});
