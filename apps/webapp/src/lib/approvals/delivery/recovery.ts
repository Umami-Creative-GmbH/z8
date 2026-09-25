import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { type ApprovalDeliveryProvider, approvalEscalationAttention, employee } from "@/db/schema";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { kickApprovalDelivery } from "./kick";
import { hasApprovalDeliveryControl, rearmApprovalDeliveryWork } from "./store";

const logger = createLogger("ApprovalDeliveryRecovery");

export type ApprovalDeliveryRecoveryOutcome =
	| { kind: "rearmed"; workIds: string[] }
	| { kind: "not_recoverable" }
	| { kind: "not_found" };

/**
 * Explicit recovery of the delivery an open incident reports. The work is
 * re-armed for an immediate attempt with a fresh retry schedule; delivered
 * work is never resent. The incident stays open until a delivery actually
 * succeeds (or a manager disposes of it). Callers authorize management.
 */
export async function recoverApprovalDeliveryForAttention(input: {
	organizationId: string;
	attentionId: string;
	actorUserId: string;
	now?: Instant;
}): Promise<ApprovalDeliveryRecoveryOutcome> {
	const [incident] = await db
		.select({
			evidence: approvalEscalationAttention.evidence,
			workflowId: approvalEscalationAttention.workflowId,
		})
		.from(approvalEscalationAttention)
		.where(
			and(
				eq(approvalEscalationAttention.organizationId, input.organizationId),
				eq(approvalEscalationAttention.id, input.attentionId),
				eq(approvalEscalationAttention.status, "open"),
				inArray(approvalEscalationAttention.reason, ["delivery_exhausted", "delivery_unavailable"]),
			),
		)
		.limit(1);
	const workId = incident?.evidence?.workId;
	if (!incident || typeof workId !== "string") return { kind: "not_found" };
	const result = await rearmApprovalDeliveryWork({
		organizationId: input.organizationId,
		workIds: [workId],
		now: input.now ?? systemClock.nowInstant(),
	});
	if (result.kind !== "rearmed") return result;
	logger.info(
		{
			organizationId: input.organizationId,
			attentionId: input.attentionId,
			workIds: result.workIds,
			actorUserId: input.actorUserId,
		},
		"Approval delivery recovery requested",
	);
	kickApprovalDelivery({
		organizationId: input.organizationId,
		workflowId: incident.workflowId,
	});
	return result;
}

/**
 * Destination repair: the recipient reached the provider's bot again, so
 * their work for that provider that was waiting for a usable destination is
 * re-armed. Nothing else is resent, and organizations without a delivery
 * owner are untouched.
 */
export async function rearmApprovalDeliveryForRepairedDestination(input: {
	organizationId: string;
	userId: string;
	provider: ApprovalDeliveryProvider;
	now?: Instant;
}): Promise<void> {
	if (!(await hasApprovalDeliveryControl(input.organizationId))) return;
	const recipients = await db
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(eq(employee.organizationId, input.organizationId), eq(employee.userId, input.userId)),
		);
	if (recipients.length === 0) return;
	const result = await rearmApprovalDeliveryWork({
		organizationId: input.organizationId,
		recipientEmployeeIds: recipients.map((recipient) => recipient.id),
		provider: input.provider,
		outcomePrefix: "destination_invalid:",
		now: input.now ?? systemClock.nowInstant(),
	});
	if (result.kind === "rearmed") {
		kickApprovalDelivery({ organizationId: input.organizationId });
	}
}
