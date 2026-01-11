/**
 * Analytics Query Caching Utilities
 *
 * Provides caching helpers for expensive analytics aggregations using
 * Next.js unstable_cache API with tag-based invalidation.
 */

import { revalidateTag, unstable_cache } from "next/cache";

/**
 * Cache TTL configuration (in seconds)
 */
export const ANALYTICS_CACHE_TTL = {
	SHORT: 300, // 5 minutes - for frequently changing data (dashboard widgets)
	MEDIUM: 3600, // 1 hour - for analytics data
	LONG: 86400, // 24 hours - for historical reports
} as const;

/**
 * Cache tag prefixes for different analytics types
 */
export const ANALYTICS_CACHE_TAGS = {
	TEAM_PERFORMANCE: "analytics:team-performance",
	VACATION_TRENDS: "analytics:vacation-trends",
	WORK_HOURS: "analytics:work-hours",
	ABSENCE_PATTERNS: "analytics:absence-patterns",
	MANAGER_EFFECTIVENESS: "analytics:manager-effectiveness",
	DASHBOARD_WIDGETS: "analytics:dashboard-widgets",
	ALL: "analytics:all",
} as const;

/**
 * Generate cache key for analytics queries
 * @param baseKey - Base identifier for the query
 * @param params - Parameters that affect the query result
 * @returns Unique cache key
 */
export function generateCacheKey(baseKey: string, params: Record<string, any>): string {
	// Sort params to ensure consistent key generation
	const sortedParams = Object.keys(params)
		.sort()
		.map((key) => {
			const value = params[key];
			if (value instanceof Date) {
				return `${key}=${value.toISOString()}`;
			}
			if (typeof value === "object") {
				return `${key}=${JSON.stringify(value)}`;
			}
			return `${key}=${value}`;
		})
		.join("&");

	return `${baseKey}:${sortedParams}`;
}

/**
 * Create a cached version of an analytics query function
 * @param fn - The async function to cache
 * @param options - Caching options
 * @returns Cached function
 */
export function createCachedQuery<TArgs extends any[], TResult>(
	fn: (...args: TArgs) => Promise<TResult>,
	options: {
		keyPrefix: string;
		tags: string[];
		revalidate?: number;
	},
) {
	return async (...args: TArgs): Promise<TResult> => {
		const cacheKey = generateCacheKey(
			options.keyPrefix,
			args.length === 1 && typeof args[0] === "object" ? args[0] : { args },
		);

		const cachedFn = unstable_cache(async () => fn(...args), [cacheKey], {
			tags: options.tags,
			revalidate: options.revalidate ?? ANALYTICS_CACHE_TTL.MEDIUM,
		});

		return cachedFn();
	};
}

/**
 * Revalidate analytics cache by tag
 * @param tag - Cache tag to revalidate (from ANALYTICS_CACHE_TAGS)
 */
export function revalidateAnalyticsCache(tag: string): void {
	revalidateTag(tag);
}

/**
 * Revalidate all analytics caches
 */
export function revalidateAllAnalytics(): void {
	revalidateTag(ANALYTICS_CACHE_TAGS.ALL);
}

/**
 * Revalidate analytics caches when work data changes
 * Call this after work period create/update/delete operations
 */
export function revalidateWorkDataCache(organizationId: string): void {
	revalidateTag(ANALYTICS_CACHE_TAGS.WORK_HOURS);
	revalidateTag(ANALYTICS_CACHE_TAGS.TEAM_PERFORMANCE);
	revalidateTag(ANALYTICS_CACHE_TAGS.DASHBOARD_WIDGETS);
	revalidateTag(`${ANALYTICS_CACHE_TAGS.WORK_HOURS}:org:${organizationId}`);
}

/**
 * Revalidate analytics caches when absence data changes
 * Call this after absence entry create/update/delete operations
 */
export function revalidateAbsenceDataCache(organizationId: string): void {
	revalidateTag(ANALYTICS_CACHE_TAGS.VACATION_TRENDS);
	revalidateTag(ANALYTICS_CACHE_TAGS.ABSENCE_PATTERNS);
	revalidateTag(ANALYTICS_CACHE_TAGS.DASHBOARD_WIDGETS);
	revalidateTag(`${ANALYTICS_CACHE_TAGS.VACATION_TRENDS}:org:${organizationId}`);
}

/**
 * Revalidate analytics caches when approval data changes
 * Call this after approval request create/update operations
 */
export function revalidateApprovalDataCache(organizationId: string): void {
	revalidateTag(ANALYTICS_CACHE_TAGS.MANAGER_EFFECTIVENESS);
	revalidateTag(ANALYTICS_CACHE_TAGS.DASHBOARD_WIDGETS);
	revalidateTag(`${ANALYTICS_CACHE_TAGS.MANAGER_EFFECTIVENESS}:org:${organizationId}`);
}

/**
 * Revalidate analytics caches when employee data changes
 * Call this after employee create/update/delete operations
 */
export function revalidateEmployeeDataCache(organizationId: string): void {
	revalidateTag(ANALYTICS_CACHE_TAGS.TEAM_PERFORMANCE);
	revalidateTag(ANALYTICS_CACHE_TAGS.DASHBOARD_WIDGETS);
	revalidateTag(`${ANALYTICS_CACHE_TAGS.TEAM_PERFORMANCE}:org:${organizationId}`);
}

/**
 * Example usage in server actions:
 *
 * ```typescript
 * import { createCachedQuery, ANALYTICS_CACHE_TAGS, ANALYTICS_CACHE_TTL } from "@/lib/analytics/cache";
 *
 * // Create cached version of expensive query
 * const getCachedTeamPerformance = createCachedQuery(
 *   getTeamPerformanceData,
 *   {
 *     keyPrefix: "team-performance",
 *     tags: [ANALYTICS_CACHE_TAGS.TEAM_PERFORMANCE, ANALYTICS_CACHE_TAGS.ALL],
 *     revalidate: ANALYTICS_CACHE_TTL.MEDIUM,
 *   }
 * );
 *
 * // Use cached query
 * const result = await getCachedTeamPerformance(organizationId, dateRange);
 *
 * // Invalidate cache after data mutation
 * import { revalidateWorkDataCache } from "@/lib/analytics/cache";
 * await createWorkPeriod(...);
 * revalidateWorkDataCache(organizationId);
 * ```
 */
