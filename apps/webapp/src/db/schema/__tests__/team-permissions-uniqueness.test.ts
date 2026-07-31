import { existsSync, readFileSync } from "node:fs";
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { teamPermissions } from "../organization";

const migrationPath = "drizzle/0057_team_permissions_uniqueness.sql";
const snapshotPath = "drizzle/meta/0057_snapshot.json";

function normalizedSql(value: string) {
	return value.replace(/\s+/g, " ").trim();
}

function predicateSql(value: SQL | undefined) {
	return value ? new PgDialect().sqlToQuery(value).sql : null;
}

describe("team permission uniqueness", () => {
	it("declares separate unique indexes for team and organization-wide scopes", () => {
		const indexes = getTableConfig(teamPermissions)
			.indexes.filter((index) => index.config.unique)
			.map((index) => ({
				name: index.config.name,
				columns: index.config.columns.map((column) => column.name),
				where: predicateSql(index.config.where),
			}));

		expect(indexes).toEqual([
			{
				name: "teamPermissions_employeeOrganizationTeam_unique_idx",
				columns: ["employee_id", "organization_id", "team_id"],
				where: '"team_permissions"."team_id" IS NOT NULL',
			},
			{
				name: "teamPermissions_employeeOrganizationOrgWide_unique_idx",
				columns: ["employee_id", "organization_id"],
				where: '"team_permissions"."team_id" IS NULL',
			},
		]);
	});

	it("reconciles duplicates before creating both database constraints", () => {
		expect(existsSync(migrationPath), "0057 migration must exist").toBe(true);
		if (!existsSync(migrationPath)) return;
		const migration = readFileSync(migrationPath, "utf8");
		const sql = normalizedSql(migration);

		expect(sql).toContain(
			'LOCK TABLE "team_permissions" IN SHARE ROW EXCLUSIVE MODE',
		);
		expect(sql.indexOf("LOCK TABLE")).toBeLessThan(sql.indexOf("UPDATE"));
		expect(sql).toContain(
			'PARTITION BY "organization_id", "employee_id", "team_id"',
		);
		expect(sql).toContain(
			'ORDER BY "updated_at" DESC NULLS LAST, "granted_at" DESC NULLS LAST, "id" DESC',
		);
		for (const permission of [
			"can_create_teams",
			"can_manage_team_members",
			"can_manage_team_settings",
			"can_approve_team_requests",
		]) {
			expect(sql).toContain(`BOOL_OR("${permission}") OVER`);
		}
		expect(sql).toContain('UPDATE "team_permissions" AS "survivor"');
		expect(sql).toContain('DELETE FROM "team_permissions" AS "duplicate"');
		expect(sql).toContain(
			'"duplicate"."team_id" IS NOT DISTINCT FROM "ranked"."team_id"',
		);
		expect(sql).toContain('DROP INDEX IF EXISTS "teamPermissions_unique_idx"');
		expect(sql).toContain(
			'CREATE UNIQUE INDEX "teamPermissions_employeeOrganizationTeam_unique_idx" ON "team_permissions" USING btree ("employee_id","organization_id","team_id") WHERE "team_permissions"."team_id" IS NOT NULL',
		);
		expect(sql).toContain(
			'CREATE UNIQUE INDEX "teamPermissions_employeeOrganizationOrgWide_unique_idx" ON "team_permissions" USING btree ("employee_id","organization_id") WHERE "team_permissions"."team_id" IS NULL',
		);
		expect(sql.indexOf("DELETE FROM")).toBeLessThan(
			sql.indexOf("CREATE UNIQUE INDEX"),
		);
		expect(sql).not.toContain("employee_invitation_draft");
		expect(sql).not.toContain("invitation_id_organization_id_idx");
	});

	it("registers 0057 after 0056 with a linked snapshot", () => {
		const journal = JSON.parse(
			readFileSync("drizzle/meta/_journal.json", "utf8"),
		) as {
			entries: Array<{
				idx: number;
				when: number;
				tag: string;
				breakpoints: boolean;
			}>;
		};
		const previous = journal.entries.find((entry) => entry.idx === 56);
		const entry = journal.entries.find((entry) => entry.idx === 57);

		expect(entry).toEqual(
			expect.objectContaining({
				idx: 57,
				tag: "0057_team_permissions_uniqueness",
				breakpoints: true,
			}),
		);
		expect(entry?.when).toBeGreaterThan(previous?.when ?? 0);
		expect(existsSync(snapshotPath), "0057 snapshot must exist").toBe(true);
		if (!existsSync(snapshotPath)) return;
		const previousSnapshot = JSON.parse(
			readFileSync("drizzle/meta/0056_snapshot.json", "utf8"),
		) as { id: string };
		const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
			prevId: string;
			tables: Record<
				string,
				{
					indexes: Record<
						string,
						{
							columns: Array<{ expression: string }>;
							isUnique: boolean;
							where?: string;
						}
					>;
					foreignKeys: Record<string, unknown>;
				}
			>;
		};

		expect(snapshot.prevId).toBe(previousSnapshot.id);
		const permissionIndexes =
			snapshot.tables["public.team_permissions"]?.indexes;
		expect(permissionIndexes?.teamPermissions_unique_idx).toBeUndefined();
		expect(permissionIndexes).toMatchObject({
			teamPermissions_employeeOrganizationTeam_unique_idx: {
				isUnique: true,
				where: '"team_permissions"."team_id" IS NOT NULL',
			},
			teamPermissions_employeeOrganizationOrgWide_unique_idx: {
				isUnique: true,
				where: '"team_permissions"."team_id" IS NULL',
			},
		});
		expect(
			snapshot.tables["public.invitation"]?.indexes
				.invitation_id_organization_id_idx,
		).toBeDefined();
		expect(
			snapshot.tables["public.employee_invitation_draft"]?.foreignKeys,
		).toMatchObject({
			employee_invitation_draft_invitation_org_fk: expect.any(Object),
			employee_invitation_draft_team_org_fk: expect.any(Object),
		});
	});
});
