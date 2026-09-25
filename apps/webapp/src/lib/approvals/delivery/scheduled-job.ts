import { createLogger } from "@/lib/logger";
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
	failedOrganizations: string[];
}

/**
 * Scheduler entry point. It supplies organization scope and limits only.
 * Organizations without a delivery control are never touched; their approval
 * notifications keep the existing path.
 */
export async function runApprovalDeliveryJob(input?: {
	perOrganizationLimit?: number;
}): Promise<ApprovalDeliveryJobResult> {
	const organizations: ApprovalDeliveryRunSummary[] = [];
	const failedOrganizations: string[] = [];
	for (const organizationId of await listApprovalDeliveryOrganizations()) {
		try {
			organizations.push(
				await processApprovalDeliveries({
					organizationId,
					limit: input?.perOrganizationLimit ?? DEFAULT_APPROVAL_DELIVERY_BATCH_LIMIT,
				}),
			);
		} catch (error) {
			failedOrganizations.push(organizationId);
			logger.error({ error, organizationId }, "Approval delivery run failed");
		}
	}
	return {
		success: failedOrganizations.length === 0,
		organizations,
		failedOrganizations,
	};
}
