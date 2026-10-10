/**
 * #763 slice 2: the /api/v1 request pipeline on PostgreSQL, proven end to end
 * with GET /api/v1/employees. Keys are created by the key store and verified
 * by the Better Auth API-key plugin with production options.
 */

import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { db } = await import("@/db");
const { authDatabaseSchema } = await import("@/lib/auth-database-schema");
const { API_KEY_PLUGIN_OPTIONS } = await import("./keys/plugin-config");
const { createOrganizationApiKey, revokeOrganizationApiKey, updateOrganizationApiKey } =
	await import("./keys/key-store");
const { createPublicApiDependencies } = await import("./dependencies");
const { handlePublicApiRequest } = await import("./pipeline");
const { listEmployees } = await import("./resources/employees");

const ids = {
	organization: "t763p-org",
	other: "t763p-other-org",
	admin: "t763p-admin",
	ana: "t763p-ana",
	ben: "t763p-ben",
	cleo: "t763p-cleo",
	otherAdmin: "t763p-other-admin",
} as const;
const users = [ids.admin, ids.ana, ids.ben, ids.cleo, ids.otherAdmin];

const auth = betterAuth({
	baseURL: "https://app.example.test",
	secret: "t763-public-api-pipeline-integration-secret",
	database: drizzleAdapter(db, { provider: "pg", schema: authDatabaseSchema }),
	plugins: [apiKey(API_KEY_PLUGIN_OPTIONS)],
});

const world = {
	billingEnabled: false,
	organizationCeiling: 1000,
	organizationHits: new Map<string, number>(),
};

const dependencies = createPublicApiDependencies({
	database: db,
	verifyApiKey: (key) => auth.api.verifyApiKey({ body: { key } }),
	async checkOrganizationLimit(organizationId) {
		const hits = (world.organizationHits.get(organizationId) ?? 0) + 1;
		world.organizationHits.set(organizationId, hits);
		return {
			allowed: hits <= world.organizationCeiling,
			limit: world.organizationCeiling,
			remaining: Math.max(0, world.organizationCeiling - hits),
			resetAt: Date.parse("2026-10-10T12:01:00Z"),
			retryAfterSeconds: 42,
		};
	},
	billingEnabled: () => world.billingEnabled,
	clientIp: (request) => request.headers.get("x-forwarded-for"),
	onError: (error) => {
		throw error;
	},
});

function get(query = "", headers: Record<string, string> = {}) {
	return handlePublicApiRequest(
		dependencies,
		listEmployees,
		new Request(`https://app.example.test/api/v1/employees${query}`, { headers }),
	);
}
const bearer = (key: string) => ({
	authorization: `Bearer ${key}`,
	"x-forwarded-for": "203.0.113.7",
});

interface EmployeeBody {
	data: Record<string, unknown>[];
	nextCursor: string | null;
}

describe("the Public API pipeline on PostgreSQL", () => {
	const admin = integrationAdminPool();
	const employeeIds: Record<string, string> = {};
	let teamId: string;

	async function cleanup() {
		await admin.query("delete from apikey where reference_id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function key(
		scopes: string[] = ["employees:read"],
		organizationId: string = ids.organization,
	) {
		const outcome = await createOrganizationApiKey(db, {
			organizationId,
			actorUserId: organizationId === ids.other ? ids.otherAdmin : ids.admin,
			name: "Integration",
			scopes: scopes as never,
			rateLimitEnabled: true,
			rateLimitMax: 100,
			rateLimitTimeWindow: 60_000,
			expiresAt: null,
		});
		if (!outcome.ok) throw new Error(outcome.reason);
		return outcome.key;
	}

	async function logRows(organizationId: string = ids.organization) {
		const { rows } = await admin.query<{
			api_key_id: string;
			method: string;
			route: string;
			status: number;
			row_count: number | null;
			ip_address: string | null;
		}>(
			`select api_key_id, method, route, status, row_count, ip_address from public_api_request_log
			 where organization_id = $1 order by requested_at, status`,
			[organizationId],
		);
		return rows;
	}

	beforeEach(async () => {
		await cleanup();
		world.billingEnabled = false;
		world.organizationCeiling = 1000;
		world.organizationHits.clear();
		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T763P', $1, $3), ($2, 'T763P other', $2, $3)`,
			[ids.organization, ids.other, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		// Names live on the auth user; the employee columns are deprecated.
		await admin.query(
			`update "user" set first_name = names.first, last_name = names.last
			 from (values ($1, 'Ana', 'Active'), ($2, 'Ben', 'Boss'), ($3, 'Cleo', 'Left'), ($4, 'Otto', 'Other'))
			   as names(id, first, last)
			 where "user".id = names.id`,
			[ids.ana, ids.ben, ids.cleo, ids.otherAdmin],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t763p-m-admin', $1, $2, 'owner', 'approved', $4),
			 ('t763p-m-other', $3, $5, 'owner', 'approved', $4)`,
			[ids.organization, ids.admin, ids.other, timestamp, ids.otherAdmin],
		);
		const { rows: teams } = await admin.query<{ id: string }>(
			"insert into team (organization_id, name, updated_at) values ($1, 'Ops', now()) returning id",
			[ids.organization],
		);
		teamId = teams[0].id;
		const { rows } = await admin.query<{ id: string; user_id: string }>(
			`insert into employee (user_id, organization_id, first_name, last_name, role, is_active,
			   employee_number, start_date, birthday, current_hourly_rate, team_id, updated_at) values
			 ($1, $5, 'Ana', 'Active', 'employee', true, 'E-1', '2024-03-01', '1990-01-01', 42, $7, $6),
			 ($2, $5, 'Ben', 'Boss', 'manager', true, 'E-2', '2023-01-15', null, null, null, $6),
			 ($3, $5, 'Cleo', 'Left', 'employee', false, null, null, null, null, null, $6),
			 ($4, $8, 'Otto', 'Other', 'admin', true, 'X-9', null, null, null, null, $6)
			 returning id, user_id`,
			[ids.ana, ids.ben, ids.cleo, ids.otherAdmin, ids.organization, timestamp, teamId, ids.other],
		);
		for (const row of rows) employeeIds[row.user_id] = row.id;
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by) values
			 ($1, $2, true, $3)`,
			[employeeIds[ids.ana], employeeIds[ids.ben], ids.admin],
		);
	});
	afterAll(cleanup);

	it("returns the key organization's employees with exactly the agreed fields", async () => {
		const { key: presented } = await key();
		await key(["employees:read"], ids.other);

		const response = await get("", bearer(presented));
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		const body = (await response.json()) as EmployeeBody;
		expect(body.nextCursor).toBeNull();
		const byName = new Map(body.data.map((row) => [row.firstName, row]));
		expect([...byName.keys()].sort()).toEqual(["Ana", "Ben", "Cleo"]);
		expect(byName.get("Ana")).toEqual({
			id: employeeIds[ids.ana],
			firstName: "Ana",
			lastName: "Active",
			workEmail: `${ids.ana}@example.test`,
			employeeNumber: "E-1",
			teamIds: [teamId],
			managerId: employeeIds[ids.ben],
			status: "active",
			startDate: "2024-03-01",
			departureDate: null,
		});
		expect(byName.get("Cleo")).toMatchObject({ status: "departed", managerId: null, teamIds: [] });
		expect(JSON.stringify(body)).not.toMatch(/1990-01-01|birthday|hourly|contract/i);

		const departed = (await (
			await get("?status=departed", bearer(presented))
		).json()) as EmployeeBody;
		expect(departed.data.map((row) => row.firstName)).toEqual(["Cleo"]);
		const active = (await (await get("?status=active", bearer(presented))).json()) as EmployeeBody;
		expect(active.data.map((row) => row.firstName).sort()).toEqual(["Ana", "Ben"]);
	});

	it("walks the cursor over every employee exactly once", async () => {
		const { key: presented } = await key();
		const seen: string[] = [];
		let cursor: string | null = null;
		do {
			const query: string = cursor ? `?limit=1&cursor=${cursor}` : "?limit=1";
			const page = (await (await get(query, bearer(presented))).json()) as EmployeeBody;
			expect(page.data.length).toBeLessThanOrEqual(1);
			seen.push(...page.data.map((row) => row.id as string));
			cursor = page.nextCursor;
		} while (cursor);
		expect(seen).toHaveLength(3);
		expect(new Set(seen).size).toBe(3);
		expect(seen).toEqual([...seen].sort());
	});

	it("refuses requests without a valid key, never accepting sessions", async () => {
		const created = await key();
		const expectInvalid = async (response: Response) => {
			expect(response.status).toBe(401);
			expect(response.headers.get("content-type")).toBe("application/problem+json");
			expect(await response.json()).toMatchObject({ type: "invalid_key", status: 401 });
		};
		// A real, unexpired session of an owner of the organization.
		const sessionToken = "t763p-real-session-token-of-the-owner";
		await admin.query(
			`insert into session (id, token, user_id, expires_at, updated_at, active_organization_id)
			 values ('t763p-session', $1, $2, now() + interval '1 day', now(), $3)`,
			[sessionToken, ids.admin, ids.organization],
		);
		await expectInvalid(await get());
		await expectInvalid(
			await get("", { cookie: `__Secure-better-auth.session_token=${sessionToken}` }),
		);
		await expectInvalid(await get("", { cookie: `better-auth.session_token=${sessionToken}` }));
		await expectInvalid(await get("", bearer(sessionToken)));
		await expectInvalid(await get("", bearer("z8_orgUnknownKeyUnknownKeyUnknownKeyUnknownKey")));
		expect(await logRows()).toEqual([]);

		await revokeOrganizationApiKey(db, {
			organizationId: ids.organization,
			actorUserId: ids.admin,
			keyId: created.id,
		});
		await expectInvalid(await get("", bearer(created.key)));
	});

	it("refuses a disabled key after identifying it, and logs the refusal", async () => {
		const created = await key();
		await updateOrganizationApiKey(db, {
			organizationId: ids.organization,
			actorUserId: ids.admin,
			keyId: created.id,
			change: { enabled: false },
		});
		const response = await get("", bearer(created.key));
		expect(response.status).toBe(401);
		// The key was identified, so the refusal reports the rate limits too.
		expect(response.headers.get("x-ratelimit-limit")).toBe("100");
		expect(response.headers.get("x-ratelimit-remaining")).toBe("100");
		expect(response.headers.get("x-ratelimit-reset")).not.toBeNull();
		expect(await logRows()).toEqual([
			{
				api_key_id: created.id,
				method: "GET",
				route: "/api/v1/employees",
				status: 401,
				row_count: null,
				ip_address: "203.0.113.7",
			},
		]);
	});

	it("refuses a key without the endpoint's scope", async () => {
		const created = await key(["projects:read"]);
		const response = await get("", bearer(created.key));
		expect(response.status).toBe(403);
		expect(response.headers.get("content-type")).toBe("application/problem+json");
		expect(await response.json()).toMatchObject({
			type: "scope_missing",
			requiredScope: "employees:read",
		});
		expect(response.headers.get("x-ratelimit-limit")).not.toBeNull();
	});

	it("requires billing access only while billing is enabled", async () => {
		const created = await key();
		world.billingEnabled = true;
		const refused = await get("", bearer(created.key));
		expect(refused.status).toBe(402);
		expect(refused.headers.get("x-ratelimit-limit")).not.toBeNull();
		expect(refused.headers.get("x-ratelimit-remaining")).not.toBeNull();
		expect(await refused.json()).toMatchObject({ type: "billing_required" });

		await admin.query(
			`insert into subscription (organization_id, status, created_at, updated_at)
			 values ($1, 'active', now(), now())`,
			[ids.organization],
		);
		expect((await get("", bearer(created.key))).status).toBe(200);

		await admin.query("delete from subscription where organization_id = $1", [ids.organization]);
		world.billingEnabled = false;
		expect((await get("", bearer(created.key))).status).toBe(200);
	});

	it("enforces the per-organization ceiling with rate-limit headers on every response", async () => {
		const created = await key();
		world.organizationCeiling = 2;
		const first = await get("", bearer(created.key));
		expect(first.status).toBe(200);
		expect(first.headers.get("x-ratelimit-limit")).toBe("2");
		expect(first.headers.get("x-ratelimit-remaining")).toBe("1");
		expect(first.headers.get("x-ratelimit-reset")).toBe(
			String(Date.parse("2026-10-10T12:01:00Z") / 1000),
		);
		expect((await get("", bearer(created.key))).status).toBe(200);

		const refused = await get("", bearer(created.key));
		expect(refused.status).toBe(429);
		expect(refused.headers.get("retry-after")).toBe("42");
		expect(refused.headers.get("x-ratelimit-remaining")).toBe("0");
		expect(await refused.json()).toMatchObject({ type: "rate_limited", status: 429 });

		expect((await logRows()).map((row) => [row.status, row.row_count])).toEqual([
			[200, 3],
			[200, 3],
			[429, null],
		]);
	});

	it("enforces the key's own limit with the key's rate-limit headers", async () => {
		const outcome = await createOrganizationApiKey(db, {
			organizationId: ids.organization,
			actorUserId: ids.admin,
			name: "Tight",
			scopes: ["employees:read"],
			rateLimitEnabled: true,
			rateLimitMax: 10,
			rateLimitTimeWindow: 60_000,
			expiresAt: null,
		});
		if (!outcome.ok) throw new Error(outcome.reason);
		for (let request = 1; request <= 10; request++) {
			const response = await get("", bearer(outcome.key.key));
			expect(response.status, `request ${request}`).toBe(200);
			expect(response.headers.get("x-ratelimit-limit")).toBe("10");
			expect(response.headers.get("x-ratelimit-remaining")).toBe(String(10 - request));
		}
		const refused = await get("", bearer(outcome.key.key));
		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
		expect(refused.headers.get("x-ratelimit-limit")).toBe("10");
		expect(refused.headers.get("x-ratelimit-remaining")).toBe("0");
		expect(await logRows()).toHaveLength(11);
	});

	it("rejects invalid query parameters as validation_failed", async () => {
		const created = await key();
		for (const query of ["?limit=0", "?limit=abc", "?status=gone", "?cursor=nonsense"]) {
			const response = await get(query, bearer(created.key));
			expect(response.status, query).toBe(400);
			expect(await response.json()).toMatchObject({ type: "validation_failed" });
		}
	});
});
