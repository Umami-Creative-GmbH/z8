import { sql } from "drizzle-orm";
import type { ApprovalDeliveryIntentEvent } from "@/db/schema";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalWorkflowType } from "../workflow/ports";

/**
 * Writes the lifecycle intent of a legacy-authoritative submission or decision
 * (#296), or of a cancellation that withdrew a cycle (#384), in the caller's
 * transaction: the counterpart of a canonical workflow's outbox row. Only kinds
 * with a delivery control get one: without a control no card is owned, and
 * nothing accumulates. `cycleId` names the submission cycle (the legacy chain
 * instance, or the single legacy request) of a cycle-keyed lifecycle; without
 * it the source is the lifecycle. Returns whether an intent was written (the
 * caller then kicks the owner after commit).
 */
export async function recordLegacyDeliveryIntent(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workflowType: ApprovalWorkflowType;
		sourceType: string;
		sourceId: string;
		approvalRequestId: string;
		cycleId?: string | null;
		event: ApprovalDeliveryIntentEvent;
	},
): Promise<boolean> {
	const result = await database.execute(sql`
		insert into approval_delivery_intent (
			organization_id, workflow_type, source_type, source_id,
			legacy_approval_request_id, legacy_cycle_id, event
		)
		select ${input.organizationId}, ${input.workflowType}::approval_workflow_type,
			${input.sourceType}, ${input.sourceId}::uuid,
			${input.approvalRequestId}::uuid, ${input.cycleId ?? null}::uuid, ${input.event}
		where exists (
			select 1 from approval_delivery_control c
			where c.organization_id = ${input.organizationId}
				and c.workflow_type = ${input.workflowType}::approval_workflow_type
		)
		returning id
	`);
	return resultRows(result).length > 0;
}

function resultRows(result: unknown): Record<string, unknown>[] {
	return result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)
		? (result.rows as Record<string, unknown>[])
		: [];
}

/**
 * The exact legacy absence request a decision will decide (#384): the
 * caller's, or else the actor's own pending request, which the unchanged
 * legacy owner selects the same way. Read before the mutation.
 */
export async function findLegacyAbsenceDecisionTarget(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		absenceId: string;
		approvalRequestId: string | undefined;
		actorEmployeeId: string;
	},
): Promise<string | undefined> {
	if (input.approvalRequestId) return input.approvalRequestId;
	const [request] = resultRows(
		await database.execute(sql`
			select id from approval_request
			where organization_id = ${input.organizationId}
				and entity_type = 'absence_entry'
				and entity_id = ${input.absenceId}::uuid
				and approver_id = ${input.actorEmployeeId}::uuid
				and status = 'pending'
			limit 1
		`),
	);
	return typeof request?.id === "string" ? request.id : undefined;
}

/**
 * The `decided` intent of a legacy absence decision's submission cycle
 * (#384), in the decision transaction: the owner refreshes the cycle's sent
 * cards and sends the next chain stage's card.
 */
export async function recordLegacyAbsenceDecisionIntent(
	database: ApprovalDatabase,
	input: { organizationId: string; absenceId: string; approvalRequestId: string },
): Promise<boolean> {
	return recordLegacyDeliveryIntent(database, {
		organizationId: input.organizationId,
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId: input.absenceId,
		approvalRequestId: input.approvalRequestId,
		cycleId: await resolveLegacyDeliveryCycle(database, input),
		event: "decided",
	});
}

/**
 * The submission cycle a legacy request belongs to (#384): the chain instance
 * it is a stage of, or the request itself. Read while the request's chain link
 * exists (cancellation clears the link of pending stages).
 */
export async function resolveLegacyDeliveryCycle(
	database: Pick<ApprovalDatabase, "execute">,
	input: { organizationId: string; approvalRequestId: string },
): Promise<string> {
	const [stage] = resultRows(
		await database.execute(sql`
			select s.chain_instance_id
			from approval_chain_stage_instance s
			where s.organization_id = ${input.organizationId}
				and s.approval_request_id = ${input.approvalRequestId}::uuid
			limit 1
		`),
	);
	return typeof stage?.chain_instance_id === "string"
		? stage.chain_instance_id
		: input.approvalRequestId;
}
