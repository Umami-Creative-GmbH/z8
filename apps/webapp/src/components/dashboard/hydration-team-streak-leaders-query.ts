import { CACHE_TAGS } from "@/lib/cache/tags";

type HydrationTeamStreakLeadersCacheInput = {
	organizationId: string;
	currentEmployeeId: string;
	teamIds: string[];
};

export function createHydrationTeamStreakLeadersCacheConfig({
	organizationId,
	currentEmployeeId,
	teamIds,
}: HydrationTeamStreakLeadersCacheInput) {
	const sortedTeamIds = [...teamIds].sort();

	return {
		keyParts: [
			"hydration-team-streak-leaders",
			organizationId,
			currentEmployeeId,
			...sortedTeamIds,
		],
		options: {
			revalidate: 60,
			tags: [
				CACHE_TAGS.HYDRATION_STREAKS(organizationId),
				CACHE_TAGS.EMPLOYEES(organizationId),
				CACHE_TAGS.TEAMS(organizationId),
			],
		},
	};
}
