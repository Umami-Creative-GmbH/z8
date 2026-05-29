import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	employee,
	holiday,
	holidayAssignment,
	type holidayCategory,
	holidayCategoryAssignment,
	type holidayPreset,
	holidayPresetAssignment,
	type holidayPresetHoliday,
} from "@/db/schema";
import type { DailyWorkRequirements, HolidayEvent } from "./types";

export interface AssignedHolidayRange {
	id: string;
	name: string;
	startDate: Date;
	endDate: Date;
	categoryId?: string | null;
	color?: string | null;
	description?: string | null;
	metadata?: Partial<HolidayEvent["metadata"]>;
}

export type DirectCustomHolidayAssignment = {
	holiday: CustomAssignedHoliday | null;
};

export type CategoryCustomHolidayAssignment = {
	category:
		| (Pick<typeof holidayCategory.$inferSelect, "organizationId" | "isActive"> & {
				holidays: CustomAssignedHoliday[];
		  })
		| null;
};

export type CustomAssignedHoliday = Pick<
	typeof holiday.$inferSelect,
	| "id"
	| "name"
	| "organizationId"
	| "startDate"
	| "endDate"
	| "categoryId"
	| "description"
	| "isActive"
	| "recurrenceType"
	| "recurrenceRule"
	| "recurrenceEndDate"
>;

export type RequestedDateRange = { startDate: Date; endDate: Date };

type HolidayPresetAssignmentWithPreset = {
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	preset:
		| (Pick<
				typeof holidayPreset.$inferSelect,
				"id" | "name" | "organizationId" | "color" | "isActive"
		  > & {
				holidays: Pick<
					typeof holidayPresetHoliday.$inferSelect,
					| "id"
					| "name"
					| "description"
					| "month"
					| "day"
					| "durationDays"
					| "categoryId"
					| "isActive"
				>[];
		  })
		| null;
};

function toUtcDay(date: Date): DateTime {
	return DateTime.fromJSDate(date, { zone: "utc" }).startOf("day");
}

export function getAssignedHolidayDateKeys(holidays: AssignedHolidayRange[]): Set<string> {
	const dateKeys = new Set<string>();

	for (const holiday of holidays) {
		let cursor = toUtcDay(holiday.startDate);
		const end = toUtcDay(holiday.endDate);
		if (!cursor.isValid || !end.isValid || end < cursor) continue;

		while (cursor <= end) {
			const dateKey = cursor.toISODate();
			if (dateKey) dateKeys.add(dateKey);
			cursor = cursor.plus({ days: 1 });
		}
	}

	return dateKeys;
}

export function applyAssignedHolidayAdjustmentsToRequirements(
	requirements: DailyWorkRequirements,
	holidays: AssignedHolidayRange[],
): DailyWorkRequirements {
	const holidayDateKeys = getAssignedHolidayDateKeys(holidays);
	const adjusted: DailyWorkRequirements = {};

	for (const [dateKey, requirement] of Object.entries(requirements)) {
		adjusted[dateKey] = {
			...requirement,
			requiredMinutes: holidayDateKeys.has(dateKey) ? 0 : requirement.requiredMinutes,
		};
	}

	return adjusted;
}

export function assignedHolidayToCalendarEvent(holiday: AssignedHolidayRange): HolidayEvent {
	return {
		id: holiday.id,
		type: "holiday",
		date: holiday.startDate,
		endDate: holiday.endDate,
		title: holiday.name,
		description: holiday.description ?? undefined,
		color: holiday.color ?? "#f59e0b",
		metadata: {
			categoryName: "Holiday",
			categoryType: "public_holiday",
			blocksTimeEntry: true,
			isRecurring: false,
			...holiday.metadata,
		},
	};
}

function getAssignmentScope(
	table:
		| typeof holidayAssignment
		| typeof holidayPresetAssignment
		| typeof holidayCategoryAssignment,
	employeeId: string,
	teamId: string | null,
) {
	const scope = [eq(table.assignmentType, "organization")];
	if (teamId) scope.push(and(eq(table.assignmentType, "team"), eq(table.teamId, teamId))!);
	scope.push(and(eq(table.assignmentType, "employee"), eq(table.employeeId, employeeId))!);
	return scope;
}

export function getPresetHolidayExpansionYears(startDate: Date, endDate: Date): number[] {
	const startYear = toUtcDay(startDate).year;
	const endYear = toUtcDay(endDate).year;
	if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || endYear < startYear) return [];

	const years: number[] = [];
	for (let year = startYear - 1; year <= endYear; year++) {
		years.push(year);
	}
	return years;
}

function expandPresetHolidayForYear(params: {
	presetId: string;
	presetName: string;
	presetColor: string | null;
	presetHoliday: Pick<
		typeof holidayPresetHoliday.$inferSelect,
		"id" | "name" | "description" | "month" | "day" | "durationDays" | "categoryId"
	>;
	year: number;
}): AssignedHolidayRange | null {
	const start = DateTime.utc(
		params.year,
		params.presetHoliday.month,
		params.presetHoliday.day,
	).startOf("day");
	if (!start.isValid) return null;

	const durationDays = Math.max(1, params.presetHoliday.durationDays ?? 1);
	const end = start.plus({ days: durationDays - 1 }).endOf("day");

	return {
		id: `preset-${params.presetId}-${params.presetHoliday.id}-${params.year}`,
		name: params.presetHoliday.name,
		startDate: start.toJSDate(),
		endDate: end.toJSDate(),
		categoryId: params.presetHoliday.categoryId,
		color: params.presetColor,
		description: params.presetHoliday.description,
		metadata: {
			isRecurring: true,
			presetId: params.presetId,
			presetName: params.presetName,
		},
	};
}

function overlapsRange(holiday: AssignedHolidayRange, startDate: Date, endDate: Date): boolean {
	return holiday.startDate <= endDate && holiday.endDate >= startDate;
}

function toAssignedHolidayRange(
	holiday: CustomAssignedHoliday,
	dateRange: { startDate: Date; endDate: Date },
): AssignedHolidayRange {
	return {
		id:
			dateRange.startDate.getTime() === holiday.startDate.getTime()
				? holiday.id
				: `${holiday.id}-${toUtcDay(dateRange.startDate).year}`,
		name: holiday.name,
		startDate: dateRange.startDate,
		endDate: dateRange.endDate,
		categoryId: holiday.categoryId,
		description: holiday.description,
		metadata: {
			isRecurring: holiday.recurrenceType !== "none",
		},
	};
}

function parseYearlyRecurrenceRule(rule: string | null): { month: number; day: number } | null {
	if (!rule) return null;

	try {
		const parsed = JSON.parse(rule) as { month?: unknown; day?: unknown };
		const { month, day } = parsed;
		if (typeof month !== "number" || typeof day !== "number") return null;
		if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
		return { month, day };
	} catch {
		return null;
	}
}

export function expandCustomAssignedHoliday(
	holiday: CustomAssignedHoliday,
	requestedRange: RequestedDateRange,
): AssignedHolidayRange[] {
	if (!holiday.isActive) return [];

	const requestedStart = toUtcDay(requestedRange.startDate);
	const requestedEnd = toUtcDay(requestedRange.endDate).endOf("day");
	const originalStart = toUtcDay(holiday.startDate);
	const originalEnd = toUtcDay(holiday.endDate);
	if (
		!requestedStart.isValid ||
		!requestedEnd.isValid ||
		requestedEnd < requestedStart ||
		!originalStart.isValid ||
		!originalEnd.isValid ||
		originalEnd < originalStart
	) {
		return [];
	}

	if (holiday.recurrenceType === "none") {
		const assignedHoliday = toAssignedHolidayRange(holiday, {
			startDate: holiday.startDate,
			endDate: holiday.endDate,
		});
		return overlapsRange(assignedHoliday, requestedRange.startDate, requestedRange.endDate)
			? [assignedHoliday]
			: [];
	}

	if (holiday.recurrenceType !== "yearly") return [];

	const rule = parseYearlyRecurrenceRule(holiday.recurrenceRule);
	if (!rule) return [];

	const durationDays = Math.floor(originalEnd.diff(originalStart, "days").days) + 1;
	const recurrenceEnd = holiday.recurrenceEndDate
		? toUtcDay(holiday.recurrenceEndDate).endOf("day")
		: null;
	const expanded: AssignedHolidayRange[] = [];
	const firstExpansionYear = Math.max(requestedStart.year - 1, originalStart.year);

	for (let year = firstExpansionYear; year <= requestedEnd.year; year++) {
		const start = DateTime.utc(year, rule.month, rule.day).startOf("day");
		if (!start.isValid) continue;
		if (recurrenceEnd && start > recurrenceEnd) continue;

		const end = start.plus({ days: durationDays - 1 }).endOf("day");
		const assignedHoliday = toAssignedHolidayRange(holiday, {
			startDate: start.toJSDate(),
			endDate: end.toJSDate(),
		});
		if (overlapsRange(assignedHoliday, requestedRange.startDate, requestedRange.endDate)) {
			expanded.push(assignedHoliday);
		}
	}

	return expanded;
}

export function overlapsEffectiveWindow(
	holiday: AssignedHolidayRange,
	window: { effectiveFrom: Date | null; effectiveUntil: Date | null },
): boolean {
	return (
		(!window.effectiveFrom || holiday.endDate >= window.effectiveFrom) &&
		(!window.effectiveUntil || holiday.startDate <= window.effectiveUntil)
	);
}

export function mergeAssignedCustomHolidays(params: {
	directAssignments: DirectCustomHolidayAssignment[];
	categoryAssignments: CategoryCustomHolidayAssignment[];
	organizationId: string;
	startDate: Date;
	endDate: Date;
}): AssignedHolidayRange[] {
	const holidaysById = new Map<string, AssignedHolidayRange>();

	for (const assignment of params.directAssignments) {
		const assignedHoliday = assignment.holiday;
		if (!assignedHoliday || assignedHoliday.organizationId !== params.organizationId) {
			continue;
		}

		for (const expandedHoliday of expandCustomAssignedHoliday(assignedHoliday, params)) {
			holidaysById.set(`custom-${expandedHoliday.id}`, expandedHoliday);
		}
	}

	for (const assignment of params.categoryAssignments) {
		const category = assignment.category;
		if (!category?.isActive || category.organizationId !== params.organizationId) {
			continue;
		}

		for (const assignedHoliday of category.holidays) {
			if (assignedHoliday.organizationId !== params.organizationId) {
				continue;
			}

			for (const expandedHoliday of expandCustomAssignedHoliday(assignedHoliday, params)) {
				holidaysById.set(`custom-${expandedHoliday.id}`, expandedHoliday);
			}
		}
	}

	return [...holidaysById.values()];
}

export async function getAssignedHolidaysForEmployee(params: {
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
}): Promise<AssignedHolidayRange[]> {
	const scopedEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, params.employeeId),
			eq(employee.organizationId, params.organizationId),
		),
		columns: { id: true, organizationId: true, teamId: true },
	});

	if (!scopedEmployee) return [];

	const customAssignments = (await db.query.holidayAssignment.findMany({
		where: and(
			eq(holidayAssignment.organizationId, params.organizationId),
			eq(holidayAssignment.isActive, true),
			or(...getAssignmentScope(holidayAssignment, params.employeeId, scopedEmployee.teamId)),
		),
		with: {
			holiday: {
				columns: {
					id: true,
					name: true,
					organizationId: true,
					startDate: true,
					endDate: true,
					categoryId: true,
					description: true,
					isActive: true,
					recurrenceType: true,
					recurrenceRule: true,
					recurrenceEndDate: true,
				},
			},
		},
	})) as unknown as DirectCustomHolidayAssignment[];

	const categoryAssignments = (await db.query.holidayCategoryAssignment.findMany({
		where: and(
			eq(holidayCategoryAssignment.organizationId, params.organizationId),
			eq(holidayCategoryAssignment.isActive, true),
			or(
				...getAssignmentScope(holidayCategoryAssignment, params.employeeId, scopedEmployee.teamId),
			),
		),
		with: {
			category: {
				columns: { organizationId: true, isActive: true },
				with: {
					holidays: {
						columns: {
							id: true,
							name: true,
							organizationId: true,
							startDate: true,
							endDate: true,
							categoryId: true,
							description: true,
							isActive: true,
							recurrenceType: true,
							recurrenceRule: true,
							recurrenceEndDate: true,
						},
						where: and(
							eq(holiday.organizationId, params.organizationId),
							eq(holiday.isActive, true),
							or(
								and(
									eq(holiday.recurrenceType, "none"),
									lte(holiday.startDate, params.endDate),
									gte(holiday.endDate, params.startDate),
								),
								and(
									eq(holiday.recurrenceType, "yearly"),
									lte(holiday.startDate, params.endDate),
									or(
										isNull(holiday.recurrenceEndDate),
										gte(holiday.recurrenceEndDate, params.startDate),
									),
								),
							),
						),
					},
				},
			},
		},
	})) as unknown as CategoryCustomHolidayAssignment[];

	const presetAssignments = (await db.query.holidayPresetAssignment.findMany({
		columns: { effectiveFrom: true, effectiveUntil: true },
		where: and(
			eq(holidayPresetAssignment.organizationId, params.organizationId),
			eq(holidayPresetAssignment.isActive, true),
			or(...getAssignmentScope(holidayPresetAssignment, params.employeeId, scopedEmployee.teamId)),
			or(
				isNull(holidayPresetAssignment.effectiveFrom),
				lte(holidayPresetAssignment.effectiveFrom, params.endDate),
			),
			or(
				isNull(holidayPresetAssignment.effectiveUntil),
				gte(holidayPresetAssignment.effectiveUntil, params.startDate),
			),
		),
		with: {
			preset: {
				columns: { id: true, name: true, organizationId: true, color: true, isActive: true },
				with: {
					holidays: {
						columns: {
							id: true,
							name: true,
							description: true,
							month: true,
							day: true,
							durationDays: true,
							categoryId: true,
							isActive: true,
						},
					},
				},
			},
		},
	})) as unknown as HolidayPresetAssignmentWithPreset[];

	const holidaysById = new Map<string, AssignedHolidayRange>();

	for (const expandedHoliday of mergeAssignedCustomHolidays({
		directAssignments: customAssignments,
		categoryAssignments,
		organizationId: params.organizationId,
		startDate: params.startDate,
		endDate: params.endDate,
	})) {
		holidaysById.set(`custom-${expandedHoliday.id}`, expandedHoliday);
	}

	const expansionYears = getPresetHolidayExpansionYears(params.startDate, params.endDate);
	for (const assignment of presetAssignments) {
		const preset = assignment.preset;
		if (!preset?.isActive || preset.organizationId !== params.organizationId) continue;

		for (const year of expansionYears) {
			for (const presetHoliday of preset.holidays) {
				if (!presetHoliday.isActive) continue;

				const expandedHoliday = expandPresetHolidayForYear({
					presetId: preset.id,
					presetName: preset.name,
					presetColor: preset.color,
					presetHoliday,
					year,
				});
				if (
					!expandedHoliday ||
					!overlapsRange(expandedHoliday, params.startDate, params.endDate) ||
					!overlapsEffectiveWindow(expandedHoliday, assignment)
				)
					continue;

				holidaysById.set(expandedHoliday.id, expandedHoliday);
			}
		}
	}

	return [...holidaysById.values()].sort(
		(left, right) => left.startDate.getTime() - right.startDate.getTime(),
	);
}
