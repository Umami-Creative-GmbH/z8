import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
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
import {
	comparePlainDates,
	dateFromInstant,
	instantFromDate,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { holidayCalendarDate, holidayStoredDates } from "@/lib/holidays/recurrence";
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

function tryToUtcDay(date: Date): PlainDate | null {
	try {
		return plainDateAt(instantFromDate(date), "UTC");
	} catch {
		return null;
	}
}

export function getAssignedHolidayDateKeys(holidays: AssignedHolidayRange[]): Set<string> {
	const dateKeys = new Set<string>();

	for (const holiday of holidays) {
		let cursor = tryToUtcDay(holiday.startDate);
		const end = tryToUtcDay(holiday.endDate);
		if (!cursor || !end || comparePlainDates(end, cursor) < 0) continue;

		while (comparePlainDates(cursor, end) <= 0) {
			dateKeys.add(cursor.toString());
			cursor = cursor.add({ days: 1 });
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

type AssignmentScope = {
	assignmentType: string;
	employeeId: string | null;
	teamId: string | null;
};
function assignmentAppliesTo(
	row: AssignmentScope,
	person: { id: string; teamId: string | null },
): boolean {
	return (
		row.assignmentType === "organization" ||
		(row.assignmentType === "employee" && row.employeeId === person.id) ||
		(row.assignmentType === "team" && row.teamId !== null && row.teamId === person.teamId)
	);
}
function getBatchAssignmentScope(
	table:
		| typeof holidayAssignment
		| typeof holidayPresetAssignment
		| typeof holidayCategoryAssignment,
	employeeIds: string[],
	teamIds: string[],
) {
	return [
		eq(table.assignmentType, "organization"),
		and(eq(table.assignmentType, "employee"), inArray(table.employeeId, employeeIds)),
		teamIds.length
			? and(eq(table.assignmentType, "team"), inArray(table.teamId, teamIds))
			: undefined,
	];
}

export function getPresetHolidayExpansionYears(startDate: Date, endDate: Date): number[] {
	const start = tryToUtcDay(startDate);
	const end = tryToUtcDay(endDate);
	if (!start || !end || end.year < start.year) return [];

	const years: number[] = [];
	for (let year = start.year - 1; year <= end.year; year++) {
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
	let startDate: PlainDate;
	try {
		startDate = Temporal.PlainDate.from(
			{
				year: params.year,
				month: params.presetHoliday.month,
				day: params.presetHoliday.day,
			},
			{ overflow: "reject" },
		);
	} catch {
		return null;
	}

	const durationDays = Math.max(1, params.presetHoliday.durationDays ?? 1);
	const endDate = startDate.add({ days: durationDays - 1 });
	const range = utcDayRange(startDate, endDate);

	return {
		id: `preset-${params.presetId}-${params.presetHoliday.id}-${params.year}`,
		name: params.presetHoliday.name,
		startDate: range.startDate,
		endDate: range.endDate,
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

/** Inclusive calendar dates as UTC midnight to the end of the last day, as presets are. */
function utcDayRange(start: PlainDate, end: PlainDate): { startDate: Date; endDate: Date } {
	return {
		startDate: dateFromInstant(start.toZonedDateTime("UTC").toInstant()),
		endDate: dateFromInstant(
			end.add({ days: 1 }).toZonedDateTime("UTC").toInstant().subtract({ milliseconds: 1 }),
		),
	};
}

function toAssignedHolidayRange(
	holiday: CustomAssignedHoliday,
	dateRange: { startDate: Date; endDate: Date },
): AssignedHolidayRange {
	return {
		id:
			dateRange.startDate.getTime() === holiday.startDate.getTime()
				? holiday.id
				: `${holiday.id}-${plainDateAt(instantFromDate(dateRange.startDate), "UTC").year}`,
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

export function expandCustomAssignedHoliday(
	holiday: CustomAssignedHoliday,
	requestedRange: RequestedDateRange,
): AssignedHolidayRange[] {
	if (!holiday.isActive) return [];

	const requestedStart = tryToUtcDay(requestedRange.startDate);
	const requestedEnd = tryToUtcDay(requestedRange.endDate);
	const originalStart = tryToUtcDay(holiday.startDate);
	const originalEnd = tryToUtcDay(holiday.endDate);
	if (
		!requestedStart ||
		!requestedEnd ||
		comparePlainDates(requestedEnd, requestedStart) < 0 ||
		!originalStart ||
		!originalEnd ||
		comparePlainDates(originalEnd, originalStart) < 0
	) {
		return [];
	}

	// Imported rows hold local-midnight instants; they are read on their calendar dates.
	const storedDates = holidayStoredDates(holiday.startDate, holiday.endDate);

	if (holiday.recurrenceType === "none") {
		const storedAsUtcDates =
			storedDates.start.equals(holidayCalendarDate(holiday.startDate)) &&
			storedDates.end.equals(holidayCalendarDate(holiday.endDate));
		const assignedHoliday = storedAsUtcDates
			? toAssignedHolidayRange(holiday, {
					startDate: holiday.startDate,
					endDate: holiday.endDate,
				})
			: {
					...toAssignedHolidayRange(holiday, utcDayRange(storedDates.start, storedDates.end)),
					id: holiday.id,
				};
		return overlapsRange(assignedHoliday, requestedRange.startDate, requestedRange.endDate)
			? [assignedHoliday]
			: [];
	}

	if (holiday.recurrenceType !== "yearly") return [];

	// The saved start date is authoritative, including for legacy malformed rules.
	const originalDate = storedDates.start;

	const durationDays = originalDate.until(storedDates.end).days + 1;
	const recurrenceEndDay = holiday.recurrenceEndDate
		? tryToUtcDay(holiday.recurrenceEndDate)
		: null;
	const recurrenceEndMs = recurrenceEndDay
		? recurrenceEndDay
				.add({ days: 1 })
				.toZonedDateTime("UTC")
				.toInstant()
				.subtract({ milliseconds: 1 }).epochMilliseconds
		: null;
	const expanded: AssignedHolidayRange[] = [];
	const firstExpansionYear = Math.max(requestedStart.year - 1, originalDate.year);

	for (let year = firstExpansionYear; year <= requestedEnd.year; year++) {
		let occurrence: PlainDate;
		try {
			occurrence = originalDate.with({ year }, { overflow: "reject" });
		} catch {
			continue; // February 29 has no occurrence in a non-leap year.
		}
		const start = occurrence.toZonedDateTime("UTC").toInstant();
		if (recurrenceEndMs !== null && start.epochMilliseconds > recurrenceEndMs) continue;
		const end = occurrence
			.add({ days: durationDays })
			.toZonedDateTime("UTC")
			.toInstant()
			.subtract({ milliseconds: 1 });
		const assignedHoliday = toAssignedHolidayRange(holiday, {
			startDate: dateFromInstant(start),
			endDate: dateFromInstant(end),
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

export async function getAssignedHolidaysForEmployees(params: {
	organizationId: string;
	employeeIds: readonly string[];
	/** Already scoped by a parent range reader, never browser-supplied. */
	employees?: readonly {
		id: string;
		organizationId: string;
		teamId: string | null;
	}[];
	startDate: Date;
	endDate: Date;
	/** The caller's client; the global db by default. */
	database?: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
}): Promise<Map<string, AssignedHolidayRange[]>> {
	const database = params.database ?? db;
	if (!params.employeeIds.length) return new Map();
	const scopedEmployees = params.employees
		? params.employees.filter(
				(person) =>
					person.organizationId === params.organizationId && params.employeeIds.includes(person.id),
			)
		: await database.query.employee.findMany({
				where: and(
					inArray(employee.id, [...params.employeeIds]),
					eq(employee.organizationId, params.organizationId),
				),
				columns: { id: true, organizationId: true, teamId: true },
			});

	if (!scopedEmployees.length) return new Map();
	const employeeIds = scopedEmployees.map((person) => person.id);
	const teamIds = scopedEmployees.flatMap((person) => (person.teamId ? [person.teamId] : []));

	const customAssignments = (await database.query.holidayAssignment.findMany({
		where: and(
			eq(holidayAssignment.organizationId, params.organizationId),
			eq(holidayAssignment.isActive, true),
			or(...getBatchAssignmentScope(holidayAssignment, employeeIds, teamIds)),
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
	})) as unknown as (DirectCustomHolidayAssignment & AssignmentScope)[];

	const categoryAssignments = (await database.query.holidayCategoryAssignment.findMany({
		where: and(
			eq(holidayCategoryAssignment.organizationId, params.organizationId),
			eq(holidayCategoryAssignment.isActive, true),
			or(...getBatchAssignmentScope(holidayCategoryAssignment, employeeIds, teamIds)),
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
	})) as unknown as (CategoryCustomHolidayAssignment & AssignmentScope)[];

	const presetAssignments = (await database.query.holidayPresetAssignment.findMany({
		columns: {
			assignmentType: true,
			employeeId: true,
			teamId: true,
			effectiveFrom: true,
			effectiveUntil: true,
		},
		where: and(
			eq(holidayPresetAssignment.organizationId, params.organizationId),
			eq(holidayPresetAssignment.isActive, true),
			or(...getBatchAssignmentScope(holidayPresetAssignment, employeeIds, teamIds)),
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
				columns: {
					id: true,
					name: true,
					organizationId: true,
					color: true,
					isActive: true,
				},
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
	})) as unknown as (HolidayPresetAssignmentWithPreset & AssignmentScope)[];

	const result = new Map<string, AssignedHolidayRange[]>();
	for (const person of scopedEmployees) {
		const holidaysById = new Map<string, AssignedHolidayRange>();

		for (const expandedHoliday of mergeAssignedCustomHolidays({
			directAssignments: customAssignments.filter((row) => assignmentAppliesTo(row, person)),
			categoryAssignments: categoryAssignments.filter((row) => assignmentAppliesTo(row, person)),
			organizationId: params.organizationId,
			startDate: params.startDate,
			endDate: params.endDate,
		})) {
			holidaysById.set(`custom-${expandedHoliday.id}`, expandedHoliday);
		}

		const expansionYears = getPresetHolidayExpansionYears(params.startDate, params.endDate);
		for (const assignment of presetAssignments.filter((row) => assignmentAppliesTo(row, person))) {
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

		result.set(
			person.id,
			Array.from(holidaysById.values()).toSorted(
				(left, right) => left.startDate.getTime() - right.startDate.getTime(),
			),
		);
	}
	return result;
}

/** A single employee uses the same assignment and expansion rules as range batches. */
export async function getAssignedHolidaysForEmployee(params: {
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
	database?: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
}): Promise<AssignedHolidayRange[]> {
	return (
		(
			await getAssignedHolidaysForEmployees({
				...params,
				employeeIds: [params.employeeId],
			})
		).get(params.employeeId) ?? []
	);
}
