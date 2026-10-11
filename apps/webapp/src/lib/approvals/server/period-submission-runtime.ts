import type { Clock } from "@/lib/datetime/temporal-core";
import { PERIOD_SUBMISSION_WORKFLOW_TYPE } from "../domain-adapters/period-submission-contract";
import type { ApprovalWorkflowDatabase } from "../workflow/repository";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";

/**
 * The approval runtime of period submission writes (#1059). The period submission adapter is
 * built into the production registry; every other kind's finalization is outside this boundary.
 * `canManageApproval` grants organization-wide management for period submissions only, and only
 * when the caller vouches for it; a bot card passes one that throws, so a card never reaches it.
 */
export function createPeriodSubmissionApprovalRuntime(
	database: ApprovalWorkflowDatabase,
	input: {
		clock: Clock;
		canManageApproval?: (actorEmployeeId: string) => Promise<boolean>;
	},
) {
	const outside = async (): Promise<never> => {
		throw new Error("Outside the period submission boundary");
	};
	return createProductionApprovalWorkflowRuntime({
		db: database,
		adapters: {
			absence: {
				clock: input.clock,
				finalizeAbsenceTerminal: outside,
				deleteCancelledAbsence: outside,
			},
			timeCorrection: {
				clock: input.clock,
				finalizeTimeCorrectionTerminal: outside,
				deleteCancelledCorrections: outside,
			},
			ordinaryWorkPeriod: { finalizeTerminal: outside },
		},
		canManageApproval: async ({ actorEmployeeId, workflow }) =>
			workflow.workflowType === PERIOD_SUBMISSION_WORKFLOW_TYPE &&
			(input.canManageApproval ? await input.canManageApproval(actorEmployeeId) : false),
		clock: input.clock,
	});
}
