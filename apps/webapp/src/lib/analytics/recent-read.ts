import "server-only";

import { Effect } from "effect";
import { cacheLife, cacheTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { runtime } from "@/lib/effect/runtime";
import { AnalyticsService } from "@/lib/effect/services/analytics.service";
import type { RecentAnalyticsIdentity } from "./recent-identity";
import type {
	OvertimeBurnDownParams,
	TeamPerformanceParams,
	WorkHoursParams,
} from "./types";

/** Only successful derived display data is cached. Authorization stays in each action. */
export async function readRecentWorkHours(
	identity: RecentAnalyticsIdentity,
	params: WorkHoursParams,
) {
	"use cache";
	cacheLife({ stale: 0, revalidate: 60, expire: 60 });
	cacheTag(CACHE_TAGS.RECENT_ANALYTICS(identity.organizationId));
	return runtime.runPromise(
		Effect.gen(function* () {
			const analytics = yield* AnalyticsService;
			return yield* analytics.getWorkHoursAnalytics(params);
		}),
	);
}

export async function readRecentTeamPerformance(
	identity: RecentAnalyticsIdentity,
	params: TeamPerformanceParams,
) {
	"use cache";
	cacheLife({ stale: 0, revalidate: 60, expire: 60 });
	cacheTag(CACHE_TAGS.RECENT_ANALYTICS(identity.organizationId));
	return runtime.runPromise(
		Effect.gen(function* () {
			const analytics = yield* AnalyticsService;
			return yield* analytics.getTeamPerformance(params);
		}),
	);
}

export async function readRecentOvertime(
	identity: RecentAnalyticsIdentity,
	params: OvertimeBurnDownParams,
) {
	"use cache";
	cacheLife({ stale: 0, revalidate: 60, expire: 60 });
	cacheTag(CACHE_TAGS.RECENT_ANALYTICS(identity.organizationId));
	return runtime.runPromise(
		Effect.gen(function* () {
			const analytics = yield* AnalyticsService;
			return yield* analytics.getOvertimeBurnDown(params);
		}),
	);
}
