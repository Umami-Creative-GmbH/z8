type TargetTeamOption = { id: string; name: string };

export function resolveInvitationTargetTeamUpdate(
	targetTeamId: string | null,
	teams: TargetTeamOption[],
) {
	return {
		targetTeamId,
		targetTeam: targetTeamId ? (teams.find((team) => team.id === targetTeamId) ?? null) : null,
	};
}
