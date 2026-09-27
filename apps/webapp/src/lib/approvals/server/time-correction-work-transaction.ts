import "server-only";

/**
 * Shared outer work transaction for approval-based time corrections (#301 / T37).
 *
 * Correction submission, decision (finalization, including business deletion)
 * and cancellation run as work transactions (#477): the coordinator opens the
 * transaction and the approval runtime borrows it. Before any row lock the
 * coordinator takes the acquisition protocol for the work they may change: the
 * adoption gate, the `time_correction` approval write gate (pinned on the
 * borrowed approval context, so the submission, decision and cancellation code
 * never re-acquires it after its row locks), organization configuration, the
 * actor's and the owner's user access, then the owner's and the actor's
 * employee keys. A routed scope that changed under those guards restarts the
 * attempt instead of acquiring an earlier-ranked lock late.
 *
 * Legacy organizations keep their established writes; they only run inside the
 * same coordinated transaction, so an adoption change never interleaves with a
 * started correction lifecycle transition.
 */
import { routeCompletedWork } from "@/lib/time-tracking/completed-work-transaction";
import {
	runWorkTransaction,
	type WorkPlan,
	type WorkRoute,
	type WorkTransactionClient,
	type WorkTransactionDatabase,
	type WorkTransactionScope,
} from "@/lib/time-tracking/work-transaction";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import {
	type ApprovalRuntimeFactory,
	approvalWorkTransactionPort,
} from "../workflow/work-transaction-port";

export interface TimeCorrectionWorkInput {
	organizationId: string;
	/** The authenticated human acting (requester or deciding approver). */
	actorUserId: string;
	/**
	 * The employee who owns the corrected work (the correction requester), or
	 * the plain reads that find it; null routes no owner, so nothing may be written.
	 */
	owner: string | ((db: WorkTransactionClient) => Promise<string | null>);
	/** Replaces the pinned gate's refusal of another scope. */
	refuse?: () => never;
	/** The caller's database, which opens the transaction; defaults to the application database. */
	database?: WorkTransactionDatabase;
}

/** The borrowed approval context carries the `time_correction` gate pinned at rank 2. */
export type TimeCorrectionWorkScope = WorkTransactionScope<
	WorkRoute,
	ApprovalWorkflowTransactionContext
>;

export function timeCorrectionWorkPlan(
	input: TimeCorrectionWorkInput,
	createApprovalRuntime: ApprovalRuntimeFactory,
): WorkPlan<WorkRoute, ApprovalWorkflowTransactionContext> {
	return {
		organizationId: input.organizationId,
		database: input.database,
		approval: approvalWorkTransactionPort(createApprovalRuntime, { refuse: input.refuse }),
		route: async (db) => {
			const owner = typeof input.owner === "string" ? input.owner : await input.owner(db);
			const routed =
				owner === null
					? { users: [input.actorUserId], employees: [], writeTargets: [] }
					: await routeCompletedWork(db, {
							organizationId: input.organizationId,
							employeeId: owner,
							actorUserId: input.actorUserId,
						});
			return { ...routed, approvalGate: "time_correction" };
		},
	};
}

/** Runs one correction lifecycle transition as a work transaction. */
export function withTimeCorrectionWorkTransaction<T>(
	input: TimeCorrectionWorkInput,
	createApprovalRuntime: ApprovalRuntimeFactory,
	operation: (scope: TimeCorrectionWorkScope) => Promise<T>,
): Promise<T> {
	return runWorkTransaction(timeCorrectionWorkPlan(input, createApprovalRuntime), operation);
}

/** The `time_correction` gate result the coordinator acquired at rank 2 and pinned. */
export function timeCorrectionAuthority(scope: TimeCorrectionWorkScope, organizationId: string) {
	return scope.approval.writeGate.acquire({ organizationId, workflowType: "time_correction" });
}
