import { compareByName } from "./org-explorer-tree";
import type { OrgExplorerPerson, OrgExplorerTeam } from "./org-explorer-types";

export type TeamCardMember = {
	person: OrgExplorerPerson;
	/** Whether this team is the member's primary team. */
	isPrimaryTeam: boolean;
};

export type TeamCard = {
	team: OrgExplorerTeam;
	/** The team lead, when loaded. They need not be a member. */
	lead: OrgExplorerPerson | null;
	leadIsMember: boolean;
	members: TeamCardMember[];
	/** False while a large organization has not loaded every member yet. */
	allMembersLoaded: boolean;
};

export type GroupedTeams = {
	cards: TeamCard[];
	/** People without a team membership. Empty while the teams are filtered. */
	noTeam: OrgExplorerPerson[];
};

/**
 * The Teams view: a card per team with its lead and members, read from team
 * memberships alone. Someone in several teams appears on each card. With a team
 * filter, only the filtered teams' cards remain.
 */
export function groupTeams(
	teams: OrgExplorerTeam[],
	people: OrgExplorerPerson[],
	filterTeamIds: readonly string[] = [],
): GroupedTeams {
	const sortedPeople = people.toSorted(compareByName);
	const peopleById = new Map(
		sortedPeople.map((entry) => [entry.employeeId, entry]),
	);
	const filter = new Set(filterTeamIds);
	const shownTeams = teams
		.filter((entry) => filter.size === 0 || filter.has(entry.teamId))
		.toSorted(
			(first, second) =>
				first.name.localeCompare(second.name) ||
				first.teamId.localeCompare(second.teamId),
		);

	const cards = shownTeams.map<TeamCard>((entry) => {
		const members = sortedPeople
			.filter((member) => member.teamIds.includes(entry.teamId))
			.map((member) => ({
				person: member,
				isPrimaryTeam: member.primaryTeamId === entry.teamId,
			}));
		const lead = entry.leadEmployeeId
			? (peopleById.get(entry.leadEmployeeId) ?? null)
			: null;

		return {
			team: entry,
			lead,
			leadIsMember: Boolean(lead?.teamIds.includes(entry.teamId)),
			members,
			allMembersLoaded: members.length >= entry.memberCount,
		};
	});

	return {
		cards,
		noTeam:
			filter.size === 0
				? sortedPeople.filter((entry) => entry.teamIds.length === 0)
				: [],
	};
}
