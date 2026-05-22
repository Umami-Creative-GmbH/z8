import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration0004 = readFileSync(
	new URL("../../../drizzle/0004_hard_bill_hollister.sql", import.meta.url),
	"utf8"
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
const migration0020Url = new URL("../../../drizzle/0020_drop_organization_fiscal_year.sql", import.meta.url);
const migration0026Url = new URL("../../../drizzle/0026_remove_employee_manager_id.sql", import.meta.url);
const migrationJournal = JSON.parse(
	readFileSync(new URL("../../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: Array<{ tag: string }> };
const migration0008Snapshot = JSON.parse(
	readFileSync(new URL("../../../drizzle/meta/0008_snapshot.json", import.meta.url), "utf8"),
) as { tables: { "public.organization": { columns: Record<string, { default?: boolean }> } } };

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
		expect(migrationJournal.entries.some((entry) => entry.tag === "0008_demo_data_feature_flag")).toBe(true);
		expect(migration0008).toContain('ADD COLUMN "demo_data_enabled" boolean DEFAULT true');
		expect(
			migration0008Snapshot.tables["public.organization"].columns.demo_data_enabled?.default,
		).toBe(true);
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
		expect(migrationJournal.entries.some((entry) => entry.tag === "0019_regular_sandman")).toBe(true);
		expect(migration0019.trim()).toBe(
			'ALTER TABLE "organization" ADD COLUMN "fiscal_year_start_month" integer DEFAULT 1;',
		);
	});

	it("registers the fiscal year start column drop migration", () => {
		expect(migrationJournal.entries.some((entry) => entry.tag === "0020_drop_organization_fiscal_year")).toBe(
			true,
		);
		expect(existsSync(migration0020Url)).toBe(true);

		const migration0020 = readFileSync(migration0020Url, "utf8");

		expect(migration0020.trim()).toBe(
			'ALTER TABLE "organization" DROP COLUMN "fiscal_year_start_month";',
		);
	});

	it("registers the employee manager_id removal migration", () => {
		expect(migrationJournal.entries.some((entry) => entry.tag === "0026_remove_employee_manager_id")).toBe(
			true,
		);
		expect(existsSync(migration0026Url)).toBe(true);

		const migration0026 = readFileSync(migration0026Url, "utf8");

		expect(migration0026).toContain('INSERT INTO "employee_managers"');
		expect(migration0026).toContain('FROM "employee" AS "e"');
		expect(migration0026).toContain('"e"."manager_id" IS NOT NULL');
		expect(migration0026).toContain('NOT EXISTS (');
		expect(migration0026).toContain('"existing_primary"."is_primary" = true');
		expect(migration0026).toContain('"e"."user_id"');
		expect(migration0026).toContain('DROP INDEX IF EXISTS "employee_managerId_idx";');
		expect(migration0026).toContain('ALTER TABLE "employee" DROP COLUMN "manager_id";');
	});
});
