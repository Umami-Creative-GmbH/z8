import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration0004 = readFileSync(
	new URL("../../../drizzle/0004_hard_bill_hollister.sql", import.meta.url),
	"utf8",
);
const migration0008 = readFileSync(
	new URL("../../../drizzle/0008_demo_data_feature_flag.sql", import.meta.url),
	"utf8",
);
const migration0014 = readFileSync(
	new URL("../../../drizzle/0014_team_membership_primary_manager.sql", import.meta.url),
	"utf8",
);
const migration0019 = readFileSync(
	new URL("../../../drizzle/0019_regular_sandman.sql", import.meta.url),
	"utf8",
);
const migration0003SnapshotUrl = new URL(
	"../../../drizzle/meta/0003_snapshot.json",
	import.meta.url,
);
const migration0020Url = new URL(
	"../../../drizzle/0020_drop_organization_fiscal_year.sql",
	import.meta.url,
);
const migration0026Url = new URL(
	"../../../drizzle/0026_remove_employee_manager_id.sql",
	import.meta.url,
);
const migration0026SnapshotUrl = new URL(
	"../../../drizzle/meta/0026_snapshot.json",
	import.meta.url,
);
const migration0030SnapshotUrl = new URL(
	"../../../drizzle/meta/0030_snapshot.json",
	import.meta.url,
);
const migrationJournal = JSON.parse(
	readFileSync(new URL("../../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: Array<{ tag: string; when: number }> };
const migration0008Snapshot = JSON.parse(
	readFileSync(new URL("../../../drizzle/meta/0008_snapshot.json", import.meta.url), "utf8"),
) as { tables: { "public.organization": { columns: Record<string, { default?: boolean }> } } };
const migration0032 = readFileSync(
	new URL("../../../drizzle/0032_works_council_feature_flag.sql", import.meta.url),
	"utf8",
);
const migration0032Snapshot = JSON.parse(
	readFileSync(new URL("../../../drizzle/meta/0032_snapshot.json", import.meta.url), "utf8"),
) as { tables: { "public.organization": { columns: Record<string, { default?: boolean }> } } };
const migration0035Url = new URL(
	"../../../drizzle/0035_approval_request_metadata_recovery.sql",
	import.meta.url,
);
const migration0036Url = new URL(
	"../../../drizzle/0036_time_entry_timezone_capture.sql",
	import.meta.url,
);
const migration0036SnapshotUrl = new URL(
	"../../../drizzle/meta/0036_snapshot.json",
	import.meta.url,
);
const migration0037Url = new URL(
	"../../../drizzle/0037_holiday_category_assignment.sql",
	import.meta.url,
);
const migration0038SnapshotUrl = new URL(
	"../../../drizzle/meta/0038_snapshot.json",
	import.meta.url,
);
const drizzleDirUrl = new URL("../../../drizzle/", import.meta.url);
const migration0048Url = new URL(
	"../../../drizzle/0048_payroll_access_scope.sql",
	import.meta.url,
);

const migration0004Statements = migration0004
	.split("--> statement-breakpoint")
	.map((statement) => statement.trim())
	.filter(Boolean);

describe("drizzle follow-up migrations", () => {
	it("keeps 0004 limited to the follow-up auth alters", () => {
		expect(migration0004Statements).toEqual([
			'ALTER TABLE "sso_provider" ALTER COLUMN "user_id" SET NOT NULL;',
			'ALTER TABLE "two_factor" ADD COLUMN "verified" boolean DEFAULT true;',
		]);
	});

	it("registers the demo data feature flag migration", () => {
		expect(
			migrationJournal.entries.some((entry) => entry.tag === "0008_demo_data_feature_flag"),
		).toBe(true);
		expect(migration0008).toContain('ADD COLUMN "demo_data_enabled" boolean DEFAULT true');
		expect(
			migration0008Snapshot.tables["public.organization"].columns.demo_data_enabled?.default,
		).toBe(true);
	});

	it("registers the works council feature flag migration", () => {
		expect(
			migrationJournal.entries.some((entry) => entry.tag === "0032_works_council_feature_flag"),
		).toBe(true);
		expect(migration0032).toContain('ADD COLUMN "works_council_enabled" boolean DEFAULT false');
		expect(
			migration0032Snapshot.tables["public.organization"].columns.works_council_enabled?.default,
		).toBe(false);
	});

	it("creates composite uniqueness before migration 0014 composite foreign keys", () => {
		const employeeUniquePosition = migration0014.indexOf(
			'ADD CONSTRAINT "employee_id_organizationId_idx" UNIQUE("id","organization_id")',
		);
		const teamUniquePosition = migration0014.indexOf(
			'ADD CONSTRAINT "team_id_organizationId_idx" UNIQUE("id","organization_id")',
		);
		const teamPrimaryManagerFkPosition = migration0014.indexOf(
			'ADD CONSTRAINT "team_primary_manager_id_organization_id_employee_id_organization_id_fk"',
		);
		const teamMembershipTeamFkPosition = migration0014.indexOf(
			'ADD CONSTRAINT "team_membership_team_id_organization_id_team_id_organization_id_fk"',
		);

		expect(employeeUniquePosition).toBeGreaterThanOrEqual(0);
		expect(teamUniquePosition).toBeGreaterThanOrEqual(0);
		expect(employeeUniquePosition).toBeLessThan(teamPrimaryManagerFkPosition);
		expect(teamUniquePosition).toBeLessThan(teamMembershipTeamFkPosition);
	});

	it("registers the organization fiscal year start migration", () => {
		expect(migrationJournal.entries.some((entry) => entry.tag === "0019_regular_sandman")).toBe(
			true,
		);
		expect(migration0019.trim()).toBe(
			'ALTER TABLE "organization" ADD COLUMN "fiscal_year_start_month" integer DEFAULT 1;',
		);
	});

	it("registers the fiscal year start column drop migration", () => {
		expect(
			migrationJournal.entries.some((entry) => entry.tag === "0020_drop_organization_fiscal_year"),
		).toBe(true);
		expect(existsSync(migration0020Url)).toBe(true);

		const migration0020 = readFileSync(migration0020Url, "utf8");

		expect(migration0020.trim()).toBe(
			'ALTER TABLE "organization" DROP COLUMN "fiscal_year_start_month";',
		);
	});

	it("registers the employee manager_id removal migration", () => {
		expect(
			migrationJournal.entries.some((entry) => entry.tag === "0026_remove_employee_manager_id"),
		).toBe(true);
		expect(existsSync(migration0026Url)).toBe(true);

		const migration0026 = readFileSync(migration0026Url, "utf8");
		const guardPosition = migration0026.indexOf("DO $$");
		const insertPosition = migration0026.indexOf('INSERT INTO "employee_managers"');
		const duplicateGuardPosition = migration0026.indexOf(
			"Duplicate employee manager assignments must be resolved before removing employee.manager_id",
		);
		const existingCrossOrganizationGuardPosition = migration0026.indexOf(
			"Cross-organization employee manager assignments must be resolved before removing employee.manager_id",
		);
		const primaryUpdatePosition = migration0026.indexOf(
			'UPDATE "employee_managers" AS "existing_assignment"',
		);
		const uniqueIndexPosition = migration0026.indexOf(
			'CREATE UNIQUE INDEX "employeeManagers_unique_idx"',
		);

		expect(guardPosition).toBeGreaterThanOrEqual(0);
		expect(guardPosition).toBeLessThan(insertPosition);
		expect(duplicateGuardPosition).toBeGreaterThanOrEqual(0);
		expect(duplicateGuardPosition).toBeLessThan(primaryUpdatePosition);
		expect(duplicateGuardPosition).toBeLessThan(uniqueIndexPosition);
		expect(existingCrossOrganizationGuardPosition).toBeGreaterThanOrEqual(0);
		expect(existingCrossOrganizationGuardPosition).toBeLessThan(insertPosition);
		expect(existingCrossOrganizationGuardPosition).toBeLessThan(primaryUpdatePosition);
		expect(existingCrossOrganizationGuardPosition).toBeLessThan(uniqueIndexPosition);
		expect(migration0026).toContain("RAISE EXCEPTION");
		expect(migration0026).toContain('GROUP BY "employee_id", "manager_id"');
		expect(migration0026).toContain("HAVING count(*) > 1");
		expect(migration0026).toContain('FROM "employee_managers" AS "em"');
		expect(migration0026).toContain('INNER JOIN "employee" AS "managed"');
		expect(migration0026).toContain('INNER JOIN "employee" AS "manager"');
		expect(migration0026).toContain('"managed"."organization_id" <> "manager"."organization_id"');
		expect(migration0026).toContain('"manager"."organization_id" = "e"."organization_id"');
		expect(migration0026).toContain('"manager"."id" IS NULL');
		expect(migration0026).toContain('"assigned_user"."id" IS NULL');
		expect(migration0026).toContain('UPDATE "employee_managers" AS "existing_assignment"');
		expect(migration0026).toContain('SET "is_primary" = true');
		expect(migration0026).toContain('"existing_assignment"."is_primary" = false');
		expect(migration0026).toContain('DROP INDEX IF EXISTS "employeeManagers_unique_idx";');
		expect(migration0026).toContain(
			'CREATE UNIQUE INDEX "employeeManagers_unique_idx" ON "employee_managers" USING btree ("employee_id","manager_id");',
		);
		expect(migration0026).toContain('INSERT INTO "employee_managers"');
		expect(migration0026).toContain('FROM "employee" AS "e"');
		expect(migration0026).toContain('"e"."manager_id" IS NOT NULL');
		expect(migration0026).toContain("NOT EXISTS (");
		expect(migration0026).toContain('"existing_primary"."is_primary" = true');
		expect(migration0026).toContain('"e"."user_id"');
		expect(migration0026).toContain('DROP INDEX IF EXISTS "employee_managerId_idx";');
		expect(migration0026).toContain('ALTER TABLE "employee" DROP COLUMN "manager_id";');
	});

	it("keeps manual follow-up migrations journal-only when no snapshot was generated", () => {
		// Some existing hand-authored follow-up migrations are journaled without a snapshot.
		expect(existsSync(migration0003SnapshotUrl)).toBe(false);
		expect(existsSync(migration0026SnapshotUrl)).toBe(false);
	});

	it("includes snapshot metadata for the platform system email template migration", () => {
		expect(
			migrationJournal.entries.some((entry) => entry.tag === "0030_platform_system_email_template"),
		).toBe(true);
		expect(existsSync(migration0030SnapshotUrl)).toBe(true);

		const snapshot = JSON.parse(readFileSync(migration0030SnapshotUrl, "utf8")) as {
			tables: Record<string, { columns: Record<string, unknown> }>;
		};

		expect(snapshot.tables["public.platform_system_email_template"]?.columns).toEqual(
			expect.objectContaining({
				template_key: expect.objectContaining({ type: "text", notNull: true }),
				editor_document: expect.objectContaining({ type: "jsonb", notNull: true }),
			}),
		);
	});

	it("registers a later idempotent approval request metadata recovery migration", () => {
		const recoveryIndex = migrationJournal.entries.findIndex(
			(entry) => entry.tag === "0035_approval_request_metadata_recovery",
		);
		const recoveryEntry = migrationJournal.entries[recoveryIndex];
		const latestPriorWhen = Math.max(
			...migrationJournal.entries.slice(0, recoveryIndex).map((entry) => entry.when),
		);

		expect(recoveryIndex).toBeGreaterThanOrEqual(0);
		expect(recoveryEntry?.when).toBeGreaterThan(latestPriorWhen);
		expect(existsSync(migration0035Url)).toBe(true);

		const migration0035 = readFileSync(migration0035Url, "utf8");

		expect(migration0035).toContain('ADD COLUMN IF NOT EXISTS "metadata" jsonb');
		expect(migration0035).toContain(
			'CREATE UNIQUE INDEX IF NOT EXISTS "approvalRequest_pending_entity_unique_idx"',
		);
	});

	it("registers the time entry timezone capture migration after approval metadata recovery", () => {
		const recoveryIndex = migrationJournal.entries.findIndex(
			(entry) => entry.tag === "0035_approval_request_metadata_recovery",
		);
		const timezoneCaptureIndex = migrationJournal.entries.findIndex(
			(entry) => entry.tag === "0036_time_entry_timezone_capture",
		);

		expect(recoveryIndex).toBeGreaterThanOrEqual(0);
		expect(timezoneCaptureIndex).toBeGreaterThan(recoveryIndex);
	});

	it("backfills time entry timezone capture columns without overwriting existing values", () => {
		expect(existsSync(migration0036Url)).toBe(true);

		const migration0036 = readFileSync(migration0036Url, "utf8");

		expect(migration0036).toContain('ADD COLUMN IF NOT EXISTS "utc_offset_minutes" integer');
		expect(migration0036).toContain('ADD COLUMN IF NOT EXISTS "timezone" text');
		expect(migration0036).toContain('ADD COLUMN IF NOT EXISTS "timezone_source" text');
		expect(migration0036).toContain('"utc_offset_minutes" = COALESCE("utc_offset_minutes", 120)');
		expect(migration0036).toContain('"timezone" = COALESCE("timezone", \'Europe/Berlin\')');
		expect(migration0036).toContain(
			'"timezone_source" = COALESCE("timezone_source", \'backfill\')',
		);
		expect(migration0036).toContain(
			'WHERE "utc_offset_minutes" IS NULL OR "timezone" IS NULL OR "timezone_source" IS NULL;',
		);
	});

	it("snapshots the time entry timezone capture columns", () => {
		expect(existsSync(migration0036SnapshotUrl)).toBe(true);

		const snapshot = JSON.parse(readFileSync(migration0036SnapshotUrl, "utf8")) as {
			tables: Record<string, { columns: Record<string, unknown> }>;
		};

		expect(snapshot.tables["public.time_entry"]?.columns).toEqual(
			expect.objectContaining({
				utc_offset_minutes: expect.objectContaining({ type: "integer", notNull: true }),
				timezone: expect.objectContaining({ type: "text", notNull: false }),
				timezone_source: expect.objectContaining({ type: "text", notNull: true }),
			}),
		);
	});
	it("uses the holiday category primary key for category assignment foreign keys", () => {
		expect(existsSync(migration0037Url)).toBe(true);

		const migration0037 = readFileSync(migration0037Url, "utf8");

		expect(migration0037).toContain(
			'FOREIGN KEY ("category_id") REFERENCES "public"."holiday_category"("id")',
		);
		expect(migration0037).not.toContain(
			'FOREIGN KEY ("category_id", "organization_id") REFERENCES "public"."holiday_category"("id", "organization_id")',
		);
	});

	it("snapshots work policy preset ownership and partial unique indexes", () => {
		expect(
			migrationJournal.entries.some((entry) => entry.tag === "0038_work_policy_preset_ownership"),
		).toBe(true);
		expect(existsSync(migration0038SnapshotUrl)).toBe(true);

		const snapshot = JSON.parse(readFileSync(migration0038SnapshotUrl, "utf8")) as {
			tables: Record<
				string,
				{
					columns: Record<string, unknown>;
					indexes: Record<string, { isUnique?: boolean; where?: string }>;
				}
			>;
		};
		const presetTable = snapshot.tables["public.work_policy_preset"];

		expect(presetTable?.columns).toEqual(
			expect.objectContaining({
				organization_id: expect.objectContaining({ type: "text", notNull: false }),
			}),
		);
		expect(presetTable?.indexes.workPolicyPreset_system_name_idx).toEqual(
			expect.objectContaining({ isUnique: true, where: '"organization_id" IS NULL' }),
		);
		expect(presetTable?.indexes.workPolicyPreset_org_name_idx).toEqual(
			expect.objectContaining({ isUnique: true, where: '"organization_id" IS NOT NULL' }),
		);
	});

	it("keeps the 0048 payroll access scope migration unique and idempotent", () => {
		const migration0048Files = readdirSync(drizzleDirUrl).filter((fileName) =>
			fileName.startsWith("0048_"),
		);
		const migration0048Entries = migrationJournal.entries.filter((entry) =>
			entry.tag.startsWith("0048_"),
		);

		expect(migration0048Files).toEqual(["0048_payroll_access_scope.sql"]);
		expect(migration0048Entries.map((entry) => entry.tag)).toEqual([
			"0048_payroll_access_scope",
		]);
		expect(existsSync(migration0048Url)).toBe(true);

		const migration0048 = readFileSync(migration0048Url, "utf8");

		expect(migration0048).toContain('ADD COLUMN IF NOT EXISTS "scope" text');
		expect(migration0048).toContain('ADD CONSTRAINT "payroll_access_grant_scope_check"');
		expect(migration0048).toContain("WHEN duplicate_object THEN null");
		expect(migration0048).not.toContain("CREATE TABLE");
		expect(migration0048).not.toContain("ALTER TYPE");
	});
});
