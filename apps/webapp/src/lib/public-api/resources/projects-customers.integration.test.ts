/** #763 slice 3: GET /api/v1/projects and /api/v1/customers on PostgreSQL. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import { callPublicApi, createTestKey, walkPublicApi } from "../testing/public-api-fixture";
import { listCustomers } from "./customers";
import { listProjects } from "./projects";

const ids = { organization: "t763r-org", other: "t763r-other-org", admin: "t763r-admin" } as const;

describe("projects and customers in the Public API", () => {
	const admin = integrationAdminPool();
	const customers: Record<string, string> = {};
	const projects: Record<string, string> = {};
	let key: string;

	async function cleanup() {
		await admin.query("delete from apikey where reference_id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = $1', [ids.admin]);
	}

	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T763R', $1, now()), ($2, 'T763R other', $2, now())`,
			[ids.organization, ids.other],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $1 || '@example.test', now(), now())`,
			[ids.admin],
		);
		const { rows: customerRows } = await admin.query<{ id: string; name: string }>(
			`insert into customer (organization_id, name, vat_id, email, is_active, created_by, updated_at) values
			 ($1, 'Acme', 'DE123', 'billing@acme.test', true, $3, now()),
			 ($1, 'Gone GmbH', null, null, false, $3, now()),
			 ($2, 'Elsewhere', null, null, true, $3, now())
			 returning id, name`,
			[ids.organization, ids.other, ids.admin],
		);
		for (const row of customerRows) customers[row.name] = row.id;
		const { rows: projectRows } = await admin.query<{ id: string; name: string }>(
			`insert into project (organization_id, name, status, customer_id, budget_hours, created_by, updated_at) values
			 ($1, 'Website', 'active', $3, 120, $5, now()),
			 ($1, 'Archive', 'archived', null, null, $5, now()),
			 ($1, 'Planning', 'planned', $3, null, $5, now()),
			 ($2, 'Foreign', 'active', $4, null, $5, now())
			 returning id, name`,
			[ids.organization, ids.other, customers.Acme, customers.Elsewhere, ids.admin],
		);
		for (const row of projectRows) projects[row.name] = row.id;
		key = await createTestKey(ids.organization, ids.admin, ["projects:read", "customers:read"]);
	});
	afterAll(cleanup);

	it("returns the organization's projects with exactly the agreed fields", async () => {
		const rows = await walkPublicApi(listProjects, key, "");
		expect(rows).toHaveLength(3);
		expect(rows.find((row) => row.name === "Website")).toEqual({
			id: projects.Website,
			name: "Website",
			status: "active",
			customerId: customers.Acme,
		});
		expect(JSON.stringify(rows)).not.toContain("Foreign");
		expect(JSON.stringify(rows)).not.toMatch(/budget|rate|member/i);
	});

	it("filters projects by status and customer", async () => {
		expect(
			(await walkPublicApi(listProjects, key, "?status=archived")).map((row) => row.name),
		).toEqual(["Archive"]);
		expect(
			(await walkPublicApi(listProjects, key, `?customerId=${customers.Acme}`))
				.map((row) => row.name)
				.sort(),
		).toEqual(["Planning", "Website"]);
		// Another organization's customer matches nothing.
		expect(await walkPublicApi(listProjects, key, `?customerId=${customers.Elsewhere}`)).toEqual(
			[],
		);
		expect((await callPublicApi(listProjects, key, "?customerId=nope")).status).toBe(400);
	});

	it("returns the organization's customers with exactly the agreed fields", async () => {
		const rows = await walkPublicApi(listCustomers, key, "", 1);
		expect(rows.sort((a, b) => String(a.name).localeCompare(String(b.name)))).toEqual([
			{ id: customers.Acme, name: "Acme", status: "active" },
			{ id: customers["Gone GmbH"], name: "Gone GmbH", status: "inactive" },
		]);
		expect(
			(await walkPublicApi(listCustomers, key, "?status=inactive")).map((row) => row.name),
		).toEqual(["Gone GmbH"]);
	});

	it("needs the matching key scope for each list", async () => {
		const projectsOnly = await createTestKey(ids.organization, ids.admin, ["projects:read"]);
		expect((await callPublicApi(listCustomers, projectsOnly)).status).toBe(403);
		expect((await callPublicApi(listProjects, projectsOnly)).status).toBe(200);
	});
});
