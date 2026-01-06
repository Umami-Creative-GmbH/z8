"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { holiday, holidayCategory } from "@/db/schema";
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
	const dateStart = new Date(date);
	dateStart.setHours(0, 0, 0, 0);

	const dateEnd = new Date(date);
	dateEnd.setHours(23, 59, 59, 999);

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
			const dateMonth = date.getMonth() + 1; // JS months are 0-indexed
			const dateDay = date.getDate();

			if (rule.month === dateMonth && rule.day === dateDay) {
				// Check if recurrence has ended
				if (h.recurrenceEndDate && date > h.recurrenceEndDate) {
					continue;
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

	for (const { holiday: h, category: cat } of recurringHolidays) {
		if (!h.recurrenceRule) continue;

		const rule = JSON.parse(h.recurrenceRule);

		// Generate instances for each year in the date range
		for (let year = startDate.getFullYear(); year <= endDate.getFullYear(); year++) {
			const instanceDate = new Date(year, rule.month - 1, rule.day);

			// Check if instance is within the date range
			if (instanceDate < startDate || instanceDate > endDate) {
				continue;
			}

			// Check if recurrence has ended
			if (h.recurrenceEndDate && instanceDate > h.recurrenceEndDate) {
				continue;
			}

			events.push({
				id: `${h.id}-${year}`,
				type: "holiday",
				date: instanceDate,
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
	const startDate = new Date(year, month, 1);
	const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

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
	const dateStart = new Date(date);
	dateStart.setHours(0, 0, 0, 0);

	const dateEnd = new Date(date);
	dateEnd.setHours(23, 59, 59, 999);

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
			const dateMonth = date.getMonth() + 1;
			const dateDay = date.getDate();

			if (rule.month === dateMonth && rule.day === dateDay) {
				if (h.recurrenceEndDate && date > h.recurrenceEndDate) {
					continue;
				}
				return true;
			}
		}
	}

	return false;
}
