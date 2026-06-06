import { describe, expect, it } from "vitest";
import { buildBulkApproveRequests } from "./pending-members-card.utils";

describe("buildBulkApproveRequests", () => {
	it("preserves each selected member's resolved invite-code target team", () => {
		const requests = buildBulkApproveRequests(
			[
				{ id: "member-1", inviteCode: { defaultTeamId: "team-a" } },
				{ id: "member-2", inviteCode: { defaultTeamId: "team-b" } },
			],
			["member-1", "member-2"],
			{},
		);

		expect(requests).toEqual([
			{ memberId: "member-1", teamId: "team-a" },
			{ memberId: "member-2", teamId: "team-b" },
		]);
	});

	it("keeps explicit no-team selections as null bulk approval payloads", () => {
		const requests = buildBulkApproveRequests(
			[{ id: "member-1", inviteCode: { defaultTeamId: "team-a" } }],
			["member-1"],
			{ "member-1": null },
		);

		expect(requests).toEqual([{ memberId: "member-1", teamId: null }]);
	});
});
