import { and, asc, eq } from "drizzle-orm";
import type { db } from "@/db";
import { approvalEscalationTransfer, approvalRequest } from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { TransferableLegacyEntityType } from "./kinds";
import type { LegacyJournalTransferFact } from "./transfer-evaluation";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type LegacyTransferExecutor = typeof db | DatabaseTransaction;

/** Committed legacy transfers of one request, oldest lineage position first. */
export async function listLegacyRequestTransferFacts(
	executor: LegacyTransferExecutor,
	input: { organizationId: string; approvalRequestId: string },
): Promise<LegacyJournalTransferFact[]> {
	const rows = await executor
		.select({
			sourceSequence: approvalEscalationTransfer.legacySourceSequence,
			sourceApproverEmployeeId: approvalEscalationTransfer.sourceApproverEmployeeId,
			replacementApproverEmployeeId: approvalEscalationTransfer.replacementApproverEmployeeId,
			transferredAt: approvalEscalationTransfer.transferredAt,
			initiator: approvalEscalationTransfer.initiator,
		})
		.from(approvalEscalationTransfer)
		.where(
			and(
				eq(approvalEscalationTransfer.organizationId, input.organizationId),
				eq(approvalEscalationTransfer.authorityMode, "legacy"),
				eq(approvalEscalationTransfer.legacyApprovalRequestId, input.approvalRequestId),
			),
		)
		.orderBy(asc(approvalEscalationTransfer.legacySourceSequence));
	return rows.map((row) => {
		// The mode check constraint guarantees a sequence for legacy rows.
		if (row.sourceSequence === null) {
			throw new Error("Legacy escalation transfer is missing its lineage position");
		}
		return {
			sourceSequence: row.sourceSequence,
			sourceApproverEmployeeId: row.sourceApproverEmployeeId,
			replacementApproverEmployeeId: row.replacementApproverEmployeeId,
			transferredAt: instantFromDate(row.transferredAt),
			initiator: row.initiator,
		};
	});
}

export interface LegacyTransferredRequest {
	approvalRequestId: string;
	currentApproverEmployeeId: string;
}

/**
 * The legacy absence request a decision addresses, when escalation ever
 * transferred it (see {@link findLegacyTransferredApprovalRequest}).
 */
export function findLegacyTransferredRequest(
	executor: LegacyTransferExecutor,
	input: { organizationId: string; absenceId: string; approvalRequestId?: string },
): Promise<LegacyTransferredRequest | null> {
	return findLegacyTransferredApprovalRequest(executor, {
		organizationId: input.organizationId,
		entityType: "absence_entry",
		entityId: input.absenceId,
		...(input.approvalRequestId ? { approvalRequestId: input.approvalRequestId } : {}),
	});
}

/**
 * The legacy request a decision addresses, when escalation ever transferred
 * it. Addressed exactly by ID when supplied (the inbox always does),
 * otherwise the pending request of the subject. The request row is locked
 * like the transfer locks it, so a decision and a transfer serialize: a
 * transfer that commits first is always seen here.
 */
export async function findLegacyTransferredApprovalRequest(
	executor: LegacyTransferExecutor,
	input: {
		organizationId: string;
		entityType: TransferableLegacyEntityType;
		entityId: string;
		approvalRequestId?: string;
	},
): Promise<LegacyTransferredRequest | null> {
	const [request] = await executor
		.select({ id: approvalRequest.id, approverId: approvalRequest.approverId })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, input.entityType),
				eq(approvalRequest.entityId, input.entityId),
				input.approvalRequestId
					? eq(approvalRequest.id, input.approvalRequestId)
					: eq(approvalRequest.status, "pending"),
			),
		)
		.limit(1)
		.for("update");
	if (!request) return null;
	const [transfer] = await executor
		.select({ id: approvalEscalationTransfer.id })
		.from(approvalEscalationTransfer)
		.where(
			and(
				eq(approvalEscalationTransfer.organizationId, input.organizationId),
				eq(approvalEscalationTransfer.authorityMode, "legacy"),
				eq(approvalEscalationTransfer.legacyApprovalRequestId, request.id),
			),
		)
		.limit(1);
	return transfer
		? { approvalRequestId: request.id, currentApproverEmployeeId: request.approverId }
		: null;
}
