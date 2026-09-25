import { createLogger } from "@/lib/logger";

const logger = createLogger("ApprovalDeliveryKick");

const KICK_LIMIT = 10;

/**
 * Best-effort fast path after a committed submission or decision: run one
 * small delivery pass for the workflow now instead of waiting for the next
 * scheduled pass. Durability never depends on it; the lifecycle intent was
 * committed with the change and the scheduled job recovers anything missed.
 */
export function kickApprovalDelivery(input: {
	organizationId: string;
	workflowId?: string | null;
}): void {
	void (async () => {
		const { hasApprovalDeliveryControl } = await import("./store");
		if (!(await hasApprovalDeliveryControl(input.organizationId))) return;
		const { processApprovalDeliveries } = await import("./owner");
		await processApprovalDeliveries({
			organizationId: input.organizationId,
			limit: KICK_LIMIT,
			...(input.workflowId ? { workflowId: input.workflowId } : {}),
		});
	})().catch((error) => {
		logger.warn(
			{ error, organizationId: input.organizationId },
			"Approval delivery fast path failed; the scheduled pass will recover",
		);
	});
}
