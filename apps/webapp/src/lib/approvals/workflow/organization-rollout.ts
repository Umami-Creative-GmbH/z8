import { approvalWorkflowRollout } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-schema";
import type { ApprovalDatabase } from "../server/types";
import { APPROVAL_WORKFLOW_TYPES } from "./types";

/**
 * Pre-creates a new organization's approval rollout rows (#359), one per
 * workflow type, in the organization's creation transaction. Without them the
 * first write of a workflow type bootstraps its row in the write gate, and every
 * other writer of that type in the organization waits on the uncommitted row.
 *
 * Rows start `legacy`/`legacy`, like the write gate's fail-safe insert and
 * migration 0107's backfill. An existing row and its modes are never changed.
 */
export async function createOrganizationApprovalRollouts(
	database: ApprovalDatabase,
	organizationId: string,
): Promise<void> {
	const updatedAt = currentTimestamp();
	await database
		.insert(approvalWorkflowRollout)
		.values(
			APPROVAL_WORKFLOW_TYPES.map((workflowType) => ({
				organizationId,
				workflowType,
				lifecycleMode: "legacy" as const,
				sideEffectMode: "legacy" as const,
				updatedAt,
			})),
		)
		.onConflictDoNothing({
			target: [approvalWorkflowRollout.organizationId, approvalWorkflowRollout.workflowType],
		});
}
