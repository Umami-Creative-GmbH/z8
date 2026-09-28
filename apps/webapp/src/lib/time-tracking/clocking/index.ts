import "server-only";

import {
	checkComplianceAfterClockOut,
	enforceBreaksAfterClockOut,
	reconcileImmediateSurcharges,
} from "@/app/[locale]/(app)/time-tracking/actions/compliance";
import { checkProjectBudgetAfterClockOut } from "@/app/[locale]/(app)/time-tracking/actions/entry-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { createClocking } from "./clocking";
import { afterCommitFollowUps, type ClockOutFollowUpEffects } from "./follow-ups";
import { coordinatedTransactions } from "./transactions";

export {
	type Clocking,
	type ClockLookup,
	type ClockLookupQuery,
	type ClockReceipt,
	createClocking,
} from "./clocking";
export {
	afterCommitFollowUps,
	type ClockFollowUps,
	type ClockOutAdvice,
	type ClosedLiveWork,
	durableFollowUps,
	recordingFollowUps,
} from "./follow-ups";
export { workPeriodOwner } from "./on-behalf";
export {
	type ClockTransactions,
	coordinatedTransactions,
	type DepartureEnlistment,
	enlistedTransactions,
} from "./transactions";
export * from "./types";

/**
 * The production follow-up effects. Their implementations still live beside the
 * web actions; the module owns when and how they run.
 */
export const clockOutFollowUpEffects: ClockOutFollowUpEffects = {
	checkCompliance: checkComplianceAfterClockOut,
	enforceBreaks: ({ durationMinutes, ...input }) =>
		enforceBreaksAfterClockOut({ ...input, sessionDurationMinutes: durationMinutes }),
	reconcileSurcharges: reconcileImmediateSurcharges,
	markBalanceDirty: markEmployeeWorkBalanceDirty,
	checkProjectBudget: checkProjectBudgetAfterClockOut,
};

/** The production instance: coordinated work transactions, follow-ups after commit. */
export const clocking = createClocking({
	clock: systemClock,
	transactions: coordinatedTransactions(),
	followUps: afterCommitFollowUps(clockOutFollowUpEffects),
});
