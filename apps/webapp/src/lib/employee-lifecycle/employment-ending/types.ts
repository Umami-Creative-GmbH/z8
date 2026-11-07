import type { AuditTrail } from "@/lib/audit-trail";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { DeactivationReason } from "../deactivation/types";
import type { ReactivationChecklistItem } from "../reactivation-checklist";
import type { DepartureMode, LifecycleClient } from "../types";
import type { EMPLOYMENT_ENDING_PARTICIPANTS } from "./participants";

/**
 * The contract of Employment ending (#1624, spec #1590): one module ends what
 * an employee holds when their employment ends, for every cause. Each context
 * ships its own participant; `participants.ts` registers them in their fixed
 * order, and `employment-ending.ts` runs them. Client-safe: types only.
 */

/** Why the employment ends. Participants derive audit reasons and metadata from it. */
export type EmploymentEndingCause =
	| { kind: "departure"; departureId: string; mode: DepartureMode }
	| {
			kind: "deactivation";
			deactivationId: string;
			reason: DeactivationReason;
	  };

/** What planning knows of the cause: a preview runs before the cause has an id. */
export type EmploymentEndingPlanCause =
	| { kind: "departure"; mode: DepartureMode }
	| { kind: "deactivation" };

/** What every plan receives; it only reads. */
export type EmploymentEndingPlanContext = {
	organizationId: string;
	employeeId: string;
	/** The open or legacy employment period that ends, when one exists. */
	employmentPeriodId: string | null;
	/** The cutoff: the moment the employment ends. */
	at: Instant;
	/** IANA zone for organization-local dates: the departure's frozen zone, else the organization's. */
	timeZone: string;
	cause: EmploymentEndingPlanCause;
};

/** What every apply receives, inside the cause's transaction. */
export type EmploymentEndingContext = Omit<EmploymentEndingPlanContext, "cause"> & {
	/** When the ending is recorded; later than `at` for a departure processed late. */
	now: Instant;
	actorUserId: string;
	/** Audit rows are written here, inside the transaction. */
	audit: AuditTrail;
	cause: EmploymentEndingCause;
};

export type EmploymentEndingReader = LifecycleClient;
export type EmploymentEndingWriter = LifecycleClient;

/** Runs after the commit; must be safe to run again on a replayed request. */
export type EmploymentEndingAfterCommit = () => Promise<void>;

/**
 * One context's part of Employment ending. `plan` reads what the employee
 * still holds with the predicate `apply` ends it by; `apply` ends what its
 * plan lists (and may re-read under its locks), writes its audit rows into
 * `ctx.audit`, and records what it ended. Both are idempotent: a second run
 * finds nothing to end. `reactivationItems` lists what to grant again after a
 * reactivation, from what was ended.
 */
export type EmploymentEndingParticipant<TPlan, TApplied, TKey extends string = string> = {
	key: TKey;
	plan(reader: EmploymentEndingReader, ctx: EmploymentEndingPlanContext): Promise<TPlan>;
	apply(
		tx: EmploymentEndingWriter,
		plan: TPlan,
		ctx: EmploymentEndingContext,
	): Promise<{
		applied: TApplied;
		afterCommit?: EmploymentEndingAfterCommit[];
	}>;
	reactivationItems(
		applied: TApplied,
		subject: { employeeId: string },
	): ReactivationChecklistItem[];
};

// biome-ignore lint/suspicious/noExplicitAny: a registry holds participants of different plan types.
export type AnyEmploymentEndingParticipant = EmploymentEndingParticipant<any, any>;

type PlanOf<P> = P extends { plan(...args: never[]): Promise<infer TPlan> } ? TPlan : never;
type AppliedOf<P> = P extends {
	reactivationItems(applied: infer TApplied, ...rest: never[]): unknown;
}
	? TApplied
	: never;

/** Each participant's plan, by its key. */
export type EmploymentEndingPlanOf<P extends readonly AnyEmploymentEndingParticipant[]> = {
	[Participant in P[number] as Participant["key"]]: PlanOf<Participant>;
};

/** What each participant ended, by its key. */
export type EmploymentEndingAppliedOf<P extends readonly AnyEmploymentEndingParticipant[]> = {
	[Participant in P[number] as Participant["key"]]: AppliedOf<Participant>;
};

/** The registered participants' plans: what an ending would end now. */
export type EmploymentEndingPlan = EmploymentEndingPlanOf<typeof EMPLOYMENT_ENDING_PARTICIPANTS>;
/** What the registered participants ended, as a deactivation's ledger row stores it. */
export type EmploymentEndingApplied = EmploymentEndingAppliedOf<
	typeof EMPLOYMENT_ENDING_PARTICIPANTS
>;
