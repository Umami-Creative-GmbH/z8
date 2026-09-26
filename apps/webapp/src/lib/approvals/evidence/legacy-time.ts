import { and, eq } from "drizzle-orm";
import {
	type ApprovalPresentationProvider,
	approvalChainStageInstance,
	approvalRequest,
	approvalSubmittedRevision,
	approvalWorkflowRollout,
} from "@/db/schema";
import type { ApprovalDatabase } from "../server/types";
import { isTimeApprovalWorkflowType, type TimeApprovalWorkflowType } from "../time-approval-kinds";
import {
	loadLegacyTimeCorrectionSubmittedRevision,
	loadLegacyWorkPeriodSubmittedRevision,
	type TimeCorrectionSubmittedRevisionRecord,
	type WorkPeriodSubmittedRevisionRecord,
} from "./store";

/**
 * Legacy-authoritative time approvals (#432): manual time submissions, policy
 * clock-outs and time corrections decided by their legacy request or chain.
 * Cards bind the exact legacy request and the legacy revision of its
 * submission cycle, as legacy absence cards do (#384).
 */

/**
 * Providers whose legacy time cards may carry controls and whose presses may
 * decide (#432). Teams and Discord share the bound path but are not verified
 * under legacy authority, so even an `actionable` presentation control (for
 * example one left from canonical authority) keeps them review-only. Slack
 * never decides.
 */
export const LEGACY_TIME_ACTIONABLE_PROVIDERS: readonly ApprovalPresentationProvider[] = [
	"telegram",
];

/**
 * Whether a time kind is decided by legacy authority in the organization
 * (rollout `legacy`, `shadow`, `ready` or none). A legacy binding is issued and
 * decides only then, so it never decides under canonical authority.
 */
export async function hasLegacyTimeAuthority(
	database: ApprovalDatabase,
	input: { organizationId: string; workflowType: TimeApprovalWorkflowType },
): Promise<boolean> {
	const [rollout] = await database
		.select({ mode: approvalWorkflowRollout.lifecycleMode })
		.from(approvalWorkflowRollout)
		.where(
			and(
				eq(approvalWorkflowRollout.organizationId, input.organizationId),
				eq(approvalWorkflowRollout.workflowType, input.workflowType),
			),
		)
		.limit(1);
	return rollout?.mode !== "canonical" && rollout?.mode !== "complete";
}

/**
 * Whether an exact time request is decided by legacy authority: its cycle has
 * a legacy submitted revision and the revision's kind has legacy authority
 * (#432). A request without a legacy revision keeps the existing path.
 */
export async function isLegacyTimeAuthorityRequest(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalRequestId: string },
): Promise<boolean> {
	const cycle = await loadLegacyTimeCycleRevision(database, input);
	return (
		cycle !== null &&
		(await hasLegacyTimeAuthority(database, {
			organizationId: input.organizationId,
			workflowType: cycle.kind,
		}))
	);
}

export type LegacyTimeCycleRevision =
	| {
			kind: "time_correction";
			workPeriodId: string;
			chainInstanceId: string | null;
			revision: TimeCorrectionSubmittedRevisionRecord;
	  }
	| {
			kind: "manual_time_submission" | "policy_clock_out";
			workPeriodId: string;
			chainInstanceId: string | null;
			revision: WorkPeriodSubmittedRevisionRecord;
	  };

/**
 * The legacy submitted revision of the cycle an exact legacy time request
 * belongs to: the request routing created, or a stage request of the chain it
 * created. Its kind is the revision's, captured at submission. Null when the
 * request is no time request or its cycle has no legacy revision. A shared
 * work-period ID alone never links two cycles.
 */
export async function loadLegacyTimeCycleRevision(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalRequestId: string },
): Promise<LegacyTimeCycleRevision | null> {
	const [request] = await database
		.select({ entityType: approvalRequest.entityType, entityId: approvalRequest.entityId })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, input.approvalRequestId),
				eq(approvalRequest.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (request?.entityType !== "time_entry") return null;
	const stages = await database
		.select({ chainInstanceId: approvalChainStageInstance.chainInstanceId })
		.from(approvalChainStageInstance)
		.where(
			and(
				eq(approvalChainStageInstance.organizationId, input.organizationId),
				eq(approvalChainStageInstance.approvalRequestId, input.approvalRequestId),
			),
		)
		.limit(2);
	if (stages.length > 1) return null;
	const chainInstanceId = stages[0]?.chainInstanceId ?? null;
	const scope = {
		organizationId: input.organizationId,
		workPeriodId: request.entityId,
		approvalRequestId: input.approvalRequestId,
		chainInstanceId,
	};
	// The cycle's revision names its kind; read it before parsing by kind.
	const kinds = await database
		.select({ workflowType: approvalSubmittedRevision.workflowType })
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.organizationId, input.organizationId),
				eq(approvalSubmittedRevision.authority, "legacy"),
				eq(approvalSubmittedRevision.sourceType, "time_entry"),
				eq(approvalSubmittedRevision.sourceId, request.entityId),
				chainInstanceId
					? eq(approvalSubmittedRevision.legacyChainInstanceId, chainInstanceId)
					: eq(approvalSubmittedRevision.legacyApprovalRequestId, input.approvalRequestId),
			),
		)
		.limit(2);
	const kind = kinds.length === 1 ? kinds[0]?.workflowType : undefined;
	if (!isTimeApprovalWorkflowType(kind)) return null;
	if (kind === "time_correction") {
		const revision = await loadLegacyTimeCorrectionSubmittedRevision(database, scope);
		return revision ? { kind, workPeriodId: request.entityId, chainInstanceId, revision } : null;
	}
	const revision = await loadLegacyWorkPeriodSubmittedRevision(database, scope);
	return revision?.workflowType === kind
		? { kind, workPeriodId: request.entityId, chainInstanceId, revision }
		: null;
}
