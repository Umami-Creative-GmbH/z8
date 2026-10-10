/**
 * #820: custom fields in the settings data export on PostgreSQL. Employee rows
 * carry the employee fields the requester's base role sees; the projects and
 * customers datasets carry their built-in columns plus their fields. Scheduled
 * exports apply the schedule creator's role as it is when each run starts.
 * Only the S3 upload is replaced (it hands the archive to the test).
 */

import JSZip from "jszip";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const uploads = vi.hoisted(() => ({ archives: [] as Buffer[] }));

vi.mock("@/lib/storage/export-s3-client", () => ({
	deleteExport: async () => {},
	generateExportKey: (organizationId: string, exportId: string) =>
		`exports/${organizationId}/${exportId}.zip`,
	getPresignedUrl: async () => "https://storage.example.test/export.zip",
	isExportS3Configured: async () => true,
	uploadExport: async (_organizationId: string, _key: string, body: Buffer) => {
		uploads.archives.push(body);
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
}));

const { db } = await import("@/db");
const { changeCustomFields } = await import("@/lib/organization/custom-fields/definitions");
const { writeCustomFieldValues } = await import("@/lib/organization/custom-fields/values");
const { fetchExportData } = await import("./data-fetchers");
const { buildExportFiles } = await import("./zip-builder");
const { DataExportExecutor } = await import(
	"@/lib/scheduled-exports/application/executors/data-export-executor"
);

const ids = {
	organization: "t820e-org",
	other: "t820e-other-org",
	admin: "t820e-admin",
	manager: "t820e-manager",
	otherOwner: "t820e-other-owner",
	adminEmployee: "82000000-0000-4000-8000-0000000000e1",
	managerEmployee: "82000000-0000-4000-8000-0000000000e2",
	otherEmployee: "82000000-0000-4000-8000-0000000000e3",
	customer: "82000000-0000-4000-8000-0000000000c1",
	project: "82000000-0000-4000-8000-0000000000a1",
	otherCustomer: "82000000-0000-4000-8000-0000000000c2",
} as const;
const users = [ids.admin, ids.manager, ids.otherOwner];

type Entity = "employee" | "project" | "customer";

function requester(employeeId: string) {
	return { exportId: "t820e-export", requestedByEmployeeId: employeeId };
}

describe("custom fields in the data export on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from data_export where organization_id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function define(
		change: Record<string, unknown>,
		organizationId: string = ids.organization,
	): Promise<{ id: string; options: { id: string; label: string }[] }> {
		const outcome = await changeCustomFields(db, {
			organizationId,
			actorUserId: organizationId === ids.other ? ids.otherOwner : ids.admin,
			change: {
				kind: "create",
				entity: "employee",
				type: "text",
				required: false,
				tracked: false,
				visibility: "manager",
				editLevel: "manager",
				...change,
			},
		});
		if (!outcome.ok) throw new Error(`define refused: ${outcome.reason}`);
		const field = outcome.fields.find(
			(f) => f.name === change.name && f.entity === (change.entity ?? "employee") && !f.archived,
		);
		if (!field) throw new Error("field missing");
		return field;
	}

	async function write(entity: Entity, recordId: string, values: Record<string, unknown>) {
		await db.transaction((tx) =>
			writeCustomFieldValues(tx, {
				organizationId: ids.organization,
				actorUserId: ids.admin,
				level: "admin",
				entity,
				recordId,
				values,
				requireComplete: false,
			}),
		);
	}

	type ExportedEmployee = { id: string; email?: string } & Record<string, unknown>;

	/** The custom field properties of an exported employee, in order. */
	const customFieldEntries = (row: ExportedEmployee | undefined) =>
		Object.entries(row ?? {}).filter(([key]) => key.startsWith("customField:"));

	async function exportedEmployee(employeeId: string, requestedBy: string) {
		const data = await fetchExportData(ids.organization, ["employees"], requester(requestedBy));
		const { employees } = data.employees as { employees: ExportedEmployee[] };
		return employees.find((row) => row.id === employeeId);
	}

	function csvFile(data: Record<string, unknown>, name: string) {
		const file = buildExportFiles(ids.organization, data).find((entry) => entry.name === name);
		if (!file) throw new Error(`missing ${name}`);
		return file.content.split("\n");
	}

	beforeEach(async () => {
		await cleanup();
		uploads.archives.length = 0;
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T820E', $1, 'Europe/Berlin', now()), ($2, 'T820E other', $2, 'UTC', now())`,
			[ids.organization, ids.other],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t820e-m-admin', $1, $3, 'admin', 'approved', now()),
			 ('t820e-m-manager', $1, $4, 'member', 'approved', now()),
			 ('t820e-m-other', $2, $5, 'owner', 'approved', now())`,
			[ids.organization, ids.other, ids.admin, ids.manager, ids.otherOwner],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'admin', now()),
			 ($3, $4, $7, 'manager', now()),
			 ($5, $6, $8, 'admin', now())`,
			[
				ids.adminEmployee,
				ids.admin,
				ids.managerEmployee,
				ids.manager,
				ids.otherEmployee,
				ids.otherOwner,
				ids.organization,
				ids.other,
			],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, vat_id, created_by, updated_at) values
			 ($1, $2, 'Acme, Inc.', '2024', $3, now()), ($4, $5, 'Foreign', null, $6, now())`,
			[ids.customer, ids.organization, ids.admin, ids.otherCustomer, ids.other, ids.otherOwner],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, customer_id, budget_hours, created_by, updated_at)
			 values ($1, $2, 'Website', 'active', $3, 120.50, $4, now())`,
			[ids.project, ids.organization, ids.customer, ids.admin],
		);
	});
	afterAll(cleanup);

	it("adds the employee fields the requester sees to each employee row, in order", async () => {
		const salaryBand = await define({
			name: "Salary band",
			visibility: "admin",
			editLevel: "admin",
		});
		const startDate = await define({ name: "Start date", type: "date" });
		const union = await define({ name: "Union member", type: "boolean" });
		const tier = await define({ name: "Tier", type: "select", options: ["Gold", "Silver"] });
		const rate = await define({ name: "Rate", type: "number" });
		const retired = await define({ name: "Retired" });
		// A name like an integer keeps its place; a name like a built-in property never replaces it.
		const year = await define({ name: "2024" });
		const email = await define({ name: "email" });
		await define({ name: "Foreign field", visibility: "employee" }, ids.other);
		await write("employee", ids.managerEmployee, {
			[salaryBand.id]: "B2",
			[startDate.id]: "2024-02-29",
			[union.id]: false,
			[tier.id]: tier.options[0].id,
			[rate.id]: "12,50",
			[retired.id]: "old",
			[year.id]: "Y",
			[email.id]: "custom@example.test",
		});
		await changeCustomFields(db, {
			organizationId: ids.organization,
			actorUserId: ids.admin,
			change: { kind: "archive", fieldId: retired.id },
		});

		const asAdmin = await exportedEmployee(ids.managerEmployee, ids.adminEmployee);
		expect(customFieldEntries(asAdmin)).toEqual([
			["customField:Salary band", "B2"],
			["customField:Start date", "2024-02-29"],
			["customField:Union member", false],
			["customField:Tier", "Gold"],
			["customField:Rate", "12.5"],
			["customField:2024", "Y"],
			["customField:email", "custom@example.test"],
		]);
		expect(asAdmin?.email).toBe(`${ids.manager}@example.test`);
		const forAdminWithoutValues = await exportedEmployee(ids.adminEmployee, ids.adminEmployee);
		expect(customFieldEntries(forAdminWithoutValues)).toEqual([
			["customField:Salary band", null],
			["customField:Start date", null],
			["customField:Union member", null],
			["customField:Tier", null],
			["customField:Rate", null],
			["customField:2024", null],
			["customField:email", null],
		]);
		// A manager never gets admin-only fields.
		const asManager = await exportedEmployee(ids.managerEmployee, ids.managerEmployee);
		expect(customFieldEntries(asManager).map(([key]) => key)).toEqual([
			"customField:Start date",
			"customField:Union member",
			"customField:Tier",
			"customField:Rate",
			"customField:2024",
			"customField:email",
		]);
	});

	it("exports projects and customers with their built-in columns and custom field columns", async () => {
		const kickoff = await define({ entity: "project", name: "Kickoff date", type: "date" });
		const budgetCode = await define({
			entity: "project",
			name: "Budget code",
			visibility: "admin",
			editLevel: "admin",
		});
		const region = await define({ entity: "customer", name: "Region" });
		const keyAccount = await define({ entity: "customer", name: "Key account", type: "boolean" });
		await write("project", ids.project, { [kickoff.id]: "2026-02-02", [budgetCode.id]: "BC-9" });
		await write("customer", ids.customer, { [region.id]: "DACH", [keyAccount.id]: true });

		const data = await fetchExportData(
			ids.organization,
			["projects", "customers"],
			requester(ids.adminEmployee),
		);
		const projects = csvFile(data, "projects.csv");
		expect(projects[0]).toBe(
			"id,name,description,status,customerId,customerName,budgetHours,deadline,isActive,createdAt,Kickoff date,Budget code",
		);
		expect(projects).toHaveLength(2);
		expect(projects[1]).toMatch(
			new RegExp(
				`^${ids.project},Website,,active,${ids.customer},"Acme, Inc.",120.5,,true,\\d{4}-\\d{2}-\\d{2}T[^,]+Z,2026-02-02,BC-9$`,
			),
		);
		const customers = csvFile(data, "customers.csv");
		expect(customers[0]).toBe(
			"id,name,address,vatId,email,contactPerson,phone,website,isActive,createdAt,Region,Key account",
		);
		// The built-in VAT ID "2024" stays as written; only real instants are re-ISOed.
		expect(customers[1]).toMatch(
			new RegExp(`^${ids.customer},"Acme, Inc.",,2024,,,,,true,[^,]+Z,DACH,true$`),
		);
		expect(customers).toHaveLength(2);

		const asManager = await fetchExportData(
			ids.organization,
			["projects"],
			requester(ids.managerEmployee),
		);
		expect(csvFile(asManager, "projects.csv")[0]).not.toContain("Budget code");
	});

	it("leaves out admin-only fields once a scheduled export's creator was demoted", async () => {
		await define({ name: "Salary band", visibility: "admin", editLevel: "admin" });
		await define({ name: "Badge" });
		const executor = new DataExportExecutor();
		const run = async () => {
			const result = await executor.execute({
				organizationId: ids.organization,
				reportConfig: { categories: ["employees"] },
				createdBy: ids.admin,
				emailRecipients: [],
			} as never);
			expect(result.success).toBe(true);
			const archive = await JSZip.loadAsync(uploads.archives.at(-1) as Buffer);
			const file = JSON.parse((await archive.file("employees.json")?.async("string")) ?? "{}");
			const row = (file.data.employees as ExportedEmployee[]).find(
				(entry) => entry.id === ids.adminEmployee,
			);
			return customFieldEntries(row).map(([key]) => key);
		};

		expect(await run()).toEqual(["customField:Salary band", "customField:Badge"]);

		await admin.query("update member set role = 'member' where id = 't820e-m-admin'");
		await admin.query("update employee set role = 'manager' where id = $1", [ids.adminEmployee]);

		expect(await run()).toEqual(["customField:Badge"]);
	});
});
