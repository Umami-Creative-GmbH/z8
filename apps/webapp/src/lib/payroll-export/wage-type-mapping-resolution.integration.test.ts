/**
 * #816: wage type mappings against a disposable PostgreSQL database.
 *
 * The Wage Types settings tab used to save every mapping on the DATEV config,
 * while each export read its own config's mappings, so non-DATEV exports never
 * saw them. Mappings now belong to the organization, and each format's export
 * reads only its own code column.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DateTime } from "luxon";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import type { WorkPeriodData } from "./types";

vi.mock("@/lib/storage/export-s3-client", () => ({
	getPresignedUrl: async () => "https://example.test/export",
	uploadExport: async () => undefined,
}));

const { createExportJob } = await import("./export-service");
const { getWageTypeMappings } = await import("./data-fetcher");
const { DatevLohnFormatter } = await import("./formatters/datev-lohn-formatter");
const { LexwareLohnFormatter } = await import("./formatters/lexware-lohn-formatter");

const admin = integrationAdminPool();
const ORG = "twm-org";
const OTHER_ORG = "twm-other";
const USER = "twm-user";
const OTHER_USER = "twm-other-user";
const ids = {
	employee: "e8100000-0000-4000-8000-000000000001",
	otherEmployee: "e8100000-0000-4000-8000-000000000002",
	workCategory: "e8101000-0000-4000-8000-000000000001",
	otherWorkCategory: "e8101000-0000-4000-8000-000000000002",
} as const;

const DATEV_CONFIG = {
	mandantennummer: "12345",
	beraternummer: "1234567",
	personnelNumberType: "employeeNumber",
	includeZeroHours: false,
};
const LEXWARE_CONFIG = {
	personnelNumberType: "employeeNumber" as const,
	includeZeroHours: false,
	includeStunden: true,
	includeStundensatz: false,
};

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [ORG, OTHER_ORG]);
	await admin.query('delete from "user" where id in ($1, $2)', [USER, OTHER_USER]);
}

async function seedOrganization(
	organizationId: string,
	userId: string,
	employeeId: string,
	workCategoryId: string,
) {
	await admin.query(
		"insert into organization (id, name, slug, timezone, created_at) values ($1, $1, $1, 'Europe/Berlin', now())",
		[organizationId],
	);
	await admin.query(
		'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, now(), now())',
		[userId, `${userId}@example.test`],
	);
	await admin.query(
		"insert into employee (id, user_id, organization_id, role, employee_number, updated_at) values ($1, $2, $3, 'admin', 'P-1', now())",
		[employeeId, userId, organizationId],
	);
	await admin.query(
		"insert into work_category (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Night shift', $3, now())",
		[workCategoryId, organizationId, userId],
	);
}

async function configure(organizationId: string, userId: string, formatId: string, config: object) {
	await admin.query(
		`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
		 values ($1, $2, $3::jsonb, $4, now())`,
		[organizationId, formatId, JSON.stringify(config), userId],
	);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into payroll_export_format (id, name, version, updated_at) values
		 ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()),
		 ('lexware_lohn', 'Lexware lohn+gehalt', '2024.1', now())
		 on conflict (id) do nothing`,
	);
	await seedOrganization(ORG, USER, ids.employee, ids.workCategory);
	await seedOrganization(OTHER_ORG, OTHER_USER, ids.otherEmployee, ids.otherWorkCategory);
	// What the Wage Types tab saves: one row per source, with a code per format.
	await admin.query(
		`insert into payroll_wage_type_mapping
		   (organization_id, work_category_id, wage_type_code, datev_wage_type_code, lexware_wage_type_code, created_by, updated_at)
		 values ($1, $2, '1100', '1100', 'LX-NIGHT', $3, now()), ($4, $5, '9900', '9900', 'LX-OTHER', $6, now())`,
		[ORG, ids.workCategory, USER, OTHER_ORG, ids.otherWorkCategory, OTHER_USER],
	);
}

function nightShift(workCategoryId: string): WorkPeriodData {
	return {
		id: `period-${workCategoryId}`,
		employeeId: ids.employee,
		employeeNumber: "P-1",
		firstName: null,
		lastName: null,
		startTime: DateTime.fromISO("2026-04-10T20:00:00Z", { zone: "utc" }),
		endTime: DateTime.fromISO("2026-04-11T04:00:00Z", { zone: "utc" }),
		durationMinutes: 480,
		workCategoryId,
		workCategoryName: "Night shift",
		workCategoryFactor: "1.00",
		projectId: null,
		projectName: null,
	};
}

/** Creates a job the way the export page does and reads mappings as processExportJob does. */
async function mappingsForExport(formatId: string) {
	const { jobId } = await createExportJob({
		organizationId: ORG,
		formatId,
		requestedById: ids.employee,
		filters: {
			dateRange: {
				start: DateTime.fromISO("2026-04-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-04-30", { zone: "utc" }),
			},
		},
	});
	const { rows } = await admin.query(
		"select organization_id from payroll_export_job where id = $1 and organization_id = $2",
		[jobId, ORG],
	);
	return getWageTypeMappings(rows[0].organization_id);
}

describe("wage type mapping resolution", () => {
	beforeEach(seed);
	afterAll(cleanup);

	it("gives a Lexware export the Lexware code saved in the Wage Types tab without a DATEV config", async () => {
		await configure(ORG, USER, "lexware_lohn", LEXWARE_CONFIG);

		const mappings = await mappingsForExport("lexware_lohn");
		const result = new LexwareLohnFormatter().transform(
			[nightShift(ids.workCategory)],
			[],
			mappings,
			LEXWARE_CONFIG,
		);

		expect(mappings.map((mapping) => mapping.lexwareWageTypeCode)).toEqual(["LX-NIGHT"]);
		expect(String(result.content)).toContain(";LX-NIGHT;");
	});

	it("uses each format's own code from one shared mapping row", async () => {
		await configure(ORG, USER, "datev_lohn", DATEV_CONFIG);
		await configure(ORG, USER, "lexware_lohn", LEXWARE_CONFIG);
		const period = nightShift(ids.workCategory);

		const datev = new DatevLohnFormatter().transform(
			[period],
			[],
			await mappingsForExport("datev_lohn"),
			DATEV_CONFIG,
		);
		const lexware = new LexwareLohnFormatter().transform(
			[period],
			[],
			await mappingsForExport("lexware_lohn"),
			LEXWARE_CONFIG,
		);

		expect(String(datev.content)).toContain("1100");
		expect(String(datev.content)).not.toContain("LX-NIGHT");
		expect(String(lexware.content)).toContain(";LX-NIGHT;");
		expect(String(lexware.content)).not.toContain("1100");
	});

	it("never resolves another organization's mappings", async () => {
		await configure(ORG, USER, "lexware_lohn", LEXWARE_CONFIG);

		const mappings = await mappingsForExport("lexware_lohn");

		expect(mappings.map((mapping) => mapping.workCategoryId)).toEqual([ids.workCategory]);
		expect(mappings.some((mapping) => mapping.lexwareWageTypeCode === "LX-OTHER")).toBe(false);
	});
});

describe("0171 payroll_wage_type_mapping_organization migration", () => {
	const SCHEMA = "t816_migration";
	const migration = readFileSync(
		join(process.cwd(), "drizzle/0171_payroll_wage_type_mapping_organization.sql"),
		"utf8",
	);

	beforeEach(seed);
	afterAll(async () => {
		await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	});

	it("moves config-owned mappings to their organization, keeps the DATEV row of a duplicate and fills legacy codes", async () => {
		const client = await admin.connect();
		try {
			await client.query(`drop schema if exists ${SCHEMA} cascade`);
			await client.query(`create schema ${SCHEMA}`);
			await client.query(`set search_path to ${SCHEMA}, public`);
			// The pre-#816 shape, reduced to the columns the migration touches.
			await client.query(`
				create table payroll_export_config (
					id uuid primary key, organization_id text not null, format_id text not null,
					is_active boolean not null default true);
				create table payroll_wage_type_mapping (
					id uuid primary key default gen_random_uuid(),
					config_id uuid not null,
					work_category_id uuid, absence_category_id uuid, special_category text,
					wage_type_code text not null default '', wage_type_name text,
					datev_wage_type_code text, datev_wage_type_name text,
					lexware_wage_type_code text, lexware_wage_type_name text,
					sage_wage_type_code text, sage_wage_type_name text,
					successfactors_time_type_code text, successfactors_time_type_name text,
					is_active boolean not null default true,
					updated_at timestamp not null default now(),
					constraint payroll_wage_type_mapping_config_id_payroll_export_config_id_fk
						foreign key (config_id) references payroll_export_config(id) on delete cascade);
				create index "payrollWageTypeMapping_configId_idx" on payroll_wage_type_mapping (config_id);
				create unique index "payrollWageTypeMapping_config_workCategory_idx"
					on payroll_wage_type_mapping (config_id, work_category_id)
					where work_category_id is not null and is_active = true;
				create unique index "payrollWageTypeMapping_config_absenceCategory_idx"
					on payroll_wage_type_mapping (config_id, absence_category_id)
					where absence_category_id is not null and is_active = true;
				create unique index "payrollWageTypeMapping_config_specialCategory_idx"
					on payroll_wage_type_mapping (config_id, special_category)
					where special_category is not null and is_active = true;
			`);
			await client.query(
				`insert into payroll_export_config (id, organization_id, format_id) values
				 ('c8160000-0000-4000-8000-000000000001', $1, 'datev_lohn'),
				 ('c8160000-0000-4000-8000-000000000002', $1, 'lexware_lohn'),
				 ('c8160000-0000-4000-8000-000000000003', $2, 'datev_lohn')`,
				[ORG, OTHER_ORG],
			);
			await client.query(
				`insert into payroll_wage_type_mapping
				   (id, config_id, work_category_id, special_category, wage_type_code, datev_wage_type_code, lexware_wage_type_code, updated_at)
				 values
				   ('a8160000-0000-4000-8000-000000000001', 'c8160000-0000-4000-8000-000000000001', $1, null, '1100', '1100', 'LX-NIGHT', '2026-01-01'),
				   ('a8160000-0000-4000-8000-000000000002', 'c8160000-0000-4000-8000-000000000002', $1, null, '777', null, '777', '2026-06-01'),
				   ('a8160000-0000-4000-8000-000000000003', 'c8160000-0000-4000-8000-000000000002', null, 'overtime', '300', null, null, '2026-01-01'),
				   ('a8160000-0000-4000-8000-000000000004', 'c8160000-0000-4000-8000-000000000003', $2, null, '9900', '9900', null, '2026-01-01')`,
				[ids.workCategory, ids.otherWorkCategory],
			);

			// Twice: the migration must be safe to re-run.
			for (const pass of [1, 2]) {
				for (const statement of migration.split("--> statement-breakpoint")) {
					await client.query(statement).catch((error: Error) => {
						throw new Error(`pass ${pass}: ${error.message}\n${statement}`);
					});
				}
			}

			const { rows } = await client.query(
				`select id, organization_id, work_category_id, special_category, datev_wage_type_code, lexware_wage_type_code
				 from payroll_wage_type_mapping order by id`,
			);
			expect(rows).toEqual([
				// The DATEV config's row wins the duplicate, although the Lexware row is newer.
				expect.objectContaining({
					id: "a8160000-0000-4000-8000-000000000001",
					organization_id: ORG,
					datev_wage_type_code: "1100",
					lexware_wage_type_code: "LX-NIGHT",
				}),
				// A legacy-only code lands in its owning config's format column.
				expect.objectContaining({
					id: "a8160000-0000-4000-8000-000000000003",
					organization_id: ORG,
					special_category: "overtime",
					datev_wage_type_code: null,
					lexware_wage_type_code: "300",
				}),
				expect.objectContaining({
					id: "a8160000-0000-4000-8000-000000000004",
					organization_id: OTHER_ORG,
					datev_wage_type_code: "9900",
				}),
			]);
			const { rows: columns } = await client.query(
				`select column_name from information_schema.columns
				 where table_schema = $1 and table_name = 'payroll_wage_type_mapping' and column_name = 'config_id'`,
				[SCHEMA],
			);
			expect(columns).toEqual([]);
			await expect(
				client.query(
					`insert into payroll_wage_type_mapping (organization_id, work_category_id) values ($1, $2)`,
					[ORG, ids.workCategory],
				),
			).rejects.toThrow(/payrollWageTypeMapping_org_workCategory_idx/);
		} finally {
			await client.query("set search_path to default").catch(() => undefined);
			client.release();
		}
	});
});
