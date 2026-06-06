import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInvitationTargetTeamUpdate } from "./edit-invitation-target-team-dialog.utils";

const componentSource = () =>
	readFileSync(join(process.cwd(), "src/components/organization/members-table.tsx"), "utf8");

describe("MembersTable invitation target teams", () => {
	it("resolves local target team updates from the submitted id", () => {
		const update = resolveInvitationTargetTeamUpdate("team-a", [
			{ id: "team-a", name: "Submitted Team" },
			{ id: "team-b", name: "Later Selected Team" },
		]);

		expect(update).toEqual({
			targetTeamId: "team-a",
			targetTeam: { id: "team-a", name: "Submitted Team" },
		});
	});

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
		expect(dialog).toContain(
			'import { resolveInvitationTargetTeamUpdate } from "./edit-invitation-target-team-dialog.utils"',
		);
		expect(dialog).toContain("mutationFn: ({ targetTeamId }");
		expect(dialog).toContain("onSuccess: (result, variables)");
		expect(dialog).toContain(
			"const update = resolveInvitationTargetTeamUpdate(variables.targetTeamId, teams)",
		);
		expect(dialog).toContain("onUpdated(update)");
		expect(dialog).toContain("disabled={updateMutation.isPending}");
		expect(dialog).toContain("updateMutation.mutate({ targetTeamId: submittedTargetTeamId })");
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
