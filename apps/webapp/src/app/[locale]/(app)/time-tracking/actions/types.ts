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

/** Error code returned when the actor may not create entries for the target. */
export const MANUAL_ENTRY_TARGET_NOT_AUTHORIZED = "target_not_authorized";

/** Where a manual-entry target's effective zone came from. */
export type ManualEntryTargetZoneSource = "employee" | "organization" | "default";

export interface ManualEntryCategoryChoice {
	id: string;
	name: string;
	factor: string;
	color: string | null;
}

/** Advisory form context for a creation-authorized manual-entry target. */
export interface ManualEntryTargetContext {
	targetEmployeeId: string;
	isOwnEntry: boolean;
	timezone: string;
	timezoneSource: ManualEntryTargetZoneSource;
	projects: AssignedProject[];
	categories: ManualEntryCategoryChoice[];
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
