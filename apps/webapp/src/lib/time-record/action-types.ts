import type { timeRecord } from "@/db/schema";

export type TimeRecord = typeof timeRecord.$inferSelect;
export type TimeRecordKind = typeof timeRecord.$inferInsert.recordKind;

export interface ListTimeRecordsFilters {
	employeeId?: string;
	recordKind?: TimeRecordKind;
	startAtFrom?: string;
	startAtTo?: string;
	limit?: number;
}
