/**
 * #795: the MCP server on PostgreSQL, driven by the official MCP client (v2)
 * through an in-process fetch. Each tool must answer exactly what its
 * `/api/v1` endpoint answers for the same key, through the same pipeline.
 */

import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { betterAuth } from "better-auth/minimal";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { integrationAdminPool } from "@/test/integration-database";

const { db } = await import("@/db");
const { authDatabaseSchema } = await import("@/lib/auth-database-schema");
const { API_KEY_PLUGIN_OPTIONS } = await import("../keys/plugin-config");
const { createOrganizationApiKey, revokeOrganizationApiKey } = await import("../keys/key-store");
const { createPublicApiDependencies } = await import("../dependencies");
const { handlePublicApiRequest } = await import("../pipeline");
const { PUBLIC_API_ENDPOINTS } = await import("../endpoints");
const { createMcpEndpoint } = await import("./server");
const { changeCustomFields } = await import("@/lib/organization/custom-fields/definitions");

const ids = {
	organization: "t795-org",
	other: "t795-other-org",
	admin: "t795-admin",
	ana: "t795-ana",
	otto: "t795-otto",
	otherAdmin: "t795-other-admin",
} as const;
const users = [ids.admin, ids.ana, ids.otto, ids.otherAdmin];
const ALL_SCOPES = [
	"time-entries:read",
	"absences:read",
	"employees:read",
	"projects:read",
	"customers:read",
] as const;
const octoberInstants = { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" };
const octoberDates = { from: "2026-10-01", to: "2026-10-31" };

const auth = betterAuth({
	baseURL: "https://app.example.test",
	secret: "t795-mcp-server-integration-secret-with-entropy",
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
			resetAt: Date.parse("2026-10-11T12:01:00Z"),
			retryAfterSeconds: 42,
		};
	},
	billingEnabled: () => world.billingEnabled,
	clientIp: (request) => request.headers.get("x-forwarded-for"),
	onError: (error) => {
		throw error;
	},
});

const handleMcpRequest = createMcpEndpoint(dependencies);
const MCP_URL = "https://app.example.test/api/mcp";

const clients: Client[] = [];
async function connect(key: string, mode: "auto" | "legacy" = "auto") {
	const client = new Client(
		{ name: "t795-suite", version: "1.0.0" },
		{ versionNegotiation: { mode } },
	);
	const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
		requestInit: { headers: { authorization: `Bearer ${key}`, "x-forwarded-for": "203.0.113.9" } },
		fetch: (url, init) => handleMcpRequest(new Request(url, init)),
	});
	await client.connect(transport);
	clients.push(client);
	return client;
}

/** A raw JSON-RPC POST, for refusals that happen before the MCP protocol runs. */
function post(body: unknown, headers: Record<string, string> = {}) {
	return handleMcpRequest(
		new Request(MCP_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...headers,
			},
			body: JSON.stringify(body),
		}),
	);
}
const toolCallBody = (name: string, args: Record<string, unknown> = {}) => ({
	jsonrpc: "2.0",
	id: 1,
	method: "tools/call",
	params: { name, arguments: args },
});

async function callV1(path: string, key: string, query: string) {
	const endpoint = PUBLIC_API_ENDPOINTS.find((candidate) => candidate.path === path);
	if (!endpoint) throw new Error(path);
	const response = await handlePublicApiRequest(
		dependencies,
		endpoint,
		new Request(`https://app.example.test${path}${query}`, {
			headers: { authorization: `Bearer ${key}` },
		}),
	);
	return { status: response.status, body: await response.json() };
}

function problemOf(result: Awaited<ReturnType<Client["callTool"]>>) {
	expect(result.isError).toBe(true);
	const text = result.content.find((block) => block.type === "text");
	if (text?.type !== "text") throw new Error("no text content");
	return JSON.parse(text.text) as Record<string, unknown>;
}

describe("the MCP server on PostgreSQL", () => {
	const admin = integrationAdminPool();
	const employees: Record<string, string> = {};
	const customFields: Record<string, string> = {};
	let sickAbsence: string;

	async function cleanup() {
		await admin.query(
			"delete from absence_entry where employee_id in (select id from employee where organization_id = any($1::text[]))",
			[[ids.organization, ids.other]],
		);
		await admin.query("delete from apikey where reference_id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function key(
		scopes: readonly string[],
		organizationId: string = ids.organization,
		rateLimitMax = 1000,
	) {
		const outcome = await createOrganizationApiKey(db, {
			organizationId,
			actorUserId: organizationId === ids.other ? ids.otherAdmin : ids.admin,
			name: "MCP suite",
			scopes: scopes as never,
			rateLimitEnabled: true,
			rateLimitMax,
			rateLimitTimeWindow: 60_000,
			expiresAt: null,
		});
		if (!outcome.ok) throw new Error(outcome.reason);
		return outcome.key;
	}

	async function logRows(organizationId: string = ids.organization) {
		const { rows } = await admin.query<{
			channel: string;
			method: string;
			route: string;
			status: number;
			row_count: number | null;
			ip_address: string | null;
		}>(
			`select channel, method, route, status, row_count, ip_address from public_api_request_log
			 where organization_id = $1 order by requested_at, id`,
			[organizationId],
		);
		return rows;
	}

	async function timeEntry(employeeId: string, type: string, at: string, offsetMinutes: number) {
		const { rows } = await admin.query<{ id: string }>(
			`insert into time_entry (employee_id, organization_id, type, timestamp, hash, created_by,
			   utc_offset_minutes, timezone, timezone_source)
			 values ($1, $2, $3, $4::timestamptz at time zone 'UTC', md5(random()::text), $5, $6, 'Europe/Berlin', 'browser')
			 returning id`,
			[employeeId, ids.organization, type, at, ids.admin, offsetMinutes],
		);
		return rows[0].id;
	}

	async function workPeriod(start: string, end: string | null) {
		const clockIn = await timeEntry(employees.ana, "clock_in", start, 120);
		const clockOut = end ? await timeEntry(employees.ana, "clock_out", end, 120) : null;
		await withCanonicalRecords(admin, (client) =>
			client.query(
				`insert into work_period (employee_id, organization_id, clock_in_id, clock_out_id, start_time,
				   end_time, duration_minutes, is_active, approval_status, updated_at)
				 values ($1, $2, $3, $4, $5::timestamptz at time zone 'UTC', $6::timestamptz at time zone 'UTC',
				   case when $6::timestamptz is null then null
				     else (extract(epoch from ($6::timestamptz - $5::timestamptz)) / 60)::int end,
				   $6::timestamptz is null, 'approved', now())`,
				[employees.ana, ids.organization, clockIn, clockOut, start, end],
			),
		);
	}

	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T795', $1, now()), ($2, 'T795 other', $2, now())`,
			[ids.organization, ids.other],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t795-m-admin', $1, $2, 'owner', 'approved', now()),
			 ('t795-m-other', $3, $4, 'owner', 'approved', now())`,
			[ids.organization, ids.admin, ids.other, ids.otherAdmin],
		);
		const { rows } = await admin.query<{ id: string; user_id: string }>(
			`insert into employee (user_id, organization_id, role, is_active, updated_at) values
			 ($1, $3, 'employee', true, now()), ($2, $4, 'employee', true, now())
			 returning id, user_id`,
			[ids.ana, ids.otto, ids.organization, ids.other],
		);
		for (const row of rows) employees[row.user_id === ids.ana ? "ana" : "otto"] = row.id;

		await workPeriod("2026-10-01T06:00:00Z", "2026-10-01T14:00:00Z");
		await workPeriod("2026-10-02T06:00:00Z", "2026-10-02T14:00:00Z");
		await workPeriod("2026-10-05T06:00:00Z", "2026-10-05T14:00:00Z");
		await workPeriod("2026-10-31T07:00:00Z", null);
		await admin.query(
			`with vehicle as (
			   insert into organization_vehicle (organization_id, name, licence_plate, updated_at)
			   values ($1, 'T795 van', 'B MC 795', now()) returning id
			 )
			 update work_period set vehicle_kind = 'organization', vehicle_id = (select id from vehicle),
			   odometer_start_km = 500, odometer_end_km = 540, driven_distance_km = 40
			 where organization_id = $1 and start_time = '2026-10-02T06:00:00'`,
			[ids.organization],
		);

		const { rows: categories } = await admin.query<{ id: string; type: string }>(
			`insert into absence_category (organization_id, type, name, updated_at) values
			 ($1, 'vacation', 'Vacation', now()), ($1, 'sick', 'Sick leave', now())
			 returning id, type`,
			[ids.organization],
		);
		const category = (type: string) => categories.find((row) => row.type === type)?.id;
		const { rows: absences } = await admin.query<{ id: string; category_id: string }>(
			`insert into absence_entry (employee_id, category_id, start_date, start_period, end_date,
			   end_period, status, sick_detail, updated_at) values
			 ($1, $2, '2026-10-12', 'full_day', '2026-10-13', 'full_day', 'approved', 'with_certificate', now()),
			 ($1, $3, '2026-10-19', 'full_day', '2026-10-20', 'am', 'approved', null, now())
			 returning id, category_id`,
			[employees.ana, category("sick"), category("vacation")],
		);
		sickAbsence = absences.find((row) => row.category_id === category("sick"))?.id as string;

		const { rows: customers } = await admin.query<{ id: string }>(
			`insert into customer (organization_id, name, is_active, created_by, updated_at)
			 values ($1, 'Acme', true, $2, now()) returning id`,
			[ids.organization, ids.admin],
		);
		const { rows: projects } = await admin.query<{ id: string }>(
			`insert into project (organization_id, name, status, customer_id, created_by, updated_at)
			 values ($1, 'Website', 'active', $2, $3, now()) returning id`,
			[ids.organization, customers[0].id, ids.admin],
		);

		const define = async (entity: string, name: string, visibility: string, type = "text") => {
			const outcome = await changeCustomFields(db, {
				organizationId: ids.organization,
				actorUserId: ids.admin,
				change: {
					kind: "create",
					entity,
					name,
					type,
					required: false,
					tracked: false,
					visibility,
					editLevel: "admin",
					options: type === "select" ? ["Blue", "Green"] : undefined,
				},
			});
			if (!outcome.ok) throw new Error(outcome.reason);
			const field = outcome.fields.find((candidate) => candidate.name === name);
			if (!field) throw new Error(name);
			customFields[name] = field.id;
			return field;
		};
		const team = await define("employee", "Team colour", "employee", "select");
		await define("employee", "Salary band", "admin");
		await define("project", "Billing code", "employee");
		await define("customer", "Segment", "employee");
		await admin.query(
			`insert into custom_field_value (organization_id, definition_id, employee_id, project_id, customer_id,
			   text_value, select_option_id) values
			 ($1, $2, $6, null, null, null, $9),
			 ($1, $3, $6, null, null, 'B2', null),
			 ($1, $4, null, $7, null, 'WEB-1', null),
			 ($1, $5, null, null, $8, 'SMB', null)`,
			[
				ids.organization,
				customFields["Team colour"],
				customFields["Salary band"],
				customFields["Billing code"],
				customFields.Segment,
				employees.ana,
				projects[0].id,
				customers[0].id,
				team.options[0].id,
			],
		);
	});
	beforeEach(async () => {
		world.billingEnabled = false;
		world.organizationCeiling = 1000;
		world.organizationHits.clear();
		for (const table of ["public_api_request_log", "apikey"]) {
			const column = table === "apikey" ? "reference_id" : "organization_id";
			await admin.query(`delete from ${table} where ${column} = any($1::text[])`, [
				[ids.organization, ids.other],
			]);
		}
		while (clients.length) await clients.pop()?.close();
	});
	afterAll(async () => {
		while (clients.length) await clients.pop()?.close();
		await cleanup();
	});

	it("initializes, lists and calls tools for modern and 2025-era clients", async () => {
		const { key: presented } = await key(ALL_SCOPES);
		for (const [mode, protocolVersion] of [
			["auto", "2026-07-28"],
			["legacy", "2025-11-25"],
		] as const) {
			const client = await connect(presented, mode);
			expect(client.getNegotiatedProtocolVersion(), mode).toBe(protocolVersion);
			const { tools } = await client.listTools();
			expect(tools.map((tool) => tool.name).sort(), mode).toEqual([
				"list_absences",
				"list_customer_custom_fields",
				"list_customers",
				"list_employee_custom_fields",
				"list_employees",
				"list_project_custom_fields",
				"list_projects",
				"list_work_periods",
			]);
			const result = await client.callTool({ name: "list_employees", arguments: {} });
			expect(result.isError ?? false, mode).toBe(false);
			expect(result.structuredContent, mode).toMatchObject({ nextCursor: null });
		}
	});

	it("lists only the tools the key's scopes allow and refuses the others as scope_missing", async () => {
		const { key: presented } = await key(["employees:read"]);
		const client = await connect(presented);
		expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
			"list_employees",
			"list_employee_custom_fields",
		]);

		const refused = await client.callTool({ name: "list_projects", arguments: {} });
		expect(problemOf(refused)).toMatchObject({
			type: "scope_missing",
			status: 403,
			requiredScope: "projects:read",
		});
		const unknown = await client.callTool({ name: "drop_tables", arguments: {} });
		expect(problemOf(unknown)).toMatchObject({ type: "not_found", status: 404 });
	});

	it("returns the same rows and fields as /api/v1 for every tool", async () => {
		const { key: presented } = await key([
			...ALL_SCOPES,
			"absences:read-health",
			"custom-fields:read-restricted",
		]);
		const client = await connect(presented);
		const cases = [
			["list_work_periods", "/api/v1/work-periods", octoberInstants],
			["list_absences", "/api/v1/absences", octoberDates],
			["list_employees", "/api/v1/employees", {}],
			["list_projects", "/api/v1/projects", {}],
			["list_customers", "/api/v1/customers", {}],
			["list_employee_custom_fields", "/api/v1/employees/custom-fields", {}],
			["list_project_custom_fields", "/api/v1/projects/custom-fields", {}],
			["list_customer_custom_fields", "/api/v1/customers/custom-fields", {}],
		] as const;
		for (const [tool, path, args] of cases) {
			const viaMcp = await client.callTool({ name: tool, arguments: args });
			const viaApi = await callV1(path, presented, `?${new URLSearchParams(args)}`);
			expect(viaApi.status, path).toBe(200);
			expect(viaMcp.structuredContent, tool).toEqual(viaApi.body);
			expect((viaApi.body as { data: unknown[] }).data.length, path).toBeGreaterThan(0);
			const text = viaMcp.content.find((block) => block.type === "text");
			expect(text?.type === "text" ? JSON.parse(text.text) : null, tool).toEqual(viaApi.body);
		}
	});

	it("never shows another organization's data", async () => {
		const { key: foreign } = await key(ALL_SCOPES, ids.other);
		const client = await connect(foreign);
		const employeesPage = await client.callTool({ name: "list_employees", arguments: {} });
		expect(employeesPage.structuredContent).toMatchObject({
			data: [{ id: employees.otto }],
			nextCursor: null,
		});
		for (const [name, args] of [
			["list_work_periods", octoberInstants],
			["list_absences", octoberDates],
			["list_projects", {}],
			["list_customers", {}],
		] as const) {
			const page = await client.callTool({ name, arguments: args });
			expect(page.structuredContent, name).toEqual({
				data: [],
				nextCursor: null,
				...(name === "list_projects" || name === "list_customers"
					? { asOf: expect.any(String) }
					: {}),
			});
		}
	});

	it("shows health detail only to a key with absences:read-health", async () => {
		const sickOf = async (scopes: string[]) => {
			const client = await connect((await key(scopes)).key);
			const page = await client.callTool({ name: "list_absences", arguments: octoberDates });
			return (page.structuredContent as { data: Record<string, unknown>[] }).data.find(
				(row) => row.id === sickAbsence,
			);
		};
		expect(await sickOf(["absences:read"])).toMatchObject({
			type: "absent",
			category: null,
			sickDetail: null,
		});
		expect(await sickOf(["absences:read", "absences:read-health"])).toMatchObject({
			type: "sick",
			category: { name: "Sick leave" },
			sickDetail: "with_certificate",
		});
	});

	it("returns the same customFields as /api/v1, restricted fields only with the restricted scope (#822)", async () => {
		const anaOf = (body: unknown) =>
			(body as { data: { id: string; customFields: Record<string, unknown> }[] }).data.find(
				(row) => row.id === employees.ana,
			)?.customFields;
		for (const scopes of [
			["employees:read"],
			["employees:read", "custom-fields:read-restricted"],
		]) {
			const { key: presented } = await key(scopes);
			const client = await connect(presented);
			const viaMcp = await client.callTool({
				name: "list_employees",
				arguments: { asOf: "2026-10-01" },
			});
			const viaApi = await callV1("/api/v1/employees", presented, "?asOf=2026-10-01");
			expect(viaMcp.structuredContent, scopes.join()).toEqual(viaApi.body);
			expect(anaOf(viaMcp.structuredContent), scopes.join()).toEqual({
				[customFields["Team colour"]]: { id: expect.any(String), label: "Blue" },
				...(scopes.length > 1 ? { [customFields["Salary band"]]: "B2" } : {}),
			});
			expect(viaMcp.structuredContent).toMatchObject({ asOf: "2026-10-01" });
		}
	});

	it("offers the custom field definition tools only with the entity scope (#822)", async () => {
		const restrictedOnly = await connect((await key(["custom-fields:read-restricted"])).key);
		expect((await restrictedOnly.listTools()).tools).toEqual([]);
		const refused = await restrictedOnly.callTool({
			name: "list_employee_custom_fields",
			arguments: {},
		});
		expect(problemOf(refused)).toMatchObject({
			type: "scope_missing",
			requiredScope: "employees:read",
		});

		const projectsKey = await connect((await key(["projects:read"])).key);
		expect((await projectsKey.listTools()).tools.map((tool) => tool.name)).toEqual([
			"list_projects",
			"list_project_custom_fields",
		]);
		const definitions = await projectsKey.callTool({
			name: "list_project_custom_fields",
			arguments: {},
		});
		expect(definitions.structuredContent).toEqual({
			data: [expect.objectContaining({ id: customFields["Billing code"], name: "Billing code" })],
			nextCursor: null,
		});
	});

	it("returns work periods as UTC instants with the recorded offset", async () => {
		const client = await connect((await key(["time-entries:read"])).key);
		const page = await client.callTool({
			name: "list_work_periods",
			arguments: { from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" },
		});
		expect(page.structuredContent).toEqual({
			data: [
				expect.objectContaining({
					start: { at: "2026-10-01T06:00:00.000Z", utcOffset: "+02:00" },
					end: { at: "2026-10-01T14:00:00.000Z", utcOffset: "+02:00" },
					durationMinutes: 480,
					vehicleUse: null,
				}),
			],
			nextCursor: null,
		});
	});

	it("returns the vehicle use of a work period (#1128)", async () => {
		const client = await connect((await key(["time-entries:read"])).key);
		const page = await client.callTool({
			name: "list_work_periods",
			arguments: { from: "2026-10-02T00:00:00Z", to: "2026-10-03T00:00:00Z" },
		});
		expect(page.structuredContent).toEqual({
			data: [
				expect.objectContaining({
					vehicleUse: {
						kind: "organization",
						vehicleId: expect.any(String),
						vehicleName: "T795 van",
						licencePlate: "B MC 795",
						odometerStartKm: 500,
						odometerEndKm: 540,
						drivenDistanceKm: 40,
					},
				}),
			],
			nextCursor: null,
		});
	});

	it("walks nextCursor through a tool over every row exactly once", async () => {
		const client = await connect((await key(["time-entries:read"])).key);
		const seen: string[] = [];
		let cursor: string | null = null;
		do {
			const page = await client.callTool({
				name: "list_work_periods",
				arguments: { ...octoberInstants, limit: 1, ...(cursor ? { cursor } : {}) },
			});
			const body = page.structuredContent as { data: { id: string }[]; nextCursor: string | null };
			expect(body.data.length).toBeLessThanOrEqual(1);
			seen.push(...body.data.map((row) => row.id));
			cursor = body.nextCursor;
		} while (cursor);
		expect(seen).toHaveLength(4);
		expect(new Set(seen).size).toBe(4);
	});

	it("refuses missing or oversized ranges as validation_failed tool errors", async () => {
		const client = await connect((await key(["time-entries:read"])).key);
		for (const args of [
			{},
			{ from: "2026-10-01T00:00:00Z" },
			{ from: "2026-01-01T00:00:00Z", to: "2027-01-03T00:00:00Z" },
		]) {
			const result = await client.callTool({ name: "list_work_periods", arguments: args });
			expect(problemOf(result), JSON.stringify(args)).toMatchObject({
				type: "validation_failed",
				status: 400,
			});
		}
	});

	it("refuses a missing, unknown or revoked key and a session cookie with 401, without an OAuth challenge", async () => {
		const created = await key(ALL_SCOPES);
		await revokeOrganizationApiKey(db, {
			organizationId: ids.organization,
			actorUserId: ids.admin,
			keyId: created.id,
		});
		const sessionToken = "t795-real-session-token-of-the-owner";
		await admin.query(
			`insert into session (id, token, user_id, expires_at, updated_at, active_organization_id)
			 values ('t795-session', $1, $2, now() + interval '1 day', now(), $3)
			 on conflict (id) do nothing`,
			[sessionToken, ids.admin, ids.organization],
		);
		for (const headers of [
			{},
			{ authorization: "Bearer z8_orgUnknownKeyUnknownKeyUnknownKeyUnknown" },
			{ authorization: `Bearer ${created.key}` },
			{ authorization: `Bearer ${sessionToken}` },
			{ cookie: `__Secure-better-auth.session_token=${sessionToken}` },
		]) {
			const response = await post(toolCallBody("list_employees"), headers);
			expect(response.status, JSON.stringify(headers)).toBe(401);
			expect(response.headers.get("content-type")).toBe("application/problem+json");
			expect(response.headers.get("www-authenticate")).toBeNull();
			expect(await response.json()).toMatchObject({ type: "invalid_key", status: 401 });
		}
		await expect(connect("z8_orgUnknownKeyUnknownKeyUnknownKeyUnknown")).rejects.toThrow();
	});

	it("requires billing access only while billing is enabled", async () => {
		const { key: presented } = await key(ALL_SCOPES);
		world.billingEnabled = true;
		const refused = await post(toolCallBody("list_employees"), {
			authorization: `Bearer ${presented}`,
		});
		expect(refused.status).toBe(402);
		expect(await refused.json()).toMatchObject({ type: "billing_required" });

		world.billingEnabled = false;
		const client = await connect(presented);
		expect(
			(await client.callTool({ name: "list_employees", arguments: {} })).isError ?? false,
		).toBe(false);
	});

	it("shares one rate-limit budget with /api/v1 and answers 429 with Retry-After", async () => {
		const { key: presented } = await key(ALL_SCOPES);
		const client = await connect(presented);
		world.organizationHits.clear();
		world.organizationCeiling = 2;

		expect((await callV1("/api/v1/employees", presented, "")).status).toBe(200);
		const viaMcp = await client.callTool({ name: "list_employees", arguments: {} });
		expect(viaMcp.isError ?? false).toBe(false);

		const refused = await post(toolCallBody("list_employees"), {
			authorization: `Bearer ${presented}`,
		});
		expect(refused.status).toBe(429);
		expect(refused.headers.get("retry-after")).toBe("42");
		expect(refused.headers.get("x-ratelimit-remaining")).toBe("0");
		expect(await refused.json()).toMatchObject({ type: "rate_limited" });
		expect((await callV1("/api/v1/employees", presented, "")).status).toBe(429);
	});

	it("spends the key's own limit on every MCP request, tools/list included, shared with /api/v1", async () => {
		const { key: presented } = await key(ALL_SCOPES, ids.organization, 3);
		const listTools = () =>
			post(
				{ jsonrpc: "2.0", id: 1, method: "tools/list" },
				{ authorization: `Bearer ${presented}` },
			);

		expect((await callV1("/api/v1/employees", presented, "")).status).toBe(200);
		const listed = await listTools();
		expect(listed.status).toBe(200);
		expect(listed.headers.get("x-ratelimit-remaining")).toBe("1");
		expect((await callV1("/api/v1/employees", presented, "")).status).toBe(200);

		const refused = await listTools();
		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
		expect(await refused.json()).toMatchObject({ type: "rate_limited" });
	});

	it("logs each tool call once with channel mcp, and nothing for initialize or tools/list", async () => {
		const { key: presented } = await key(["employees:read"]);
		const client = await connect(presented);
		await client.listTools();
		expect(await logRows()).toEqual([]);

		await client.callTool({ name: "list_employees", arguments: {} });
		await client.callTool({ name: "list_projects", arguments: {} });
		await client.callTool({ name: "list_employees", arguments: { limit: 0 } });
		await callV1("/api/v1/employees", presented, "");
		world.billingEnabled = true;
		await post(toolCallBody("list_employees"), { authorization: `Bearer ${presented}` });

		expect(await logRows()).toEqual([
			{
				channel: "mcp",
				method: "GET",
				route: "/api/v1/employees",
				status: 200,
				row_count: 1,
				ip_address: "203.0.113.9",
			},
			expect.objectContaining({ channel: "mcp", route: "/api/v1/projects", status: 403 }),
			expect.objectContaining({ channel: "mcp", route: "/api/v1/employees", status: 400 }),
			expect.objectContaining({ channel: "api", route: "/api/v1/employees", status: 200 }),
			expect.objectContaining({ channel: "mcp", route: "/api/v1/employees", status: 402 }),
		]);
	});
});
