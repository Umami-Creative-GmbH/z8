import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalEscalationControl } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import {
	DEFAULT_ESCALATION_BATCH_LIMIT,
	type ProcessDueEscalationsSummary,
	processDueEscalations,
} from "./transfer";

const logger = createLogger("ApprovalEscalationJob");

export interface ApprovalEscalationJobResult {
	success: boolean;
	organizations: ProcessDueEscalationsSummary[];
	failedOrganizations: string[];
}

/**
 * Scheduler entry point. It supplies organization scope and limits only; all
 * policy, eligibility and authority decisions stay in the escalation module.
 * Organizations whose escalation ownership has not moved from legacy channel
 * automation are never touched, and ownership is re-read per assignment.
 */
export async function runApprovalEscalationJob(input?: {
	perOrganizationLimit?: number;
}): Promise<ApprovalEscalationJobResult> {
	const owners = await db
		.select({ organizationId: approvalEscalationControl.organizationId })
		.from(approvalEscalationControl)
		.where(eq(approvalEscalationControl.owner, "escalation"))
		.orderBy(asc(approvalEscalationControl.organizationId));

	const organizations: ProcessDueEscalationsSummary[] = [];
	const failedOrganizations: string[] = [];
	for (const { organizationId } of owners) {
		try {
			organizations.push(
				await processDueEscalations({
					organizationId,
					limit: input?.perOrganizationLimit ?? DEFAULT_ESCALATION_BATCH_LIMIT,
				}),
			);
		} catch (error) {
			failedOrganizations.push(organizationId);
			logger.error({ error, organizationId }, "Approval escalation run failed");
		}
	}
	return {
		success: failedOrganizations.length === 0,
		organizations,
		failedOrganizations,
	};
}
