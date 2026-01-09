"use server";

import { and, eq, isNull, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	employee,
	holidayCategory,
	holidayPreset,
	holidayPresetAssignment,
	holidayPresetHoliday,
} from "@/db/schema";
import { dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";
import type { HolidayEvent } from "./types";

// Type for a resolved preset with source info
export interface ResolvedPreset {
	preset: typeof holidayPreset.$inferSelect | null;
	source: "employee" | "team" | "organization" | "none";
	assignment: typeof holidayPresetAssignment.$inferSelect | null;
}

// Type for holiday check result
export interface HolidayCheckResult {
	isHoliday: boolean;
	holidayName?: string;
	source: "preset" | "custom" | null;
	categoryName?: string;
}

/**
 * Resolve effective preset for an employee using hierarchy:
 * Employee assignment > Team assignment > Organization default
 */
export async function getEffectivePresetForEmployee(employeeId: string): Promise<ResolvedPreset> {
	// Get employee with their team info
	const [employeeRecord] = await db
		.select({
			id: employee.id,
			organizationId: employee.organizationId,
			teamId: employee.teamId,
		})
		.from(employee)
		.where(eq(employee.id, employeeId))
		.limit(1);

	if (!employeeRecord) {
		return { preset: null, source: "none", assignment: null };
	}

	const now = new Date();

	// 1. Check for employee-specific assignment (priority 2)
	const [employeeAssignment] = await db
		.select({
			assignment: holidayPresetAssignment,
			preset: holidayPreset,
		})
		.from(holidayPresetAssignment)
		.innerJoin(holidayPreset, eq(holidayPresetAssignment.presetId, holidayPreset.id))
		.where(
			and(
				eq(holidayPresetAssignment.employeeId, employeeId),
				eq(holidayPresetAssignment.assignmentType, "employee"),
				eq(holidayPresetAssignment.isActive, true),
				eq(holidayPreset.isActive, true),
				or(
					isNull(holidayPresetAssignment.effectiveFrom),
					eq(holidayPresetAssignment.effectiveFrom, now),
				),
				or(
					isNull(holidayPresetAssignment.effectiveUntil),
					eq(holidayPresetAssignment.effectiveUntil, now),
				),
			),
		)
		.limit(1);

	if (employeeAssignment) {
		return {
			preset: employeeAssignment.preset,
			source: "employee",
			assignment: employeeAssignment.assignment,
		};
	}

	// 2. Check for team assignment (priority 1) if employee has a team
	if (employeeRecord.teamId) {
		const [teamAssignment] = await db
			.select({
				assignment: holidayPresetAssignment,
				preset: holidayPreset,
			})
			.from(holidayPresetAssignment)
			.innerJoin(holidayPreset, eq(holidayPresetAssignment.presetId, holidayPreset.id))
			.where(
				and(
					eq(holidayPresetAssignment.teamId, employeeRecord.teamId),
					eq(holidayPresetAssignment.assignmentType, "team"),
					eq(holidayPresetAssignment.isActive, true),
					eq(holidayPreset.isActive, true),
					or(
						isNull(holidayPresetAssignment.effectiveFrom),
						eq(holidayPresetAssignment.effectiveFrom, now),
					),
					or(
						isNull(holidayPresetAssignment.effectiveUntil),
						eq(holidayPresetAssignment.effectiveUntil, now),
					),
				),
			)
			.limit(1);

		if (teamAssignment) {
			return {
				preset: teamAssignment.preset,
				source: "team",
				assignment: teamAssignment.assignment,
			};
		}
	}

	// 3. Check for organization default (priority 0)
	const [orgAssignment] = await db
		.select({
			assignment: holidayPresetAssignment,
			preset: holidayPreset,
		})
		.from(holidayPresetAssignment)
		.innerJoin(holidayPreset, eq(holidayPresetAssignment.presetId, holidayPreset.id))
		.where(
			and(
				eq(holidayPresetAssignment.organizationId, employeeRecord.organizationId),
				eq(holidayPresetAssignment.assignmentType, "organization"),
				eq(holidayPresetAssignment.isActive, true),
				eq(holidayPreset.isActive, true),
				or(
					isNull(holidayPresetAssignment.effectiveFrom),
					eq(holidayPresetAssignment.effectiveFrom, now),
				),
				or(
					isNull(holidayPresetAssignment.effectiveUntil),
					eq(holidayPresetAssignment.effectiveUntil, now),
				),
			),
		)
		.limit(1);

	if (orgAssignment) {
		return {
			preset: orgAssignment.preset,
			source: "organization",
			assignment: orgAssignment.assignment,
		};
	}

	return { preset: null, source: "none", assignment: null };
}

/**
 * Check if date is a holiday for a specific employee based on their preset
 */
export async function isHolidayForEmployee(
	employeeId: string,
	date: Date,
): Promise<HolidayCheckResult> {
	const dateDT = dateFromDB(date);
	if (!dateDT) return { isHoliday: false, source: null };

	const month = dateDT.month; // Luxon months are 1-indexed
	const day = dateDT.day;

	// Get the employee's effective preset
	const { preset } = await getEffectivePresetForEmployee(employeeId);

	if (!preset) {
		return { isHoliday: false, source: null };
	}

	// Get holidays from the preset that match the date
	const matchingHolidays = await db
		.select({
			holiday: holidayPresetHoliday,
			category: holidayCategory,
		})
		.from(holidayPresetHoliday)
		.leftJoin(holidayCategory, eq(holidayPresetHoliday.categoryId, holidayCategory.id))
		.where(
			and(
				eq(holidayPresetHoliday.presetId, preset.id),
				eq(holidayPresetHoliday.month, month),
				eq(holidayPresetHoliday.day, day),
				eq(holidayPresetHoliday.isActive, true),
			),
		)
		.limit(1);

	if (matchingHolidays.length > 0) {
		const { holiday: h, category: cat } = matchingHolidays[0];
		return {
			isHoliday: true,
			holidayName: h.name,
			source: "preset",
			categoryName: cat?.name,
		};
	}

	return { isHoliday: false, source: null };
}

/**
 * Get all holidays for an employee in a date range (for calendar display)
 */
export async function getEmployeeHolidaysInRange(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<HolidayEvent[]> {
	const events: HolidayEvent[] = [];

	const startDT = dateFromDB(startDate);
	const endDT = dateFromDB(endDate);
	if (!startDT || !endDT) return events;

	// Get the employee's effective preset
	const { preset, source } = await getEffectivePresetForEmployee(employeeId);

	if (!preset) {
		return events;
	}

	// Get all active holidays from the preset
	const presetHolidays = await db
		.select({
			holiday: holidayPresetHoliday,
			category: holidayCategory,
		})
		.from(holidayPresetHoliday)
		.leftJoin(holidayCategory, eq(holidayPresetHoliday.categoryId, holidayCategory.id))
		.where(
			and(eq(holidayPresetHoliday.presetId, preset.id), eq(holidayPresetHoliday.isActive, true)),
		);

	// Generate holiday instances for each year in the range
	for (let year = startDT.year; year <= endDT.year; year++) {
		for (const { holiday: h, category: cat } of presetHolidays) {
			// Create date for this year
			const holidayDT = DateTime.utc(year, h.month, h.day);

			// Check if within range
			if (holidayDT < startDT || holidayDT > endDT) {
				continue;
			}

			// Handle multi-day holidays
			const duration = h.durationDays || 1;
			for (let d = 0; d < duration; d++) {
				const instanceDT = holidayDT.plus({ days: d });
				if (instanceDT > endDT) break;

				const instanceDate = dateToDB(instanceDT);
				if (!instanceDate) continue;

				events.push({
					id: `preset-${preset.id}-${h.id}-${year}-${d}`,
					type: "holiday",
					date: instanceDate,
					title: h.name,
					description: h.description || undefined,
					color: cat?.color || preset.color || "#f59e0b",
					metadata: {
						categoryName: cat?.name || "Holiday",
						categoryType: cat?.type || "public_holiday",
						blocksTimeEntry: cat?.blocksTimeEntry ?? true,
						isRecurring: true,
						presetId: preset.id,
						presetName: preset.name,
						presetSource: source,
					},
				});
			}
		}
	}

	return events;
}

/**
 * Get all presets for an organization
 */
export async function getOrganizationPresets(organizationId: string) {
	return db
		.select()
		.from(holidayPreset)
		.where(and(eq(holidayPreset.organizationId, organizationId), eq(holidayPreset.isActive, true)));
}

/**
 * Get holidays for a specific preset
 */
export async function getPresetHolidays(presetId: string) {
	return db
		.select({
			holiday: holidayPresetHoliday,
			category: holidayCategory,
		})
		.from(holidayPresetHoliday)
		.leftJoin(holidayCategory, eq(holidayPresetHoliday.categoryId, holidayCategory.id))
		.where(eq(holidayPresetHoliday.presetId, presetId));
}

/**
 * Get all assignments for an organization
 */
export async function getOrganizationAssignments(organizationId: string) {
	return db
		.select({
			assignment: holidayPresetAssignment,
			preset: holidayPreset,
		})
		.from(holidayPresetAssignment)
		.innerJoin(holidayPreset, eq(holidayPresetAssignment.presetId, holidayPreset.id))
		.where(
			and(
				eq(holidayPresetAssignment.organizationId, organizationId),
				eq(holidayPresetAssignment.isActive, true),
			),
		);
}

/**
 * Check if a preset with the same location already exists
 */
export async function findExistingPresetByLocation(
	organizationId: string,
	countryCode: string,
	stateCode?: string,
	regionCode?: string,
) {
	const conditions = [
		eq(holidayPreset.organizationId, organizationId),
		eq(holidayPreset.countryCode, countryCode),
	];

	if (stateCode) {
		conditions.push(eq(holidayPreset.stateCode, stateCode));
	} else {
		conditions.push(isNull(holidayPreset.stateCode));
	}

	if (regionCode) {
		conditions.push(eq(holidayPreset.regionCode, regionCode));
	} else {
		conditions.push(isNull(holidayPreset.regionCode));
	}

	const [existing] = await db
		.select()
		.from(holidayPreset)
		.where(and(...conditions))
		.limit(1);

	return existing || null;
}
