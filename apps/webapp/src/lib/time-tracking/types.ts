import type { timeEntry, workPeriod } from "@/db/schema";
import type { DailyWorkActualMinutes, LiveWork } from "@/lib/calendar/types";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
export type TimeEntry = typeof timeEntry.$inferSelect;
export type WorkPeriod = typeof workPeriod.$inferSelect;

export interface ActiveWorkPeriod {
	workPeriod: WorkPeriod;
	clockInEntry: TimeEntry;
	elapsedMinutes: number;
}

export interface WorkPeriodWithEntries extends WorkPeriod {
	clockInEntry: TimeEntry;
	clockOutEntry: TimeEntry | null;
}

/** Day totals summed over today, this week and this month, live work included. */
export interface DayTotalSummary {
	todayMinutes: number;
	weekMinutes: number;
	monthMinutes: number;
	// Surcharge credits (optional - only present when surcharges are enabled)
	todaySurchargeMinutes?: number;
	weekSurchargeMinutes?: number;
	monthSurchargeMinutes?: number;
}

/** What it takes to recompute the day totals at a later instant while live work runs. */
export interface DayTotalBasis {
	timezone: string;
	weekStartDay: WeekStartDay;
	/** Completed work per local day, split at local midnight. */
	completedMinutesByDate: DailyWorkActualMinutes;
	/** Surcharge per local day on which its work period started. */
	surchargeMinutesByDate: DailyWorkActualMinutes;
	liveWork: LiveWork[];
}

export interface TimeSummary extends DayTotalSummary {
	/** Lets the client advance the totals as live work runs. */
	dayTotalBasis?: DayTotalBasis;
}

export interface CorrectionRequest {
	workPeriodId: string;
	newClockInTime: string;
	newClockOutTime?: string;
	reason: string;
}

export interface ServerActionResult<T = void> {
	success: boolean;
	data?: T;
	error?: string;
	holidayName?: string;
}
