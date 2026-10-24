import { and, eq, gt, isNotNull, lt } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import {
	compareInstants,
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import {
	allocateProtectedMinutes,
	employeePayrollWindow,
} from "@/lib/payroll-allocation/protected-minutes";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import { loadEmployeeTrackingContext } from "@/lib/time-tracking/tracking-start";
import type { WorkBalanceDbClient } from "./db-client";

/** Use the payroll interval allocation rule; keep the original work and captures intact. */
export async function sumTrackedWorkMinutes(
	client: Pick<WorkBalanceDbClient, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		startDate: string;
		throughDate: string;
		timezone: string;
	},
): Promise<number> {
	if (input.startDate > input.throughDate) return 0;
	const window = employeePayrollWindow(
		input.startDate,
		input.throughDate,
		input.timezone,
	);
	const periods = await loadTrackedWorkPeriods(client, input, window);
	return allocateTrackedWorkMinutes(periods, window);
}

/** Null lets historical/legacy readers retain their previous aggregation. */
export async function sumWorkMinutesWithinTracking(
	client: Pick<WorkBalanceDbClient, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		startDate: Date;
		endDate: Date;
	},
): Promise<number | null> {
	const tracking = await loadEmployeeTrackingContext(client, input);
	if (!tracking) return null;
	const firstDay = plainDateAt(
		instantFromDate(input.startDate),
		tracking.timezone,
	).toString();
	return sumTrackedWorkMinutes(client, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		timezone: tracking.timezone,
		startDate: firstDay > tracking.startDate ? firstDay : tracking.startDate,
		throughDate: plainDateAt(
			instantFromDate(input.endDate),
			tracking.timezone,
		).toString(),
	});
}

/** Daily overtime flags use employee-local tracking days while charts retain raw history. */
export async function readTrackedDailyWorkMinutes(
	client: Pick<WorkBalanceDbClient, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		startDate: Date;
		endDate: Date;
	},
): Promise<{ timezone: string; minutesByDate: Record<string, number> } | null> {
	const tracking = await loadEmployeeTrackingContext(client, input);
	if (!tracking) return null;
	const requestedStart = plainDateAt(
		instantFromDate(input.startDate),
		tracking.timezone,
	).toString();
	const startDate =
		requestedStart > tracking.startDate ? requestedStart : tracking.startDate;
	const throughDate = plainDateAt(
		instantFromDate(input.endDate),
		tracking.timezone,
	).toString();
	const minutesByDate: Record<string, number> = {};
	if (startDate > throughDate)
		return { timezone: tracking.timezone, minutesByDate };
	const window = employeePayrollWindow(
		startDate,
		throughDate,
		tracking.timezone,
	);
	const periods = await loadTrackedWorkPeriods(client, input, window);
	return allocateTrackedDailyWorkMinutes(periods, {
		startDate,
		throughDate,
		timezone: tracking.timezone,
	});
}

/** The same protected-minute allocation for completed periods already read in a range batch. */
export function allocateTrackedDailyWorkMinutes(
	periods: readonly TrackedWorkPeriod[],
	input: { startDate: string; throughDate: string; timezone: string },
): { timezone: string; minutesByDate: Record<string, number> } {
	const { startDate, throughDate, timezone } = input;
	const minutesByDate: Record<string, number> = {};
	if (startDate > throughDate) return { timezone, minutesByDate };
	const window = employeePayrollWindow(startDate, throughDate, timezone);
	const dayWindows: Record<string, TrackingWindow> = {};
	for (
		let day = parsePlainDate(startDate);
		day.toString() <= throughDate;
		day = day.add({ days: 1 })
	) {
		const date = day.toString();
		dayWindows[date] = employeePayrollWindow(date, date, timezone);
		minutesByDate[date] = 0;
	}
	for (const period of periods) {
		if (!period.endTime) continue;
		const start = instantFromDate(period.startTime);
		const end = instantFromDate(period.endTime);
		if (
			compareInstants(start, window.endExclusive) >= 0 ||
			compareInstants(end, window.start) <= 0
		)
			continue;
		if (compareInstants(end, start) < 0) {
			// Retain the allocator's reconciliation failure for invalid history.
			allocateTrackedWorkMinutes([period], window);
			continue;
		}
		const periodStartDate = plainDateAt(start, timezone).toString();
		// A positive interval ending at midnight belongs only to preceding days.
		const lastInstant =
			compareInstants(start, end) < 0 ? end.subtract({ nanoseconds: 1 }) : end;
		const periodEndDate = plainDateAt(lastInstant, timezone).toString();
		const firstDay = periodStartDate > startDate ? periodStartDate : startDate;
		const lastDay = periodEndDate < throughDate ? periodEndDate : throughDate;
		for (
			let day = parsePlainDate(firstDay);
			day.toString() <= lastDay;
			day = day.add({ days: 1 })
		) {
			const date = day.toString();
			minutesByDate[date] += allocateTrackedWorkMinutes(
				[period],
				dayWindows[date],
			);
		}
	}
	return { timezone: timezone, minutesByDate };
}

type TrackingWindow = ReturnType<typeof employeePayrollWindow>;
type TrackedWorkPeriod = Pick<
	typeof workPeriod.$inferSelect,
	"startTime" | "endTime" | "durationMinutes"
>;

/** All tracking consumers share the established completed-work inclusion rule. */
function loadTrackedWorkPeriods(
	client: Pick<WorkBalanceDbClient, "select">,
	input: { organizationId: string; employeeId: string },
	window: TrackingWindow,
) {
	return client
		.select({
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				completedWorkPeriodCondition(),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.durationMinutes),
				lt(workPeriod.startTime, dateFromInstant(window.endExclusive)),
				gt(workPeriod.endTime, dateFromInstant(window.start)),
			),
		);
}

function allocateTrackedWorkMinutes(
	periods: readonly TrackedWorkPeriod[],
	window: TrackingWindow,
): number {
	let total = 0;
	for (const period of periods) {
		if (!period.endTime) continue;
		const allocation = allocateProtectedMinutes(
			{
				startAt: instantFromDate(period.startTime),
				endAt: instantFromDate(period.endTime),
				storedMinutes: period.durationMinutes,
			},
			window,
		);
		if (allocation.status === "blocked")
			throw new Error(
				"Recorded work crossing the tracking boundary needs interval reconciliation.",
			);
		if (allocation.status === "allocated") total += allocation.minutes;
	}
	return total;
}
