import type { employee, timeEntry } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { ComplianceWarning } from "@/lib/effect/services/work-policy.service";
import type { AttributionIntent, ClockChannel, CloseActiveWorkResult } from "../close-active-work";
import type { ProjectTaskIneligibility } from "../project-eligibility";
import type { TimeEntryRequestMetadata } from "../time-entry-writer";
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

/**
 * Who asks. Adapters authenticate the principal; the module authorizes it. A
 * departure is the offboarding's system actor: it closes the departing
 * employee's work only inside that departure's own work transaction (#476
 * decisions 5 and 20), attributed to the human who recorded the departure.
 */
export type ClockPrincipal =
	| { kind: "user"; userId: string }
	| { kind: "departure"; departureId: string; userId: string }
	/** userId supplies required creator provenance, never human authority. */
	| {
			kind: "automatic_clock_out";
			userId: string;
			operationId: string;
			workPeriodId: string;
	  };

/**
 * The employee whose live work changes: the principal's own, or, `onBehalf`,
 * another employee's. Only a clock-out of a named period runs on behalf, and only
 * for an owner, an admin or the employee's direct manager; never for oneself. A
 * departure's subject is its departing employee, never on behalf.
 */
export type ClockSubject = { employeeId: string; onBehalf?: boolean };

/** When the command happened: sampled by the server, or captured by the device. */
export type ClockCommandAt = { kind: "now" } | { kind: "occurred"; instant: Instant };

/** The zones the event capture may use: the device's, else the fallback. */
export type ClockCommandZone = {
	device: string | null;
	fallback: string;
};

/**
 * The instants an occurred command may carry, chosen by its adapter. Checked
 * after committed replay, so a retried old command that committed replays. The
 * window covers the command's endpoints and any further device observations.
 */
export type ClockCommandFreshness = {
	earliest: Instant;
	latest: Instant;
	/** Device observations the command carries besides its endpoints. */
	observed?: readonly Instant[];
};

/**
 * A frozen clock command's bytes, as its client froze them before the first
 * attempt. The receipt stores them as its command, so they are the collision
 * fingerprint, and the append writer reads its fields from them. Frozen
 * commands run only under append admission.
 */
export type FrozenClockPayload = {
	readonly version: number;
	readonly operationId: string;
	readonly [field: string]: unknown;
};

/**
 * The work a closure closes: the employee's active work, a known period, or the
 * period a named start operation (a clock-in or a break's resume) created.
 */
export type ClockTarget =
	| { kind: "active" }
	| { kind: "period"; workPeriodId: string }
	| { kind: "started_by"; operationId: string };

export type ClockOutBody = {
	kind: "clock_out";
	/** Absent: the employee's active work. */
	target?: ClockTarget;
	project: AttributionIntent;
	workCategory: AttributionIntent;
	/**
	 * The task of the project (#873). Absent, the task follows the project: kept
	 * while the project stays, cleared when it changes.
	 */
	task?: AttributionIntent;
};

export type ClockInBody = {
	kind: "clock_in";
	workLocationType: WorkLocationType;
};

/** Where a break closed the work: its instant and the zone observed there. */
export type BreakStart = { instant: Instant; zone: string };

/**
 * A break on the target: it closes the work at the break start and resumes it at
 * the command's instant. The start is either `breakMinutes` before that instant
 * or an observed instant of its own.
 */
export type BreakBody = {
	kind: "break";
	/** Absent: the employee's active work. */
	target?: ClockTarget;
} & ({ breakMinutes: number; start?: never } | { start: BreakStart; breakMinutes?: never });

export type ClockBody = ClockInBody | ClockOutBody | BreakBody;

/**
 * The device position taken at the clock event (#826, Time Tracking ADR 0004).
 * Only the employee's own web/PWA commands may carry one; the module keeps it
 * as a position stamp only when the capture check passes inside the work
 * transaction, and otherwise silently drops it.
 */
export type ClockPosition = {
	latitude: number;
	longitude: number;
	accuracyMeters: number;
	/** When the device determined the position; a cached fix may predate the event. */
	fixedAt: Instant;
};

type ClockCommandOf<Body extends ClockBody> = {
	organizationId: string;
	principal: ClockPrincipal;
	subject: ClockSubject;
	identity: OperationIdentity;
	channel: ClockChannel;
	at: ClockCommandAt;
	zone: ClockCommandZone;
	freshness?: ClockCommandFreshness;
	payload?: FrozenClockPayload;
	/**
	 * A legacy clock command: an old consumer's request on the legacy direct
	 * route (#266). It commits only under legacy admission; an adopted
	 * organization answers only its committed replays (#327).
	 */
	legacy?: true;
	/** The position taken at the event; see `ClockPosition`. Never part of a web receipt. */
	position?: ClockPosition;
	body: Body;
};

export type ClockInCommand = ClockCommandOf<ClockInBody>;
export type ClockOutCommand = ClockCommandOf<ClockOutBody>;
export type BreakCommand = ClockCommandOf<BreakBody> & {
	/**
	 * The adapter's request evidence, stored on the hash-chained entries an
	 * unadopted organization's break writes. Absent, those entries record the
	 * channel's source, as the operation's own entries always do.
	 */
	request?: TimeEntryRequestMetadata;
};
export type ClockCommand = ClockInCommand | ClockOutCommand | BreakCommand;

/** Refusals every clock command can meet. */
type SharedClockFailure =
	| "access_denied"
	| "billing_required"
	| "invalid_command"
	| "admission_window"
	| "collision"
	| "append_review_required"
	/** A frozen command in an organization that has not adopted append admission. */
	| "frozen_not_accepted"
	/** A legacy command in an adopted organization, which it never commits. */
	| "legacy_not_accepted"
	/** Nothing was written; retrying is safe. */
	| "failed"
	/** The only outcome where work may have been saved. */
	| "unconfirmed";

/** Refusals of a named close target; the active target refuses `not_clocked_in`. */
type ClockTargetFailure = "target_unknown" | "target_not_active";

export type ClockOutFailure =
	| SharedClockFailure
	| ClockTargetFailure
	| "not_clocked_in"
	| "project_not_allowed"
	/** The task cannot be booked; the refusal names why (#873). */
	| "task_not_allowed"
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
	| ClockTargetFailure
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
	| "under_review"
	| "task_not_allowed";

export type ClockOutRefusal =
	| SharedClockRefusal
	| { code: "task_not_allowed"; reason: ProjectTaskIneligibility }
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
			/** The committed receipt; null for a legacy closure, which keeps none. */
			receipt: CloseActiveWorkResult | null;
	  }
	| { outcome: "refused"; failure: ClockOutRefusal };

export type ClockInOutcome =
	| { outcome: "executed" | "replayed"; result: ClockInResult }
	| { outcome: "refused"; failure: ClockInRefusal };

/** The work a committed break resumed; an executed break adds its closure's advice. */
export type BreakResult = {
	workPeriodId: string;
	start: Instant;
} & Pick<ClockOutResult, "complianceWarnings" | "breakAdjustment">;

export type BreakOutcome =
	| { outcome: "executed" | "replayed"; result: BreakResult }
	| { outcome: "refused"; failure: BreakRefusal };

export type ClockOutcome = ClockInOutcome | ClockOutOutcome | BreakOutcome;
