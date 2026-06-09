import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { employeeInvitationDraft } from "../employee-invitation-draft";

describe("employee invitation draft schema", () => {
	it("defines organization-scoped invitation draft fields", () => {
		expect(employeeInvitationDraft.invitationId.name).toBe("invitation_id");
		expect(employeeInvitationDraft.organizationId.name).toBe("organization_id");
		expect(employeeInvitationDraft.teamId.name).toBe("team_id");
		expect(employeeInvitationDraft.role.name).toBe("role");
		expect(employeeInvitationDraft.contractType.name).toBe("contract_type");
		expect(employeeInvitationDraft.currentHourlyRate.name).toBe("current_hourly_rate");
	});

	it("registers the migration after the latest journal entry", () => {
		const migration = readFileSync("drizzle/0050_employee_invitation_draft.sql", "utf8");
		const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
		expect(migration).toContain('CREATE TABLE IF NOT EXISTS "employee_invitation_draft"');
		expect(migration).toContain('"invitation_id" text NOT NULL');
		expect(migration).toContain('"organization_id" text NOT NULL');
		expect(migration).toContain(
			'CREATE UNIQUE INDEX IF NOT EXISTS "employeeInvitationDraft_invitationId_unique_idx"',
		);
		expect(migration).toContain("employee_invitation_draft_invitation_org_fk");
		expect(migration).toContain('FOREIGN KEY ("invitation_id","organization_id")');
		expect(migration).toContain('REFERENCES "public"."invitation"("id","organization_id")');
		expect(migration).toContain("employee_invitation_draft_team_org_fk");
		expect(migration).toContain('FOREIGN KEY ("team_id","organization_id")');
		expect(migration).toContain('ON DELETE SET NULL ("team_id")');
		const snapshot = JSON.parse(readFileSync("drizzle/meta/0050_snapshot.json", "utf8"));
		expect(snapshot.tables["public.employee_invitation_draft"]).toBeTruthy();
		expect(journal.entries.at(-1)).toMatchObject({
			idx: 50,
			tag: "0050_employee_invitation_draft",
		});
		expect(journal.entries.at(-1).when).toBeGreaterThan(1780773132900);
	});
});
