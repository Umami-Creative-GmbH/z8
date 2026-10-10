import { approvalWorkflowRollout } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-schema";
import {
	initialApprovalLifecycleMode,
	initialApprovalSideEffectMode,
} from "../authority/resolution";
import type { ApprovalDatabase } from "../server/types";
import { APPROVAL_WORKFLOW_TYPES } from "./types";

/**
 * Pre-creates a new organization's approval rollout rows (#359), one per
 * workflow type, in the organization's creation transaction. Without them the
 * first write of a workflow type bootstraps its row in the write gate, and every
 * other writer of that type in the organization waits on the uncommitted row.
 *
 * Rows start in the kind's initial modes, like the write gate's fail-safe
 * insert: `legacy`/`legacy` (as migration 0107's backfill), or
 * `complete`/`canonical` for a canonical-only kind (#1058). An existing row
 * and its modes are never changed.
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
				lifecycleMode: initialApprovalLifecycleMode(workflowType),
				sideEffectMode: initialApprovalSideEffectMode(workflowType),
				updatedAt,
			})),
		)
		.onConflictDoNothing({
			target: [approvalWorkflowRollout.organizationId, approvalWorkflowRollout.workflowType],
		});
}
