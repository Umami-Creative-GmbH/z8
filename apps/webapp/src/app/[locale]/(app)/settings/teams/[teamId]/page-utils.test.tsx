import { describe, expect, it, vi } from "vitest";
import { extractTeamMemberIds } from "./page-state";

vi.mock("./page-sections", () => ({
	AddMemberDialog: () => null,
	DeleteTeamDialog: () => null,
	RemoveMemberDialog: () => null,
	TeamInfoCard: () => null,
	TeamMembersCard: () => null,
	TeamPageHeader: () => null,
}));

vi.mock("./page-state", () => ({
	invalidateTeamQueries: vi.fn(),
	useTeamPageUiState: vi.fn(),
}));

describe("extractTeamMemberIds", () => {
	it("extracts employee IDs from direct team employees", () => {
		const team = {
			employees: [{ id: "emp-1" }, { id: "emp-2" }],
		};

		expect(extractTeamMemberIds(team)).toEqual(["emp-1", "emp-2"]);
	});

	it("extracts employee IDs from membership-shaped team employees", () => {
		const team = {
			employees: [
				{ id: "membership-1", employee: { id: "emp-1" } },
				{ id: "membership-2", employee: { id: "emp-2" } },
			],
		};

		expect(extractTeamMemberIds(team)).toEqual(["emp-1", "emp-2"]);
	});
});
