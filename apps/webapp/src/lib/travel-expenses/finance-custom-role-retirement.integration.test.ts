/**
 * #748 (ADR 0001): migration 0138 turns every holder of a `TravelExpenseFinance`
 * custom role into an all-scope expense officer and deletes the stored
 * permission. Runs the migration's statements against a disposable PostgreSQL
 * database; the tables already exist there.
 */

import { readFile } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const migration = await readFile(
	new URL("../../../drizzle/0138_retire_travel_expense_finance_custom_role.sql", import.meta.url),
	"utf8",
);
const statements = migration.split("--> statement-breakpoint");

const ids = {
	reader: "e7480000-0000-4000-8000-000000000001",
	officer: "e7480000-0000-4000-8000-000000000002",
	merged: "e7480000-0000-4000-8000-000000000003",
	settled: "e7480000-0000-4000-8000-000000000004",
	leaver: "e7480000-0000-4000-8000-000000000005",
	foreigner: "e7480000-0000-4000-8000-000000000006",
	dormant: "e7480000-0000-4000-8000-000000000007",
	owner: "e7480000-0000-4000-8000-000000000008",
	team: "e7480000-0000-4000-8000-0000000000a1",
	readRole: "e7481000-0000-4000-8000-000000000001",
	exportRole: "e7481000-0000-4000-8000-000000000002",
	settleRole: "e7481000-0000-4000-8000-000000000003",
	inactiveRole: "e7481000-0000-4000-8000-000000000004",
	mergedGrant: "e7482000-0000-4000-8000-000000000001",
	settledGrant: "e7482000-0000-4000-8000-000000000002",
} as const;
type Person =
	| "reader"
	| "officer"
	| "merged"
	| "settled"
	| "leaver"
	| "foreigner"
	| "dormant"
	| "owner";
type Role = "readRole" | "exportRole" | "settleRole" | "inactiveRole";

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id in ('t748-org', 't748-foreign')");
	await admin.query('delete from "user" where id like $1', ["t748-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t748-org','Expenses','t748-org','Europe/Berlin',now()),
		 ('t748-foreign','Foreign','t748-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, boolean]> = [
		["owner", "t748-org", true],
		["reader", "t748-org", true],
		["officer", "t748-org", true],
		["merged", "t748-org", true],
		["settled", "t748-org", true],
		["leaver", "t748-org", false],
		["dormant", "t748-org", true],
		["foreigner", "t748-foreign", true],
	];
	for (const [name, organizationId, isActive] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t748-${name}`, name, `t748-${name}@example.test`],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,is_active,updated_at) values ($1,$2,$3,'employee',$4,now())",
			[ids[name], `t748-${name}`, organizationId, isActive],
		);
	}
	await admin.query(
		"insert into team (id, organization_id, name, updated_at) values ($1, 't748-org', 'Berlin', now())",
		[ids.team],
	);
	const roles: Array<[Role, string, boolean, string[]]> = [
		["readRole", "Accounting", true, ["read"]],
		["exportRole", "Payroll export", true, ["read", "export"]],
		["settleRole", "Payments", true, ["settle"]],
		["inactiveRole", "Old finance", false, ["read", "export", "settle"]],
	];
	for (const [role, name, isActive, actions] of roles) {
		await admin.query(
			`insert into custom_role (id, organization_id, name, is_active, base_tier, created_by, updated_at)
			 values ($1, 't748-org', $2, $3, 'employee', 't748-owner', now())`,
			[ids[role], name, isActive],
		);
		for (const action of actions) {
			await admin.query(
				`insert into custom_role_permission (custom_role_id, action, subject)
				 values ($1, $2, 'TravelExpenseFinance')`,
				[ids[role], action],
			);
		}
	}
	// The read role also grants an unrelated permission, which stays.
	await admin.query(
		`insert into custom_role_permission (custom_role_id, action, subject)
		 values ($1, 'read', 'Report')`,
		[ids.readRole],
	);
}

async function assign(person: Person, role: Role, assignedBy: Person = "owner") {
	await admin.query(
		`insert into employee_custom_role (employee_id, custom_role_id, assigned_by)
		 values ($1, $2, $3)`,
		[ids[person], ids[role], `t748-${assignedBy}`],
	);
}

async function existingGrant(
	grantId: string,
	officer: Person,
	values: { scope: "all" | "specific"; canExport: boolean; canRecordReimbursements: boolean },
) {
	await admin.query(
		`insert into expense_officer_grant
		   (id, organization_id, officer_employee_id, scope, can_export, can_record_reimbursements, created_by, updated_by)
		 values ($1, 't748-org', $2, $3, $4, $5, 't748-owner', 't748-owner')`,
		[grantId, ids[officer], values.scope, values.canExport, values.canRecordReimbursements],
	);
}

/** Runs the migration and returns the warnings it raised. */
async function migrate(): Promise<string[]> {
	const warnings: string[] = [];
	const client = await admin.connect();
	const listener = (notice: { message?: string }) => warnings.push(notice.message ?? "");
	client.on("notice", listener);
	try {
		await client.query("begin");
		for (const statement of statements) await client.query(statement);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.off("notice", listener);
		client.release();
	}
	return warnings;
}

async function grants() {
	const { rows } = await admin.query<{
		officer: string;
		scope: string;
		canExport: boolean;
		canRecordReimbursements: boolean;
		isActive: boolean;
		updatedBy: string | null;
	}>(
		`select officer_employee_id as officer, scope, can_export as "canExport",
		        can_record_reimbursements as "canRecordReimbursements", is_active as "isActive",
		        updated_by as "updatedBy"
		 from expense_officer_grant where organization_id in ('t748-org', 't748-foreign')
		 order by officer_employee_id, created_at`,
	);
	return rows;
}

async function audits() {
	const { rows } = await admin.query<{
		officer: string;
		action: string;
		performedBy: string;
		changes: string;
		metadata: string | null;
	}>(
		`select employee_id as officer, action, performed_by as "performedBy", changes, metadata
		 from audit_log where organization_id = 't748-org' and entity_type = 'expense_officer_grant'
		 order by employee_id, timestamp`,
	);
	return rows.map((row) => ({
		...row,
		changes: JSON.parse(row.changes),
		metadata: row.metadata && JSON.parse(row.metadata),
	}));
}

async function financePermissions() {
	const { rows } = await admin.query<{ role: string; action: string; subject: string }>(
		`select custom_role_id as role, action, subject from custom_role_permission
		 where custom_role_id = any($1::uuid[]) order by custom_role_id, action`,
		[[ids.readRole, ids.exportRole, ids.settleRole, ids.inactiveRole]],
	);
	return rows;
}

const allScope = (canExport: boolean, canRecordReimbursements: boolean) => ({
	scope: "all",
	teamIds: [],
	employeeIds: [],
	canExport,
	canRecordReimbursements,
});

describe("migration 0138: TravelExpenseFinance custom roles become expense officer grants (#748)", () => {
	beforeEach(seed);
	afterAll(cleanup);

	it("gives every holder an all-scope grant with the capabilities their roles granted", async () => {
		await assign("reader", "readRole");
		await assign("officer", "readRole", "reader");
		await assign("officer", "exportRole");
		await assign("officer", "settleRole");

		await migrate();

		expect(await grants()).toEqual([
			{
				officer: ids.reader,
				scope: "all",
				canExport: false,
				canRecordReimbursements: false,
				isActive: true,
				updatedBy: "t748-owner",
			},
			{
				officer: ids.officer,
				scope: "all",
				canExport: true,
				canRecordReimbursements: true,
				isActive: true,
				// The earliest assignment's author.
				updatedBy: "t748-reader",
			},
		]);
		expect(await audits()).toEqual([
			{
				officer: ids.reader,
				action: "expense_officer.grant_created",
				performedBy: "t748-owner",
				changes: { from: null, to: allScope(false, false) },
				metadata: { migration: "0138", customRoleIds: [ids.readRole] },
			},
			{
				officer: ids.officer,
				action: "expense_officer.grant_created",
				performedBy: "t748-reader",
				changes: { from: null, to: allScope(true, true) },
				metadata: {
					migration: "0138",
					customRoleIds: [ids.readRole, ids.exportRole, ids.settleRole],
				},
			},
		]);
	});

	it("merges the capabilities into an existing grant and widens it to all employees", async () => {
		await existingGrant(ids.mergedGrant, "merged", {
			scope: "specific",
			canExport: true,
			canRecordReimbursements: false,
		});
		await admin.query(
			`insert into expense_officer_team (organization_id, grant_id, team_id, created_by)
			 values ('t748-org', $1, $2, 't748-owner')`,
			[ids.mergedGrant, ids.team],
		);
		await admin.query(
			`insert into expense_officer_employee (organization_id, grant_id, employee_id, created_by)
			 values ('t748-org', $1, $2, 't748-owner')`,
			[ids.mergedGrant, ids.leaver],
		);
		await assign("merged", "settleRole");

		await migrate();

		const { rows } = await admin.query<{ id: string }>(
			"select id from expense_officer_grant where officer_employee_id = $1",
			[ids.merged],
		);
		expect(rows).toEqual([{ id: ids.mergedGrant }]);
		expect(await grants()).toEqual([
			expect.objectContaining({
				officer: ids.merged,
				scope: "all",
				canExport: true,
				canRecordReimbursements: true,
				isActive: true,
			}),
		]);
		const scopeRows = await admin.query(
			`select 1 from expense_officer_team where grant_id = $1
			 union all select 1 from expense_officer_employee where grant_id = $1`,
			[ids.mergedGrant],
		);
		expect(scopeRows.rowCount).toBe(0);
		expect(await audits()).toEqual([
			{
				officer: ids.merged,
				action: "expense_officer.grant_changed",
				performedBy: "t748-owner",
				changes: {
					from: {
						scope: "specific",
						teamIds: [ids.team],
						employeeIds: [ids.leaver],
						canExport: true,
						canRecordReimbursements: false,
					},
					to: allScope(true, true),
				},
				metadata: { migration: "0138", customRoleIds: [ids.settleRole] },
			},
		]);
	});

	it("leaves a grant that already covers the role untouched", async () => {
		await existingGrant(ids.settledGrant, "settled", {
			scope: "all",
			canExport: true,
			canRecordReimbursements: true,
		});
		await assign("settled", "exportRole");

		await migrate();

		expect(await grants()).toEqual([
			expect.objectContaining({ officer: ids.settled, scope: "all", canExport: true }),
		]);
		expect(await audits()).toEqual([]);
	});

	it("logs holders without an active employee record in the organization and skips them", async () => {
		// The foreigner's employee record belongs to another organization.
		await assign("foreigner", "readRole");
		await assign("leaver", "exportRole");

		const warnings = await migrate();

		expect(await grants()).toEqual([]);
		expect(warnings).toEqual([
			expect.stringContaining(ids.leaver),
			expect.stringContaining(ids.foreigner),
		]);
		expect(warnings[1]).toContain("t748-org");
	});

	it("ignores inactive roles and deletes every stored finance permission", async () => {
		await assign("dormant", "inactiveRole");
		await assign("reader", "readRole");

		await migrate();

		expect((await grants()).map((grant) => grant.officer)).toEqual([ids.reader]);
		expect(await financePermissions()).toEqual([
			{ role: ids.readRole, action: "read", subject: "Report" },
		]);
		const assignments = await admin.query(
			"select 1 from employee_custom_role where custom_role_id = any($1::uuid[])",
			[[ids.readRole, ids.inactiveRole]],
		);
		expect(assignments.rowCount).toBe(2);
	});

	it("is a no-op when run again", async () => {
		await assign("officer", "exportRole");
		await migrate();
		const before = { grants: await grants(), audits: await audits() };

		expect(await migrate()).toEqual([]);

		expect({ grants: await grants(), audits: await audits() }).toEqual(before);
	});
});
