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
	| "approval_handover"
	| "notify_deputy_release";

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
	/**
	 * Other employees' absences that name this employee as deputy and have not
	 * ended at the cutoff; the departure clears the deputy on them (#1014).
	 */
	deputyAbsences: number;
	/**
	 * The departing employee's work balance (#1002). Information only: it never
	 * blocks the departure, its follow-up or the release gate. Null for an
	 * employee who is not departing, and while offboarding is not released.
	 */
	workBalance: OffboardingWorkBalance | null;
	capabilities: {
		schedule: boolean;
		cancel: boolean;
		offboardNow: boolean;
		rehire: boolean;
		resolve: boolean;
	};
}

export interface OffboardingWorkBalance {
	/** The figure every work-balance view reads; null while it is not calculated yet. */
	balance: { balanceMinutes: number; computedThroughDate: string } | null;
	/**
	 * A final overtime payout, offered when the balance is positive and the
	 * viewer may record overtime payouts. Recording it re-checks everything.
	 */
	finalPayout: {
		/** Local date (`YYYY-MM-DD`) in the employee's effective timezone. */
		defaultDay: string;
		/** The whole remaining balance. */
		defaultMinutes: number;
		/** Today in the employee's effective timezone: a payout may not be dated later. */
		latestDay: string;
	} | null;
}

export interface DepartureReplacementOption {
	employeeId: string;
	name: string;
}

export type DeparturePreviewException =
	| "running_timer"
	| "future_shifts"
	| "future_absences"
	/** The employee is deputy on running or upcoming absences (#1014). */
	| "deputy_absences"
	| "unassigned_approval_duties"
	| "legacy_approval_duties"
	/** The chosen replacement is not one of the replacements offered. */
	| "replacement_ineligible"
	/** Some duties were requested by the chosen replacement; admins resolve them. */
	| "replacement_requested_duties"
	/** Later stages name only this employee and need a replacement. */
	| "later_stages_without_replacement"
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
