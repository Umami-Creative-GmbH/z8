"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { holiday, holidayCategory } from "@/db/schema";
import { dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";
import type { HolidayEvent } from "./types";

interface HolidayWithCategory {
	holiday: typeof holiday.$inferSelect;
	category: typeof holidayCategory.$inferSelect;
}

/**
 * Check if a date is a holiday that blocks time entry
 */
export async function isHolidayBlockingTimeEntry(
	organizationId: string,
	date: Date,
): Promise<{ isBlocked: boolean; holiday: HolidayWithCategory | null }> {
	// Convert to DateTime and get day boundaries
	const dateDT = dateFromDB(date);
	if (!dateDT) return { isBlocked: false, holiday: null };

	const dateStart = dateToDB(dateDT.startOf("day"))!;
	const dateEnd = dateToDB(dateDT.endOf("day"))!;

	// Query non-recurring holidays
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
				eq(holidayCategory.blocksTimeEntry, true),
				eq(holiday.recurrenceType, "yearly"),
			),
		);

	// Check if date matches any recurring holiday
	for (const { holiday: h, category } of recurringHolidays) {
		if (h.recurrenceRule) {
			const rule = JSON.parse(h.recurrenceRule);
			const dateMonth = dateDT.month; // Luxon months are 1-indexed
			const dateDay = dateDT.day;

			if (rule.month === dateMonth && rule.day === dateDay) {
				// Check if recurrence has ended
				if (h.recurrenceEndDate) {
					const recurrenceEndDT = dateFromDB(h.recurrenceEndDate);
					if (recurrenceEndDT && dateDT > recurrenceEndDT) {
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

	// Convert date range to DateTime
	const startDT = dateFromDB(startDate);
	const endDT = dateFromDB(endDate);
	if (!startDT || !endDT) return events;

	for (const { holiday: h, category: cat } of recurringHolidays) {
		if (!h.recurrenceRule) continue;

		const rule = JSON.parse(h.recurrenceRule);

		// Generate instances for each year in the date range
		for (let year = startDT.year; year <= endDT.year; year++) {
			const instanceDT = DateTime.utc(year, rule.month, rule.day);

			// Check if instance is within the date range
			if (instanceDT < startDT || instanceDT > endDT) {
				continue;
			}

			// Check if recurrence has ended
			if (h.recurrenceEndDate) {
				const recurrenceEndDT = dateFromDB(h.recurrenceEndDate);
				if (recurrenceEndDT && instanceDT > recurrenceEndDT) {
					continue;
				}
			}

			events.push({
				id: `${h.id}-${year}`,
				type: "holiday",
				date: dateToDB(instanceDT)!, // Convert back to Date for interface compatibility
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
	// Calculate date range for the month (month is 0-indexed in JavaScript, 1-indexed in Luxon)
	const startDT = DateTime.utc(year, month + 1, 1).startOf("day");
	const endDT = startDT.endOf("month");

	// Convert to Date objects for Drizzle query
	const startDate = dateToDB(startDT)!;
	const endDate = dateToDB(endDT)!;

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
	// Convert to DateTime and get day boundaries
	const dateDT = dateFromDB(date);
	if (!dateDT) return false;

	const dateStart = dateToDB(dateDT.startOf("day"))!;
	const dateEnd = dateToDB(dateDT.endOf("day"))!;

	// Check non-recurring holidays
	const nonRecurringHolidays = await db
		.select()
		.from(holiday)
		.innerJoin(holidayCategory, eq(holiday.categoryId, holidayCategory.id))
		.where(
			and(
				eq(holiday.organizationId, organizationId),
				eq(holiday.isActive, true),
				eq(holidayCategory.isActive, true),
				eq(holidayCategory.excludeFromCalculations, true),
				eq(holiday.recurrenceType, "none"),
				lte(holiday.startDate, dateEnd),
				gte(holiday.endDate, dateStart),
			),
		)
		.limit(1);

	if (nonRecurringHolidays.length > 0) {
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
			const dateMonth = dateDT.month; // Luxon months are 1-indexed
			const dateDay = dateDT.day;

			if (rule.month === dateMonth && rule.day === dateDay) {
				if (h.recurrenceEndDate) {
					const recurrenceEndDT = dateFromDB(h.recurrenceEndDate);
					if (recurrenceEndDT && dateDT > recurrenceEndDT) {
						continue;
					}
				}
				return true;
			}
		}
	}

	return false;
}
