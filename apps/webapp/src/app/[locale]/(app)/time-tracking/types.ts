import type { timeEntry } from "@/db/schema";

export interface WorkPeriodWithEntries {
	id: string;
	employeeId: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	clockIn: typeof timeEntry.$inferSelect;
	clockOut: typeof timeEntry.$inferSelect | undefined;
}

export interface TimeSummary {
	totalMinutes: number;
	totalHours: number;
	periodCount: number;
	averageHoursPerDay: number;
}
