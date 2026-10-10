/**
 * #763 slice 1: organization API keys on PostgreSQL. Org ownership, the
 * atomic per-org limit, per-key rate limits enforced by Better Auth's key
 * verification, audit entries, creators who leave, and the migration of
 * user-owned keys.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { db } = await import("@/db");
const { authDatabaseSchema } = await import("@/lib/auth-database-schema");
const { API_KEY_PLUGIN_OPTIONS } = await import("./plugin-config");
const {
	createOrganizationApiKey,
	getOrganizationApiKey,
	listOrganizationApiKeys,
	revokeOrganizationApiKey,
	updateOrganizationApiKey,
	MAX_KEYS_PER_ORGANIZATION,
} = await import("./key-store");

const ids = {
	organization: "t763k-org",
	other: "t763k-other-org",
	adminA: "t763k-admin-a",
	adminB: "t763k-admin-b",
	otherAdmin: "t763k-other-admin",
} as const;
const users = [ids.adminA, ids.adminB, ids.otherAdmin];

// Verification as production runs it: the API-key plugin with Z8's options.
const auth = betterAuth({
	baseURL: "https://app.example.test",
	secret: "t763-api-key-integration-secret-with-enough-entropy",
	database: drizzleAdapter(db, { provider: "pg", schema: authDatabaseSchema }),
	plugins: [apiKey(API_KEY_PLUGIN_OPTIONS)],
});
const verify = (key: string) => auth.api.verifyApiKey({ body: { key } });

const settings = {
	name: "Payroll sync",
	scopes: ["employees:read", "time-entries:read"] as const,
	rateLimitEnabled: true,
	rateLimitMax: 100,
	rateLimitTimeWindow: 60_000,
};

describe("organization API keys on PostgreSQL", () => {
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from apikey where reference_id = any($1::text[])", [
			[ids.organization, ids.other, ...users],
		]);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function create(
		actorUserId: string = ids.adminA,
		organizationId: string = ids.organization,
	) {
		return createOrganizationApiKey(db, {
			organizationId,
			actorUserId,
			...settings,
			expiresAt: null,
		});
	}

	async function created(actorUserId: string = ids.adminA) {
		const outcome = await create(actorUserId);
		if (!outcome.ok) throw new Error(outcome.reason);
		return outcome.key;
	}

	async function audit() {
		const { rows } = await admin.query<{
			action: string;
			entity_type: string;
			entity_id: string;
			performed_by: string;
			changes: string;
		}>(
			`select action, entity_type, entity_id, performed_by, changes from audit_log
			 where organization_id = $1 and action like 'api_key.%' order by timestamp, action`,
			[ids.organization],
		);
		return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T763K', $1, $3), ($2, 'T763K other', $2, $3)`,
			[ids.organization, ids.other, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t763k-m-a', $1, $3, 'admin', 'approved', $6),
			 ('t763k-m-b', $1, $4, 'owner', 'approved', $6),
			 ('t763k-m-other', $2, $5, 'owner', 'approved', $6)`,
			[ids.organization, ids.other, ids.adminA, ids.adminB, ids.otherAdmin, timestamp],
		);
		await admin.query(
			`insert into employee (user_id, organization_id, first_name, last_name, role, is_active, updated_at) values
			 ($1, $3, 'Ada', 'Admin', 'admin', true, $4),
			 ($2, $3, 'Bo', 'Owner', 'admin', true, $4)`,
			[ids.adminA, ids.adminB, ids.organization, timestamp],
		);
	});
	afterAll(cleanup);

	it("lets every admin of the organization see, edit and revoke a key another admin created", async () => {
		const key = await created(ids.adminA);

		const listed = await listOrganizationApiKeys(db, ids.organization);
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({
			id: key.id,
			organizationId: ids.organization,
			name: "Payroll sync",
			scopes: ["time-entries:read", "employees:read"],
			creator: { userId: ids.adminA, departed: false },
		});
		expect(listed[0].start).toBe(key.key.slice(0, 10));
		expect(key.key.startsWith("z8_org")).toBe(true);

		// Another organization's admin sees nothing and can change nothing.
		expect(await listOrganizationApiKeys(db, ids.other)).toEqual([]);
		expect(await getOrganizationApiKey(db, ids.other, key.id)).toBeNull();
		expect(
			await updateOrganizationApiKey(db, {
				organizationId: ids.other,
				actorUserId: ids.otherAdmin,
				keyId: key.id,
				change: { name: "Hijacked" },
			}),
		).toEqual({ ok: false, reason: "key_not_found" });
		expect(
			await revokeOrganizationApiKey(db, {
				organizationId: ids.other,
				actorUserId: ids.otherAdmin,
				keyId: key.id,
			}),
		).toEqual({ ok: false, reason: "key_not_found" });

		expect(
			await updateOrganizationApiKey(db, {
				organizationId: ids.organization,
				actorUserId: ids.adminB,
				keyId: key.id,
				change: { name: "Payroll export", scopes: ["absences:read"] },
			}),
		).toEqual({ ok: true });
		expect(await getOrganizationApiKey(db, ids.organization, key.id)).toMatchObject({
			name: "Payroll export",
			scopes: ["absences:read"],
			creator: { userId: ids.adminA },
		});

		expect(
			await revokeOrganizationApiKey(db, {
				organizationId: ids.organization,
				actorUserId: ids.adminB,
				keyId: key.id,
			}),
		).toEqual({ ok: true });
		expect(await listOrganizationApiKeys(db, ids.organization)).toEqual([]);
		expect((await verify(key.key)).valid).toBe(false);
	});

	it("audits creating, editing and revoking a key with the acting admin", async () => {
		const key = await created(ids.adminA);
		await updateOrganizationApiKey(db, {
			organizationId: ids.organization,
			actorUserId: ids.adminB,
			keyId: key.id,
			change: { rateLimitMax: 10, rateLimitTimeWindow: 1000 },
		});
		await revokeOrganizationApiKey(db, {
			organizationId: ids.organization,
			actorUserId: ids.adminA,
			keyId: key.id,
		});

		const entries = await audit();
		expect(
			entries.map(({ action, performed_by, entity_type, entity_id }) => ({
				action,
				performed_by,
				entity_type,
				entity_id,
			})),
		).toEqual([
			{
				action: "api_key.created",
				performed_by: ids.adminA,
				entity_type: "api_key",
				entity_id: key.id,
			},
			{
				action: "api_key.updated",
				performed_by: ids.adminB,
				entity_type: "api_key",
				entity_id: key.id,
			},
			{
				action: "api_key.revoked",
				performed_by: ids.adminA,
				entity_type: "api_key",
				entity_id: key.id,
			},
		]);
		expect(entries[1].changes).toEqual({
			before: { rateLimitMax: 100, rateLimitTimeWindow: 60_000 },
			after: { rateLimitMax: 10, rateLimitTimeWindow: 1000 },
		});
		// The key itself never reaches the audit log.
		expect(JSON.stringify(entries)).not.toContain(key.key);
	});

	it("refuses the eleventh key of an organization, also when two admins create at once", async () => {
		for (let index = 0; index < MAX_KEYS_PER_ORGANIZATION - 1; index++) await created();
		const outcomes = await Promise.all([create(ids.adminA), create(ids.adminB)]);
		expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
		expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
			{ ok: false, reason: "key_limit_reached" },
		]);
		expect(await listOrganizationApiKeys(db, ids.organization)).toHaveLength(10);
		expect(await create(ids.adminA)).toEqual({ ok: false, reason: "key_limit_reached" });
		// Another organization's keys do not count.
		expect((await create(ids.otherAdmin, ids.other)).ok).toBe(true);
	});

	it("enforces the per-key limit the admin set, on create and after an edit", async () => {
		const outcome = await createOrganizationApiKey(db, {
			organizationId: ids.organization,
			actorUserId: ids.adminA,
			...settings,
			rateLimitMax: 10,
			rateLimitTimeWindow: 60_000,
			expiresAt: null,
		});
		if (!outcome.ok) throw new Error(outcome.reason);
		for (let request = 1; request <= 10; request++) {
			expect((await verify(outcome.key.key)).valid, `request ${request}`).toBe(true);
		}
		const refused = await verify(outcome.key.key);
		expect(refused.valid).toBe(false);
		expect(refused.error?.code).toBe("RATE_LIMITED");

		// A raised limit applies from the next request.
		await updateOrganizationApiKey(db, {
			organizationId: ids.organization,
			actorUserId: ids.adminB,
			keyId: outcome.key.id,
			change: { rateLimitMax: 20 },
		});
		expect((await verify(outcome.key.key)).valid).toBe(true);

		// A disabled key no longer verifies.
		await updateOrganizationApiKey(db, {
			organizationId: ids.organization,
			actorUserId: ids.adminB,
			keyId: outcome.key.id,
			change: { enabled: false },
		});
		expect((await verify(outcome.key.key)).valid).toBe(false);
	});

	it("keeps a key working after its creator leaves, and marks the creator as departed", async () => {
		const key = await created(ids.adminA);
		await admin.query(
			"update employee set is_active = false where user_id = $1 and organization_id = $2",
			[ids.adminA, ids.organization],
		);
		await admin.query("delete from member where user_id = $1 and organization_id = $2", [
			ids.adminA,
			ids.organization,
		]);

		const verified = await verify(key.key);
		expect(verified.valid).toBe(true);
		expect(verified.key?.referenceId).toBe(ids.organization);
		expect((await listOrganizationApiKeys(db, ids.organization))[0].creator).toMatchObject({
			userId: ids.adminA,
			departed: true,
		});
	});

	it("migrates user-owned keys to the organization in their metadata", async () => {
		const migration = await readFile(
			join(import.meta.dirname, "../../../../drizzle/0188_organization_api_keys.sql"),
			"utf8",
		);
		const legacy = (id: string, referenceId: string, metadata: unknown, extra = "") =>
			admin.query(
				`insert into apikey (id, config_id, name, start, reference_id, prefix, key, enabled,
				 rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count,
				 created_at, updated_at, metadata${extra ? ", permissions" : ""})
				 values ($1, 'default', 'legacy', 'z8_org', $2, 'z8_org', $1 || '-hash', true,
				 true, 60000, 100, 0, now(), now(), $3${extra ? ", $4" : ""})`,
				extra ? [id, referenceId, metadata, extra] : [id, referenceId, metadata],
			);
		await legacy(
			"t763kLegacyKeyOne",
			ids.adminA,
			JSON.stringify({
				organizationId: ids.organization,
				displayName: "Old BI export",
				createdBy: ids.adminA,
				scopes: ["time-entries:read", "time-entries:write", "reports:read", "projects:read"],
				rateLimitEnabled: true,
				rateLimitMax: 25,
				rateLimitTimeWindow: 1000,
			}),
		);
		// Stored JSON-encoded twice by an older plugin version.
		await legacy(
			"t763kLegacyKeyTwo",
			ids.adminB,
			JSON.stringify(
				JSON.stringify({ organizationId: ids.organization, scopes: ["projects:write"] }),
			),
		);
		// Already organization-owned, but holding scopes v1 no longer offers.
		await legacy(
			"t763kLegacyOrgOwned",
			ids.organization,
			JSON.stringify({ createdBy: ids.adminB }),
			JSON.stringify({ "time-entries": ["read", "write"], reports: ["read"] }),
		);
		// No organization: unusable, deleted.
		await legacy("t763kLegacyOrphan", ids.adminA, JSON.stringify({ displayName: "lost" }));

		await admin.query(migration);

		const { rows } = await admin.query<{ id: string }>(
			"select id from apikey where reference_id = any($1::text[]) or id like 't763kLegacy%'",
			[[ids.organization, ids.adminA, ids.adminB]],
		);
		expect(rows).toHaveLength(3);
		const keys = await listOrganizationApiKeys(db, ids.organization);
		const byName = new Map(keys.map((key) => [key.name, key]));
		expect(byName.get("Old BI export")).toMatchObject({
			organizationId: ids.organization,
			scopes: ["time-entries:read", "projects:read"],
			rateLimitMax: 25,
			rateLimitTimeWindow: 1000,
			creator: { userId: ids.adminA },
		});
		expect(
			keys
				.filter((key) => key.name === "legacy")
				.map((key) => key.scopes)
				.sort(),
		).toEqual([[], ["time-entries:read"]]);
		const { rows: stored } = await admin.query<{ permissions: string }>(
			"select permissions from apikey where reference_id = $1 and name = 'legacy' and permissions like '%time-entries%'",
			[ids.organization],
		);
		expect(stored.map((row) => JSON.parse(row.permissions))).toEqual([
			{ "time-entries": ["read"] },
		]);
		for (const key of keys) {
			expect(key.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		}

		// Running it again changes nothing.
		await admin.query(migration);
		expect(await listOrganizationApiKeys(db, ids.organization)).toEqual(keys);
	});
});
