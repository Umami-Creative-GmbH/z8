import type { ClockOutFollowUpEffects } from "@/lib/time-tracking/clocking/follow-ups";
import type { PolicyClockOutSurchargeSnapshot } from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot.types";
import type { DepartureTaskContext } from "./delivery";
import type { DepartureTaskClaim } from "./outbox";

/** What a departure's closure stages for its `clock_postprocess` task. */
export type ClockPostprocessPayload = {
	workPeriodId: string;
	durationMinutes: number;
	periodStartedAt: string;
	timezone: string;
	createdBy: string;
	surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
	/** The closed work's project; absent on tasks staged before #485. */
	projectId?: string | null;
	/** True when the closure committed its own work-balance refresh intent. */
	balanceRefreshCommitted?: boolean;
};

/** Progress a retried task resumes from. */
type PostprocessProgress = {
	breaksEnforced?: boolean;
	affectedWorkPeriodIds?: string[];
	surchargesReconciled?: boolean;
};

type PostprocessPayload = ClockPostprocessPayload & PostprocessProgress;

/**
 * The shared clock-out effects a departure runs durably. Compliance is not among
 * them, although its totals no longer depend on a request session (#524):
 * - A departure closes the timer at its cutoff, the start of the day after the
 *   last working day, not at a reported end of work. A timer still running then
 *   is usually a forgotten clock-out, which the departure already flags for
 *   review (*Needs review: offboarding clock-out*). Checking it would log daily
 *   and weekly violations measured to the cutoff, and a later correction of the
 *   period never retracts them.
 * - Its warnings advise whoever clocked out, and a departure has no one to advise.
 * An on-behalf clock-out differs: a manager states the end, so it is checked.
 */
export type ClockPostprocessEffects = Omit<ClockOutFollowUpEffects, "checkCompliance">;

function parsePayload(payload: Record<string, unknown>): PostprocessPayload {
	if (
		typeof payload.workPeriodId !== "string" ||
		typeof payload.durationMinutes !== "number" ||
		typeof payload.periodStartedAt !== "string" ||
		typeof payload.timezone !== "string" ||
		typeof payload.createdBy !== "string"
	) {
		throw new Error("invalid_clock_postprocess_payload");
	}
	return payload as unknown as PostprocessPayload;
}

/**
 * A departure's clock-out follow-ups, made durable (#476 decision 14): the shared
 * clock-out effects in the order `afterCommitFollowUps` runs them, break
 * enforcement for this exact period, surcharges for the periods it touched
 * (using the snapshot taken at close), the work balance unless the closure
 * committed its refresh, then budget warnings. A failed step fails the task;
 * each completed step is recorded on it, so a retry resumes instead of replaying
 * an effect or applying it to an unrelated later period.
 */
export function createClockPostprocessHandler(effects: ClockPostprocessEffects) {
	return async (claim: DepartureTaskClaim, context: DepartureTaskContext) => {
		const payload = parsePayload(claim.payload);
		const scope = { organizationId: claim.organizationId, employeeId: claim.employeeId };

		let affectedWorkPeriodIds = payload.affectedWorkPeriodIds ?? [payload.workPeriodId];
		if (!payload.breaksEnforced) {
			const result = await effects.enforceBreaks({
				...scope,
				workPeriodId: payload.workPeriodId,
				durationMinutes: payload.durationMinutes,
				timezone: payload.timezone,
				createdBy: payload.createdBy,
			});
			affectedWorkPeriodIds = result.affectedWorkPeriodIds;
			await context.recordProgress({ breaksEnforced: true, affectedWorkPeriodIds });
		}

		if (!payload.surchargesReconciled && payload.surchargeSnapshot) {
			await effects.reconcileSurcharges({
				...scope,
				affectedWorkPeriodIds,
				snapshot: payload.surchargeSnapshot,
			});
			await context.recordProgress({ surchargesReconciled: true });
		}

		if (!payload.balanceRefreshCommitted) {
			await effects.markBalanceDirty({
				...scope,
				dirtyFromDate: payload.periodStartedAt.slice(0, 10),
			});
		}

		if (payload.projectId) {
			await effects.checkProjectBudget(payload.projectId, claim.organizationId);
		}
	};
}
