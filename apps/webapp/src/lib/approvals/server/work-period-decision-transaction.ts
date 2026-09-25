import "server-only";

/**
 * Shared outer work transaction for manual and policy clock-out decisions
 * (#303 / T39).
 *
 * A final policy clock-out approval can split the approved period to insert a
 * required break, inside the approval transaction. The decision therefore takes
 * the #264 acquisition protocol for the owner's work before any row lock, in the
 * same order as every other completed-work writer:
 *
 * 1. the organization adoption gate, with the append control read under it;
 * 2. the ordinary approval write gate of the decided kind (rank 2);
 * 3. the organization configuration guard;
 * 4. the sorted user access guards (the deciding actor and the owner's user);
 * 5. the sorted exclusive employee keys (the owner and every employee record of
 *    the actor).
 *
 * The routed scope is re-read under those locks; a changed scope throws
 * `WorkTransactionScopeChanged` and the caller restarts the whole transaction.
 * The sealed scope is registered for the transaction client, so the terminal
 * break split finds the coordination it runs under instead of locking late.
 */
import { routeScope, sameScope } from "@/lib/time-tracking/completed-work-transaction";
import { WorkTransactionScopeChanged } from "@/lib/time-tracking/web-clock-out-resources";
import {
	acquireAdoptionGate,
	acquireEmployeeCoordination,
	acquireOrganizationConfigurationGuard,
	acquireUserConfigurationAccessGuards,
	readAppendAdmission,
	sealWorkTransactionScope,
	type WorkTransactionClient,
	type WorkTransactionScope,
} from "@/lib/time-tracking/work-transaction";
import type { OrdinaryWorkPeriodApprovalKind } from "../domain-adapters/work-period-contract";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import type { ApprovalWriteGate, ApprovalWriteGateResult } from "../workflow/ports";

export interface WorkPeriodDecisionRoute {
	organizationId: string;
	kind: OrdinaryWorkPeriodApprovalKind;
	/** The employee who owns the decided work (the requester). */
	ownerEmployeeId: string;
	/** The authenticated human deciding. */
	actorUserId: string;
}

export interface WorkPeriodDecisionTransaction {
	scope: WorkTransactionScope;
	/** The ordinary approval gate result of the decided kind, acquired at rank 2. */
	authority: ApprovalWriteGateResult;
	/** An approval gate that returns the already acquired authority. */
	writeGate: ApprovalWriteGate;
}

/**
 * Acquires the protocol on the caller's approval repository transaction. Must be
 * called before any row lock of the transaction; the reads before it are plain.
 */
export async function acquireWorkPeriodDecisionScope(
	context: ApprovalWorkflowTransactionContext,
	route: WorkPeriodDecisionRoute,
): Promise<WorkPeriodDecisionTransaction> {
	const transaction = context.dbService.db as unknown as WorkTransactionClient;
	const routeInput = {
		organizationId: route.organizationId,
		employeeId: route.ownerEmployeeId,
		actorUserId: route.actorUserId,
	};
	const routed = await routeScope(transaction, routeInput);
	await acquireAdoptionGate(transaction, route.organizationId);
	const admission = await readAppendAdmission(transaction, route.organizationId);
	const authority = await context.writeGate.acquire({
		organizationId: route.organizationId,
		workflowType: route.kind,
	});
	await acquireOrganizationConfigurationGuard(transaction, route.organizationId);
	await acquireUserConfigurationAccessGuards(transaction, routed.userIds);
	await acquireEmployeeCoordination(transaction, routed.employeeIds);
	if (!sameScope(routed, await routeScope(transaction, routeInput))) {
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
	return {
		scope,
		authority,
		writeGate: {
			acquire: async (gateScope) => {
				if (
					gateScope.organizationId !== route.organizationId ||
					gateScope.workflowType !== route.kind
				) {
					throw new Error("Work period decision rollout scope mismatch");
				}
				return authority;
			},
		},
	};
}

/**
 * Runs one coordinated decision transaction, restarting it (at most twice) when
 * the routed scope changed before its locks were held.
 */
export async function retryWorkPeriodDecisionTransaction<T>(run: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await run();
		} catch (error) {
			if (!(error instanceof WorkTransactionScopeChanged) || attempt >= 2) throw error;
		}
	}
}
