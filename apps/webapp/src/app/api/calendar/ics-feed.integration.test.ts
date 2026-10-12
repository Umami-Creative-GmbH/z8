import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { digestIcsFeedSecret } from "@/lib/calendar-sync/ics-feed-secret";
import { integrationAdminPool } from "@/test/integration-database";

const ids = {
	organization: "t991-ics-org",
	user: "t991-ics-user",
	employee: "39910000-0000-4000-8000-000000000001",
} as const;
const BASE_URL = "https://app.example.test";

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("@/lib/app-url", () => ({ getDefaultAppBaseUrl: () => BASE_URL }));
vi.mock("@/lib/rate-limit", () => ({
	getClientIp: () => "203.0.113.7",
	checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0, retryAfter: 0 }),
	createRateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: ids.user, email: "t991-ics@example.test" },
				session: { activeOrganizationId: ids.organization },
			}),
		},
	},
}));
vi.mock("@/lib/auth-helpers", () => ({
	getAbility: async () => ({ can: () => true, cannot: () => false }),
}));

const feeds = await import("./ics-feeds/route");
const feedById = await import("./ics-feeds/[id]/route");
const regenerate = await import("./ics-feeds/[id]/regenerate/route");
const publicFeed = await import("./ics/[secret]/route");
const admin = integrationAdminPool();

function fetchPublicFeed(url: string) {
	const secret = url.slice(`${BASE_URL}/api/calendar/ics/`.length);
	return publicFeed.GET(new NextRequest(url), { params: Promise.resolve({ secret }) });
}

function idParams(id: string) {
	return { params: Promise.resolve({ id }) };
}

async function cleanup() {
	await admin.query("delete from audit_log where organization_id = $1", [ids.organization]);
	await admin.query("delete from ics_feed where organization_id = $1", [ids.organization]);
	await admin.query("delete from employee where id = $1", [ids.employee]);
	await admin.query('delete from "user" where id = $1', [ids.user]);
	await admin.query("delete from organization where id = $1", [ids.organization]);
}

beforeEach(async () => {
	await cleanup();
	const timestamp = new Date("2026-10-10T08:00:00Z");
	await admin.query(
		"insert into organization (id, name, slug, created_at) values ($1, $1, $1, $2)",
		[ids.organization, timestamp],
	);
	await admin.query(
		'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, $3, $3)',
		[ids.user, "t991-ics@example.test", timestamp],
	);
	await admin.query(
		"insert into employee (id, user_id, organization_id, updated_at) values ($1, $2, $3, $4)",
		[ids.employee, ids.user, ids.organization, timestamp],
	);
});
afterAll(cleanup);

describe("migration 0176 on a pre-digest ics_feed table", () => {
	it("hashes existing secrets in place so subscribed URLs resolve to the same feed", async () => {
		const migration = await readFile(
			new URL("../../../../drizzle/0176_ics_feed_secret_digest.sql", import.meta.url),
			"utf8",
		);
		const legacySecret = "5e".repeat(32);
		const deactivatedSecret = "c4".repeat(32);
		const lastAccessed = new Date("2026-10-01T06:00:00Z");
		const deactivatedAt = new Date("2026-09-15T12:00:00Z");
		const client = await admin.connect();
		try {
			await client.query("begin");
			// Rebuild the 0000 shape of ics_feed. The transaction is rolled back, so
			// other suites keep the migrated schema.
			await client.query("delete from ics_feed");
			await client.query(`
				alter table ics_feed drop column secret_digest, drop column secret_hash_version,
					drop column revoked_at, drop column revoked_by;
				alter table ics_feed rename column last_used_at to last_accessed_at;
				alter table ics_feed add column secret text not null constraint ics_feed_secret_unique unique,
					add column is_active boolean default true not null;
				create index "icsFeed_secret_idx" on ics_feed using btree (secret);
			`);
			const legacy = await client.query<{ id: string }>(
				`insert into ics_feed (organization_id, feed_type, employee_id, secret, created_by, last_accessed_at, updated_at)
				 values ($1, 'user', $2, $3, $4, $5, now()) returning id`,
				[ids.organization, ids.employee, legacySecret, ids.user, lastAccessed],
			);
			const deactivated = await client.query<{ id: string }>(
				`insert into ics_feed (organization_id, feed_type, employee_id, secret, created_by, is_active, updated_at)
				 values ($1, 'user', $2, $3, $4, false, $5) returning id`,
				[ids.organization, ids.employee, deactivatedSecret, ids.user, deactivatedAt],
			);

			await client.query(migration);
			await client.query(migration);

			const columns = await client.query<{ column_name: string }>(
				"select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ics_feed'",
			);
			const columnNames = columns.rows.map((row) => row.column_name);
			expect(columnNames).not.toContain("secret");
			expect(columnNames).not.toContain("is_active");
			expect(columnNames).not.toContain("last_accessed_at");

			const rows = await client.query<{
				id: string;
				secret_digest: string;
				secret_hash_version: string;
				revoked_at: Date | null;
				revoked_by: string | null;
				last_used_at: Date | null;
			}>(
				`select id, secret_digest, secret_hash_version, revoked_at, revoked_by, last_used_at
				 from ics_feed where organization_id = $1`,
				[ids.organization],
			);
			const byId = new Map(rows.rows.map((row) => [row.id, row]));
			// The public route looks feeds up by digestIcsFeedSecret(<URL secret>).
			expect(byId.get(legacy.rows[0].id)).toEqual({
				id: legacy.rows[0].id,
				secret_digest: digestIcsFeedSecret(legacySecret),
				secret_hash_version: "v1",
				revoked_at: null,
				revoked_by: null,
				last_used_at: lastAccessed,
			});
			expect(byId.get(deactivated.rows[0].id)).toMatchObject({
				secret_digest: digestIcsFeedSecret(deactivatedSecret),
				revoked_at: deactivatedAt,
				revoked_by: null,
			});
			// No column anywhere in the row still carries a plain secret.
			const raw = await client.query("select to_jsonb(f)::text as value from ics_feed f");
			for (const row of raw.rows) {
				expect(row.value).not.toContain(legacySecret);
				expect(row.value).not.toContain(deactivatedSecret);
			}
		} finally {
			await client.query("rollback");
			client.release();
		}
	});
});

describe("ICS feed credential lifecycle", () => {
	it("resolves a feed stored before the migration by its unchanged URL", async () => {
		const secret = "7a".repeat(32);
		await admin.query(
			`insert into ics_feed (organization_id, feed_type, employee_id, secret_digest, secret_hash_version, created_by, updated_at)
			 values ($1, 'user', $2, encode(sha256(convert_to($3, 'UTF8')), 'hex'), 'v1', $4, now())`,
			[ids.organization, ids.employee, secret, ids.user],
		);

		const response = await fetchPublicFeed(`${BASE_URL}/api/calendar/ics/${secret}`);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/calendar");
		// The fetch is recorded fire-and-forget.
		await vi.waitFor(async () => {
			const row = await admin.query(
				"select last_used_at from ics_feed where organization_id = $1",
				[ids.organization],
			);
			expect(row.rows[0].last_used_at).not.toBeNull();
		});
	});

	it("shows the URL once, stores only its digest, and audits create, regenerate and revoke", async () => {
		const created = await feeds.POST(
			new NextRequest(`${BASE_URL}/api/calendar/ics-feeds`, {
				method: "POST",
				body: JSON.stringify({ feedType: "user" }),
			}),
		);
		expect(created.status).toBe(200);
		const { id, url } = (await created.json()) as { id: string; url: string };
		const secret = url.slice(`${BASE_URL}/api/calendar/ics/`.length);
		expect(secret).toMatch(/^[0-9a-f]{64}$/);
		expect((await fetchPublicFeed(url)).status).toBe(200);

		const stored = await admin.query("select to_jsonb(f) as row from ics_feed f where id = $1", [
			id,
		]);
		expect(stored.rows[0].row.secret_digest).toBe(digestIcsFeedSecret(secret));
		expect(JSON.stringify(stored.rows[0].row)).not.toContain(secret);

		// Listing and detail never carry the URL.
		const list = await (
			await feeds.GET(new NextRequest(`${BASE_URL}/api/calendar/ics-feeds`))
		).json();
		expect(list.feeds).toHaveLength(1);
		expect(list.feeds[0]).not.toHaveProperty("url");
		expect(JSON.stringify(list)).not.toContain(secret);
		const detail = await (
			await feedById.GET(new NextRequest(`${BASE_URL}/api/calendar/ics-feeds/${id}`), idParams(id))
		).json();
		expect(detail.id).toBe(id);
		expect(detail).not.toHaveProperty("url");

		// Regenerating replaces the credential: the old URL stops resolving.
		const regenerated = await regenerate.POST(
			new NextRequest(`${BASE_URL}/api/calendar/ics-feeds/${id}/regenerate`, { method: "POST" }),
			idParams(id),
		);
		const { url: newUrl } = (await regenerated.json()) as { url: string };
		expect(newUrl).not.toBe(url);
		expect((await fetchPublicFeed(url)).status).toBe(404);
		expect((await fetchPublicFeed(newUrl)).status).toBe(200);

		// Revoking records who and when; the URL stops resolving.
		const revoked = await feedById.DELETE(
			new NextRequest(`${BASE_URL}/api/calendar/ics-feeds/${id}`, { method: "DELETE" }),
			idParams(id),
		);
		expect(revoked.status).toBe(200);
		const revokedRow = await admin.query(
			"select revoked_at, revoked_by from ics_feed where id = $1 and organization_id = $2",
			[id, ids.organization],
		);
		expect(revokedRow.rows[0].revoked_at).toBeInstanceOf(Date);
		expect(revokedRow.rows[0].revoked_by).toBe(ids.user);
		expect((await fetchPublicFeed(newUrl)).status).toBe(404);
		const relist = await (
			await feeds.GET(new NextRequest(`${BASE_URL}/api/calendar/ics-feeds`))
		).json();
		expect(relist.feeds).toEqual([]);

		const audit = await admin.query<{
			action: string;
			entity_type: string;
			entity_id: string;
			performed_by: string;
			employee_id: string;
			metadata: string;
		}>(
			`select action, entity_type, entity_id, performed_by, employee_id, metadata
			 from audit_log where organization_id = $1 order by timestamp, action`,
			[ids.organization],
		);
		expect(audit.rows.map((row) => row.action)).toEqual([
			"ics_feed.created",
			"ics_feed.regenerated",
			"ics_feed.revoked",
		]);
		for (const row of audit.rows) {
			expect(row).toMatchObject({
				entity_type: "ics_feed",
				entity_id: id,
				performed_by: ids.user,
				employee_id: ids.employee,
			});
			expect(JSON.parse(row.metadata)).toMatchObject({ feedType: "user" });
			expect(row.metadata).not.toContain(secret);
			expect(row.metadata).not.toContain(digestIcsFeedSecret(secret));
		}
	});
});
