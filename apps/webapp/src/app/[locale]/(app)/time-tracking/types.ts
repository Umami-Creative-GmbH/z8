import type { timeEntry, workPeriod } from "@/db/schema";

export type WorkPeriodWithEntries = typeof workPeriod.$inferSelect & {
	clockIn: typeof timeEntry.$inferSelect;
	clockOut: typeof timeEntry.$inferSelect | undefined;
};

export interface TimeSummary {
	totalMinutes: number;
	totalHours: number;
	periodCount: number;
	averageHoursPerDay: number;
}
