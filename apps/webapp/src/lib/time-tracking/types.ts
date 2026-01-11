import type { timeEntry, workPeriod } from "@/db/schema";
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

export interface TimeSummary {
	todayMinutes: number;
	weekMinutes: number;
	monthMinutes: number;
	// Surcharge credits (optional - only present when surcharges are enabled)
	todaySurchargeMinutes?: number;
	weekSurchargeMinutes?: number;
	monthSurchargeMinutes?: number;
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
