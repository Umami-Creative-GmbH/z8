import { describe, expect, it } from "vitest";
import { resolveBulkApproveTeamId } from "./pending-members-card";

describe("resolveBulkApproveTeamId", () => {
	it("uses the first selected member's invite-code default team when untouched", () => {
		const teamId = resolveBulkApproveTeamId(
			[
				{
					id: "member-1",
					inviteCode: { defaultTeamId: "team-default" },
				},
			],
			["member-1"],
			{},
		);

		expect(teamId).toBe("team-default");
	});
});
