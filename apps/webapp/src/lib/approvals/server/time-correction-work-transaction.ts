import "server-only";

/**
 * Shared outer work transaction for approval-based time corrections (#301 / T37).
 *
 * Correction submission, decision (finalization, including business deletion)
 * and cancellation run inside the approval repository transaction. Before any
 * row lock they take the #264 acquisition protocol for the work they may change:
 *
 * 1. the organization adoption gate, with the append control read under it;
 * 2. the `time_correction` approval write gate (rank 2);
 * 3. the organization configuration guard;
 * 4. the sorted user access guards (the actor and the owner's user);
 * 5. the sorted exclusive employee keys (the owner and every employee record of
 *    the actor).
 *
 * The routed scope is re-read under those locks; a changed scope throws
 * `WorkTransactionScopeChanged` and the caller restarts the whole transaction
 * instead of acquiring an earlier-ranked lock late. The approval gate result is
 * pinned on the returned context, so the existing submission, decision and
 * cancellation code never re-acquires it after its row locks.
 *
 * Legacy organizations keep their established writes; they only run inside the
 * same coordinated transaction, so an adoption change never interleaves with a
 * started correction lifecycle transition.
 */
import { routeCompletedWork } from "@/lib/time-tracking/completed-work-transaction";
import {
	acquireAdoptionGate,
	acquireEmployeeCoordination,
	acquireOrganizationConfigurationGuard,
	acquireUserConfigurationAccessGuards,
	readAppendAdmission,
	type SealedWorkTransactionScope,
	sameWorkRoute,
	sealWorkTransactionScope,
	type WorkTransactionClient,
	WorkTransactionScopeChanged,
} from "@/lib/time-tracking/work-transaction";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import { acquirePinnedApprovalContext } from "../workflow/pinned-write-gate";
import type { ApprovalWriteGateResult } from "../workflow/ports";

export interface TimeCorrectionWorkRoute {
	organizationId: string;
	/** The employee who owns the corrected work (the correction requester). */
	ownerEmployeeId: string;
	/** The authenticated human acting (requester or deciding approver). */
	actorUserId: string;
}

export interface TimeCorrectionWorkTransaction {
	scope: SealedWorkTransactionScope;
	/** The `time_correction` approval gate result, acquired at rank 2. */
	authority: ApprovalWriteGateResult;
	/** The caller's context with the acquired approval gate pinned. */
	context: ApprovalWorkflowTransactionContext;
}

/**
 * Acquires the protocol on the caller's approval repository transaction. Must be
 * called before any row lock of the transaction; routing reads before it are
 * plain reads. `refuse` replaces the pinned gate's refusal of another scope.
 */
export async function acquireTimeCorrectionWorkScope(
	context: ApprovalWorkflowTransactionContext,
	route: TimeCorrectionWorkRoute,
	refuse?: () => never,
): Promise<TimeCorrectionWorkTransaction> {
	const transaction = context.dbService.db as unknown as WorkTransactionClient;
	const routeInput = {
		organizationId: route.organizationId,
		employeeId: route.ownerEmployeeId,
		actorUserId: route.actorUserId,
	};
	const routed = await routeCompletedWork(transaction, routeInput);
	await acquireAdoptionGate(transaction, route.organizationId);
	const admission = await readAppendAdmission(transaction, route.organizationId);
	const pinned = await acquirePinnedApprovalContext(context, {
		organizationId: route.organizationId,
		workflowType: "time_correction",
		refuse,
	});
	await acquireOrganizationConfigurationGuard(transaction, route.organizationId);
	await acquireUserConfigurationAccessGuards(transaction, routed.users);
	await acquireEmployeeCoordination(transaction, routed.employees);
	if (!sameWorkRoute(routed, await routeCompletedWork(transaction, routeInput))) {
		throw new WorkTransactionScopeChanged();
	}

	const scope = sealWorkTransactionScope({
		db: transaction,
		admission,
		assertEmployee(organizationId: string, employeeId: string) {
			if (organizationId !== route.organizationId || employeeId !== route.ownerEmployeeId) {
				throw new Error("Employee scope is outside the work transaction");
			}
		},
	});
	return { scope, ...pinned };
}

/**
 * Runs one coordinated correction transaction, restarting it (at most twice)
 * when the routed scope changed before its locks were held.
 */
export async function retryTimeCorrectionWorkTransaction<T>(run: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await run();
		} catch (error) {
			if (!(error instanceof WorkTransactionScopeChanged) || attempt >= 2) throw error;
		}
	}
}
