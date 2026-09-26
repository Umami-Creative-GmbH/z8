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
 * The decision reads its request, workflow and period before the locks, so it
 * also observes those rows before its first read and re-observes them under
 * the protocol: a decision that committed meanwhile restarts the transaction,
 * which then replays it from fresh reads instead of deciding on stale ones.
 * The sealed scope is registered for the transaction client, so the terminal
 * break split finds the coordination it runs under instead of locking late.
 */
import { sql } from "drizzle-orm";
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
 * Every approval row a work-period decision reads before its locks: the
 * period, its legacy requests, and its workflows with their stages and
 * assignments. Any committed decision changes at least one of them.
 */
export async function observeWorkPeriodDecision(
	context: ApprovalWorkflowTransactionContext,
	input: { organizationId: string; workPeriodId: string },
): Promise<string> {
	const transaction = context.dbService.db as unknown as WorkTransactionClient;
	const result = await transaction.execute(sql`
		select json_build_array(
			(select row_to_json(period) from work_period period
				where period.id = ${input.workPeriodId}::uuid
					and period.organization_id = ${input.organizationId}),
			(select json_agg(row_to_json(request) order by request.id) from approval_request request
				where request.organization_id = ${input.organizationId}
					and request.entity_type = 'time_entry'
					and request.entity_id = ${input.workPeriodId}::uuid),
			(select json_agg(json_build_array(
					workflow.id, workflow.status, workflow.version, workflow.current_stage_order,
					(select json_agg(json_build_array(stage.id, stage.status) order by stage.id)
						from approval_workflow_stage stage
						where stage.organization_id = workflow.organization_id
							and stage.workflow_id = workflow.id),
					(select json_agg(json_build_array(assignment.id, assignment.status) order by assignment.id)
						from approval_stage_assignment assignment
						where assignment.organization_id = workflow.organization_id
							and assignment.workflow_id = workflow.id)
				) order by workflow.id)
				from approval_workflow workflow
				where workflow.organization_id = ${input.organizationId}
					and workflow.source_type = 'time_entry'
					and workflow.source_id = ${input.workPeriodId}::uuid)
		)::text as observation
	`);
	const rows = (result as { rows?: Array<{ observation?: unknown }> }).rows;
	const observation = rows?.[0]?.observation;
	if (rows?.length !== 1 || typeof observation !== "string") {
		throw new Error("Work period decision observation failed");
	}
	return observation;
}

/**
 * Acquires the protocol on the caller's approval repository transaction. Must be
 * called before any row lock of the transaction; the reads before it are plain.
 * `observed` is the decision's observation from before its first read; a
 * different observation under the locks restarts the transaction.
 */
export async function acquireWorkPeriodDecisionScope(
	context: ApprovalWorkflowTransactionContext,
	route: WorkPeriodDecisionRoute & { workPeriodId: string; observed: string },
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
	if (
		!sameScope(routed, await routeScope(transaction, routeInput)) ||
		route.observed !==
			(await observeWorkPeriodDecision(context, {
				organizationId: route.organizationId,
				workPeriodId: route.workPeriodId,
			}))
	) {
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
