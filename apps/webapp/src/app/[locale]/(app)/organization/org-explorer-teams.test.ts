import { describe, expect, it } from "vitest";
import { groupTeams } from "./org-explorer-teams";
import type { OrgExplorerPerson, OrgExplorerTeam } from "./org-explorer-types";

function person(
	employeeId: string,
	overrides: Partial<OrgExplorerPerson> = {},
): OrgExplorerPerson {
	return {
		employeeId,
		userId: `user-${employeeId}`,
		name: employeeId,
		pronouns: null,
		email: `${employeeId}@example.com`,
		image: null,
		position: null,
		primaryTeamId: overrides.teamIds?.[0] ?? null,
		teamIds: [],
		managerIds: [],
		reportIds: [],
		lineReportIds: [],
		...overrides,
	};
}

function team(
	teamId: string,
	overrides: Partial<OrgExplorerTeam> = {},
): OrgExplorerTeam {
	return {
		teamId,
		name: teamId,
		description: null,
		leadEmployeeId: null,
		memberCount: 0,
		...overrides,
	};
}

describe("groupTeams", () => {
	it("shows someone in several teams on each of their teams, marking their primary team", () => {
		const { cards } = groupTeams(
			[team("Ops", { memberCount: 1 }), team("Sales", { memberCount: 2 })],
			[
				person("Ada", { teamIds: ["Sales", "Ops"], primaryTeamId: "Sales" }),
				person("Bob", { teamIds: ["Sales"] }),
			],
		);

		expect(
			cards.map((card) => ({
				team: card.team.teamId,
				members: card.members.map((member) => [
					member.person.employeeId,
					member.isPrimaryTeam,
				]),
			})),
		).toEqual([
			{ team: "Ops", members: [["Ada", false]] },
			{
				team: "Sales",
				members: [
					["Ada", true],
					["Bob", true],
				],
			},
		]);
	});

	it("collects people without a team membership for the No team card", () => {
		const { noTeam } = groupTeams(
			[team("Ops", { memberCount: 1 })],
			[person("Zed"), person("Ada", { teamIds: ["Ops"] }), person("Bea")],
		);

		expect(noTeam.map((entry) => entry.employeeId)).toEqual(["Bea", "Zed"]);
	});

	it("puts the team lead in the header even when they are not a member", () => {
		const { cards } = groupTeams(
			[
				team("Ops", { leadEmployeeId: "Lead", memberCount: 1 }),
				team("Sales", { leadEmployeeId: "Ada", memberCount: 1 }),
			],
			[
				person("Lead", { teamIds: ["Sales"] }),
				person("Ada", { teamIds: ["Sales"] }),
			],
		);
		const [ops, sales] = cards;

		expect(ops?.lead?.employeeId).toBe("Lead");
		expect(ops?.leadIsMember).toBe(false);
		expect(ops?.members).toEqual([]);
		expect(sales?.lead?.employeeId).toBe("Ada");
		expect(sales?.leadIsMember).toBe(true);
	});

	it("says whether every member of a team is loaded", () => {
		const { cards } = groupTeams(
			[team("Ops", { memberCount: 2 }), team("Sales", { memberCount: 1 })],
			[person("Ada", { teamIds: ["Ops", "Sales"] })],
		);

		expect(
			cards.map((card) => [card.team.teamId, card.allMembersLoaded]),
		).toEqual([
			["Ops", false],
			["Sales", true],
		]);
	});

	it("narrows the cards to the filtered teams and drops the No team card", () => {
		const grouped = groupTeams(
			[team("Ops"), team("Sales"), team("Hr")],
			[person("Zed")],
			["Sales", "Ops"],
		);

		expect(grouped.cards.map((card) => card.team.teamId)).toEqual([
			"Ops",
			"Sales",
		]);
		expect(grouped.noTeam).toEqual([]);
	});
});
