import type { timeEntry } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { ComplianceWarning } from "@/lib/effect/services/work-policy.service";
import type { ClockChannel } from "@/lib/time-tracking/close-active-work";
import type { ManualCommandRejection } from "./manual-command-submission";
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
	deviceInfo?: ClockChannel;
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
	/** Display name of the target, empty when none is known. */
	targetName: string;
	isOwnEntry: boolean;
	timezone: string;
	timezoneSource: ManualEntryTargetZoneSource;
	/**
	 * Advisory: `2` once the organization admits strict versioned commands
	 * (#308), otherwise `1` (legacy input). The server re-reads it under protection.
	 */
	manualCommandVersion: 1 | 2;
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

/** What a manual submission committed, for either command representation. */
export interface ManualTimeEntryCreated {
	workPeriodId: string;
	/**
	 * Whether the original submission left approval pending at commit. This is
	 * committed participation, not the current approval status.
	 */
	requiresApproval: boolean;
	wasAdjusted?: boolean;
	adjustedTimes?: {
		clockIn: string;
		clockOut: string;
		durationMinutes: number;
	};
	/** Version-2 commands only: a fresh save or the replay of a committed one. */
	disposition?: "executed" | "replayed";
}

/**
 * Why a manual submission did not commit. Version-2 commands carry the typed
 * rejection so the form can ask for exactly the missing confirmation.
 */
export type ManualTimeEntryResult =
	| { success: true; data: ManualTimeEntryCreated }
	| {
			success: false;
			error: string;
			code?: string;
			holidayName?: string;
			rejection?: ManualCommandRejection;
	  };

/** Legacy unversioned input in an organization that now requires version-2 commands. */
export const MANUAL_ENTRY_REFRESH_REQUIRED = "manual_entry_refresh_required";
/** A version-2 command in an organization that has not adopted them. */
export const MANUAL_ENTRY_NOT_ADOPTED = "manual_entry_not_adopted";
/** The submission identity names other committed work or changed evidence. */
export const MANUAL_ENTRY_COLLISION = "manual_entry_collision";
