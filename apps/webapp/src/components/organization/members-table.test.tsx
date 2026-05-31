import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentSource = () =>
	readFileSync(join(process.cwd(), "src/components/organization/members-table.tsx"), "utf8");

describe("MembersTable invitation target teams", () => {
	it("shows pending invitation target teams and exposes the edit action", () => {
		const file = componentSource();

		expect(file).toContain(
			'import { EditInvitationTargetTeamDialog } from "./edit-invitation-target-team-dialog"',
		);
		expect(file).toContain('accessorKey: "targetTeam"');
		expect(file).toContain('organization.members.targetTeam", "Target Team"');
		expect(file).toContain('organization.members.noTargetTeam", "No team"');
		expect(file).toContain('organization.members.editTargetTeam", "Edit target team"');
		expect(file).toContain("<EditInvitationTargetTeamDialog");
	});

	it("preserves targetTeamId when resending pending invitations", () => {
		const file = componentSource();

		expect(file).toContain("targetTeamId: invitation.targetTeamId ?? null");
	});

	it("updates the local pending invitation target team after editing", () => {
		const table = componentSource();
		const dialog = readFileSync(
			join(process.cwd(), "src/components/organization/edit-invitation-target-team-dialog.tsx"),
			"utf8",
		);

		expect(dialog).toContain("onUpdated:");
		expect(dialog).toContain("onUpdated({");
		expect(dialog).toContain("targetTeamId: updatedTargetTeamId");
		expect(dialog).toContain("targetTeam: updatedTargetTeam");
		expect(table).toContain("handleInvitationTargetTeamUpdated");
		expect(table).toContain("setInvitations((currentInvitations) =>");
		expect(table).toContain("invitation.id === invitationId");
		expect(table).toContain("targetTeamId: update.targetTeamId");
		expect(table).toContain("targetTeam: update.targetTeam");
		expect(table).toContain("onUpdated={handleInvitationTargetTeamUpdated}");
	});
});

describe("Organizations settings page invitation target teams", () => {
	it("maps fetched team display data onto pending invitations", () => {
		const file = readFileSync(
			join(process.cwd(), "src/app/[locale]/(app)/settings/organizations/page.tsx"),
			"utf8",
		);

		expect(file).toContain("targetTeamIds");
		expect(file).toContain("targetTeamsById");
		expect(file).toContain("targetTeam: invitation.targetTeamId");
		expect(file).toContain("name: team.name");
	});
});
