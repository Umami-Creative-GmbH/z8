/**
 * Cache Tags for Next.js 16 'use cache' directive
 *
 * These tags are used with cacheTag() and revalidateTag() for granular cache invalidation.
 */

export const CACHE_TAGS = {
	// Auth/User (private cache)
	AUTH_CONTEXT: "auth-context",
	USER_ORGANIZATIONS: "user-organizations",
	ONBOARDING_STATUS: "onboarding-status",

	// Organization data (public cache, scoped by org)
	EMPLOYEES: (orgId: string) => `employees:${orgId}`,
	TEAMS: (orgId: string) => `teams:${orgId}`,
	LOCATIONS: (orgId: string) => `locations:${orgId}`,

	// Vacation policies (public cache, scoped by org)
	VACATION_POLICY: (orgId: string) => `vacation-policy:${orgId}`,

	// Skills & Qualifications (public cache, scoped)
	SKILLS: (orgId: string) => `skills:${orgId}`,
	EMPLOYEE_SKILLS: (employeeId: string) => `employee-skills:${employeeId}`,
	SUBAREA_SKILLS: (subareaId: string) => `subarea-skills:${subareaId}`,
	TEMPLATE_SKILLS: (templateId: string) => `template-skills:${templateId}`,

	// Analytics (keep in sync with analytics/cache.ts)
	ANALYTICS_ALL: "analytics:all",
} as const;
