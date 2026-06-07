export type TeamStreakLeader = {
	employeeId: string;
	displayName: string;
	currentStreak: number;
	isCurrentUser: boolean;
};

export type TeamStreakLeaderCandidate = {
	employeeId: string;
	userId: string;
	displayName: string;
	currentStreak: number | null | undefined;
};

export function collectUniqueTeamIds(
	primaryTeamId: string | null | undefined,
	memberships: Array<{ teamId: string }>,
): string[] {
	return Array.from(
		new Set([primaryTeamId, ...memberships.map((membership) => membership.teamId)].filter(Boolean)),
	) as string[];
}

export function buildTeamStreakLeaders(
	candidates: TeamStreakLeaderCandidate[],
	currentUserId: string,
): TeamStreakLeader[] {
	const uniqueCandidates = new Map<string, TeamStreakLeaderCandidate>();

	for (const candidate of candidates) {
		if (!uniqueCandidates.has(candidate.employeeId)) {
			uniqueCandidates.set(candidate.employeeId, candidate);
		}
	}

	return Array.from(uniqueCandidates.values())
		.map((candidate) => ({
			employeeId: candidate.employeeId,
			displayName: candidate.displayName,
			currentStreak: candidate.currentStreak ?? 0,
			isCurrentUser: candidate.userId === currentUserId,
		}))
		.sort((left, right) => {
			if (right.currentStreak !== left.currentStreak) {
				return right.currentStreak - left.currentStreak;
			}

			return left.displayName.localeCompare(right.displayName);
		})
		.slice(0, 3);
}
