import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import {
	type ApprovalEscalationTransferEventPayload,
	approvalEscalationTransfer,
	approvalEscalationTransferEvent,
} from "@/db/schema";
import type { EscalationJournalTransferFact } from "./transfer-evaluation";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type EscalationTransferExecutor = typeof db | DatabaseTransaction;

export type EscalationTransferRow = typeof approvalEscalationTransfer.$inferSelect;
export type EscalationTransferInsert = Omit<
	typeof approvalEscalationTransfer.$inferInsert,
	"id" | "createdAt"
>;

/** Exact committed operation lookup, always scoped to the organization. */
export async function findEscalationTransferByOperationKey(
	executor: EscalationTransferExecutor,
	input: { organizationId: string; operationKey: string },
): Promise<EscalationTransferRow | null> {
	const [row] = await executor
		.select()
		.from(approvalEscalationTransfer)
		.where(
			and(
				eq(approvalEscalationTransfer.organizationId, input.organizationId),
				eq(approvalEscalationTransfer.operationKey, input.operationKey),
			),
		)
		.limit(1);
	return row ?? null;
}

/** Committed transfers of one workflow, for lineage/allowance classification. */
export async function listWorkflowEscalationTransferFacts(
	executor: EscalationTransferExecutor,
	input: { organizationId: string; workflowId: string },
): Promise<EscalationJournalTransferFact[]> {
	return executor
		.select({
			sourceAssignmentId: approvalEscalationTransfer.sourceAssignmentId,
			replacementAssignmentId: approvalEscalationTransfer.replacementAssignmentId,
			initiator: approvalEscalationTransfer.initiator,
		})
		.from(approvalEscalationTransfer)
		.where(
			and(
				eq(approvalEscalationTransfer.organizationId, input.organizationId),
				eq(approvalEscalationTransfer.workflowId, input.workflowId),
			),
		);
}

/**
 * Journal a committed transfer and its immutable delivery event. Must run in
 * the same transaction as the workflow transition it links; a conflicting
 * concurrent writer fails the whole transaction rather than duplicating it.
 */
export async function recordEscalationTransfer(
	executor: EscalationTransferExecutor,
	input: {
		transfer: EscalationTransferInsert;
		event: ApprovalEscalationTransferEventPayload;
	},
): Promise<EscalationTransferRow> {
	const [row] = await executor
		.insert(approvalEscalationTransfer)
		.values(input.transfer)
		.returning();
	if (!row) throw new Error("Escalation transfer journal returned no row");
	await executor.insert(approvalEscalationTransferEvent).values({
		organizationId: row.organizationId,
		transferId: row.id,
		eventType: "assignment_transferred",
		payload: input.event,
	});
	return row;
}
