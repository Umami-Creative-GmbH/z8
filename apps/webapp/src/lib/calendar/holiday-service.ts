import "server-only";

import { and, eq, gte, lte, or } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { holiday, holidayCategory } from "@/db/schema";
import { instantFromDB, instantToDB } from "@/lib/datetime/drizzle-adapter";
import { localDayRange, localMonthRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	instantFromDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { holidayStoredDatesInclude } from "@/lib/holidays/recurrence";
import type { HolidayEvent } from "./types";

/** Legacy calculation exclusion semantics, loaded once on the caller's scoped client. */
export async function loadCalculationExclusions(
	reader: Pick<typeof db, "select">,
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<(date: Date) => boolean> {
	const rows = await reader
		.select({ holiday, category: holidayCategory })
		.from(holiday)
		.innerJoin(holidayCategory, eq(holiday.categoryId, holidayCategory.id))
		.where(
			and(
				eq(holiday.organizationId, organizationId),
				eq(holidayCategory.organizationId, organizationId),
				eq(holiday.isActive, true),
				eq(holidayCategory.isActive, true),
				eq(holidayCategory.excludeFromCalculations, true),
				or(
					eq(holiday.recurrenceType, "yearly"),
					and(
						eq(holiday.recurrenceType, "none"),
						lte(holiday.startDate, dateFromInstant(instantFromDate(endDate).add({ hours: 48 }))),
						gte(
							holiday.endDate,
							dateFromInstant(instantFromDate(startDate).subtract({ hours: 48 })),
						),
					),
				),
			),
		);
	return (date) => {
		const instant = instantFromDate(date);
		const day = instant.toZonedDateTimeISO("UTC");
		// One-off rows are read on their calendar dates, as the assigned-holiday reader does.
		if (
			rows.some(
				({ holiday: h }) =>
					h.recurrenceType === "none" &&
					holidayStoredDatesInclude(h.startDate, h.endDate, day.toPlainDate()),
			)
		)
			return true;
		for (const { holiday: h } of rows) {
			if (h.recurrenceType !== "yearly" || !h.recurrenceRule) continue;
			const rule = JSON.parse(h.recurrenceRule);
			if (
				rule.month === day.month &&
				rule.day === day.day &&
				(!h.recurrenceEndDate ||
					compareInstants(instant, instantFromDate(h.recurrenceEndDate)) <= 0)
			)
				return true;
		}
		return false;
	};
}

interface HolidayWithCategory {
	holiday: typeof holiday.$inferSelect;
	category: typeof holidayCategory.$inferSelect;
}

/**
 * Check if a date is a holiday that blocks time entry
 * Uses employee's timezone to determine the calendar day for holiday matching
 */
export async function isHolidayBlockingTimeEntry(
	organizationId: string,
	date: Date,
	employeeTimezone: string = "UTC",
	/** A protected operation passes its transaction; defaults to the global client. */
	reader: Pick<typeof db, "select"> = db,
): Promise<{ isBlocked: boolean; holiday: HolidayWithCategory | null }> {
	const instant = instantFromDB(date);
	if (!instant) return { isBlocked: false, holiday: null };

	// Convert to employee's timezone to get their calendar day
	const employeeLocalDate = plainDateAt(instant, employeeTimezone);

	// Get day boundaries in employee's timezone, then convert back to UTC for DB query
	const dayWindow = localDayRange(employeeLocalDate.toString(), employeeTimezone);
	const dateStart = dateFromInstant(dayWindow.start);
	const dateEnd = dateFromInstant(dayWindow.endExclusive.subtract({ milliseconds: 1 }));

	// Query non-recurring holidays
	const nonRecurringHolidays = await reader
		.select({
			holiday: holiday,
			category: holidayCategory,
		})
		.from(holiday)
		.innerJoin(holidayCategory, eq(holiday.categoryId, holidayCategory.id))
		.where(
			and(
				eq(holiday.organizationId, organizationId),
				eq(holiday.isActive, true),
				eq(holidayCategory.organizationId, organizationId),
				eq(holidayCategory.isActive, true),
				eq(holidayCategory.blocksTimeEntry, true),
				eq(holiday.recurrenceType, "none"),
				lte(holiday.startDate, dateEnd),
				gte(holiday.endDate, dateStart),
			),
		)
		.limit(1);

	if (nonRecurringHolidays.length > 0) {
		return {
			isBlocked: true,
			holiday: nonRecurringHolidays[0],
		};
	}

	// Query recurring holidays
	const recurringHolidays = await reader
		.select({
			holiday: holiday,
			category: holidayCategory,
		})
		.from(holiday)
		.innerJoin(holidayCategory, eq(holiday.categoryId, holidayCategory.id))
		.where(
			and(
				eq(holiday.organizationId, organizationId),
				eq(holiday.isActive, true),
				eq(holidayCategory.organizationId, organizationId),
				eq(holidayCategory.isActive, true),
				eq(holidayCategory.blocksTimeEntry, true),
				eq(holiday.recurrenceType, "yearly"),
			),
		);

	// Check if date matches any recurring holiday (using employee's local calendar day)
	for (const { holiday: h, category } of recurringHolidays) {
		if (h.recurrenceRule) {
			const rule = JSON.parse(h.recurrenceRule);
			// Use employee's local date for recurring holiday matching
			const dateMonth = employeeLocalDate.month;
			const dateDay = employeeLocalDate.day;

			if (rule.month === dateMonth && rule.day === dateDay) {
				// Check if recurrence has ended
				if (h.recurrenceEndDate) {
					const recurrenceEndInstant = instantFromDB(h.recurrenceEndDate);
					if (recurrenceEndInstant && compareInstants(instant, recurrenceEndInstant) > 0) {
						continue;
					}
				}

				return {
					isBlocked: true,
					holiday: { holiday: h, category },
				};
			}
		}
	}

	return { isBlocked: false, holiday: null };
}

/**
 * Expand recurring holidays into actual date instances for a date range
 */
export async function expandRecurringHolidays(
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<HolidayEvent[]> {
	// Fetch all recurring holidays
	const recurringHolidays = await db
		.select({
			holiday: holiday,
			category: holidayCategory,
		})
		.from(holiday)
		.innerJoin(holidayCategory, eq(holiday.categoryId, holidayCategory.id))
		.where(
			and(
				eq(holiday.organizationId, organizationId),
				eq(holiday.isActive, true),
				eq(holiday.recurrenceType, "yearly"),
			),
		);

	const events: HolidayEvent[] = [];

	const startInstant = instantFromDB(startDate);
	const endInstant = instantFromDB(endDate);
	if (!startInstant || !endInstant) return events;

	const startYear = plainDateAt(startInstant, "UTC").year;
	const endYear = plainDateAt(endInstant, "UTC").year;

	for (const { holiday: h, category: cat } of recurringHolidays) {
		if (!h.recurrenceRule) continue;

		const rule = JSON.parse(h.recurrenceRule);

		// Generate instances for each year in the date range
		for (let year = startYear; year <= endYear; year++) {
			let instanceDate: Temporal.PlainDate;
			try {
				instanceDate = Temporal.PlainDate.from(
					{ year, month: rule.month, day: rule.day },
					{ overflow: "reject" },
				);
			} catch {
				continue;
			}
			const instanceInstant = instanceDate.toZonedDateTime("UTC").toInstant();

			// Check if instance is within the date range
			if (
				compareInstants(instanceInstant, startInstant) < 0 ||
				compareInstants(instanceInstant, endInstant) > 0
			) {
				continue;
			}

			// Check if recurrence has ended
			if (h.recurrenceEndDate) {
				const recurrenceEndInstant = instantFromDB(h.recurrenceEndDate);
				if (recurrenceEndInstant && compareInstants(instanceInstant, recurrenceEndInstant) > 0) {
					continue;
				}
			}

			events.push({
				id: `${h.id}-${year}`,
				type: "holiday",
				date: instantToDB(instanceInstant)!, // Convert back to Date for interface compatibility
				title: h.name,
				description: h.description || undefined,
				color: cat.color || "#f59e0b",
				metadata: {
					categoryName: cat.name,
					categoryType: cat.type,
					blocksTimeEntry: cat.blocksTimeEntry,
					isRecurring: true,
				},
			});
		}
	}

	return events;
}

/**
 * Get all holidays (recurring and non-recurring) for a month
 */
export async function getHolidaysForMonth(
	organizationId: string,
	month: number, // 0-11 (JS month format)
	year: number,
): Promise<HolidayEvent[]> {
	const monthRange = localMonthRange(`${year}-${String(month + 1).padStart(2, "0")}-01`, "UTC");

	// Convert to Date objects for Drizzle query
	const startDate = dateFromInstant(monthRange.start);
	const endDate = dateFromInstant(monthRange.endExclusive.subtract({ milliseconds: 1 }));

	// Get non-recurring holidays
	const nonRecurringHolidays = await db
		.select({
			holiday: holiday,
			category: holidayCategory,
		})
		.from(holiday)
		.innerJoin(holidayCategory, eq(holiday.categoryId, holidayCategory.id))
		.where(
			and(
				eq(holiday.organizationId, organizationId),
				eq(holiday.isActive, true),
				eq(holiday.recurrenceType, "none"),
				lte(holiday.startDate, endDate),
				gte(holiday.endDate, startDate),
			),
		);

	const events: HolidayEvent[] = nonRecurringHolidays.map(({ holiday: h, category: cat }) => ({
		id: h.id,
		type: "holiday" as const,
		date: h.startDate,
		endDate: h.endDate, // For multi-day display in schedule-x
		title: h.name,
		description: h.description || undefined,
		color: cat.color || "#f59e0b",
		metadata: {
			categoryName: cat.name,
			categoryType: cat.type,
			blocksTimeEntry: cat.blocksTimeEntry,
			isRecurring: false,
		},
	}));

	// Add recurring holidays
	const recurringEvents = await expandRecurringHolidays(organizationId, startDate, endDate);
	events.push(...recurringEvents);

	return events;
}

/**
 * Check if a date should be excluded from work hour calculations
 */
export async function shouldExcludeFromCalculations(
	organizationId: string,
	date: Date,
): Promise<boolean> {
	const instant = instantFromDB(date);
	if (!instant) return false;

	// Imported rows hold local-midnight instants up to 14 hours off the UTC day; the
	// candidates are read on their calendar dates (`holidayStoredDates`).
	const calendarDay = plainDateAt(instant, "UTC");
	const dayWindow = localDayRange(calendarDay.toString(), "UTC");

	// Check non-recurring holidays
	const nonRecurringHolidays = await db
		.select({ holiday })
		.from(holiday)
		.innerJoin(holidayCategory, eq(holiday.categoryId, holidayCategory.id))
		.where(
			and(
				eq(holiday.organizationId, organizationId),
				eq(holidayCategory.organizationId, organizationId),
				eq(holiday.isActive, true),
				eq(holidayCategory.isActive, true),
				eq(holidayCategory.excludeFromCalculations, true),
				eq(holiday.recurrenceType, "none"),
				lte(holiday.startDate, dateFromInstant(dayWindow.endExclusive.add({ hours: 48 }))),
				gte(holiday.endDate, dateFromInstant(dayWindow.start.subtract({ hours: 48 }))),
			),
		);

	if (
		nonRecurringHolidays.some(({ holiday: h }) =>
			holidayStoredDatesInclude(h.startDate, h.endDate, calendarDay),
		)
	) {
		return true;
	}

	// Check recurring holidays
	const recurringHolidays = await db
		.select({
			holiday: holiday,
			category: holidayCategory,
		})
		.from(holiday)
		.innerJoin(holidayCategory, eq(holiday.categoryId, holidayCategory.id))
		.where(
			and(
				eq(holiday.organizationId, organizationId),
				eq(holiday.isActive, true),
				eq(holidayCategory.isActive, true),
				eq(holidayCategory.excludeFromCalculations, true),
				eq(holiday.recurrenceType, "yearly"),
			),
		);

	for (const { holiday: h } of recurringHolidays) {
		if (h.recurrenceRule) {
			const rule = JSON.parse(h.recurrenceRule);
			const dateMonth = calendarDay.month;
			const dateDay = calendarDay.day;

			if (rule.month === dateMonth && rule.day === dateDay) {
				if (h.recurrenceEndDate) {
					const recurrenceEndInstant = instantFromDB(h.recurrenceEndDate);
					if (recurrenceEndInstant && compareInstants(instant, recurrenceEndInstant) > 0) {
						continue;
					}
				}
				return true;
			}
		}
	}

	return false;
}
