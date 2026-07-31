import { readFileSync } from "node:fs";
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { employeeInvitationDraft } from "../employee-invitation-draft";

function sqlText(value: SQL): string {
	return new PgDialect().sqlToQuery(value).sql;
}

describe("employee invitation draft schema", () => {
	it("defines organization-scoped invitation draft fields", () => {
		expect(employeeInvitationDraft.invitationId.name).toBe("invitation_id");
		expect(employeeInvitationDraft.organizationId.name).toBe("organization_id");
		expect(employeeInvitationDraft.teamId.name).toBe("team_id");
		expect(employeeInvitationDraft.role.name).toBe("role");
		expect(employeeInvitationDraft.contractType.name).toBe("contract_type");
		expect(employeeInvitationDraft.currentHourlyRate.name).toBe(
			"current_hourly_rate",
		);
	});

	it("models the deployed updated_at database default", () => {
		const updatedAt = getTableConfig(employeeInvitationDraft).columns.find(
			(column) => column.name === "updated_at",
		);

		expect(updatedAt?.default).toBeDefined();
		expect(sqlText(updatedAt?.default as SQL)).toBe("now()");
	});

	it("stores a required normalized email with organization-scoped uniqueness", () => {
		const tableConfig = getTableConfig(employeeInvitationDraft);
		const normalizedEmail = tableConfig.columns.find(
			(column) => column.name === "normalized_email",
		);
		const uniqueIndexes = tableConfig.indexes.filter(
			(index) => index.config.unique,
		);

		expect(normalizedEmail?.notNull).toBe(true);
		expect(
			uniqueIndexes.map((index) => ({
				name: index.config.name,
				columns: index.config.columns.map((column) => column.name),
			})),
		).toEqual(
			expect.arrayContaining([
				{
					name: "employeeInvitationDraft_invitationId_unique_idx",
					columns: ["invitation_id"],
				},
				{
					name: "employeeInvitationDraft_organizationNormalizedEmail_unique_idx",
					columns: ["organization_id", "normalized_email"],
				},
			]),
		);
	});

	it("stores organization creation permission as a required false-default boolean", () => {
		const tableConfig = getTableConfig(employeeInvitationDraft);
		const permission = tableConfig.columns.find(
			(column) => column.name === "can_create_organizations",
		);

		expect(permission).toMatchObject({
			dataType: "boolean",
			notNull: true,
			default: false,
		});
	});

	it("registers the migration after its predecessor", () => {
		const migration = readFileSync(
			"drizzle/0050_employee_invitation_draft.sql",
			"utf8",
		);
		const schema = readFileSync(
			"src/db/schema/employee-invitation-draft.ts",
			"utf8",
		);
		const journal = JSON.parse(
			readFileSync("drizzle/meta/_journal.json", "utf8"),
		);
		expect(migration).toContain(
			'CREATE TABLE IF NOT EXISTS "employee_invitation_draft"',
		);
		expect(migration).toContain('"invitation_id" text NOT NULL');
		expect(migration).toContain('"organization_id" text NOT NULL');
		expect(migration).toContain(
			'CREATE UNIQUE INDEX IF NOT EXISTS "employeeInvitationDraft_invitationId_unique_idx"',
		);
		expect(migration).toContain("employee_invitation_draft_invitation_org_fk");
		expect(migration).toContain(
			'FOREIGN KEY ("invitation_id","organization_id")',
		);
		expect(migration).toContain(
			'REFERENCES "public"."invitation"("id","organization_id")',
		);
		expect(schema).not.toContain("employee_invitation_draft_invitation_org_fk");
		expect(migration).toContain("employee_invitation_draft_team_org_fk");
		expect(migration).toContain('FOREIGN KEY ("team_id","organization_id")');
		expect(migration).toContain('ON DELETE SET NULL ("team_id")');
		const snapshot = JSON.parse(
			readFileSync("drizzle/meta/0050_snapshot.json", "utf8"),
		);
		expect(snapshot.tables["public.employee_invitation_draft"]).toBeTruthy();
		const migrationEntry = journal.entries.find(
			(entry: { tag: string }) =>
				entry.tag === "0050_employee_invitation_draft",
		);
		expect(migrationEntry).toMatchObject({
			idx: 50,
			tag: "0050_employee_invitation_draft",
		});
		expect(migrationEntry?.when).toBeGreaterThan(1780773132900);
	});

	it("registers the identity repair migration after all predecessors", () => {
		const migration = readFileSync(
			"drizzle/0054_employee_invitation_draft_identity.sql",
			"utf8",
		);
		const snapshot = JSON.parse(
			readFileSync("drizzle/meta/0054_snapshot.json", "utf8"),
		);
		const journal = JSON.parse(
			readFileSync("drizzle/meta/_journal.json", "utf8"),
		) as {
			entries: Array<{ idx: number; tag: string; when: number }>;
		};
		const migrationIndex = journal.entries.findIndex(
			(entry) => entry.tag === "0054_employee_invitation_draft_identity",
		);
		const migrationEntry = journal.entries[migrationIndex];
		const latestPriorWhen = Math.max(
			...journal.entries.slice(0, migrationIndex).map((entry) => entry.when),
		);
		const draftSnapshot = snapshot.tables["public.employee_invitation_draft"];
		const invitationSnapshot = snapshot.tables["public.invitation"];
		const telegramDigestSnapshot =
			snapshot.tables["public.telegram_digest_delivery"];

		expect(migrationEntry).toMatchObject({
			idx: 54,
			tag: "0054_employee_invitation_draft_identity",
		});
		expect(migrationEntry?.when).toBeGreaterThan(1781096400000);
		expect(migrationEntry?.when).toBeGreaterThan(latestPriorWhen);
		expect(draftSnapshot?.columns.normalized_email).toMatchObject({
			type: "text",
			notNull: true,
		});
		expect(draftSnapshot?.columns.can_create_organizations).toMatchObject({
			type: "boolean",
			notNull: true,
			default: false,
		});
		expect(migration).toContain(
			'ADD COLUMN IF NOT EXISTS "can_create_organizations" boolean DEFAULT false NOT NULL',
		);
		expect(draftSnapshot?.columns.updated_at?.default).toBe("now()");
		expect(telegramDigestSnapshot?.columns.updated_at?.default).toBe("now()");
		expect(
			draftSnapshot?.indexes
				.employeeInvitationDraft_organizationNormalizedEmail_unique_idx,
		).toMatchObject({ isUnique: true });
		expect(
			draftSnapshot?.foreignKeys.employee_invitation_draft_invitation_org_fk,
		).toMatchObject({
			tableFrom: "employee_invitation_draft",
			tableTo: "invitation",
			columnsFrom: ["invitation_id", "organization_id"],
			columnsTo: ["id", "organization_id"],
			onDelete: "cascade",
		});
		expect(
			draftSnapshot?.foreignKeys.employee_invitation_draft_team_org_fk,
		).toMatchObject({
			tableFrom: "employee_invitation_draft",
			tableTo: "team",
			columnsFrom: ["team_id", "organization_id"],
			columnsTo: ["id", "organization_id"],
			onDelete: "set null",
		});
		expect(
			invitationSnapshot?.indexes.invitation_id_organization_id_idx,
		).toMatchObject({
			isUnique: true,
			columns: [
				expect.objectContaining({ expression: "id" }),
				expect.objectContaining({ expression: "organization_id" }),
			],
		});
		expect(snapshot.tables).not.toHaveProperty("public.daily_digest_delivery");
		expect(migration).not.toContain("DROP CONSTRAINT");
		expect(migration).not.toContain(
			'DROP INDEX "invitation_id_organization_id_idx"',
		);
	});
});
