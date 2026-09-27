import type { employee, timeEntry } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { ComplianceWarning } from "@/lib/effect/services/work-policy.service";
import type { AttributionIntent, ClockChannel } from "../close-active-work";
import type { WorkLocationType } from "../work-location";

/** An authenticated human clocking their own employee record. */
export type ClockActor = {
	userId: string;
	employee: typeof employee.$inferSelect;
	/**
	 * Fallback zone for the event capture when the adapter supplies no device
	 * zone: the web uses the saved user setting, bots their temporal context.
	 */
	resolveTimezone(): Promise<string>;
};

/**
 * Where a command's operation identity came from. Client and derived identities
 * name one attempt across retries and replay a committed result; a server
 * identity names only this attempt and is never replayed.
 */
export type OperationIdentity = {
	origin: "client" | "derived" | "server";
	id: string;
};

/** Who asks. Adapters authenticate the principal; the module authorizes it. */
export type ClockPrincipal = { kind: "user"; userId: string };

/** When the command happened: sampled by the server, or captured by the device. */
export type ClockCommandAt = { kind: "now" } | { kind: "occurred"; instant: Instant };

/** The zones the event capture may use: the device's, else the fallback. */
export type ClockCommandZone = {
	device: string | null;
	fallback: string;
};

/**
 * The instants an occurred command may carry, chosen by its adapter. Checked
 * after committed replay, so a retried old command that committed replays.
 */
export type ClockCommandFreshness = { earliest: Instant; latest: Instant };

export type ClockOutBody = {
	kind: "clock_out";
	project: AttributionIntent;
	workCategory: AttributionIntent;
};

export type ClockInBody = {
	kind: "clock_in";
	workLocationType: WorkLocationType;
};

/**
 * A break on the active work: it closes the work `breakMinutes` before the
 * command's instant and resumes it at that instant.
 */
export type BreakBody = {
	kind: "break";
	breakMinutes: number;
};

export type ClockBody = ClockInBody | ClockOutBody | BreakBody;

type ClockCommandOf<Body extends ClockBody> = {
	organizationId: string;
	principal: ClockPrincipal;
	/** The employee whose live work changes. */
	subject: { employeeId: string };
	identity: OperationIdentity;
	channel: ClockChannel;
	at: ClockCommandAt;
	zone: ClockCommandZone;
	freshness?: ClockCommandFreshness;
	body: Body;
};

export type ClockInCommand = ClockCommandOf<ClockInBody>;
export type ClockOutCommand = ClockCommandOf<ClockOutBody>;
export type BreakCommand = ClockCommandOf<BreakBody>;
export type ClockCommand = ClockInCommand | ClockOutCommand | BreakCommand;

/** Refusals every clock command can meet. */
type SharedClockFailure =
	| "access_denied"
	| "billing_required"
	| "invalid_command"
	| "admission_window"
	| "collision"
	| "append_review_required"
	/** Nothing was written; retrying is safe. */
	| "failed"
	/** The only outcome where work may have been saved. */
	| "unconfirmed";

export type ClockOutFailure =
	| SharedClockFailure
	| "not_clocked_in"
	| "project_not_allowed"
	| "work_category_not_allowed"
	| "invalid_interval";

export type ClockInFailure =
	| SharedClockFailure
	| "already_clocked_in"
	| "holiday_blocked"
	| "occupancy_conflict"
	| "invalid_work_location";

export type BreakFailure =
	| SharedClockFailure
	| "not_clocked_in"
	| "invalid_break_duration"
	/** The break would close the work at or before its start. */
	| "invalid_interval"
	/** Only the resumed half: a holiday never refuses closing work. */
	| "holiday_blocked"
	/** The active work has an unresolved approval or correction. */
	| "under_review"
	/** Other recorded work occupies the resumed interval. */
	| "occupancy_conflict";

/** One failure taxonomy; each adapter words every code. */
export type ClockCommandFailure = ClockOutFailure | ClockInFailure | BreakFailure;

/** Refusals every clock command can meet, with their detail. */
type SharedClockRefusal =
	| { code: "billing_required"; reason: string }
	| { code: "admission_window"; reason: "too_old" | "in_future" }
	| { code: "append_review_required"; requirement: unknown }
	| { code: "collision" | "failed" | "unconfirmed"; cause?: unknown };

type DetailedClockFailure =
	| SharedClockRefusal["code"]
	| "already_clocked_in"
	| "holiday_blocked"
	| "under_review";

export type ClockOutRefusal =
	| SharedClockRefusal
	| { code: Exclude<ClockOutFailure, DetailedClockFailure> };

export type ClockInRefusal =
	| SharedClockRefusal
	/** Where the employee's live work started. */
	| { code: "already_clocked_in"; since: Instant }
	| { code: "holiday_blocked"; holidayName?: string }
	| { code: Exclude<ClockInFailure, DetailedClockFailure> };

export type BreakRefusal =
	| SharedClockRefusal
	| { code: "holiday_blocked"; holidayName?: string }
	/** What the work waits for: its own approval, or a time correction. */
	| { code: "under_review"; review: "approval" | "time_correction" }
	| { code: Exclude<BreakFailure, DetailedClockFailure> };

export type ClockRefusal = ClockInRefusal | ClockOutRefusal | BreakRefusal;

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

/** The committed clock-in entry. */
export type ClockInResult = typeof timeEntry.$inferSelect;

export type ClockOutOutcome =
	| {
			outcome: "executed" | "replayed";
			result: ClockOutResult;
			/** The stored duration; null only for a replayed legacy row without one. */
			durationMinutes: number | null;
	  }
	| { outcome: "refused"; failure: ClockOutRefusal };

export type ClockInOutcome =
	| { outcome: "executed" | "replayed"; result: ClockInResult }
	| { outcome: "refused"; failure: ClockInRefusal };

/** The work a committed break resumed. */
export type BreakResult = {
	workPeriodId: string;
	start: Instant;
};

export type BreakOutcome =
	| { outcome: "executed" | "replayed"; result: BreakResult }
	| { outcome: "refused"; failure: BreakRefusal };

export type ClockOutcome = ClockInOutcome | ClockOutOutcome | BreakOutcome;
