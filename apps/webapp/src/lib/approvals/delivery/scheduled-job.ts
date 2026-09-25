import { createLogger } from "@/lib/logger";
import {
	type EscalationReplacementDeliverySummary,
	processEscalationReplacementDeliveries,
} from "../escalation/replacement-delivery";
import {
	type ApprovalDeliveryRunSummary,
	DEFAULT_APPROVAL_DELIVERY_BATCH_LIMIT,
	processApprovalDeliveries,
} from "./owner";
import { listApprovalDeliveryOrganizations } from "./store";

const logger = createLogger("ApprovalDeliveryJob");

export interface ApprovalDeliveryJobResult {
	success: boolean;
	organizations: ApprovalDeliveryRunSummary[];
	/** Escalation's replacement delivery pass per organization (#300). */
	replacements: EscalationReplacementDeliverySummary[];
	failedOrganizations: string[];
}

/**
 * Scheduler entry point. It supplies organization scope and limits only.
 * Organizations without a delivery control are never touched; their approval
 * notifications keep the existing path. Each organization gets the delivery
 * owner's pass and escalation's replacement delivery pass; they share the
 * work table but never execute each other's work.
 */
export async function runApprovalDeliveryJob(input?: {
	perOrganizationLimit?: number;
}): Promise<ApprovalDeliveryJobResult> {
	const limit = input?.perOrganizationLimit ?? DEFAULT_APPROVAL_DELIVERY_BATCH_LIMIT;
	const organizations: ApprovalDeliveryRunSummary[] = [];
	const replacements: EscalationReplacementDeliverySummary[] = [];
	const failedOrganizations: string[] = [];
	for (const organizationId of await listApprovalDeliveryOrganizations()) {
		try {
			organizations.push(await processApprovalDeliveries({ organizationId, limit }));
			replacements.push(await processEscalationReplacementDeliveries({ organizationId, limit }));
		} catch (error) {
			failedOrganizations.push(organizationId);
			logger.error({ error, organizationId }, "Approval delivery run failed");
		}
	}
	return {
		success: failedOrganizations.length === 0,
		organizations,
		replacements,
		failedOrganizations,
	};
}
