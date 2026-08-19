import type { timeEntry } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { ComplianceWarning } from "@/lib/effect/services/work-policy.service";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";

export interface CorrectionRequest {
	workPeriodId: string;
	submissionId: string;
	newClockInDate: string;
	newClockInTime: string;
	newClockOutDate?: string;
	newClockOutTime?: string;
	reason: string;
	workLocationType: WorkLocationType;
	workCategoryId: string | null;
}

export interface SameDayEditRequest {
	workPeriodId: string;
	newClockInDate: string;
	newClockInTime: string;
	newClockOutDate?: string;
	newClockOutTime?: string;
	reason?: string;
	workLocationType: WorkLocationType;
	workCategoryId: string | null;
}

export interface TimeEntryDeletionRequest {
	workPeriodId: string;
	submissionId: string;
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

export interface ClockOutActionContext extends BrowserTimezoneContext {
	submissionId: string;
	instant?: Instant;
	deviceInfo?: "web" | "mobile";
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
	submissionId: string;
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
