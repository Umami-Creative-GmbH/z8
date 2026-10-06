import "server-only";

import { db } from "@/db";
import { finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction } from "@/lib/approvals/server/work-period-approvals";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { createProductionApprovalWorkflowRuntime } from "@/lib/approvals/workflow/runtime";
import { systemClock } from "@/lib/datetime/temporal-core";

/** The approval runtime for ordinary work periods; other kinds are refused. */

export function createOrdinaryApprovalRuntime(database: ApprovalWorkflowDatabase = db) {
	return createProductionApprovalWorkflowRuntime({
		db: database,
		adapters: {
			absence: {
				clock: systemClock,
				finalizeAbsenceTerminal: async () => {
					throw new Error("Absence finalization is outside time tracking");
				},
				deleteCancelledAbsence: async () => {
					throw new Error("Absence cancellation is outside time tracking");
				},
			},
			timeCorrection: {
				clock: systemClock,
				finalizeTimeCorrectionTerminal: async () => {
					throw new Error("Time correction finalization is outside time tracking");
				},
				deleteCancelledCorrections: async () => {
					throw new Error("Time correction cancellation is outside time tracking");
				},
			},
			ordinaryWorkPeriod: {
				finalizeTerminal: finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
			},
		},
		canManageApproval: async () => false,
		clock: systemClock,
	});
}

// ApprovalDbService is an Effect v3 contract until #632, so the approvals module builds it.
export { approvalDbServiceForTransaction } from "@/lib/approvals/server/v3-boundary";
