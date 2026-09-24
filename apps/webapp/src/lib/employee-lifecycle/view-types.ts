/**
 * Client-safe lifecycle read models. Only serializable public facts: task
 * payloads, session or claim tokens and internal error text never appear here.
 */

export type EmployeeOffboardingState =
	| "active"
	| "scheduled"
	| "blocked"
	| "offboarded"
	| "legacy_inactive";

export type OffboardingReviewKind =
	| "clock_out"
	| "clock_repair"
	| "approval_handover"
	| "future_work"
	| "employment_terms";

export type OffboardingFollowUpTaskKind =
	| "dispatch_departure"
	| "session_revocation"
	| "billing_sync"
	| "clock_postprocess"
	| "notify_review"
	| "clock_repair"
	| "approval_handover";

export interface EmployeeOffboardingView {
	employeeId: string;
	organizationId: string;
	employmentPeriodId: string | null;
	state: EmployeeOffboardingState;
	departure: null | {
		id: string;
		revision: number;
		mode: "scheduled" | "immediate";
		lastWorkingDay: string | null;
		/** ISO instant. */
		cutoff: string;
		/** Zone frozen when the cutoff was calculated; format the cutoff in it. */
		timezone: string;
		replacementEmployeeId: string | null;
		blockedReason: string | null;
	};
	/** The period an effective departure ended, required to confirm a rehire. */
	previousEmploymentPeriodId: string | null;
	/** Rehire needs approved membership; otherwise re-invite first. */
	membershipApproved: boolean;
	followUp: { pending: number; failed: number; openReviews: number };
	/** Failed follow-up work an admin may retry. */
	failedTasks: Array<{ id: string; kind: OffboardingFollowUpTaskKind }>;
	reviews: Array<{
		id: string;
		kind: OffboardingReviewKind;
		status: "open" | "resolved";
		/** Allow-listed machine reason, for example `no_replacement`. */
		reason: string | null;
		/** Handover task to assign a replacement for, when the review is about one. */
		handoverTaskId: string | null;
		actionUrl: string;
	}>;
	/** Work dated after the cutoff; kept, never deleted, and managed where it lives. */
	futureWork: { shifts: number; absences: number; employmentTerms: number };
	capabilities: {
		schedule: boolean;
		cancel: boolean;
		offboardNow: boolean;
		rehire: boolean;
		resolve: boolean;
	};
}

export interface DepartureReplacementOption {
	employeeId: string;
	name: string;
}

export type DeparturePreviewException =
	| "running_timer"
	| "future_shifts"
	| "future_absences"
	| "unassigned_approval_duties"
	| "legacy_approval_duties"
	| "owner_authorization_required"
	| "final_accessible_owner";

/** Advisory, side-effect free; submission recomputes everything. */
export interface EmployeeDeparturePreview {
	lastWorkingDay: string | null;
	cutoff: string;
	timezone: string;
	pendingDutyCount: number;
	replacementOptions: DepartureReplacementOption[];
	exceptions: DeparturePreviewException[];
}
