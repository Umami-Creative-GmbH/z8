import "server-only";

import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { readClockPresence } from "@/lib/time-tracking/clock-presence";
import { buildDayTotalBasis, summarizeDayTotals } from "@/lib/time-tracking/day-totals";
import type { WorkTransactionClient } from "@/lib/time-tracking/web-clock-out-transaction";
import type { KioskDayTotal, KioskEmployeeState } from "./protocol";

/**
 * What the kiosk shows about an employee after their PIN (#860): whether they
 * are clocked out, clocked in or on a break in progress (#861), and today's day
 * total in the kiosk's zone, live work included (an open break keeps counting,
 * ADR 0007). Instants are canonical UTC strings; the device formats them in the
 * kiosk's zone.
 */
export async function readKioskEmployeeState(
	client: Pick<WorkTransactionClient, "select">,
	input: { organizationId: string; employeeId: string; timezone: string; now: Instant },
): Promise<{ state: KioskEmployeeState; dayTotal: KioskDayTotal }> {
	const { organizationId, employeeId, timezone, now } = input;
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
		weekStartDay: "monday",
	});
	const dayTotal: KioskDayTotal = {
		date,
		timezone,
		todayMinutes: summarizeDayTotals(basis, now).todayMinutes,
	};

	if (!presence) return { state: { status: "clocked_out" }, dayTotal };
	const since = instantToCanonicalString(instantFromDate(presence.workSince));
	if (presence.state === "on_break" && presence.breakSince) {
		return {
			state: {
				status: "on_break",
				workPeriodId: presence.workPeriodId,
				since,
				breakSince: instantToCanonicalString(instantFromDate(presence.breakSince)),
				breakZone: presence.breakZone ?? timezone,
			},
			dayTotal,
		};
	}
	return { state: { status: "clocked_in", workPeriodId: presence.workPeriodId, since }, dayTotal };
}
