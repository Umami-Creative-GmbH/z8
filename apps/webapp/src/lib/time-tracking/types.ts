import type { TimeEntry, WorkPeriod } from "@/db/schema";

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
