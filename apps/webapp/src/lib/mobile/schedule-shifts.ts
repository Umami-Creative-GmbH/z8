import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { shift } from "@/db/schema";
import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

/** The mobile schedule shows this many of the organization's calendar days, from today on. */
const MOBILE_SCHEDULE_DAYS = 28;

export interface MobileScheduleShift {
	id: string;
	/** The organization-local calendar date, `YYYY-MM-DD`. */
	date: string;
	startTime: string;
	endTime: string;
	status: "draft" | "published";
	notes: string | null;
	color: string | null;
}

/** The employee's published shifts of the organization's next 28 calendar days, from today. */
export async function loadMobileScheduleShifts(input: {
	organizationId: string;
	employeeId: string;
	now: Instant;
}): Promise<MobileScheduleShift[]> {
	const timezone = await loadOrganizationTimezone(db, input.organizationId);
	const today = plainDateAt(input.now, timezone);
	const bounds = shiftDateRangeBounds(today, today.add({ days: MOBILE_SCHEDULE_DAYS }), timezone);

	const rows = await db.query.shift.findMany({
		columns: {
			id: true,
			date: true,
			startTime: true,
			endTime: true,
			status: true,
			notes: true,
			color: true,
		},
		where: and(
			eq(shift.organizationId, input.organizationId),
			eq(shift.employeeId, input.employeeId),
			eq(shift.status, "published"),
			gte(shift.date, bounds.start),
			lt(shift.date, bounds.endExclusive),
		),
		orderBy: [asc(shift.date), asc(shift.startTime)],
	});

	return rows.map((row) => ({
		...row,
		date: shiftCalendarDate(row.date, timezone).toString(),
	}));
}
