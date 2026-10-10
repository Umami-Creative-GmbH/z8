/**
 * #359 runtime evidence: organization creation is one coordinated auth
 * transaction that commits the organization, its guarded owner membership and
 * one legacy approval rollout row per workflow type, or nothing at all.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Both production entry points run against a real Better Auth instance
 * configured with the production coordination hooks: the HTTP
 * `/organization/create` endpoint through the coordinated `/api/auth` handler,
 * and the onboarding service's server-side call. Only request headers, Next
 * cache and the after-commit membership provisioning are replaced.
 */

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { bearer } from "better-auth/plugins/bearer";
import { organization } from "better-auth/plugins/organization";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_WORKFLOW_TYPES } from "@/lib/approvals/workflow/types";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	requestHeaders: new Headers(),
	failOwnerGuard: false,
	provisioned: [] as string[],
	// biome-ignore lint/suspicious/noExplicitAny: assigned the Better Auth instance below.
	auth: null as any,
}));

// getRequestSession awaits connection(), which throws outside a Next request scope.
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", () => ({ headers: async () => harness.requestHeaders }));

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

// The onboarding service's `auth` is the real Better Auth instance below, and
// `runAuthMutation` is production's one-line coordination over its context.
vi.mock("@/lib/auth", async () => {
	const { runCoordinatedAuthMutation } = await import("@/lib/auth/auth-transaction");
	return {
		auth: {
			api: {
				createOrganization: (input: unknown) => harness.auth.api.createOrganization(input),
			},
		},
		runAuthMutation: <T>(mutation: () => Promise<T>) =>
			runCoordinatedAuthMutation(harness.auth.$context, mutation),
	};
});

// Injects a failure into the owner's #314 member guard, after the organization insert.
vi.mock("@/lib/authorization/authorization-mutation", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/lib/authorization/authorization-mutation")>();
	return {
		...original,
		protectAuthorizationMutation: async (
			...args: Parameters<typeof original.protectAuthorizationMutation>
		) => {
			if (harness.failOwnerGuard) throw new Error("injected owner guard failure");
			return original.protectAuthorizationMutation(...args);
		},
	};
});

const { db } = await import("@/db");
const { user: userTable } = await import("@/db/auth-schema");
const { captureAuthTransactions, runCoordinatedAuthMutation, UncoordinatedAuthMutationError } =
	await import("@/lib/auth/auth-transaction");
const { createCoordinatedOrganizationHooks, handleCoordinatedAuthRequest } = await import(
	"@/lib/auth/auth-mutation-coordination"
);
const { authDatabaseSchema } = await import("@/lib/auth-database-schema");
const { AuthService } = await import("@/lib/effect/services/auth.service");
const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
const { OnboardingService, OnboardingServiceLive } = await import(
	"@/lib/effect/services/onboarding.service"
);

const origin = "http://localhost:3000";
const ownerUser = "t359-owner-user";
const slug = "t359-created-org";
const token = `${ownerUser}-session-token`;
const ownerGuard = JSON.stringify(["work-user-configuration-access", ownerUser]);
const backfill = {
	bare: "t359-backfill-bare-org",
	partial: "t359-backfill-partial-org",
} as const;

describe("coordinated organization creation on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	// A real Better Auth instance with the production organization coordination.
	const auth = betterAuth({
		baseURL: origin,
		secret: "t359-organization-creation-integration-secret",
		database: drizzleAdapter(captureAuthTransactions(db), {
			provider: "pg",
			schema: authDatabaseSchema,
			transaction: true,
		}),
		session: { cookieCache: { enabled: false } },
		plugins: [
			bearer(),
			organization({
				// Production's check, without the deployment flag.
				allowUserToCreateOrganization: async (user) => {
					const record = await db.query.user.findFirst({ where: eq(userTable.id, user.id) });
					return record?.canCreateOrganizations ?? false;
				},
				creatorRole: "owner",
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
					beforeCreateInvitation: async () => undefined,
					afterAcceptInvitation: async () => undefined,
					afterAddMember: async ({ user }) => {
						harness.provisioned.push(`added:${user.id}`);
					},
				}),
			}),
		],
	});
	harness.auth = auth;

	/** The create-organization dialog's request, through the coordinated `/api/auth` handler. */
	const createOverHttp = () =>
		handleCoordinatedAuthRequest(
			auth.$context,
			new Request(`${origin}/api/auth/organization/create`, {
				method: "POST",
				headers: {
					origin,
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ name: "T359 created", slug }),
			}),
			(request) => auth.handler(request),
		);

	/** The onboarding organization step, through the production service. */
	const createThroughOnboarding = () => {
		const authLayer = Layer.succeed(
			AuthService,
			AuthService.of({
				getSession: () =>
					Effect.succeed({
						user: { id: ownerUser },
						session: { activeOrganizationId: null },
					} as never),
			} as never),
		);
		const layer = OnboardingServiceLive.pipe(
			Layer.provide(authLayer),
			Layer.provide(DatabaseServiceLive),
		);
		return Effect.runPromise(
			Effect.result(
				Effect.gen(function* () {
					const service = yield* OnboardingService;
					return yield* service.createOrganization({ name: "T359 created", slug });
				}).pipe(Effect.provide(layer)),
			),
		);
	};

	const openHolds = new Set<PoolClient>();

	async function holdAdvisoryLock(key: string) {
		const client: PoolClient = await admin.connect();
		openHolds.add(client);
		await client.query("begin");
		await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
		return {
			async release() {
				if (!openHolds.delete(client)) return;
				await client.query("commit");
				client.release();
			},
		};
	}

	async function waitForWaiterOn(key: string) {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const { rows } = await admin.query<{ waiting: number }>(
				`select count(*)::int as waiting from pg_locks l, (select hashtextextended($1, 0) as k) h
				 where l.locktype = 'advisory' and not l.granted
				   and l.classid = ((h.k >> 32) & 4294967295)::oid
				   and l.objid = (h.k & 4294967295)::oid`,
				[key],
			);
			if ((rows[0]?.waiting ?? 0) > 0) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(`No transaction waited on ${key}`);
	}

	/** Everything the created organization committed, by slug. */
	async function createdRows() {
		const { rows: organizations } = await admin.query<{ id: string }>(
			"select id from organization where slug = $1",
			[slug],
		);
		const organizationId = organizations[0]?.id ?? null;
		const { rows: members } = await admin.query<{ user_id: string; role: string }>(
			"select user_id, role from member where organization_id = $1",
			[organizationId],
		);
		const { rows: rollouts } = await admin.query<{
			workflow_type: string;
			lifecycle_mode: string;
			side_effect_mode: string;
		}>(
			`select workflow_type, lifecycle_mode, side_effect_mode from approval_workflow_rollout
			 where organization_id = $1 order by workflow_type::text`,
			[organizationId],
		);
		const { rows: sessions } = await admin.query<{ active_organization_id: string | null }>(
			"select active_organization_id from session where token = $1",
			[token],
		);
		return {
			organizationId,
			organizations: organizations.length,
			members,
			rollouts,
			activeOrganizationId: sessions[0]?.active_organization_id ?? null,
		};
	}

	const legacyRollouts = [...APPROVAL_WORKFLOW_TYPES].sort().map((workflowType) => ({
		workflow_type: workflowType,
		lifecycle_mode: "legacy",
		side_effect_mode: "legacy",
	}));

	async function expectCreatedTogether() {
		const created = await createdRows();
		expect(created.organizations).toBe(1);
		expect(created.members).toEqual([{ user_id: ownerUser, role: "owner" }]);
		expect(created.rollouts).toEqual(legacyRollouts);
		expect(created.activeOrganizationId).toBe(created.organizationId);
		expect(harness.provisioned).toEqual([`added:${ownerUser}`]);
		return created;
	}

	async function rolloutRowCount() {
		const { rows } = await admin.query<{ count: number }>(
			"select count(*)::int as count from approval_workflow_rollout",
		);
		return rows[0]?.count ?? 0;
	}

	/** No organization, member, rollout row or session change survives the attempt. */
	async function expectNothingCreated(rolloutRowsBefore: number) {
		const { rows } = await admin.query("select id from organization where slug = $1", [slug]);
		expect(rows).toEqual([]);
		expect(await rolloutRowCount()).toBe(rolloutRowsBefore);
		const { rows: members } = await admin.query("select id from member where user_id = $1", [
			ownerUser,
		]);
		expect(members).toEqual([]);
		expect((await createdRows()).activeOrganizationId).toBeNull();
		expect(harness.provisioned).toEqual([]);
	}

	async function failRolloutInserts() {
		await admin.query(`
			create or replace function t359_fail_rollout_insert() returns trigger language plpgsql as $$
			begin raise exception 't359 injected rollout failure'; end $$`);
		await admin.query(`
			create trigger t359_fail_rollout_insert before insert on approval_workflow_rollout
			for each row execute function t359_fail_rollout_insert()`);
	}

	async function cleanup() {
		await admin.query(
			"drop trigger if exists t359_fail_rollout_insert on approval_workflow_rollout",
		);
		await admin.query("drop function if exists t359_fail_rollout_insert()");
		await admin.query("delete from organization where slug = $1 or id = any($2::text[])", [
			slug,
			Object.values(backfill),
		]);
		await admin.query('delete from "user" where id = $1', [ownerUser]);
	}

	async function seed() {
		await cleanup();
		await admin.query(
			`insert into "user" (id, name, email, email_verified, role, can_create_organizations,
			   created_at, updated_at)
			 values ($1, 'T359 owner', 't359-owner@example.test', true, 'user', true, now(), now())`,
			[ownerUser],
		);
		await admin.query(
			`insert into session (id, token, user_id, expires_at, created_at, updated_at)
			 values ('t359-session', $1, $2, now() + interval '1 day', now(), now())`,
			[token, ownerUser],
		);
		harness.requestHeaders = new Headers({ authorization: `Bearer ${token}` });
	}

	beforeEach(async () => {
		harness.failOwnerGuard = false;
		harness.provisioned.length = 0;
		await seed();
	});

	afterEach(async () => {
		for (const client of openHolds) {
			await client.query("rollback");
			client.release();
		}
		openHolds.clear();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe("HTTP create endpoint", () => {
		it("commits the organization, its owner and one legacy rollout row per workflow type", async () => {
			const response = await createOverHttp();

			expect(response.status).toBe(200);
			const body = (await response.json()) as { id: string };
			const created = await expectCreatedTogether();
			expect(created.organizationId).toBe(body.id);
		});

		it("takes the owner's member guard inside the uncommitted creation", async () => {
			const guard = await holdAdvisoryLock(ownerGuard);
			const pending = createOverHttp();
			await waitForWaiterOn(ownerGuard);

			// The organization row is written, but not visible until the whole creation commits.
			expect((await createdRows()).organizations).toBe(0);
			await guard.release();

			expect((await pending).status).toBe(200);
			await expectCreatedTogether();
		});

		it("leaves nothing behind when the rollout-row write fails", async () => {
			await failRolloutInserts();
			const rolloutRowsBefore = await rolloutRowCount();

			const response = await createOverHttp();

			expect(response.status).toBeGreaterThanOrEqual(400);
			await expectNothingCreated(rolloutRowsBefore);
		});

		it("leaves nothing behind when the owner's member guard fails", async () => {
			harness.failOwnerGuard = true;
			const rolloutRowsBefore = await rolloutRowCount();

			const response = await createOverHttp();

			expect(response.status).toBeGreaterThanOrEqual(400);
			await expectNothingCreated(rolloutRowsBefore);
		});
	});

	describe("onboarding", () => {
		it("creates the same row set through the server-side call", async () => {
			const result = await createThroughOnboarding();

			expect(result._tag).toBe("Success");
			const created = await expectCreatedTogether();
			expect(result).toMatchObject({ success: { organizationId: created.organizationId } });
		});

		it("leaves nothing behind when the rollout-row write fails", async () => {
			await failRolloutInserts();
			const rolloutRowsBefore = await rolloutRowCount();

			const result = await createThroughOnboarding();

			expect(result).toMatchObject({ _tag: "Failure", failure: { field: "slug" } });
			await expectNothingCreated(rolloutRowsBefore);
		});
	});

	it("refuses an uncoordinated server-side creation before writing the organization", async () => {
		const rolloutRowsBefore = await rolloutRowCount();

		await expect(
			auth.api.createOrganization({
				headers: harness.requestHeaders,
				body: { name: "T359 created", slug },
			}),
		).rejects.toBeInstanceOf(UncoordinatedAuthMutationError);
		await expectNothingCreated(rolloutRowsBefore);
	});

	it("deletes the rollout rows with their organization", async () => {
		await runCoordinatedAuthMutation(auth.$context, () =>
			auth.api.createOrganization({
				headers: harness.requestHeaders,
				body: { name: "T359 created", slug },
			}),
		);
		const { organizationId } = await expectCreatedTogether();

		await admin.query("delete from organization where id = $1", [organizationId]);

		const { rows } = await admin.query(
			"select id from approval_workflow_rollout where organization_id = $1",
			[organizationId],
		);
		expect(rows).toEqual([]);
	});

	describe("migration 0107 backfill", () => {
		const migrationSql = async () => {
			const { readFile } = await import("node:fs/promises");
			return readFile(
				new URL("../../../drizzle/0107_approval_workflow_rollout_precreate.sql", import.meta.url),
				"utf8",
			);
		};

		async function rolloutsOf(client: PoolClient, organizationId: string) {
			const { rows } = await client.query<{
				id: string;
				workflow_type: string;
				lifecycle_mode: string;
				side_effect_mode: string;
				updated_at: Date;
			}>(
				`select id, workflow_type, lifecycle_mode, side_effect_mode, updated_at
				 from approval_workflow_rollout where organization_id = $1 order by workflow_type::text`,
				[organizationId],
			);
			return rows;
		}

		// Runs in a rolled-back transaction: the backfill covers every organization in
		// the shared test database, and other suites own theirs.
		it("adds only the missing legacy rows, keeps existing modes, and is safe to re-run", async () => {
			const sql = await migrationSql();
			const client = await admin.connect();
			try {
				await client.query("begin");
				await client.query(
					`insert into organization (id, name, slug, created_at)
					 select id, id, id, now() from unnest($1::text[]) as id`,
					[Object.values(backfill)],
				);
				await client.query(
					`insert into approval_workflow_rollout
					 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
					 values ($1, 'policy_clock_out', 'canonical', 'canonical', now(), '2026-01-01T00:00:00Z')`,
					[backfill.partial],
				);
				const [existing] = await rolloutsOf(client, backfill.partial);

				await client.query(sql);
				const bare = await rolloutsOf(client, backfill.bare);
				const partial = await rolloutsOf(client, backfill.partial);

				expect(bare.map(({ id: _, updated_at: __, ...row }) => row)).toEqual(legacyRollouts);
				expect(partial.map(({ id: _, updated_at: __, ...row }) => row)).toEqual(
					legacyRollouts.map((row) =>
						row.workflow_type === "policy_clock_out"
							? { ...row, lifecycle_mode: "canonical", side_effect_mode: "canonical" }
							: row,
					),
				);
				expect(partial.find((row) => row.id === existing?.id)).toEqual(existing);

				await client.query(sql);
				expect(await rolloutsOf(client, backfill.bare)).toEqual(bare);
				expect(await rolloutsOf(client, backfill.partial)).toEqual(partial);
				const { rows } = await client.query<{ missing: number }>(
					`select count(*)::int as missing
					 from organization o
					 cross join unnest(enum_range(null::approval_workflow_type)) as t(workflow_type)
					 where not exists (select 1 from approval_workflow_rollout r
					   where r.organization_id = o.id and r.workflow_type = t.workflow_type)`,
				);
				expect(rows[0]?.missing).toBe(0);
			} finally {
				await client.query("rollback");
				client.release();
			}
		});
	});
});
