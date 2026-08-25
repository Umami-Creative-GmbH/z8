/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner owns the disposable database and rejects any database outside its sentinel.
 */
import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { authDatabaseSchema } from "@/lib/auth-database-schema";
import { createZ8SCIMPlugin } from "./auth-configuration";
import { SCIM_SCOPES } from "./constants";

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const sentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const required = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const configuration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required,
	sentinel,
});
if (configuration.status === "error") throw new Error(configuration.reason);
const describeIntegration =
	configuration.status === "enabled" ? describe : describe.skip;

const runId = randomUUID();
const organizationIds: string[] = [];
const connectionIds: string[] = [];

type SCIMResource = { id: string; externalId?: string; active?: boolean };

describeIntegration("managed SCIM protocol PostgreSQL contract", () => {
	const pool = new Pool({ connectionString: databaseUrl, max: 8 });
	const database = drizzle({ client: pool, schema: authDatabaseSchema });
	const auth = betterAuth({
		baseURL: "http://localhost:3000",
		secret: "managed-scim-protocol-integration-secret",
		database: drizzleAdapter(database, {
			provider: "pg",
			schema: authDatabaseSchema,
			transaction: true,
		}),
		plugins: [createZ8SCIMPlugin("p".repeat(32))],
	});

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required,
			sentinel,
			currentDatabase: async () => {
				const result = await pool.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled")
			throw new Error("SCIM protocol test is not enabled");
	});

	afterAll(async () => {
		try {
			for (const connectionId of connectionIds) {
				await pool.query(
					"delete from scim_managed_connection where connection_id = $1",
					[connectionId],
				);
			}
			for (const organizationId of organizationIds) {
				await pool.query("delete from organization where id = $1", [
					organizationId,
				]);
			}
		} finally {
			await pool.end();
		}
	});

	async function request(
		token: string,
		path: string,
		method = "GET",
		body?: unknown,
	) {
		return auth.handler(
			new Request(`http://localhost:3000/api/auth/scim/v2${path}`, {
				method,
				headers: {
					authorization: `Bearer ${token}`,
					...(body === undefined
						? {}
						: { "content-type": "application/scim+json" }),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
		);
	}

	async function setup(label: string, scopes = SCIM_SCOPES) {
		const organizationId = `scim-protocol-org-${label}-${runId}`;
		const actorId = `scim-protocol-actor-${label}-${runId}`;
		const defaultTemplateId = randomUUID();
		const mappedTemplateId = randomUUID();
		const providerId = `scim-protocol-provider-${label}-${runId}`;
		const now = new Date("2026-08-26T12:00:00.000Z");
		organizationIds.push(organizationId);
		await pool.query(
			`insert into "user" (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'SCIM Protocol Actor', $2, true, $3, $3)`,
			[actorId, `${actorId}@example.test`, now],
		);
		await pool.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'SCIM Protocol Organization', $2, $3)`,
			[organizationId, organizationId, now],
		);
		for (const [id, name, role] of [
			[defaultTemplateId, "Default", "employee"],
			[mappedTemplateId, "Mapped", "manager"],
		] as const) {
			await pool.query(
				`insert into role_template (id, organization_id, name, is_global, is_active, employee_role, team_permissions, created_at, created_by, updated_at)
				 values ($1, $2, $3, false, true, $4, '{}'::jsonb, $5, $6, $5)`,
				[id, organizationId, name, role, now, actorId],
			);
		}
		await pool.query(
			`insert into enterprise_identity_setup (organization_id, provider_id, domain, domain_verified, created_at, created_by, updated_at)
			 values ($1, $2, $3, true, $4, $5, $4)`,
			[organizationId, providerId, `${label}.example.test`, now, actorId],
		);
		await pool.query(
			`insert into sso_provider (id, issuer, user_id, provider_id, organization_id, domain, domain_verified)
			 values ($1, $2, $3, $4, $5, $6, true)`,
			[
				randomUUID(),
				`https://${label}.example.test`,
				actorId,
				providerId,
				organizationId,
				`${label}.example.test`,
			],
		);
		const created = await auth.api.createSCIMManagedConnection({
			body: {
				creationRequestId: `scim-protocol-${label}-${runId}`,
				provisioningDomainId: organizationId,
				actorId,
				scopes,
				expiresAt: new Date("2027-08-26T12:00:00.000Z"),
			},
		});
		connectionIds.push(created.connection.connectionId);
		await pool.query(
			`insert into scim_provider_config (organization_id, creation_request_id, connection_id, state, auto_activate_users, deprovision_action, default_role_template_id, created_at, created_by, updated_at)
			 values ($1, $2, $3, 'active', true, 'suspend', $4, $5, $6, $5)`,
			[
				organizationId,
				`scim-protocol-${label}-${runId}`,
				created.connection.connectionId,
				defaultTemplateId,
				now,
				actorId,
			],
		);
		return {
			organizationId,
			actorId,
			defaultTemplateId,
			mappedTemplateId,
			providerId,
			connectionId: created.connection.connectionId,
			credentialId: created.credential.credentialId,
			token: created.token,
		};
	}

	async function bindUser(
		graph: Awaited<ReturnType<typeof setup>>,
		externalId: string,
	) {
		const userId = `scim-protocol-user-${externalId}-${runId}`;
		const now = new Date("2026-08-26T12:00:00.000Z");
		await pool.query(
			`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, $4, $4)`,
			[userId, externalId, `${externalId}@example.test`, now],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values ($1, $2, $3, 'member', 'pending', $4)`,
			[randomUUID(), graph.organizationId, userId, now],
		);
		await pool.query(
			`insert into account (id, issuer, account_id, provider_id, user_id, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $6)`,
			[
				randomUUID(),
				graph.providerId,
				externalId,
				graph.providerId,
				userId,
				now,
			],
		);
		return userId;
	}

	function user(externalId: string, active = true) {
		return {
			schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
			userName: `${externalId}@example.test`,
			name: { formatted: externalId },
			emails: [{ value: `${externalId}@example.test`, primary: true }],
			externalId,
			active,
		};
	}

	it("serves managed SCIM protocol resources, authorization errors, Entra groups, and immutable identities", async () => {
		const graph = await setup("protocol");
		await bindUser(graph, "protocol-user");
		const config = await request(graph.token, "/ServiceProviderConfig");
		expect(config.status).toBe(200);
		expect(config.headers.get("content-type")).toContain(
			"application/scim+json",
		);
		expect((await config.json()) as { schemas: string[] }).toMatchObject({
			schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
		});
		const created = await request(
			graph.token,
			"/Users",
			"POST",
			user("protocol-user"),
		);
		expect(created.status).toBe(201);
		const source = (await created.json()) as SCIMResource;
		const listed = await request(
			graph.token,
			"/Users?filter=externalId%20eq%20%22protocol-user%22&startIndex=1&count=1",
		);
		expect(listed.status).toBe(200);
		expect(await listed.json()).toMatchObject({
			totalResults: 1,
			Resources: [{ id: source.id }],
		});
		const immutable = await request(
			graph.token,
			`/Users/${source.id}`,
			"PUT",
			user("replacement"),
		);
		expect(immutable.status).toBe(409);
		expect(await immutable.json()).toEqual({
			schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
			status: "409",
			detail: "The SCIM identity cannot be linked",
		});
		const group = await request(graph.token, "/Groups", "POST", {
			schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
			displayName: "Entra Group",
			externalId: "entra-group",
			members: [{ value: source.id }],
		});
		expect(group.status).toBe(201);
		const groupResource = (await group.json()) as SCIMResource;
		const updatedGroup = await request(
			graph.token,
			`/Groups/${groupResource.id}`,
			"PUT",
			{
				schemas: [
					"urn:ietf:params:scim:schemas:core:2.0:Group",
					"urn:ietf:params:scim:schemas:extension:enterprise:2.0:Group",
				],
				displayName: "Entra Group",
				externalId: "entra-group",
				members: [{ value: source.id }],
			},
		);
		expect(updatedGroup.status).toBe(200);
		expect((await updatedGroup.json()) as { schemas: string[] }).toMatchObject({
			schemas: expect.arrayContaining([
				"urn:ietf:params:scim:schemas:core:2.0:Group",
			]),
		});
		for (const [path, method, body, status] of [
			[
				`/Groups/${groupResource.id}`,
				"PATCH",
				{
					schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
					Operations: [
						{ op: "replace", path: "displayName", value: "Updated" },
					],
				},
				200,
			],
			[`/Groups/${groupResource.id}`, "DELETE", undefined, 204],
			[
				`/Users/${source.id}`,
				"PATCH",
				{
					schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
					Operations: [{ op: "replace", path: "active", value: false }],
				},
				200,
			],
			[`/Users/${source.id}`, "DELETE", undefined, 204],
		] as const) {
			const response = await request(graph.token, path, method, body);
			expect(response.status).toBe(status);
		}
		for (const [token, path, expected] of [
			["invalid", "/Users", 401],
			[graph.token, "/Unknown", 400],
		] as const)
			expect((await request(token, path)).status).toBe(expected);
		const restricted = await setup("restricted", ["scim.users.read"]);
		expect((await request(restricted.token, "/Groups")).status).toBe(403);
	});

	it("projects only bound organization identities, roles, lifecycle state, and managed credentials", async () => {
		const orgA = await setup("organization-a");
		const orgB = await setup("organization-b");
		const aUserId = await bindUser(orgA, "organization-a-user");
		const bUserId = await bindUser(orgB, "organization-b-user");
		await pool.query(
			`insert into role_template_mapping (id, organization_id, idp_type, idp_group_id, idp_group_name, role_template_id, priority, created_at, created_by)
			 values ($1, $2, 'scim', 'winning-group', 'Winning group', $3, 100, $4, $5)`,
			[
				randomUUID(),
				orgA.organizationId,
				orgA.mappedTemplateId,
				new Date("2026-08-26T12:00:00.000Z"),
				orgA.actorId,
			],
		);
		const createdA = await request(
			orgA.token,
			"/Users",
			"POST",
			user("organization-a-user"),
		);
		const createdB = await request(
			orgB.token,
			"/Users",
			"POST",
			user("organization-b-user"),
		);
		expect(createdA.status).toBe(201);
		expect(createdB.status).toBe(201);
		const aSource = (await createdA.json()) as SCIMResource;
		const bSource = (await createdB.json()) as SCIMResource;
		expect(bSource.externalId).toBe("organization-b-user");
		const winningGroup = await request(orgA.token, "/Groups", "POST", {
			schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
			displayName: "Winning group",
			externalId: "winning-group",
			members: [{ value: aSource.id }],
		});
		expect(winningGroup.status).toBe(201);
		const winning = (await winningGroup.json()) as SCIMResource;
		const defaultGroup = await request(orgA.token, "/Groups", "POST", {
			schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
			displayName: "Default group",
			externalId: "default-group",
		});
		expect(defaultGroup.status).toBe(201);
		const projection = async (organizationId: string, userId: string) =>
			(
				await pool.query<{
					role_template_id: string;
					employee_role: string;
					status: string;
					is_active: boolean;
				}>(
					`select projection.role_template_id, employee.role as employee_role, member.status, employee.is_active
				 from scim_role_projection_state projection join employee on employee.organization_id = projection.organization_id and employee.user_id = projection.user_id
				 join member on member.organization_id = projection.organization_id and member.user_id = projection.user_id
				 where projection.organization_id = $1 and projection.user_id = $2`,
					[organizationId, userId],
				)
			).rows[0];
		expect(await projection(orgA.organizationId, aUserId)).toMatchObject({
			role_template_id: orgA.mappedTemplateId,
			employee_role: "manager",
			status: "approved",
			is_active: true,
		});
		expect(await projection(orgB.organizationId, bUserId)).toMatchObject({
			role_template_id: orgB.defaultTemplateId,
			employee_role: "employee",
			status: "approved",
			is_active: true,
		});
		const removed = await request(
			orgA.token,
			`/Groups/${winning.id}`,
			"PATCH",
			{
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [
					{ op: "remove", path: `members[value eq "${aSource.id}"]` },
				],
			},
		);
		expect(removed.status).toBe(200);
		expect(await projection(orgA.organizationId, aUserId)).toMatchObject({
			role_template_id: orgA.defaultTemplateId,
			employee_role: "employee",
		});
		expect(await projection(orgB.organizationId, bUserId)).toMatchObject({
			role_template_id: orgB.defaultTemplateId,
			status: "approved",
			is_active: true,
		});
		const deactivate = await request(
			orgA.token,
			`/Users/${aSource.id}`,
			"PATCH",
			{
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [{ op: "replace", path: "active", value: false }],
			},
		);
		expect(deactivate.status).toBe(200);
		expect(await projection(orgA.organizationId, aUserId)).toMatchObject({
			status: "suspended",
			is_active: false,
		});
		expect(await projection(orgB.organizationId, bUserId)).toMatchObject({
			status: "approved",
			is_active: true,
		});
		const reactivate = await request(
			orgA.token,
			`/Users/${aSource.id}`,
			"PATCH",
			{
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [{ op: "replace", path: "active", value: true }],
			},
		);
		expect(reactivate.status).toBe(200);
		expect(await projection(orgA.organizationId, aUserId)).toMatchObject({
			status: "approved",
			is_active: true,
		});
		const rotated = await auth.api.rotateSCIMManagedCredential({
			body: {
				connectionId: orgA.connectionId,
				provisioningDomainId: orgA.organizationId,
				actorId: orgA.actorId,
				scopes: SCIM_SCOPES,
				expiresAt: new Date("2027-08-26T12:00:00.000Z"),
			},
		});
		expect(rotated.token).not.toBe(orgA.token);
		await auth.api.revokeSCIMManagedCredential({
			body: {
				connectionId: orgA.connectionId,
				provisioningDomainId: orgA.organizationId,
				credentialId: orgA.credentialId,
				actorId: orgA.actorId,
			},
		});
		expect((await request(orgA.token, "/Users")).status).toBe(401);
		const persisted = await pool.query<{ value: string }>(
			`select coalesce(string_agg(to_jsonb(row)::text, ''), '') as value from (select * from scim_managed_connection where connection_id = $1 union all select * from scim_managed_connection where connection_id = $2) row`,
			[orgA.connectionId, orgB.connectionId],
		);
		expect(persisted.rows[0]?.value).not.toContain(rotated.token);
		const events = await auth.api.listSCIMManagedConnectionEvents({
			body: {
				connectionId: orgA.connectionId,
				provisioningDomainId: orgA.organizationId,
			},
		});
		expect(JSON.stringify(events)).not.toContain(rotated.token);
		const deadline = Date.now() + 5_000;
		let status = "reconciling";
		while (Date.now() < deadline && status === "reconciling") {
			const result = await auth.api.decommissionSCIMManagedConnection({
				body: {
					connectionId: orgA.connectionId,
					provisioningDomainId: orgA.organizationId,
					actorId: orgA.actorId,
				},
			});
			status = result.decommission.status;
		}
		expect(status).toBe("decommissioned");
	});
});
