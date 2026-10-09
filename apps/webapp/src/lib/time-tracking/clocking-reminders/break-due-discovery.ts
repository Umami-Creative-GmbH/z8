import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { type InstantRange, localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import { complianceTotalsOf } from "@/lib/time-tracking/compliance-totals";

type Database = Pick<typeof db, "select">;

/** What the break-due reminder evaluates for one employee's live work. */
export interface BreakDueFacts {
	liveWork: { id: string; start: Instant };
	/** Completed work on the live work's local start day, the live work left out. */
	completedMinutes: number;
	/** Breaks taken on that day so far. */
	breakMinutes: number;
}

/**
 * The live work of a page of employees and the work and breaks on its local start day (the
 * compliance day), read without a work transaction. Employees without live work are left out.
 */
export async function loadBreakDueFacts(
	input: {
		organizationId: string;
		employees: readonly { employeeId: string; timezone: string }[];
	},
	database: Database,
): Promise<Map<string, BreakDueFacts>> {
	const facts = new Map<string, BreakDueFacts>();
	if (input.employees.length === 0) return facts;
	const live = await database
		.select({ id: workPeriod.id, employeeId: workPeriod.employeeId, start: workPeriod.startTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(
					workPeriod.employeeId,
					input.employees.map((person) => person.employeeId),
				),
				isNull(workPeriod.deletedAt),
				eq(workPeriod.isActive, true),
				isNull(workPeriod.endTime),
				isNull(workPeriod.clockOutId),
			),
		)
		.orderBy(desc(workPeriod.startTime));
	const timezones = new Map(input.employees.map((person) => [person.employeeId, person.timezone]));
	const days = new Map<string, { liveWork: BreakDueFacts["liveWork"]; day: InstantRange }>();
	for (const row of live) {
		const timezone = timezones.get(row.employeeId);
		// Rows come latest first: an employee's most recent live work wins.
		if (!timezone || days.has(row.employeeId)) continue;
		const start = instantFromDate(row.start);
		const localDate = start.toZonedDateTimeISO(timezone).toPlainDate().toString();
		days.set(row.employeeId, {
			liveWork: { id: row.id, start },
			day: localDayRange(localDate, timezone),
		});
	}
	if (days.size === 0) return facts;

	const ranges = [...days.values()].map((entry) => entry.day);
	const from = ranges.reduce((earliest, range) =>
		compareInstants(range.start, earliest.start) < 0 ? range : earliest,
	).start;
	const until = ranges.reduce((latest, range) =>
		compareInstants(range.endExclusive, latest.endExclusive) > 0 ? range : latest,
	).endExclusive;
	const periods = await database
		.select({
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.employeeId, [...days.keys()]),
				isNull(workPeriod.deletedAt),
				gte(workPeriod.startTime, dateFromInstant(from)),
				lt(workPeriod.startTime, dateFromInstant(until)),
			),
		);
	for (const [employeeId, { liveWork, day }] of days) {
		const totals = complianceTotalsOf(
			periods
				.filter((period) => period.employeeId === employeeId)
				.map((period) => ({
					start: instantFromDate(period.startTime),
					end: period.endTime ? instantFromDate(period.endTime) : null,
					durationMinutes: period.durationMinutes,
				})),
			{ day, week: day },
		);
		facts.set(employeeId, {
			liveWork,
			completedMinutes: totals.dailyMinutes,
			breakMinutes: totals.breakMinutes,
		});
	}
	return facts;
}
