/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner owns the disposable database and rejects any database outside its sentinel.
 */
import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth/minimal";
import { organization } from "better-auth/plugins/organization";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import { captureAuthTransactions } from "@/lib/auth/auth-transaction";
import { authDatabaseSchema } from "@/lib/auth-database-schema";
import { integrationAdminPool } from "@/test/integration-database";
import {
	createSCIMCallbackModelRegistration,
	createZ8SCIMPlugin,
} from "./auth-configuration";
import { getSCIMCredentialExpiresAt, SCIM_SCOPES } from "./constants";
import {
	createSCIMDecommissionStore,
	decommissionSCIMConnection,
	runDueSCIMDecommission,
} from "./decommission";
import { guardSCIMSubjectAcquisitions } from "./projection-guards";

const runId = randomUUID();
const organizationIds: string[] = [];
const connectionIds: string[] = [];
const seededUserIds: string[] = [];

type SCIMResource = { id: string; externalId?: string; active?: boolean };

async function expectSafeSCIMError(
	response: Response,
	status: number,
	secrets: string[],
) {
	expect(response.status).toBe(status);
	expect(response.headers.get("content-type")).toContain(
		"application/scim+json",
	);
	const error = (await response.json()) as {
		schemas: string[];
		status: string;
		detail?: string;
	};
	expect(error.schemas).toEqual([
		"urn:ietf:params:scim:api:messages:2.0:Error",
	]);
	expect(error.status).toBe(String(status));
	for (const secret of secrets)
		expect(JSON.stringify(error)).not.toContain(secret);
	return error;
}

describe("managed SCIM protocol PostgreSQL contract", () => {
	const pool = integrationAdminPool();
	const database = drizzle({ client: pool, schema: authDatabaseSchema });
	const auth = betterAuth({
		baseURL: "http://localhost:3000",
		secret: "managed-scim-protocol-integration-secret",
		// As in production: SCIM callbacks guard on the captured transaction (#314).
		database: guardSCIMSubjectAcquisitions(
			drizzleAdapter(captureAuthTransactions(database), {
				provider: "pg",
				schema: authDatabaseSchema,
				transaction: true,
			}),
		),
		plugins: [
			createZ8SCIMPlugin("p".repeat(32)),
			organization({
				schema: {
					member: {
						additionalFields: {
							status: { type: "string", required: false },
						},
					},
				},
			}),
			sso({ domainVerification: { enabled: true } }),
			createSCIMCallbackModelRegistration(),
		],
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
			for (const userId of seededUserIds)
				await pool.query('delete from "user" where id = $1', [userId]);
		} finally {
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
		const credentialExpiresAt = getSCIMCredentialExpiresAt();
		organizationIds.push(organizationId);
		seededUserIds.push(actorId);
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
				expiresAt: credentialExpiresAt,
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
			expiresAt: credentialExpiresAt,
			token: created.token,
		};
	}

	async function bindUser(
		graph: Awaited<ReturnType<typeof setup>>,
		externalId: string,
		email = `${externalId}@example.test`,
	) {
		const userId = `scim-protocol-user-${externalId}-${runId}`;
		seededUserIds.push(userId);
		const now = new Date("2026-08-26T12:00:00.000Z");
		await pool.query(
			`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, $4, $4)`,
			[userId, externalId, email, now],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values ($1, $2, $3, 'member', 'pending', $4)`,
			[randomUUID(), graph.organizationId, userId, now],
		);
		await pool.query(
			`insert into account (id, account_id, provider_id, user_id, created_at, updated_at) values ($1, $2, $3, $4, $5, $5)`,
			[randomUUID(), externalId, graph.providerId, userId, now],
		);
		return userId;
	}

	function user(
		externalId: string,
		active = true,
		email = `${externalId}@example.test`,
	) {
		return {
			schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
			userName: email,
			name: { formatted: externalId },
			emails: [{ value: email, primary: true }],
			externalId,
			active,
		};
	}

	it("synchronizes the enterprise personnel number with the organization employee", async () => {
		const extension =
			"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
		const graph = await setup("personnel-create");
		const userId = await bindUser(graph, `personnel-create-${runId}`);
		const created = await request(graph.token, "/Users", "POST", {
			...user(`personnel-create-${runId}`),
			schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", extension],
			[extension]: { employeeNumber: " E-0042 " },
		});
		expect(created.status).toBe(201);
		const resource = await created.json();
		expect(resource[extension]).toMatchObject({ employeeNumber: "E-0042" });
		const stored = await pool.query(
			"select employee_number from employee where organization_id = $1 and user_id = $2",
			[graph.organizationId, userId],
		);
		expect(stored.rows).toEqual([{ employee_number: "E-0042" }]);
		const read = await request(graph.token, `/Users/${resource.id}`);
		expect((await read.json())[extension]).toMatchObject({
			employeeNumber: "E-0042",
		});
	});
	it("keeps personnel number updates and clears under IdP ownership", async () => {
		const extension =
			"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
		const graph = await setup("personnel-patch");
		const externalId = `personnel-patch-${runId}`;
		const userId = await bindUser(graph, externalId);
		const created = await request(
			graph.token,
			"/Users",
			"POST",
			user(externalId),
		);
		expect(created.status).toBe(201);
		const resource = await created.json();
		const patch = async (Operations: unknown[]) =>
			request(graph.token, `/Users/${resource.id}`, "PATCH", {
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations,
			});
		const changed = await patch([
			{ op: "add", path: `${extension}:employeeNumber`, value: " 0042 " },
		]);
		expect(changed.status).toBe(200);
		expect((await changed.json())[extension]).toMatchObject({
			employeeNumber: "0042",
		});
		const current = async () =>
			(
				await pool.query(
					"select employee_number, personnel_number_managed_by_scim from employee where organization_id = $1 and user_id = $2",
					[graph.organizationId, userId],
				)
			).rows[0];
		expect(await current()).toEqual({
			employee_number: "0042",
			personnel_number_managed_by_scim: true,
		});
		const pathless = await patch([
			{ op: "replace", value: { [extension]: { employeeNumber: " E-7 " } } },
		]);
		expect(pathless.status).toBe(200);
		expect((await pathless.json())[extension]).toMatchObject({
			employeeNumber: "E-7",
		});
		expect((await current()).employee_number).toBe("E-7");
		const unrelated = await patch([
			{ op: "replace", path: "displayName", value: "Renamed" },
		]);
		expect(unrelated.status).toBe(200);
		expect((await current()).employee_number).toBe("E-7");
		const removed = await patch([
			{ op: "remove", path: `${extension}:employeeNumber` },
		]);
		expect(removed.status).toBe(200);
		expect(await current()).toEqual({
			employee_number: null,
			personnel_number_managed_by_scim: true,
		});
		const replaced = await request(
			graph.token,
			`/Users/${resource.id}`,
			"PUT",
			{
				...user(externalId),
				schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", extension],
				[extension]: { employeeNumber: " R-9 " },
			},
		);
		expect(replaced.status).toBe(200);
		expect((await replaced.json())[extension]).toMatchObject({
			employeeNumber: "R-9",
		});
		const omitted = await request(
			graph.token,
			`/Users/${resource.id}`,
			"PUT",
			user(externalId),
		);
		expect(omitted.status).toBe(200);
		expect(await current()).toEqual({
			employee_number: null,
			personnel_number_managed_by_scim: true,
		});
	});
	it("rolls back conflicting personnel number creates, replacements and multi-operation patches", async () => {
		const extension =
			"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
		const graph = await setup("personnel-conflict");
		const holder = `personnel-holder-${runId}`;
		const target = `personnel-target-${runId}`;
		const holderUserId = await bindUser(graph, holder);
		const targetUserId = await bindUser(graph, target);
		const withNumber = (externalId: string, employeeNumber: unknown) => ({
			...user(externalId),
			schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", extension],
			[extension]: { employeeNumber },
		});
		expect(
			(await request(graph.token, "/Users", "POST", withNumber(holder, "E-42")))
				.status,
		).toBe(201);
		await pool.query(
			"update employee set is_active = false where organization_id = $1 and user_id = $2",
			[graph.organizationId, holderUserId],
		);
		const conflict = await request(
			graph.token,
			"/Users",
			"POST",
			withNumber(target, " e-42 "),
		);
		await expectSafeSCIMError(conflict, 409, []).then((error) =>
			expect(error).toMatchObject({ scimType: "uniqueness" }),
		);
		expect(
			(
				await pool.query(
					"select id from employee where organization_id = $1 and user_id = $2",
					[graph.organizationId, targetUserId],
				)
			).rows,
		).toEqual([]);
		expect(
			(
				await pool.query(
					"select status from member where organization_id = $1 and user_id = $2",
					[graph.organizationId, targetUserId],
				)
			).rows,
		).toEqual([{ status: "pending" }]);
		const listed = await request(
			graph.token,
			`/Users?filter=${encodeURIComponent(`externalId eq "${target}"`)}`,
		);
		expect(await listed.json()).toMatchObject({ totalResults: 0 });
		const created = await request(graph.token, "/Users", "POST", user(target));
		expect(created.status).toBe(201);
		const resource = await created.json();
		const before = (
			await pool.query(
				"select * from employee where organization_id = $1 and user_id = $2",
				[graph.organizationId, targetUserId],
			)
		).rows;
		const replacement = await request(
			graph.token,
			`/Users/${resource.id}`,
			"PUT",
			{ ...withNumber(target, "e-42"), displayName: "Rejected replacement" },
		);
		await expectSafeSCIMError(replacement, 409, []).then((error) =>
			expect(error).toMatchObject({ scimType: "uniqueness" }),
		);
		const patch = await request(graph.token, `/Users/${resource.id}`, "PATCH", {
			schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
			Operations: [
				{ op: "replace", path: "displayName", value: "Rejected patch" },
				{ op: "add", path: `${extension}:employeeNumber`, value: "E-42" },
			],
		});
		await expectSafeSCIMError(patch, 409, []).then((error) =>
			expect(error).toMatchObject({ scimType: "uniqueness" }),
		);
		const read = await request(graph.token, `/Users/${resource.id}`);
		expect(await read.json()).toMatchObject({
			displayName: resource.displayName,
		});
		expect(
			(
				await pool.query(
					"select * from employee where organization_id = $1 and user_id = $2",
					[graph.organizationId, targetUserId],
				)
			).rows,
		).toEqual(before);
	});

	it("claims ownership for explicit empty values and validates personnel number length atomically", async () => {
		const extension =
			"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
		const graph = await setup("personnel-empty");
		for (const [index, value] of [null, "", "   "].entries()) {
			const externalId = `personnel-empty-${index}-${runId}`;
			const userId = await bindUser(graph, externalId);
			const response = await request(graph.token, "/Users", "POST", {
				...user(externalId),
				schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", extension],
				[extension]: { employeeNumber: value },
			});
			expect(response.status).toBe(201);
			expect(
				(
					await pool.query(
						"select employee_number, personnel_number_managed_by_scim from employee where organization_id = $1 and user_id = $2",
						[graph.organizationId, userId],
					)
				).rows,
			).toEqual([
				{ employee_number: null, personnel_number_managed_by_scim: true },
			]);
		}
		for (const [index, value] of ["X".repeat(51), 123].entries()) {
			const externalId = `personnel-invalid-${index}-${runId}`;
			const userId = await bindUser(graph, externalId);
			const response = await request(graph.token, "/Users", "POST", {
				...user(externalId),
				schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", extension],
				[extension]: { employeeNumber: value },
			});
			await expectSafeSCIMError(response, 400, []);
			expect(
				(
					await pool.query(
						"select id from employee where organization_id = $1 and user_id = $2",
						[graph.organizationId, userId],
					)
				).rows,
			).toEqual([]);
		}
	});

	it("keeps local personnel numbers unowned until explicitly supplied and returns canonical list values", async () => {
		const extension =
			"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
		const graph = await setup("personnel-local");
		const externalId = `personnel-local-${runId}`;
		const userId = await bindUser(graph, externalId);
		const created = await request(
			graph.token,
			"/Users",
			"POST",
			user(externalId),
		);
		expect(created.status).toBe(201);
		const resource = await created.json();
		await pool.query(
			"update employee set employee_number = 'LOCAL-0042' where organization_id = $1 and user_id = $2",
			[graph.organizationId, userId],
		);
		expect(
			(
				await request(
					graph.token,
					`/Users/${resource.id}`,
					"PUT",
					user(externalId),
				)
			).status,
		).toBe(200);
		const list = await request(graph.token, "/Users");
		expect(await list.json()).toMatchObject({
			Resources: [
				{ id: resource.id, [extension]: { employeeNumber: "LOCAL-0042" } },
			],
		});
		const excluded = await request(
			graph.token,
			`/Users/${resource.id}?excludedAttributes=${encodeURIComponent(`${extension}:employeeNumber`)}`,
		);
		expect((await excluded.json())[extension]?.employeeNumber).toBeUndefined();
		const selected = await request(
			graph.token,
			`/Users/${resource.id}?attributes=userName`,
		);
		expect((await selected.json())[extension]).toBeUndefined();
		expect(
			(
				await pool.query(
					"select employee_number, personnel_number_managed_by_scim from employee where organization_id = $1 and user_id = $2",
					[graph.organizationId, userId],
				)
			).rows,
		).toEqual([
			{
				employee_number: "LOCAL-0042",
				personnel_number_managed_by_scim: false,
			},
		]);
		const cleared = await request(
			graph.token,
			`/Users/${resource.id}`,
			"PATCH",
			{
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [{ op: "remove", path: extension }],
			},
		);
		expect(cleared.status).toBe(200);
		expect(
			(
				await pool.query(
					"select employee_number, personnel_number_managed_by_scim from employee where organization_id = $1 and user_id = $2",
					[graph.organizationId, userId],
				)
			).rows,
		).toEqual([
			{ employee_number: null, personnel_number_managed_by_scim: true },
		]);
	});
	it("maps a concurrent personnel number index conflict to SCIM uniqueness and rolls back ownership", async () => {
		const extension =
			"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
		const graph = await setup("personnel-race");
		const holder = `race-holder-${runId}`;
		const target = `race-target-${runId}`;
		const holderId = await bindUser(graph, holder);
		const targetId = await bindUser(graph, target);
		expect(
			(await request(graph.token, "/Users", "POST", user(holder))).status,
		).toBe(201);
		const created = await request(graph.token, "/Users", "POST", user(target));
		expect(created.status).toBe(201);
		const source = await created.json();
		const concurrent = await pool.connect();
		try {
			await concurrent.query("begin");
			await concurrent.query(
				"update employee set employee_number = 'RACE-1' where organization_id = $1 and user_id = $2",
				[graph.organizationId, holderId],
			);
			const pending = request(graph.token, `/Users/${source.id}`, "PATCH", {
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [
					{ op: "add", path: `${extension}:employeeNumber`, value: "race-1" },
				],
			});
			await vi.waitFor(
				async () => {
					const blockers = await pool.query(
						"select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%update%employee%'",
					);
					expect(blockers.rows.length).toBeGreaterThan(0);
				},
				{ timeout: 10_000 },
			);
			await concurrent.query("commit");
			await expectSafeSCIMError(await pending, 409, []).then((error) =>
				expect(error).toMatchObject({ scimType: "uniqueness" }),
			);
			expect(
				(
					await pool.query(
						"select employee_number, personnel_number_managed_by_scim from employee where organization_id = $1 and user_id = $2",
						[graph.organizationId, targetId],
					)
				).rows,
			).toEqual([
				{ employee_number: null, personnel_number_managed_by_scim: false },
			]);
			const read = await request(graph.token, `/Users/${source.id}`);
			expect((await read.json())[extension]?.employeeNumber).toBeUndefined();
		} finally {
			await concurrent.query("rollback");
			concurrent.release();
		}
	}, 20_000);

	it("keeps one user's personnel number and ownership independent across organizations", async () => {
		const extension =
			"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
		const first = await setup("personnel-org-a");
		const second = await setup("personnel-org-b");
		const externalId = `two-organizations-${runId}`;
		const userId = await bindUser(first, externalId);
		await pool.query(
			"insert into member (id, organization_id, user_id, role, status, created_at) values ($1, $2, $3, 'member', 'pending', now())",
			[randomUUID(), second.organizationId, userId],
		);
		await pool.query(
			"insert into account (id, account_id, provider_id, user_id, created_at, updated_at) values ($1, $2, $3, $4, now(), now())",
			[randomUUID(), externalId, second.providerId, userId],
		);
		const numbered = {
			...user(externalId),
			schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", extension],
			[extension]: { employeeNumber: "SAME-42" },
		};
		const firstResponse = await request(
			first.token,
			"/Users",
			"POST",
			numbered,
		);
		expect(firstResponse.status).toBe(201);
		const firstSource = await firstResponse.json();
		const secondResponse = await request(
			second.token,
			"/Users",
			"POST",
			user(externalId),
		);
		expect(secondResponse.status).toBe(201);
		const secondSource = await secondResponse.json();
		const before = await pool.query(
			"select organization_id, personnel_number_managed_by_scim from employee where user_id = $1 order by organization_id",
			[userId],
		);
		expect(before.rows).toEqual([
			{
				organization_id: first.organizationId,
				personnel_number_managed_by_scim: true,
			},
			{
				organization_id: second.organizationId,
				personnel_number_managed_by_scim: false,
			},
		]);
		expect(
			(
				await request(
					second.token,
					`/Users/${secondSource.id}`,
					"PUT",
					numbered,
				)
			).status,
		).toBe(200);
		const forbidden = await request(
			first.token,
			`/Users/${secondSource.id}`,
			"PUT",
			{ ...numbered, [extension]: { employeeNumber: "FORBIDDEN" } },
		);
		expect(forbidden.status).toBe(404);
		const readA = await request(first.token, `/Users/${firstSource.id}`);
		const readB = await request(second.token, `/Users/${secondSource.id}`);
		expect((await readA.json())[extension]).toMatchObject({
			employeeNumber: "SAME-42",
		});
		expect((await readB.json())[extension]).toMatchObject({
			employeeNumber: "SAME-42",
		});
	});

	it("preserves personnel number ownership through credential rotation and projection replay", async () => {
		const extension =
			"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
		const graph = await setup("personnel-rotation");
		const externalId = `personnel-rotation-${runId}`;
		const userId = await bindUser(graph, externalId);
		const created = await request(graph.token, "/Users", "POST", {
			...user(externalId),
			schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", extension],
			[extension]: { employeeNumber: "ROT-42" },
		});
		expect(created.status).toBe(201);
		const source = await created.json();
		const rotated = await auth.api.rotateSCIMManagedCredential({
			body: {
				connectionId: graph.connectionId,
				provisioningDomainId: graph.organizationId,
				actorId: graph.actorId,
				scopes: SCIM_SCOPES,
				expiresAt: getSCIMCredentialExpiresAt(),
			},
		});
		await auth.api.reconcileSCIMProjection({
			body: { provisioningDomainId: graph.organizationId },
		});
		const read = await request(rotated.token, `/Users/${source.id}`);
		expect((await read.json())[extension]).toMatchObject({
			employeeNumber: "ROT-42",
		});
		expect(
			(
				await pool.query(
					"select personnel_number_managed_by_scim from employee where organization_id = $1 and user_id = $2",
					[graph.organizationId, userId],
				)
			).rows,
		).toEqual([{ personnel_number_managed_by_scim: true }]);
	});

	it("updates the personnel number without reactivating employment ended by an effective departure", async () => {
		const extension =
			"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
		const graph = await setup("personnel-departure");
		const externalId = `personnel-departure-${runId}`;
		const userId = await bindUser(graph, externalId);
		const created = await request(
			graph.token,
			"/Users",
			"POST",
			user(externalId),
		);
		expect(created.status).toBe(201);
		const source = await created.json();
		const patch = (Operations: unknown[]) =>
			request(graph.token, `/Users/${source.id}`, "PATCH", {
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations,
			});
		expect(
			(await patch([{ op: "replace", path: "active", value: false }])).status,
		).toBe(200);
		const employeeId = (
			await pool.query(
				"select id from employee where organization_id = $1 and user_id = $2",
				[graph.organizationId, userId],
			)
		).rows[0].id;
		const periodId = randomUUID();
		await pool.query(
			"insert into employee_employment_period (id, organization_id, employee_id, status, started_at, ended_at, start_provenance) values ($1, $2, $3, 'closed', '2025-01-01Z', '2026-01-01Z', 'recorded')",
			[periodId, graph.organizationId, employeeId],
		);
		await pool.query(
			"insert into employee_departure (organization_id, employee_id, employment_period_id, mode, timezone, cutoff_at, revision, status, created_by, request_id, request_fingerprint, effective_at) values ($1, $2, $3, 'immediate', 'UTC', '2026-01-01Z', 1, 'effective', $4, $5, 'personnel-number-regression', '2026-01-01Z')",
			[graph.organizationId, employeeId, periodId, graph.actorId, randomUUID()],
		);
		const updated = await patch([
			{ op: "replace", path: "active", value: true },
			{ op: "add", path: `${extension}:employeeNumber`, value: "FORMER-42" },
		]);
		expect(updated.status).toBe(200);
		expect((await updated.json())[extension]).toMatchObject({
			employeeNumber: "FORMER-42",
		});
		expect(
			(
				await pool.query(
					"select id, is_active, employee_number from employee where organization_id = $1 and user_id = $2",
					[graph.organizationId, userId],
				)
			).rows,
		).toEqual([
			{ id: employeeId, is_active: false, employee_number: "FORMER-42" },
		]);
	});
	it("serves managed SCIM protocol resources, authorization errors, and Entra groups", async () => {
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
		const replaced = await request(
			graph.token,
			`/Users/${source.id}`,
			"PUT",
			user("replacement"),
		);
		expect(replaced.status).toBe(200);
		expect((await replaced.json()) as SCIMResource).toMatchObject({
			id: source.id,
			externalId: "replacement",
		});
		const updatedProfile = await request(
			graph.token,
			`/Users/${source.id}`,
			"PUT",
			{
				...user("replacement"),
				userName: "unrelated-profile@example.invalid",
				name: { formatted: "Updated Profile" },
				emails: [{ value: "unrelated-profile@example.invalid", primary: true }],
			},
		);
		expect(updatedProfile.status).toBe(200);
		expect((await updatedProfile.json()) as SCIMResource).toMatchObject({
			id: source.id,
			externalId: "replacement",
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
				schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
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
		await expectSafeSCIMError(await request("invalid", "/Users"), 401, [
			graph.token,
			graph.organizationId,
			graph.providerId,
		]);
		expect((await request(graph.token, "/Unknown")).status).toBe(404);
		const restricted = await setup("restricted", ["scim.users.read"]);
		await expectSafeSCIMError(await request(restricted.token, "/Groups"), 403, [
			restricted.token,
			restricted.organizationId,
			restricted.providerId,
		]);
	});

	it("links a first SCIM user by its provider subject instead of either SCIM or persisted email", async () => {
		const graph = await setup("external-subject");
		const targetId = await bindUser(
			graph,
			"provider-subject-target",
			"persisted-target@example.test",
		);
		const collisionId = await bindUser(
			graph,
			"provider-subject-collision",
			"scim-collision@example.test",
		);
		const created = await request(
			graph.token,
			"/Users",
			"POST",
			user("provider-subject-target", true, "scim-collision@example.test"),
		);
		expect(created.status).toBe(201);
		const source = (await created.json()) as SCIMResource;
		const binding = await pool.query<{ user_id: string }>(
			"select user_id from scim_user where id = $1",
			[source.id],
		);
		expect(binding.rows).toEqual([{ user_id: targetId }]);
		expect(binding.rows[0]?.user_id).not.toBe(collisionId);
	});

	it("accepts the rotated credential, preserves its documented overlap, then rejects revoked and expired credentials", async () => {
		const graph = await setup("credential-lifecycle");
		const rotatedExpiresAt = getSCIMCredentialExpiresAt();
		const rotated = await auth.api.rotateSCIMManagedCredential({
			body: {
				connectionId: graph.connectionId,
				provisioningDomainId: graph.organizationId,
				actorId: graph.actorId,
				scopes: SCIM_SCOPES,
				expiresAt: rotatedExpiresAt,
			},
		});
		expect((await request(rotated.token, "/Users")).status).toBe(200);
		expect((await request(graph.token, "/Users")).status).toBe(200);
		await auth.api.revokeSCIMManagedCredential({
			body: {
				connectionId: graph.connectionId,
				provisioningDomainId: graph.organizationId,
				credentialId: graph.credentialId,
				actorId: graph.actorId,
			},
		});
		await expectSafeSCIMError(await request(graph.token, "/Users"), 401, [
			graph.token,
		]);
		const storedCredentials = await pool.query<{
			credential_id: string;
			status: string;
			token_digest: string;
			hash_version: string;
			serialized_scopes: string;
			expires_at: Date;
			revoked_by: string | null;
		}>(
			`select credential_id, credential.status, token_digest, hash_version,
				serialized_scopes, expires_at, revoked_by
			 from scim_managed_credential credential
			 join scim_managed_connection connection
				on connection.id = credential.connection_record_id
			 where connection.connection_id = $1`,
			[graph.connectionId],
		);
		expect(storedCredentials.rows).toHaveLength(2);
		expect(storedCredentials.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					credential_id: graph.credentialId,
					status: "revoked",
					hash_version: "v1",
					serialized_scopes: JSON.stringify(SCIM_SCOPES),
					expires_at: graph.expiresAt,
					revoked_by: graph.actorId,
				}),
				expect.objectContaining({
					credential_id: rotated.credential.credentialId,
					status: "active",
					hash_version: "v1",
					serialized_scopes: JSON.stringify(SCIM_SCOPES),
					expires_at: rotatedExpiresAt,
					revoked_by: null,
				}),
			]),
		);
		for (const credential of storedCredentials.rows) {
			expect(credential.token_digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
			expect(credential.token_digest).not.toBe(graph.token);
			expect(credential.token_digest).not.toBe(rotated.token);
		}
		expect(JSON.stringify(storedCredentials.rows)).not.toContain(graph.token);
		expect(JSON.stringify(storedCredentials.rows)).not.toContain(rotated.token);
		const expired = await setup("expired-credential");
		// @better-auth/scim 1.7.1's assertFutureExpiry rejects past expiries;
		// retain its API-generated digest and move only the fixture expiry.
		const expiredAt = new Date(Date.now() - 60_000);
		await pool.query(
			`update scim_managed_credential credential
			 set expires_at = $1
			 from scim_managed_connection connection
			 where credential.connection_record_id = connection.id
				and connection.connection_id = $2`,
			[expiredAt, expired.connectionId],
		);
		const expiredStored = await pool.query<{
			status: string;
			token_digest: string;
			hash_version: string;
			serialized_scopes: string;
			expires_at: Date;
		}>(
			`select credential.status, credential.token_digest, credential.hash_version,
				credential.serialized_scopes, credential.expires_at
			 from scim_managed_credential credential
			 join scim_managed_connection connection
				on connection.id = credential.connection_record_id
			 where connection.connection_id = $1`,
			[expired.connectionId],
		);
		expect(expiredStored.rows).toEqual([
			{
				status: "active",
				token_digest: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
				hash_version: "v1",
				serialized_scopes: JSON.stringify(SCIM_SCOPES),
				expires_at: expiredAt,
			},
		]);
		expect(expiredStored.rows[0]?.token_digest).not.toBe(expired.token);
		expect(
			(
				await auth.api.getSCIMManagedConnection({
					body: {
						connectionId: expired.connectionId,
						provisioningDomainId: expired.organizationId,
					},
				})
			).credentials,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					credentialId: expired.credentialId,
					status: "expired",
					expiresAt: expiredAt,
					scopes: SCIM_SCOPES,
				}),
			]),
		);
		expect(
			await expectSafeSCIMError(await request(expired.token, "/Users"), 401, [
				expired.token,
			]),
		).toEqual({
			schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
			status: "401",
			detail: "Invalid SCIM bearer token",
		});
	});

	it("decommissions only the due configuration through the production durable runner", async () => {
		const orgA = await setup("decommission-a");
		const orgB = await setup("decommission-b");
		const now = new Date("2026-08-26T13:00:00.000Z");
		const retryAfter = new Date("2026-08-26T14:00:00.000Z");
		const store = createSCIMDecommissionStore(database);
		let reconcilingCalls = 0;
		const initial = await decommissionSCIMConnection({
			database,
			store,
			auth: {
				api: {
					decommissionSCIMManagedConnection: async () => {
						reconcilingCalls++;
						return {
							decommission: {
								status: "reconciling" as const,
								retryAfter,
							},
						};
					},
				},
			},
			organizationId: orgA.organizationId,
			connectionId: orgA.connectionId,
			actorId: orgA.actorId,
			now,
		});
		expect(initial).toBe("deferred");
		expect(reconcilingCalls).toBe(1);
		const deferred = await pool.query<{
			state: string;
			updated_by: string | null;
			decommission_retry_at: Date;
			decommission_attempt_count: number;
		}>(
			`select state, updated_by, decommission_retry_at, decommission_attempt_count
			 from scim_provider_config where organization_id = $1`,
			[orgA.organizationId],
		);
		expect(deferred.rows).toEqual([
			{
				state: "decommissioning",
				updated_by: orgA.actorId,
				decommission_retry_at: retryAfter,
				decommission_attempt_count: 1,
			},
		]);
		expect(
			await runDueSCIMDecommission({
				store,
				auth,
				now: new Date(retryAfter.getTime() - 1),
			}),
		).toBe("skipped");
		const completed = await runDueSCIMDecommission({
			store,
			auth,
			now: retryAfter,
		});
		expect(completed).toBe("completed");
		const persisted = await pool.query<{
			state: string;
			decommission_completed_at: Date | null;
			decommission_retry_at: Date | null;
			decommission_last_error: string | null;
		}>(
			`select state, decommission_completed_at, decommission_retry_at, decommission_last_error
			 from scim_provider_config where organization_id = $1`,
			[orgA.organizationId],
		);
		expect(persisted.rows).toEqual([
			{
				state: "decommissioned",
				decommission_completed_at: retryAfter,
				decommission_retry_at: null,
				decommission_last_error: null,
			},
		]);
		const configs = await pool.query<{
			organization_id: string;
			connection_id: string | null;
			state: string;
		}>(
			`select organization_id, connection_id, state from scim_provider_config
			 where organization_id in ($1, $2) order by organization_id`,
			[orgA.organizationId, orgB.organizationId],
		);
		expect(configs.rows).toEqual([
			{
				organization_id: orgA.organizationId,
				connection_id: orgA.connectionId,
				state: "decommissioned",
			},
			{
				organization_id: orgB.organizationId,
				connection_id: orgB.connectionId,
				state: "active",
			},
		]);
		const connections = await pool.query<{
			connection_id: string;
			status: string;
			credential_status: string;
		}>(
			`select connection.connection_id, connection.status,
				credential.status as credential_status
			 from scim_managed_connection connection
			 join scim_managed_credential credential
				on credential.connection_record_id = connection.id
			 where connection.connection_id in ($1, $2)
			 order by connection.connection_id`,
			[orgA.connectionId, orgB.connectionId],
		);
		expect(connections.rows).toEqual(
			expect.arrayContaining([
				{
					connection_id: orgA.connectionId,
					status: "decommissioned",
					credential_status: "decommissioned",
				},
				{
					connection_id: orgB.connectionId,
					status: "active",
					credential_status: "active",
				},
			]),
		);
		const decommissioned = await request(orgA.token, "/Users");
		await expectSafeSCIMError(decommissioned, 401, [orgA.token]);
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
			status: "pending",
			is_active: false,
		});
		expect(await projection(orgB.organizationId, bUserId)).toMatchObject({
			role_template_id: orgB.defaultTemplateId,
			employee_role: "employee",
			status: "pending",
			is_active: false,
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
			status: "pending",
			is_active: false,
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
			status: "pending",
			is_active: false,
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
			status: "pending",
			is_active: false,
		});
		const rotated = await auth.api.rotateSCIMManagedCredential({
			body: {
				connectionId: orgA.connectionId,
				provisioningDomainId: orgA.organizationId,
				actorId: orgA.actorId,
				scopes: SCIM_SCOPES,
				expiresAt: getSCIMCredentialExpiresAt(),
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
			`select coalesce(string_agg(value, ''), '') as value from (
				select to_jsonb(connection)::text as value from scim_managed_connection connection where connection_id in ($1, $2)
				union all select to_jsonb(credential)::text as value from scim_managed_credential credential
				join scim_managed_connection connection on connection.id = credential.connection_record_id
				where connection.connection_id in ($1, $2)
			) values`,
			[orgA.connectionId, orgB.connectionId],
		);
		expect(persisted.rows[0]?.value).not.toContain(orgA.token);
		expect(persisted.rows[0]?.value).not.toContain(rotated.token);
		const events = await auth.api.listSCIMManagedConnectionEvents({
			body: {
				connectionId: orgA.connectionId,
				provisioningDomainId: orgA.organizationId,
			},
		});
		expect(JSON.stringify(events)).not.toContain(rotated.token);
	});
});
