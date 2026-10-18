import type { ApprovalTriageContext } from "../triage-assessment";
import type {
	ApprovalInboxDetailResult,
	ApprovalInboxFastLaneGroup,
	ApprovalInboxItem,
} from "./types";

/** The assessment the reviewer actually saw; it never grants decision authority. */
export interface ApprovalFastLaneReview {
	group: ApprovalInboxFastLaneGroup;
	reviewedContexts: Record<string, ApprovalTriageContext | null>;
}

export type FastLaneDecisionItem = Pick<
	ApprovalInboxItem,
	"id" | "type" | "entityId" | "status" | "triage" | "capabilities"
>;

export function isApprovalFastLaneReview(
	value: unknown,
): value is ApprovalFastLaneReview {
	if (!value || typeof value !== "object") return false;
	const review = value as Record<string, unknown>;
	if (
		![
			"small_time_correction",
			"low_risk_absence",
			"payroll_blocker",
			"stale_pending",
		].includes(String(review.group))
	)
		return false;
	if (
		!review.reviewedContexts ||
		typeof review.reviewedContexts !== "object" ||
		Array.isArray(review.reviewedContexts)
	)
		return false;
	return Object.values(review.reviewedContexts).every((context) => {
		if (context === null) return true;
		if (!context || typeof context !== "object" || Array.isArray(context))
			return false;
		const fields = context as Record<string, unknown>;
		return (
			["organizationId", "requestId", "entityId", "scope"].every(
				(field) =>
					typeof fields[field] === "string" && fields[field].length > 0,
			) &&
			(fields.revision === null ||
				(typeof fields.revision === "string" && fields.revision.length > 0))
		);
	});
}

export function matchesFastLaneReview(
	item: FastLaneDecisionItem,
	review: ApprovalFastLaneReview,
): boolean {
	if (item.status !== "pending" || item.triage.fastLaneGroup !== review.group)
		return false;
	const current = item.triage.context;
	const reviewed = review.reviewedContexts[item.id];
	// Other kinds keep their existing triage scope and independent authorization.
	if (!item.triage.requestKind || item.triage.requestKind === "other")
		return true;
	return (
		!!current?.revision &&
		!!reviewed &&
		current.organizationId === reviewed.organizationId &&
		current.requestId === reviewed.requestId &&
		current.entityId === reviewed.entityId &&
		current.revision === reviewed.revision &&
		current.scope === reviewed.scope
	);
}

export function fastLaneDecisionItemOf(
	detail: ApprovalInboxDetailResult,
): FastLaneDecisionItem {
	const item = detail.item;
	const a = item.capabilities;
	const b = detail.actions;
	const ownRequest = a.ownRequest || b.ownRequest;
	const decidedEarlierStage = a.decidedEarlierStage || b.decidedEarlierStage;
	return {
		...item,
		capabilities: {
			...a,
			...b,
			canApprove:
				a.canApprove && b.canApprove && !ownRequest && !decidedEarlierStage,
			canReject:
				a.canReject && b.canReject && !ownRequest && !decidedEarlierStage,
			canBulkApprove:
				a.canBulkApprove &&
				b.canBulkApprove &&
				!ownRequest &&
				!decidedEarlierStage,
			requiresRejectReason: a.requiresRejectReason || b.requiresRejectReason,
			requiresDetailReview: a.requiresDetailReview || b.requiresDetailReview,
			ownRequest,
			decidedEarlierStage,
		},
	};
}
