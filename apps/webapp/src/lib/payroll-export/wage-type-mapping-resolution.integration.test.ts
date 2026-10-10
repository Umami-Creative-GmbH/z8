/**
 * Wage type mappings against a disposable PostgreSQL database.
 *
 * The Wage Types settings tab saves every mapping on the organization's DATEV
 * config (`page.tsx` passes `config = datevConfig`), each row carrying a code per
 * format. An export reads mappings from its own format's config
 * (`getWageTypeMappings(job.configId)`), so a Lexware export never sees the
 * Lexware code an administrator entered (#816).
 */

import { DateTime } from "luxon";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("@/lib/storage/export-s3-client", () => ({
	getPresignedUrl: async () => "https://example.test/export",
	uploadExport: async () => undefined,
}));

const { createExportJob } = await import("./export-service");
const { getWageTypeMappings } = await import("./data-fetcher");
const { LexwareLohnFormatter } = await import("./formatters/lexware-lohn-formatter");

const admin = integrationAdminPool();
const ORG = "twm-org";
const USER = "twm-user";
const ids = {
	employee: "e8100000-0000-4000-8000-000000000001",
	workCategory: "e8101000-0000-4000-8000-000000000001",
} as const;

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id = $1', [USER]);
}

async function seed() {
	await cleanup();
	await admin.query(
		"insert into organization (id, name, slug, timezone, created_at) values ($1, 'Mappings', $1, 'Europe/Berlin', now())",
		[ORG],
	);
	await admin.query(
		'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, now(), now())',
		[USER, `${USER}@example.test`],
	);
	await admin.query(
		"insert into employee (id, user_id, organization_id, role, employee_number, updated_at) values ($1, $2, $3, 'admin', 'P-1', now())",
		[ids.employee, USER, ORG],
	);
	await admin.query(
		`insert into payroll_export_format (id, name, version, updated_at) values
		 ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()),
		 ('lexware_lohn', 'Lexware lohn+gehalt', '2024.1', now())
		 on conflict (id) do nothing`,
	);
	await admin.query(
		`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at) values
		 ($1, 'datev_lohn', '{"mandantennummer":"12345","beraternummer":"1234567","personnelNumberType":"employeeNumber"}'::jsonb, $2, now()),
		 ($1, 'lexware_lohn', '{"personnelNumberType":"employeeNumber","includeZeroHours":false,"includeStunden":true,"includeStundensatz":false}'::jsonb, $2, now())`,
		[ORG, USER],
	);
	await admin.query(
		"insert into work_category (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Night shift', $3, now())",
		[ids.workCategory, ORG, USER],
	);
	// What the Wage Types tab writes: one row on the DATEV config, with a Lexware code.
	await admin.query(
		`insert into payroll_wage_type_mapping
		   (config_id, work_category_id, wage_type_code, datev_wage_type_code, lexware_wage_type_code, created_by, updated_at)
		 select id, $2, '1100', '1100', 'LX-NIGHT', $3, now()
		 from payroll_export_config where organization_id = $1 and format_id = 'datev_lohn'`,
		[ORG, ids.workCategory, USER],
	);
}

describe("wage type mapping resolution", () => {
	beforeEach(seed);
	afterAll(cleanup);

	// #816: fails today because the Lexware job resolves no mappings. Flip to `it` with the fix.
	it.fails("gives a Lexware export the Lexware code saved in the Wage Types tab", async () => {
		const { jobId } = await createExportJob({
			organizationId: ORG,
			formatId: "lexware_lohn",
			requestedById: ids.employee,
			filters: {
				dateRange: {
					start: DateTime.fromISO("2026-04-01", { zone: "utc" }),
					end: DateTime.fromISO("2026-04-30", { zone: "utc" }),
				},
			},
		});
		const { rows } = await admin.query(
			"select config_id from payroll_export_job where id = $1 and organization_id = $2",
			[jobId, ORG],
		);
		// The same read processExportJob runs for this job.
		const mappings = await getWageTypeMappings(rows[0].config_id);

		const result = new LexwareLohnFormatter().transform(
			[
				{
					id: "period-1",
					employeeId: ids.employee,
					employeeNumber: "P-1",
					firstName: null,
					lastName: null,
					startTime: DateTime.fromISO("2026-04-10T20:00:00Z", { zone: "utc" }),
					endTime: DateTime.fromISO("2026-04-11T04:00:00Z", { zone: "utc" }),
					durationMinutes: 480,
					workCategoryId: ids.workCategory,
					workCategoryName: "Night shift",
					workCategoryFactor: "1.00",
					projectId: null,
					projectName: null,
				},
			],
			[],
			mappings,
			{
				personnelNumberType: "employeeNumber",
				includeZeroHours: false,
				includeStunden: true,
				includeStundensatz: false,
			},
		);

		expect(mappings.map((mapping) => mapping.lexwareWageTypeCode)).toEqual(["LX-NIGHT"]);
		expect(String(result.content)).toContain(";LX-NIGHT;");
	});
});
