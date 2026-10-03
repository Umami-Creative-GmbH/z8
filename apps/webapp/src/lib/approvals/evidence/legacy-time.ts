import { and, eq } from "drizzle-orm";
import {
	type ApprovalPresentationProvider,
	approvalChainStageInstance,
	approvalRequest,
	approvalSubmittedRevision,
} from "@/db/schema";
import { type ApprovalAuthority, readApprovalAuthoritySnapshot } from "../authority";
import type { ApprovalDatabase } from "../server/types";
import { isTimeApprovalWorkflowType } from "../time-approval-kinds";
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
 * The approval authority of an exact time request (#432): its kind is the one
 * its cycle's legacy revision names. A request whose cycle has no legacy
 * revision is `undetermined`: no legacy card is issued for it and no card
 * decides it, so it keeps the existing path. A snapshot read, for
 * presentation only.
 */
export async function readTimeRequestAuthority(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalRequestId: string },
): Promise<ApprovalAuthority | "undetermined"> {
	const cycle = await loadLegacyTimeCycleRevision(database, input);
	if (cycle === null) return "undetermined";
	const { authority } = await readApprovalAuthoritySnapshot(database, {
		organizationId: input.organizationId,
		workflowType: cycle.kind,
	});
	return authority;
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
