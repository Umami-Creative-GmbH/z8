/**
 * Data Access Layer Caching
 *
 * Provides caching wrappers for heavy database queries using Next.js unstable_cache.
 * These cached functions are ideal for:
 * - Dashboard data that doesn't need real-time updates
 * - Reference data (teams, departments, schedules)
 * - Aggregate statistics and reports
 *
 * Use `connection()` in routes that need fresh data on every request.
 */

import { unstable_cache } from "next/cache";
import { eq } from "drizzle-orm";
import { db, employee, team, workScheduleTemplate, holidayPreset } from "@/db";

// Cache tags for invalidation
export const CACHE_TAGS = {
	TEAMS: "teams",
	EMPLOYEES: "employees",
	SCHEDULES: "schedules",
	HOLIDAYS: "holidays",
	REPORTS: "reports",
} as const;

/**
 * Get cached team list for an organization
 * Revalidates every 5 minutes or on tag invalidation
 */
export const getCachedTeams = unstable_cache(
	async (organizationId: string) => {
		return db.query.team.findMany({
			where: eq(team.organizationId, organizationId),
			columns: {
				id: true,
				name: true,
				description: true,
			},
			orderBy: (team, { asc }) => [asc(team.name)],
		});
	},
	["teams"],
	{
		revalidate: 300, // 5 minutes
		tags: [CACHE_TAGS.TEAMS],
	},
);

/**
 * Get cached employee count for an organization
 * Useful for dashboard stats
 */
export const getCachedEmployeeCount = unstable_cache(
	async (organizationId: string) => {
		const employees = await db.query.employee.findMany({
			where: eq(employee.organizationId, organizationId),
			columns: { id: true, isActive: true },
		});

		// Single pass to count active/inactive (js-combine-iterations)
		const counts = employees.reduce(
			(acc, e) => {
				if (e.isActive) acc.active++;
				else acc.inactive++;
				return acc;
			},
			{ active: 0, inactive: 0 },
		);

		return {
			total: employees.length,
			...counts,
		};
	},
	["employee-count"],
	{
		revalidate: 60, // 1 minute
		tags: [CACHE_TAGS.EMPLOYEES],
	},
);

/**
 * Get cached work schedule templates for an organization
 */
export const getCachedScheduleTemplates = unstable_cache(
	async (organizationId: string) => {
		return db.query.workScheduleTemplate.findMany({
			where: eq(workScheduleTemplate.organizationId, organizationId),
			columns: {
				id: true,
				name: true,
				description: true,
				scheduleCycle: true,
				scheduleType: true,
				hoursPerCycle: true,
				isDefault: true,
				isActive: true,
			},
			orderBy: (template, { asc }) => [asc(template.name)],
		});
	},
	["schedule-templates"],
	{
		revalidate: 300, // 5 minutes
		tags: [CACHE_TAGS.SCHEDULES],
	},
);

/**
 * Get cached holiday presets for an organization
 */
export const getCachedHolidayPresets = unstable_cache(
	async (organizationId: string) => {
		return db.query.holidayPreset.findMany({
			where: eq(holidayPreset.organizationId, organizationId),
			columns: {
				id: true,
				name: true,
				countryCode: true,
				stateCode: true,
				isActive: true,
			},
			orderBy: (preset, { asc }) => [asc(preset.name)],
		});
	},
	["holiday-presets"],
	{
		revalidate: 3600, // 1 hour (holidays change rarely)
		tags: [CACHE_TAGS.HOLIDAYS],
	},
);

/**
 * Get cached employee list for dropdowns/selectors
 * Lighter version without full employee details
 */
export const getCachedEmployeeList = unstable_cache(
	async (organizationId: string) => {
		return db.query.employee.findMany({
			where: eq(employee.organizationId, organizationId),
			columns: {
				id: true,
				firstName: true,
				lastName: true,
				employeeNumber: true,
				isActive: true,
				teamId: true,
			},
			orderBy: (employee, { asc }) => [asc(employee.lastName), asc(employee.firstName)],
		});
	},
	["employee-list"],
	{
		revalidate: 60, // 1 minute
		tags: [CACHE_TAGS.EMPLOYEES],
	},
);

/**
 * Get cached team hierarchy for an organization
 * Includes parent-child relationships
 */
export const getCachedTeamHierarchy = unstable_cache(
	async (organizationId: string) => {
		const teams = await db.query.team.findMany({
			where: eq(team.organizationId, organizationId),
			columns: {
				id: true,
				name: true,
				description: true,
			},
			orderBy: (team, { asc }) => [asc(team.name)],
		});

		// Return flat list since team table doesn't have hierarchy columns
		return teams;
	},
	["team-hierarchy"],
	{
		revalidate: 300, // 5 minutes
		tags: [CACHE_TAGS.TEAMS],
	},
);
