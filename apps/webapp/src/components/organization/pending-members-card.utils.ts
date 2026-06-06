type PendingMemberTeamSource = {
	id: string;
	inviteCode?: { defaultTeamId?: string | null } | null;
};

function resolveApproveTeamId(
	member: PendingMemberTeamSource,
	teamAssignments: Record<string, string | null>,
) {
	if (member.id in teamAssignments) {
		return teamAssignments[member.id] === null ? null : teamAssignments[member.id];
	}

	return member.inviteCode?.defaultTeamId || undefined;
}

export function buildBulkApproveRequests(
	pendingMembers: PendingMemberTeamSource[],
	selectedMemberIds: string[],
	teamAssignments: Record<string, string | null>,
) {
	return selectedMemberIds.flatMap((memberId) => {
		const member = pendingMembers.find((pendingMember) => pendingMember.id === memberId);

		return member ? [{ memberId, teamId: resolveApproveTeamId(member, teamAssignments) }] : [];
	});
}

export { resolveApproveTeamId };
