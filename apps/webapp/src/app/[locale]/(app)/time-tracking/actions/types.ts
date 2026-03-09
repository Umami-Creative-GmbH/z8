import type { timeEntry } from "@/db/schema";
import type { ComplianceWarning } from "@/lib/effect/services/work-policy.service";

export interface CorrectionRequest {
	workPeriodId: string;
	newClockInTime: string;
	newClockOutTime?: string;
	reason: string;
}

export interface SameDayEditRequest {
	workPeriodId: string;
	newClockInTime: string;
	newClockOutTime?: string;
	reason?: string;
}

export interface BreakAdjustmentInfo {
	breakMinutes: number;
	breakInsertedAt: string;
	regulationName: string;
	originalDurationMinutes: number;
	adjustedDurationMinutes: number;
}

export type ClockOutResult = typeof timeEntry.$inferSelect & {
	complianceWarnings?: ComplianceWarning[];
	breakAdjustment?: BreakAdjustmentInfo;
	pendingApproval?: boolean;
};

export interface AssignedProject {
	id: string;
	name: string;
	color: string | null;
	status: string;
	budgetHours: number | null;
	deadline: string | null;
	totalHoursBooked: number;
}

export interface ManualTimeEntryInput {
	date: string;
	clockInTime: string;
	clockOutTime: string;
	reason: string;
	projectId?: string;
	workCategoryId?: string;
}
