import type { timeRecord } from "@/db/schema";

export type TimeRecord = typeof timeRecord.$inferSelect;
export type TimeRecordKind = typeof timeRecord.$inferInsert.recordKind;
export type TimeRecordApprovalState = typeof timeRecord.$inferInsert.approvalState;
export type TimeRecordOrigin = typeof timeRecord.$inferInsert.origin;

export interface CreateTimeRecordInput {
	employeeId: string;
	recordKind: TimeRecordKind;
	startAt: string;
	endAt?: string | null;
	durationMinutes?: number | null;
	approvalState?: TimeRecordApprovalState;
	origin?: TimeRecordOrigin;
}

export interface ListTimeRecordsFilters {
	employeeId?: string;
	recordKind?: TimeRecordKind;
	startAtFrom?: string;
	startAtTo?: string;
	limit?: number;
}
