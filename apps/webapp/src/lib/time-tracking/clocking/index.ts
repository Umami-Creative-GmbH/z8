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

export { type Clocking, type ClockLookup, createClocking } from "./clocking";
export {
	afterCommitFollowUps,
	type ClockFollowUps,
	type ClockOutAdvice,
	type ClosedLiveWork,
	recordingFollowUps,
} from "./follow-ups";
export { type ClockTransactions, coordinatedTransactions } from "./transactions";
export * from "./types";

/**
 * The production follow-up effects. Their implementations still live beside the
 * web actions; the module owns when and how they run.
 */
export const clockOutFollowUpEffects: ClockOutFollowUpEffects = {
	checkCompliance: (input) =>
		checkComplianceAfterClockOut(
			input.employeeId,
			input.organizationId,
			input.workPeriodId,
			input.durationMinutes,
			input.timezone,
		),
	enforceBreaks: enforceBreaksAfterClockOut,
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
