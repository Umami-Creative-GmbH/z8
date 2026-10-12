import { and, asc, eq, gt, gte, lt, lte, or } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { shift } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { getInstantLocalMinuteFields } from "@/lib/datetime/temporal-format";
import { shiftCalendarDate, shiftDateBounds } from "./shift-date";

/** How many shifts the employee's dashboard lists. */
export const UPCOMING_SHIFTS_LIMIT = 5;

export interface UpcomingShift {
	id: string;
	/** The organization-local shift date, `YYYY-MM-DD`. */
	date: string;
	/** Organization-local wall time, `HH:mm`. */
	startTime: string;
	/** Organization-local wall time, `HH:mm`; at or before `startTime` when the shift ends the next day. */
	endTime: string;
	notes: string | null;
	subareaName: string | null;
	locationName: string | null;
}

export interface UpcomingShifts {
	/** Today in the organization's zone, `YYYY-MM-DD`, so the viewer's zone never moves the day. */
	today: string;
	shifts: UpcomingShift[];
}

/**
 * Where "upcoming" starts at `now`: today's shifts that have not ended yet, then every later
 * shift date. Days and wall times are the organization's. Yesterday's night shift is left out
 * even while it still runs past midnight.
 */
export function upcomingShiftWindow(now: Instant, organizationTimezone: string) {
	const local = getInstantLocalMinuteFields(now, organizationTimezone);
	const todayBounds = shiftDateBounds(local.date, organizationTimezone);
	return {
		today: local.date,
		todayStart: todayBounds.start,
		tomorrowStart: todayBounds.endExclusive,
		currentTime: local.time,
	};
}

type UpcomingShiftRecord = Pick<
	typeof shift.$inferSelect,
	"id" | "date" | "startTime" | "endTime" | "notes"
> & {
	subarea: { name: string; location: { name: string } | null } | null;
};

export function toUpcomingShift(
	row: UpcomingShiftRecord,
	organizationTimezone: string,
): UpcomingShift {
	return {
		id: row.id,
		date: shiftCalendarDate(row.date, organizationTimezone).toString(),
		startTime: row.startTime,
		endTime: row.endTime,
		notes: row.notes,
		subareaName: row.subarea?.name ?? null,
		locationName: row.subarea?.location?.name ?? null,
	};
}

/** The employee's next published shifts in the organization, earliest first. */
export async function loadUpcomingShifts(
	database: typeof appDb,
	input: {
		organizationId: string;
		employeeId: string;
		organizationTimezone: string;
		now: Instant;
		limit: number;
	},
): Promise<UpcomingShifts> {
	const bounds = upcomingShiftWindow(input.now, input.organizationTimezone);

	const rows = await database.query.shift.findMany({
		columns: { id: true, date: true, startTime: true, endTime: true, notes: true },
		with: {
			subarea: {
				columns: { name: true },
				with: { location: { columns: { name: true } } },
			},
		},
		where: and(
			eq(shift.organizationId, input.organizationId),
			eq(shift.employeeId, input.employeeId),
			eq(shift.status, "published"),
			or(
				gte(shift.date, bounds.tomorrowStart),
				and(
					gte(shift.date, bounds.todayStart),
					lt(shift.date, bounds.tomorrowStart),
					// Today's shift is upcoming until it ends; one ending at or before its start ends
					// tomorrow (`shiftEndsNextDay`).
					or(gt(shift.endTime, bounds.currentTime), lte(shift.endTime, shift.startTime)),
				),
			),
		),
		orderBy: [asc(shift.date), asc(shift.startTime)],
		limit: input.limit,
	});

	return {
		today: bounds.today,
		shifts: rows.map((row) => toUpcomingShift(row, input.organizationTimezone)),
	};
}
