/**
 * #822: custom fields in the Public API on PostgreSQL. Values embedded in the
 * employee, project and customer lists as of a date, the per-entity definitions
 * endpoints, and the two visibility tiers of ADR 0002.
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import { encodeCursor } from "../pagination";
import type { ApiKeyScope } from "../scopes";
import { callPublicApi, createTestKey, walkPublicApi } from "../testing/public-api-fixture";

const { db } = await import("@/db");
const { changeCustomFields } = await import("@/lib/organization/custom-fields/definitions");
const { listEmployees } = await import("./employees");
const { listProjects } = await import("./projects");
const { listCustomers } = await import("./customers");
const { PUBLIC_API_ENDPOINTS } = await import("../endpoints");
const { listCustomerCustomFields, listEmployeeCustomFields, listProjectCustomFields } =
	await import("./custom-fields");

const ids = {
	organization: "t822-org",
	other: "t822-other-org",
	admin: "t822-admin",
	ana: "t822-ana",
	dora: "t822-dora",
	otherAdmin: "t822-other-admin",
	otto: "t822-otto",
} as const;
const users = [ids.admin, ids.ana, ids.dora, ids.otherAdmin, ids.otto];

type Entity = "employee" | "project" | "customer";

describe("custom fields in the Public API", () => {
	const admin = integrationAdminPool();
	const records: Record<string, string> = {};
	const fields: Record<string, { id: string; options: { id: string; label: string }[] }> = {};

	async function cleanup() {
		await admin.query("delete from apikey where reference_id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query(`delete from "user" where id like 't822-%'`);
	}

	async function define(
		name: string,
		change: Record<string, unknown> = {},
		organizationId: string = ids.organization,
	) {
		const outcome = await changeCustomFields(db, {
			organizationId,
			actorUserId: organizationId === ids.other ? ids.otherAdmin : ids.admin,
			change: {
				kind: "create",
				entity: "employee",
				name,
				type: "text",
				required: false,
				tracked: false,
				visibility: "employee",
				editLevel: "admin",
				...change,
			},
		});
		if (!outcome.ok) throw new Error(`define ${name} refused: ${outcome.reason}`);
		const field = outcome.fields.find(
			(candidate) => candidate.name === name && !candidate.archived,
		);
		if (!field) throw new Error(`field ${name} missing`);
		fields[name] = field;
		return field;
	}

	async function change(input: Record<string, unknown>) {
		const outcome = await changeCustomFields(db, {
			organizationId: ids.organization,
			actorUserId: ids.admin,
			change: input,
		});
		if (!outcome.ok) throw new Error(`change refused: ${outcome.reason}`);
	}

	const RECORD_COLUMN = { employee: "employee_id", project: "project_id", customer: "customer_id" };

	async function value(
		entity: Entity,
		recordId: string,
		fieldName: string,
		column: string,
		stored: unknown,
		validFrom: string | null = null,
		organizationId: string = ids.organization,
	) {
		await admin.query(
			`insert into custom_field_value (organization_id, definition_id, ${RECORD_COLUMN[entity]}, ${column}, valid_from, tracked)
			 values ($1, $2, $3, $4, $5, $6)`,
			[organizationId, fields[fieldName].id, recordId, stored, validFrom, validFrom !== null],
		);
	}

	const key = (scopes: string[]) => createTestKey(ids.organization, ids.admin, scopes as never);

	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T822', $1, now()), ($2, 'T822 other', $2, now())`,
			[ids.organization, ids.other],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		const { rows } = await admin.query<{ id: string; user_id: string }>(
			`insert into employee (user_id, organization_id, role, is_active, updated_at) values
			 ($1, $3, 'employee', true, now()), ($2, $4, 'employee', true, now())
			 returning id, user_id`,
			[ids.ana, ids.otto, ids.organization, ids.other],
		);
		for (const row of rows) records[row.user_id === ids.ana ? "ana" : "otto"] = row.id;

		await define("Shirt size");
		await define("Cost center", { visibility: "manager" });
		await define("Salary band", { visibility: "admin" });
		await value("employee", records.ana, "Shirt size", "text_value", "L");
		await value("employee", records.ana, "Cost center", "text_value", "CC-7");
		await value("employee", records.ana, "Salary band", "text_value", "B2");
		await define("Hours", { type: "number", number: { integerOnly: false, min: "0", max: "60" } });
		await define("Hired", { type: "date" });
		await define("Remote", { type: "boolean" });
		await define("Level", { type: "select", options: ["Junior", "Senior"] });
		await define("Nickname");
		await define("Retired");
		await value("employee", records.ana, "Hours", "number_value", "40.50");
		await value("employee", records.ana, "Hired", "date_value", "2024-03-01");
		await value("employee", records.ana, "Remote", "boolean_value", false);
		await value("employee", records.ana, "Level", "select_option_id", fields.Level.options[1].id);
		await value("employee", records.ana, "Retired", "text_value", "gone");
		await change({ kind: "archiveOption", optionId: fields.Level.options[1].id });
		await change({ kind: "archive", fieldId: fields.Retired.id });
		await define("Grade", { tracked: true });
		await value("employee", records.ana, "Grade", "text_value", "G1", "2026-01-01");
		await value("employee", records.ana, "Grade", "text_value", "G2", "2026-07-01");

		const { rows: departed } = await admin.query<{ id: string }>(
			`insert into employee (user_id, organization_id, role, is_active, updated_at)
			 values ($1, $2, 'employee', false, now()) returning id`,
			[ids.dora, ids.organization],
		);
		records.dora = departed[0].id;
		await value("employee", records.dora, "Shirt size", "text_value", "S");

		const { rows: customers } = await admin.query<{ id: string; name: string }>(
			`insert into customer (organization_id, name, is_active, created_by, updated_at) values
			 ($1, 'Acme', true, $2, now()), ($1, 'Gone GmbH', false, $2, now())
			 returning id, name`,
			[ids.organization, ids.admin],
		);
		for (const row of customers) records[row.name] = row.id;
		const { rows: projects } = await admin.query<{ id: string }>(
			`insert into project (organization_id, name, status, customer_id, created_by, updated_at)
			 values ($1, 'Website', 'active', $2, $3, now()) returning id`,
			[ids.organization, records.Acme, ids.admin],
		);
		records.Website = projects[0].id;

		await define("Billing code", { entity: "project" });
		await define("Margin", { entity: "project", visibility: "manager" });
		await define("Segment", { entity: "customer" });
		await define("Credit rating", { entity: "customer", visibility: "admin" });
		await value("project", records.Website, "Billing code", "text_value", "WEB-1");
		await value("project", records.Website, "Margin", "text_value", "high");
		await value("customer", records.Acme, "Segment", "text_value", "SMB");
		await value("customer", records.Acme, "Credit rating", "text_value", "AA");
		await value("customer", records["Gone GmbH"], "Segment", "text_value", "Enterprise");
	});
	// An organization has at most 10 keys.
	beforeEach(async () => {
		await admin.query("delete from apikey where reference_id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
	});
	afterAll(cleanup);

	const anaOf = (rows: Record<string, unknown>[]) =>
		rows.find((row) => row.id === records.ana) as { customFields: Record<string, unknown> };

	it("returns only employee-visible fields without the restricted scope, and all with it", async () => {
		const plain = anaOf(await walkPublicApi(listEmployees, await key(["employees:read"]), ""));
		expect(plain.customFields).toMatchObject({ [fields["Shirt size"].id]: "L" });
		expect(plain.customFields).not.toHaveProperty(fields["Cost center"].id);
		expect(plain.customFields).not.toHaveProperty(fields["Salary band"].id);
		expect(JSON.stringify(plain)).not.toMatch(/CC-7|B2/);

		const restricted = anaOf(
			await walkPublicApi(
				listEmployees,
				await key(["employees:read", "custom-fields:read-restricted"]),
				"",
			),
		);
		expect(restricted.customFields).toMatchObject({
			[fields["Shirt size"].id]: "L",
			[fields["Cost center"].id]: "CC-7",
			[fields["Salary band"].id]: "B2",
		});
	});

	it("returns every active field with null when unset, and each type as specified", async () => {
		const rows = await walkPublicApi(listEmployees, await key(["employees:read"]), "");
		const { customFields } = anaOf(rows);
		expect(customFields).toEqual({
			[fields["Shirt size"].id]: "L",
			[fields.Hours.id]: "40.5",
			[fields.Hired.id]: "2024-03-01",
			[fields.Remote.id]: false,
			// An archived option's label still resolves.
			[fields.Level.id]: { id: fields.Level.options[1].id, label: "Senior" },
			[fields.Nickname.id]: null,
			[fields.Grade.id]: "G2",
		});
		// Archived fields are left out, even with a value.
		expect(customFields).not.toHaveProperty(fields.Retired.id);
	});

	it("applies the same two tiers to projects and customers", async () => {
		const plainKey = await key(["projects:read", "customers:read"]);
		const fullKey = await key(["projects:read", "customers:read", "custom-fields:read-restricted"]);
		const website = async (presented: string) =>
			(await walkPublicApi(listProjects, presented, "")).find((row) => row.id === records.Website)
				?.customFields;
		const acme = async (presented: string) =>
			(await walkPublicApi(listCustomers, presented, "")).find((row) => row.id === records.Acme)
				?.customFields;

		expect(await website(plainKey)).toEqual({ [fields["Billing code"].id]: "WEB-1" });
		expect(await website(fullKey)).toEqual({
			[fields["Billing code"].id]: "WEB-1",
			[fields.Margin.id]: "high",
		});
		expect(await acme(plainKey)).toEqual({ [fields.Segment.id]: "SMB" });
		expect(await acme(fullKey)).toEqual({
			[fields.Segment.id]: "SMB",
			[fields["Credit rating"].id]: "AA",
		});
	});

	it("reads tracked fields as of asOf and untracked ones whatever the date", async () => {
		const presented = await key(["employees:read"]);
		const asOf = async (date: string) => {
			const { status, body } = await callPublicApi(listEmployees, presented, `?asOf=${date}`);
			expect(status, date).toBe(200);
			expect(body.asOf, date).toBe(date);
			return anaOf(body.data as Record<string, unknown>[]).customFields;
		};
		for (const [date, grade] of [
			["2025-12-31", null],
			["2026-01-01", "G1"],
			["2026-03-15", "G1"],
			["2026-07-01", "G2"],
		] as const) {
			expect(await asOf(date), date).toMatchObject({
				[fields.Grade.id]: grade,
				[fields["Shirt size"].id]: "L",
			});
		}
	});

	it("defaults asOf to today in the organization's timezone and echoes it", async () => {
		// A zone whose date differs from UTC's right now.
		const now = Temporal.Now.instant();
		const utc = now.toZonedDateTimeISO("UTC");
		const zone = utc.hour >= 10 ? "Pacific/Kiritimati" : "Pacific/Pago_Pago";
		const today = now.toZonedDateTimeISO(zone).toPlainDate().toString();
		expect(today).not.toBe(utc.toPlainDate().toString());
		await admin.query("update organization set timezone = $2 where id = $1", [
			ids.organization,
			zone,
		]);
		onTestFinished(() =>
			admin.query("update organization set timezone = 'UTC' where id = $1", [ids.organization]),
		);

		const presented = await key(["employees:read", "projects:read", "customers:read"]);
		for (const endpoint of [listEmployees, listProjects, listCustomers]) {
			const { status, body } = await callPublicApi(endpoint, presented);
			expect(status, endpoint.path).toBe(200);
			expect(body.asOf, endpoint.path).toBe(today);
		}
	});

	it("refuses an invalid asOf as validation_failed on asOf", async () => {
		const presented = await key(["employees:read", "projects:read", "customers:read"]);
		for (const endpoint of [listEmployees, listProjects, listCustomers]) {
			for (const date of ["2026-13-01", "2026-02-30", "yesterday"]) {
				const { status, body } = await callPublicApi(endpoint, presented, `?asOf=${date}`);
				expect(status, `${endpoint.path} ${date}`).toBe(400);
				expect(body).toMatchObject({
					type: "validation_failed",
					errors: [expect.objectContaining({ parameter: "asOf" })],
				});
			}
		}
	});

	it("keeps the values of departed employees and inactive customers", async () => {
		const employeesKey = await key(["employees:read", "customers:read"]);
		const dora = (await walkPublicApi(listEmployees, employeesKey, "?status=departed")).find(
			(row) => row.id === records.dora,
		);
		expect(dora?.customFields).toMatchObject({
			[fields["Shirt size"].id]: "S",
			[fields.Hours.id]: null,
		});
		const gone = (await walkPublicApi(listCustomers, employeesKey, "?status=inactive")).find(
			(row) => row.id === records["Gone GmbH"],
		);
		expect(gone?.customFields).toEqual({ [fields.Segment.id]: "Enterprise" });
	});

	it("lists an entity's definitions, active and archived, in position order", async () => {
		const definitions = await walkPublicApi(
			listEmployeeCustomFields,
			await key(["employees:read"]),
			"",
			50,
		);
		const names = definitions.map((row) => row.name);
		expect([...names].sort()).toEqual(
			["Shirt size", "Hours", "Hired", "Remote", "Level", "Nickname", "Retired", "Grade"].sort(),
		);
		const positions = definitions.map((row) => row.position as number);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		expect(names.slice(0, 6)).toEqual([
			"Shirt size",
			"Hours",
			"Hired",
			"Remote",
			"Level",
			"Nickname",
		]);

		const byName = new Map(definitions.map((row) => [row.name, row]));
		expect(byName.get("Hours")).toEqual({
			id: fields.Hours.id,
			name: "Hours",
			type: "number",
			tracked: false,
			required: false,
			visibility: "employee",
			archived: false,
			position: expect.any(Number),
			integerOnly: false,
			min: "0",
			max: "60",
			options: [],
		});
		expect(byName.get("Level")).toMatchObject({
			type: "select",
			integerOnly: null,
			min: null,
			max: null,
			options: [
				{ id: fields.Level.options[0].id, label: "Junior", archived: false },
				{ id: fields.Level.options[1].id, label: "Senior", archived: true },
			],
		});
		expect(byName.get("Grade")).toMatchObject({ tracked: true, archived: false });
		expect(byName.get("Retired")).toMatchObject({ archived: true });
		expect(JSON.stringify(definitions)).not.toMatch(/editLevel|edit_level/);
	});

	it("filters definitions by status and walks the cursor over each exactly once", async () => {
		const presented = await key(["employees:read"]);
		const all = await walkPublicApi(listEmployeeCustomFields, presented, "", 50);
		const walked = await walkPublicApi(listEmployeeCustomFields, presented, "", 1);
		expect(walked.map((row) => row.id)).toEqual(all.map((row) => row.id));
		expect(new Set(walked.map((row) => row.id)).size).toBe(all.length);

		const archived = await walkPublicApi(listEmployeeCustomFields, presented, "?status=archived");
		expect(archived.map((row) => row.name)).toEqual(["Retired"]);
		const active = await walkPublicApi(listEmployeeCustomFields, presented, "?status=active");
		expect(active).toHaveLength(all.length - 1);
		expect((await callPublicApi(listEmployeeCustomFields, presented, "?cursor=nope")).status).toBe(
			400,
		);
	});

	it("leaves restricted definitions out without the restricted scope, names included", async () => {
		const plainKey = await key(["employees:read", "projects:read", "customers:read"]);
		const fullKey = await key([
			"employees:read",
			"projects:read",
			"customers:read",
			"custom-fields:read-restricted",
		]);
		const cases = [
			[listEmployeeCustomFields, ["Cost center", "Salary band"]],
			[listProjectCustomFields, ["Margin"]],
			[listCustomerCustomFields, ["Credit rating"]],
		] as const;
		for (const [endpoint, restricted] of cases) {
			const plain = JSON.stringify(await walkPublicApi(endpoint, plainKey, ""));
			const full = (await walkPublicApi(endpoint, fullKey, "")).map((row) => row.name);
			for (const name of restricted) {
				expect(plain, endpoint.path).not.toContain(name);
				expect(plain, endpoint.path).not.toContain(fields[name].id);
				expect(full, endpoint.path).toContain(name);
			}
		}
		expect(
			(await callPublicApi(listProjectCustomFields, await key(["employees:read"]))).status,
		).toBe(403);
	});

	it("never reads another organization's definitions or values", async () => {
		const foreign = await define("Secret", { visibility: "employee" }, ids.other);
		await value("employee", records.otto, "Secret", "text_value", "hidden", null, ids.other);
		const ours = await key([
			"employees:read",
			"projects:read",
			"customers:read",
			"custom-fields:read-restricted",
		]);
		for (const endpoint of [
			listEmployees,
			listProjects,
			listCustomers,
			listEmployeeCustomFields,
			listProjectCustomFields,
			listCustomerCustomFields,
		]) {
			const text = JSON.stringify(await walkPublicApi(endpoint, ours, ""));
			expect(text, endpoint.path).not.toContain(foreign.id);
			expect(text, endpoint.path).not.toMatch(/Secret|hidden/);
		}

		// A cursor naming a guessed foreign field id only positions the walk: it reads nothing foreign.
		const guessed = await callPublicApi(
			listEmployeeCustomFields,
			ours,
			`?cursor=${encodeCursor([-1, foreign.id])}`,
		);
		expect(guessed.status).toBe(200);
		expect(JSON.stringify(guessed.body)).not.toMatch(new RegExp(`${foreign.id}|Secret`));

		const theirs = await createTestKey(ids.other, ids.otherAdmin, ["employees:read"]);
		const [otto] = await walkPublicApi(listEmployees, theirs, "");
		expect(otto.customFields).toEqual({ [foreign.id]: "hidden" });
		const theirDefinitions = await walkPublicApi(listEmployeeCustomFields, theirs, "");
		expect(theirDefinitions.map((row) => row.id)).toEqual([foreign.id]);
	});

	it("reads a page's custom fields with a constant number of queries", async () => {
		for (const name of ["eve", "finn", "gus"]) {
			const userId = `t822-${name}`;
			await admin.query(
				`insert into "user" (id, name, email, created_at, updated_at)
				 values ($1, $1, $1 || '@example.test', now(), now())`,
				[userId],
			);
			const { rows } = await admin.query<{ id: string }>(
				`insert into employee (user_id, organization_id, role, is_active, updated_at)
				 values ($1, $2, 'employee', true, now()) returning id`,
				[userId, ids.organization],
			);
			await value("employee", rows[0].id, "Shirt size", "text_value", "M");
			await value("employee", rows[0].id, "Grade", "text_value", "G1", "2026-01-01");
		}
		const principal = {
			organizationId: ids.organization,
			apiKeyId: "t822-counting",
			scopes: ["employees:read", "custom-fields:read-restricted"] as ApiKeyScope[],
			creatorUserId: ids.admin,
		};
		const selectsFor = async (limit: number) => {
			let selects = 0;
			const counting = {
				select: ((...args: Parameters<typeof db.select>) => {
					selects++;
					return db.select(...args);
				}) as typeof db.select,
			};
			const result = await listEmployees.run({
				principal,
				query: listEmployees.query.parse({ limit: String(limit) }),
				database: counting,
			});
			if (!result.ok) throw new Error(result.problem.type);
			return { selects, rows: result.body.data.length };
		};
		const one = await selectsFor(1);
		const many = await selectsFor(50);
		expect(one.rows).toBe(1);
		expect(many.rows).toBeGreaterThanOrEqual(5);
		expect(one.selects).toBeGreaterThan(0);
		expect(many.selects).toBe(one.selects);
	});

	it("grants nothing with only custom-fields:read-restricted", async () => {
		const restrictedOnly = await key(["custom-fields:read-restricted"]);
		for (const endpoint of PUBLIC_API_ENDPOINTS) {
			const { status, body } = await callPublicApi(
				endpoint,
				restrictedOnly,
				"?from=2026-10-01&to=2026-10-02",
			);
			expect(status, endpoint.path).toBe(403);
			expect(body, endpoint.path).toMatchObject({ type: "scope_missing" });
		}
	});
});
