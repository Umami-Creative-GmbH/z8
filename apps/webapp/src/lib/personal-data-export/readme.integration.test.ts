/**
 * #1172: the README's Art. 15 sections against a disposable PostgreSQL
 * database: the real owners, admins, managers and covering officers, the
 * organization's retention periods, the rights section, the employee-only
 * "complete copy" note, the field explanations, and that the employee
 * export's README never changes with the employee's withheld data.
 */

import JSZip from "jszip";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
);
vi.mock("@/lib/storage/export-s3-client", () => ({
	isExportS3Configured: async () => true,
	uploadPrivateObject: async () => ({ bucket: "t1172", versionId: null }),
	deletePrivateObject: async () => {},
	deletePrivateObjectVersions: async () => {},
}));

const { db } = await import("@/db");
const { processPersonalDataExport } = await import("./processor");
const { PERSONAL_DATA_COLLECTORS } = await import("./collectors");
const { findUnexplainedFields, readmeContentsOf } = await import("./readme");

const ORG = "t1172-org";
const OTHER_ORG = "t1172-other";
const NOW = Temporal.Instant.from("2026-10-13T08:00:00Z");

const ids = {
	ada: "11720000-0000-4000-8000-000000000001",
	owner: "11720000-0000-4000-8000-000000000002",
	formerAdmin: "11720000-0000-4000-8000-000000000003",
	manager: "11720000-0000-4000-8000-000000000004",
	teamLead: "11720000-0000-4000-8000-000000000005",
	creator: "11720000-0000-4000-8000-000000000006",
	otherLead: "11720000-0000-4000-8000-000000000007",
	filer: "11720000-0000-4000-8000-000000000008",
	otherFiler: "11720000-0000-4000-8000-000000000009",
	payroll: "11720000-0000-4000-8000-00000000000a",
	expense: "11720000-0000-4000-8000-00000000000b",
	otherOrgAdmin: "11720000-0000-4000-8000-00000000000c",
	teamAda: "11720000-0000-4000-8000-0000000000a1",
	teamOther: "11720000-0000-4000-8000-0000000000a2",
	filerGrant: "11720000-0000-4000-8000-0000000000b1",
	otherFilerGrant: "11720000-0000-4000-8000-0000000000b2",
	payrollGrant: "11720000-0000-4000-8000-0000000000b3",
	hrOnlyDocument: "11720000-0000-4000-8000-0000000000c1",
	adminField: "11720000-0000-4000-8000-0000000000d1",
} as const;

const admin = integrationAdminPool();

async function cleanup() {
	for (const org of [ORG, OTHER_ORG]) {
		await admin.query("delete from audit_log where organization_id = $1", [org]);
		await admin.query("delete from organization where id = $1", [org]);
		await admin.query("delete from personal_data_export_file_cleanup where organization_id = $1", [
			org,
		]);
	}
	await admin.query('delete from "user" where id like $1', ["t1172-%"]);
}

async function seedPerson(
	name: string,
	displayName: string,
	input: { employeeId?: string; role?: string; organizationId?: string; isActive?: boolean } = {},
) {
	const organizationId = input.organizationId ?? ORG;
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[`t1172-${name}`, displayName, `t1172-${name}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t1172-member-${name}`, organizationId, `t1172-${name}`, input.role ?? "member"],
	);
	if (input.employeeId) {
		await admin.query(
			`insert into employee (id,user_id,organization_id,role,is_active,updated_at)
			 values ($1,$2,$3,'employee',$4,now())`,
			[input.employeeId, `t1172-${name}`, organizationId, input.isActive ?? true],
		);
	}
}

/** Runs one export of Ada at a fixed time and returns its README. */
async function adaReadme(kind: "employee" | "admin"): Promise<string> {
	const { rows } = await admin.query<{ id: string }>(
		`insert into personal_data_export (organization_id, employee_id, kind, requested_by_user_id, status, expires_at)
		 values ($1, $2, $3, $4, 'pending', now() + interval '7 days') returning id`,
		[ORG, ids.ada, kind, kind === "admin" ? "t1172-owner" : "t1172-ada"],
	);
	const exportId = rows[0]?.id as string;
	let zip: Uint8Array | null = null;
	const outcome = await processPersonalDataExport(
		db,
		{ organizationId: ORG, exportId },
		{
			now: () => NOW,
			upload: async (_organizationId, _key, data) => {
				zip = data as Uint8Array;
				return { bucket: "t1172", versionId: null };
			},
			notify: async () => undefined,
		},
	);
	expect(outcome).toEqual({ status: "completed" });
	await admin.query("delete from personal_data_export where id = $1", [exportId]);
	const archive = await JSZip.loadAsync(zip as unknown as Uint8Array);
	return (await archive.file("README.txt")?.async("string")) as string;
}

describe("personal data export README sections (#1172)", () => {
	beforeAll(async () => {
		await cleanup();
		for (const organizationId of [ORG, OTHER_ORG]) {
			await admin.query(
				`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
				 values ($1, $2, $1, 'Europe/Berlin', true, now())`,
				[organizationId, organizationId === ORG ? "Acme GmbH" : "Other AG"],
			);
		}
		await seedPerson("ada", "Ada Lovelace", { employeeId: ids.ada });
		await seedPerson("owner", "Olga Owner", { employeeId: ids.owner, role: "owner" });
		await seedPerson("admin", "Adam Admin", { role: "admin" });
		await seedPerson("former-admin", "Fiona Former", {
			employeeId: ids.formerAdmin,
			role: "admin",
			isActive: false,
		});
		await seedPerson("manager", "Max Manager", { employeeId: ids.manager });
		await seedPerson("team-lead", "Tina Teamlead", { employeeId: ids.teamLead });
		await seedPerson("creator", "Carl Creator", { employeeId: ids.creator });
		await seedPerson("other-lead", "Otto Otherlead", { employeeId: ids.otherLead });
		await seedPerson("filer", "Petra Personnel", { employeeId: ids.filer });
		await seedPerson("other-filer", "Quinn Otherfiler", { employeeId: ids.otherFiler });
		await seedPerson("payroll", "Paul Payroll", { employeeId: ids.payroll });
		await seedPerson("expense", "Erik Expense", { employeeId: ids.expense });
		await seedPerson("other-org-admin", "Xena Elsewhere", {
			employeeId: ids.otherOrgAdmin,
			role: "admin",
			organizationId: OTHER_ORG,
		});

		await admin.query(
			`insert into team (id, organization_id, name, updated_at) values
			   ($1, $3, 'Platform', now()), ($2, $3, 'Other team', now())`,
			[ids.teamAda, ids.teamOther, ORG],
		);
		await admin.query("update employee set team_id = $1 where id = $2", [ids.teamAda, ids.ada]);
		await admin.query(
			"insert into employee_managers (employee_id, manager_id, is_primary, assigned_by) values ($1, $2, true, 't1172-owner')",
			[ids.ada, ids.manager],
		);
		// Team permissions: on Ada's team, create-only org-wide, and on another team.
		await admin.query(
			`insert into team_permissions (employee_id, organization_id, team_id, can_create_teams,
			   can_approve_team_requests, granted_by, updated_at) values
			   ($1, $4, $5, false, true, $7, now()),
			   ($2, $4, null, true, false, $7, now()),
			   ($3, $4, $6, false, true, $7, now())`,
			[ids.teamLead, ids.creator, ids.otherLead, ORG, ids.teamAda, ids.teamOther, ids.owner],
		);
		// Personnel file officers: one for Ada's team, one for another team.
		await admin.query(
			`insert into personnel_file_officer_grant (id, organization_id, officer_employee_id, scope, categories, created_by) values
			   ($1, $3, $4, 'specific', '{contract,payslip}', 't1172-owner'),
			   ($2, $3, $5, 'specific', '{contract}', 't1172-owner')`,
			[ids.filerGrant, ids.otherFilerGrant, ORG, ids.filer, ids.otherFiler],
		);
		await admin.query(
			`insert into personnel_file_officer_team (organization_id, grant_id, team_id, created_by) values
			   ($1, $2, $4, 't1172-owner'), ($1, $3, $5, 't1172-owner')`,
			[ORG, ids.filerGrant, ids.otherFilerGrant, ids.teamAda, ids.teamOther],
		);
		// Payroll access naming Ada, and an expense officer for everyone.
		await admin.query(
			`insert into payroll_access_grant (id, organization_id, payroll_employee_id, scope, created_by, updated_at)
			 values ($1, $2, $3, 'specific', 't1172-owner', now())`,
			[ids.payrollGrant, ORG, ids.payroll],
		);
		await admin.query(
			`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
			 values ($1, $2, $3, 't1172-owner')`,
			[ORG, ids.payrollGrant, ids.ada],
		);
		await admin.query(
			`insert into expense_officer_grant (organization_id, officer_employee_id, scope, can_export, can_record_reimbursements, created_by)
			 values ($1, $2, 'all', true, false, 't1172-owner')`,
			[ORG, ids.expense],
		);
		await admin.query(
			`insert into personnel_file_retention_period (organization_id, category, retention_years) values
			   ($1, 'contract', 10), ($1, 'payslip', 6)`,
			[ORG],
		);
	});

	afterAll(async () => {
		await cleanup();
	});

	it("lists the real people with access, with each grant's coverage, and the retention periods", async () => {
		const readme = await adaReadme("employee");

		for (const listed of [
			"Olga Owner (owner)",
			"Adam Admin (administrator)",
			"Max Manager (your manager)",
			"Tina Teamlead (team permissions for your team)",
			"Petra Personnel: Contracts, Payslips",
			"Paul Payroll",
			"Erik Expense: read approved reports, export them",
		]) {
			expect(readme, listed).toContain(listed);
		}
		for (const absent of [
			"Ada Lovelace (",
			"Fiona Former",
			"Carl Creator",
			"Otto Otherlead",
			"Quinn Otherfiler",
			"Xena Elsewhere",
		]) {
			expect(readme, absent).not.toContain(absent);
		}

		expect(readme).toContain("Contracts: 10 years");
		expect(readme).toContain("Payslips: 6 years");
		expect(readme).toContain("Certificates: no retention period set");
		expect(readme).toContain("Audit log entries are deleted after 365 days.");
		expect(readme).toContain("(Art. 21 GDPR)");
		expect(readme).toContain("supervisory authority");
		expect(readme).toContain("You can ask the administrators of Acme GmbH for a complete copy");
		expect(readme).toContain(
			"employment.json > employment_terms (employment/employment_terms.csv)",
		);
		expect(readme).toContain("  - hourly_rate: Your hourly wage under these terms.");
	});

	it("leaves the complete-copy note out of the admin export, which explains its withheld parts", async () => {
		const readme = await adaReadme("admin");

		expect(readme).not.toContain("complete copy");
		expect(readme).toContain("Olga Owner (owner)");
		expect(readme).toContain("employment.json > billable_rates");
	});

	it("still lists the payroll access covering a former employee", async () => {
		await admin.query("update employee set is_active = false where id = $1", [ids.ada]);
		try {
			expect(await adaReadme("admin")).toContain("  - Paul Payroll");
		} finally {
			await admin.query("update employee set is_active = true where id = $1", [ids.ada]);
		}
	});

	it("never reveals whether withheld data exists in the employee export", async () => {
		const before = await adaReadme("employee");

		await admin.query(
			`insert into employee_document (id, organization_id, employee_id, category, title, document_date,
			   visibility, storage_provider, storage_key, file_name, mime_type, size_bytes, checksum_sha256)
			 values ($1, $2, $3, 'other', 'Warning letter', '2026-09-01', 'hr_only', 's3-private',
			   't1172/warning.pdf', 'warning.pdf', 'application/pdf', 10, 'sha')`,
			[ids.hrOnlyDocument, ORG, ids.ada],
		);
		await admin.query(
			`insert into billable_rate (organization_id, level, employee_id, hourly_rate, effective_from, created_by)
			 values ($1, 'employee', $2, '187.50', '2026-01-01', 't1172-owner')`,
			[ORG, ids.ada],
		);
		await admin.query(
			`insert into custom_field_definition (id, organization_id, entity, name, type, visibility, edit_level, position)
			 values ($1, $2, 'employee', 'Salary band', 'text', 'admin', 'admin', 1)`,
			[ids.adminField, ORG],
		);
		await admin.query(
			`insert into custom_field_value (organization_id, definition_id, employee_id, text_value)
			 values ($1, $2, $3, 'Band 7')`,
			[ORG, ids.adminField, ids.ada],
		);

		const after = await adaReadme("employee");
		expect(after).toBe(before);
		for (const withheld of ["Warning letter", "hr_only", "billable", "Salary band", "Band 7"]) {
			expect(after, withheld).not.toContain(withheld);
		}
	});

	it("explains every field of every part a collector with a field guide writes", async () => {
		for (const kind of ["employee", "admin"] as const) {
			const scope = { organizationId: ORG, employeeId: ids.ada, userId: "t1172-ada", kind };
			const categories = await Promise.all(
				PERSONAL_DATA_COLLECTORS.map((collector) => collector.collect(db, scope)),
			);
			const contents = readmeContentsOf(categories, PERSONAL_DATA_COLLECTORS);
			expect(contents.employment?.guide, kind).toBeDefined();
			expect(contents.account?.guide, kind).toBeDefined();
			const guided = Object.fromEntries(
				Object.entries(contents).filter(([, entry]) => entry?.guide !== undefined),
			);
			expect(findUnexplainedFields(guided), kind).toEqual([]);
		}
	});
});
