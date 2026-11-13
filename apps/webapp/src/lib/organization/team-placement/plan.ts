/** An employee's team placement: their team memberships and which of them is primary. */
export type TeamPlacement = {
	primaryTeamId: string | null;
	membershipTeamIds: readonly string[];
};

/**
 * A change to one employee's team placement that can end intended-driver status
 * (Organization ADR 0005): a move sets the Team field, the other two change one membership.
 */
export type TeamChangeKind =
	| { kind: "move"; teamId: string | null }
	| { kind: "addMembership" | "removeMembership"; teamId: string };

/** What a change does to the placement (Organization ADR 0010). */
export type TeamPlacementPlan = {
	/** The membership to add, when the employee is not yet a member. */
	addTeamId: string | null;
	/** The membership that ends. */
	endTeamId: string | null;
	/** The employee's primary team afterwards. */
	primaryTeamId: string | null;
};

/** The alphabetically first membership (by id) other than `endTeamId`, else none. */
function firstRemaining(membershipTeamIds: readonly string[], endTeamId: string | null) {
	return membershipTeamIds.filter((teamId) => teamId !== endTeamId).toSorted()[0] ?? null;
}

/**
 * Keeps the primary team among the memberships. A move to a team adds it as a membership and
 * the primary team and ends the old primary team's membership; a move to no team ends that
 * membership. Adding a membership makes it primary only for an employee without a primary
 * team. Whenever the primary membership ends, the first remaining membership becomes primary.
 * Other memberships stay.
 */
export function planTeamChange(
	placement: TeamPlacement,
	change: TeamChangeKind,
): TeamPlacementPlan {
	const { primaryTeamId, membershipTeamIds } = placement;
	const isMember = (teamId: string) => membershipTeamIds.includes(teamId);
	switch (change.kind) {
		case "move": {
			const { teamId } = change;
			const endTeamId = primaryTeamId && primaryTeamId !== teamId ? primaryTeamId : null;
			if (teamId) {
				return {
					addTeamId: isMember(teamId) ? null : teamId,
					endTeamId,
					primaryTeamId: teamId,
				};
			}
			return {
				addTeamId: null,
				endTeamId,
				primaryTeamId: firstRemaining(membershipTeamIds, endTeamId),
			};
		}
		case "addMembership":
			return {
				addTeamId: isMember(change.teamId) ? null : change.teamId,
				endTeamId: null,
				primaryTeamId: primaryTeamId ?? change.teamId,
			};
		case "removeMembership":
			return {
				addTeamId: null,
				endTeamId: isMember(change.teamId) ? change.teamId : null,
				primaryTeamId:
					primaryTeamId === change.teamId
						? firstRemaining(membershipTeamIds, change.teamId)
						: primaryTeamId,
			};
	}
}
