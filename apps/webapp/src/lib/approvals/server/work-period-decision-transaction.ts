import "server-only";

/**
 * Shared outer work transaction for manual and policy clock-out decisions
 * (#303 / T39).
 *
 * A final policy clock-out approval can split the approved period to insert a
 * required break, inside the approval transaction. The decision therefore runs
 * as a work transaction (#477): the coordinator opens the transaction, the
 * approval runtime borrows it, and before any read of the decision the
 * coordinator takes the acquisition protocol for the owner's work in the same
 * order as every other completed-work writer:
 *
 * 1. the organization adoption gate, with the append control read under it;
 * 2. the ordinary approval write gate of the decided kind (rank 2), pinned on
 *    the borrowed approval context;
 * 3. the organization configuration guard;
 * 4. the sorted user access guards (the deciding actor and the owner's user);
 * 5. the sorted exclusive employee keys (the owner and every employee record of
 *    the actor).
 *
 * The route is the decision's observation: the period, its legacy requests,
 * and its workflows with their stages and assignments. The decided kind and
 * owner come from it, and it is the route's snapshot, so a decision that
 * committed before the guards were held restarts the attempt, which then
 * replays it from fresh reads instead of deciding on stale ones. The
 * coordinator registers its scope for the transaction client, so the terminal
 * break split finds the coordination it runs under instead of locking late.
 */
import { sql } from "drizzle-orm";
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
import type { OrdinaryWorkPeriodApprovalKind } from "../domain-adapters/work-period-contract";
import { classifyTimeApprovalRequest } from "../time-request-kind";
import {
	type ApprovalRuntimeFactory,
	approvalWorkTransactionPort,
} from "../workflow/work-transaction-port";

export interface WorkPeriodDecisionInput {
	organizationId: string;
	workPeriodId: string;
	/** The decided legacy request or canonical assignment. */
	approvalRequestId: string;
	/** The authenticated human deciding. */
	actorUserId: string;
	/** The caller's database, which opens the transaction; defaults to the application database. */
	database?: WorkTransactionDatabase;
}

/** Whose work the decision may change, and the approval kind it decides. */
export interface WorkPeriodDecisionTarget {
	kind: OrdinaryWorkPeriodApprovalKind;
	/** The employee who owns the decided work (the requester). */
	ownerEmployeeId: string;
}

export interface WorkPeriodDecisionSnapshot {
	observation: string;
	/** Null when the observation names no ordinary decision target; nothing is routed. */
	target: WorkPeriodDecisionTarget | null;
}

export type WorkPeriodDecisionRoute = WorkRoute<WorkPeriodDecisionSnapshot> & {
	snapshot: WorkPeriodDecisionSnapshot;
};

export type WorkPeriodDecisionScope = WorkTransactionScope<
	WorkPeriodDecisionRoute,
	ApprovalWorkflowTransactionContext
>;

/**
 * Every approval row a work-period decision reads: the period, its legacy
 * requests, and its workflows with their stages and assignments. Any committed
 * decision changes at least one of them.
 */
export async function observeWorkPeriodDecision(
	db: WorkTransactionClient,
	input: { organizationId: string; workPeriodId: string },
): Promise<string> {
	const result = await db.execute(sql`
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
							and assignment.workflow_id = workflow.id),
					workflow.workflow_type, workflow.requester_employee_id
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

function isOrdinaryKind(value: unknown): value is OrdinaryWorkPeriodApprovalKind {
	return value === "manual_time_submission" || value === "policy_clock_out";
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/**
 * The target the observation names for `approvalRequestId`: a legacy request
 * of the period, classified as the legacy decision evidence classifies it, or
 * an assignment of one of its canonical workflows. The decision itself
 * verifies everything again under the guards.
 */
export function workPeriodDecisionTarget(
	observation: string,
	approvalRequestId: string,
): WorkPeriodDecisionTarget | null {
	const parsed: unknown = JSON.parse(observation);
	if (!Array.isArray(parsed)) return null;
	const [rawPeriod, rawRequests, rawWorkflows] = parsed;
	const period = objectOrNull(rawPeriod);
	if (!period) return null;
	const request = (Array.isArray(rawRequests) ? rawRequests : [])
		.map(objectOrNull)
		.find((candidate) => candidate?.id === approvalRequestId);
	if (request) {
		const metadata = objectOrNull(request.metadata);
		const kind = classifyTimeApprovalRequest({
			metadata:
				metadata && Object.hasOwn(metadata, "timeRequest")
					? { timeRequest: metadata.timeRequest }
					: undefined,
			reason: typeof request.reason === "string" ? request.reason : null,
			pendingChanges: period.pending_changes,
		});
		return isOrdinaryKind(kind) && typeof request.requested_by === "string"
			? { kind, ownerEmployeeId: request.requested_by }
			: null;
	}
	for (const workflow of Array.isArray(rawWorkflows) ? rawWorkflows : []) {
		if (!Array.isArray(workflow)) continue;
		const [, , , , , assignments, kind, requester] = workflow;
		const named =
			Array.isArray(assignments) &&
			assignments.some(
				(assignment) => Array.isArray(assignment) && assignment[0] === approvalRequestId,
			);
		if (named) {
			return isOrdinaryKind(kind) && typeof requester === "string"
				? { kind, ownerEmployeeId: requester }
				: null;
		}
	}
	return null;
}

export function workPeriodDecisionPlan(
	input: WorkPeriodDecisionInput,
	createApprovalRuntime: ApprovalRuntimeFactory,
): WorkPlan<WorkPeriodDecisionRoute, ApprovalWorkflowTransactionContext> {
	return {
		organizationId: input.organizationId,
		database: input.database,
		approval: approvalWorkTransactionPort(createApprovalRuntime),
		route: async (db) => {
			const observation = await observeWorkPeriodDecision(db, input);
			const target = workPeriodDecisionTarget(observation, input.approvalRequestId);
			const snapshot = { observation, target };
			if (!target) {
				return { users: [input.actorUserId], employees: [], writeTargets: [], snapshot };
			}
			const routed = await routeCompletedWork(db, {
				organizationId: input.organizationId,
				employeeId: target.ownerEmployeeId,
				actorUserId: input.actorUserId,
			});
			return { ...routed, approvalGate: target.kind, snapshot };
		},
	};
}

/** Runs one ordinary work-period decision as a work transaction. */
export function withWorkPeriodDecisionTransaction<T>(
	input: WorkPeriodDecisionInput,
	createApprovalRuntime: ApprovalRuntimeFactory,
	operation: (scope: WorkPeriodDecisionScope) => Promise<T>,
): Promise<T> {
	return runWorkTransaction(workPeriodDecisionPlan(input, createApprovalRuntime), operation);
}
