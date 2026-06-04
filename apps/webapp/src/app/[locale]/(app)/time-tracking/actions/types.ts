import type { timeEntry } from "@/db/schema";
import type { ComplianceWarning } from "@/lib/effect/services/work-policy.service";

export interface CorrectionRequest {
	workPeriodId: string;
	newClockInDate: string;
	newClockInTime: string;
	newClockOutDate?: string;
	newClockOutTime?: string;
	reason: string;
}

export interface SameDayEditRequest {
	workPeriodId: string;
	newClockInDate: string;
	newClockInTime: string;
	newClockOutDate?: string;
	newClockOutTime?: string;
	reason?: string;
}

export interface TimeEntryDeletionRequest {
	workPeriodId: string;
	reason: string;
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

export interface BrowserTimezoneContext {
	browserTimezone?: string | null;
}

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
	employeeId?: string;
	date: string;
	clockInTime: string;
	clockOutTime: string;
	reason: string;
	timezone?: string;
	browserTimezone?: string | null;
	projectId?: string;
	workCategoryId?: string;
}
