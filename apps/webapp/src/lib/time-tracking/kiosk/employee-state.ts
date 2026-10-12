import "server-only";

import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	dateFromInstant,
	type Instant,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { readClockPresence } from "@/lib/time-tracking/clock-presence";
import { buildDayTotalBasis, summarizeDayTotals } from "@/lib/time-tracking/day-totals";
import type { WorkTransactionClient } from "@/lib/time-tracking/web-clock-out-transaction";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import type { KioskDayTotal, KioskEmployeeState } from "./protocol";

/**
 * What the kiosk shows about an employee after their PIN (#860): whether they
 * are clocked out, clocked in or on a break in progress (#861), and their day
 * total. The day total is computed as the web computes it for the employee
 * (`readTimeSummary`): in the employee's timezone and week start, never the
 * kiosk's, live work included (an open break keeps counting, ADR 0007).
 * Instants are canonical UTC strings.
 */
export async function readKioskEmployeeState(
	client: Pick<WorkTransactionClient, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		/** The employee's own calendar: their timezone and week start. */
		calendar: { timezone: string; weekStartDay: WeekStartDay };
		now: Instant;
	},
): Promise<{ state: KioskEmployeeState; dayTotal: KioskDayTotal }> {
	const { organizationId, employeeId, now } = input;
	const { timezone, weekStartDay } = input.calendar;
	const [presence] = await readClockPresence(client, { organizationId, employeeIds: [employeeId] });

	const date = now.toZonedDateTimeISO(timezone).toPlainDate().toString();
	const today = localDayRange(date, timezone);
	const periods = await client
		.select({
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				isNull(workPeriod.deletedAt),
				lt(workPeriod.startTime, dateFromInstant(today.endExclusive)),
				or(
					gt(workPeriod.endTime, dateFromInstant(today.start)),
					and(isNull(workPeriod.endTime), eq(workPeriod.isActive, true)),
				),
			),
		);
	const basis = buildDayTotalBasis({
		periods: periods.map((period) => ({ ...period, surchargeMinutes: null })),
		timezone,
		weekStartDay,
	});
	const dayTotal: KioskDayTotal = {
		date,
		timezone,
		minutes: summarizeDayTotals(basis, now).todayMinutes,
	};

	if (!presence) return { state: { status: "clocked_out" }, dayTotal };
	const since = instantToCanonicalString(presence.workSince);
	if (presence.state === "on_break" && presence.breakSince && presence.breakZone) {
		return {
			state: {
				status: "on_break",
				workPeriodId: presence.workPeriodId,
				since,
				breakSince: instantToCanonicalString(presence.breakSince),
				breakZone: presence.breakZone,
			},
			dayTotal,
		};
	}
	return { state: { status: "clocked_in", workPeriodId: presence.workPeriodId, since }, dayTotal };
}
