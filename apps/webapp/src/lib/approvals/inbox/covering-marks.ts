import { isDeputyDecisionEntityType } from "../deputy/deputy-decision";
import type { ApprovalQueryParams } from "../domain/types";
import type {
	ApprovalInboxCapabilities,
	ApprovalInboxCover,
	ApprovalInboxDetailResult,
	ApprovalInboxItem,
} from "./types";

/**
 * Inbox marks for covering deputies (#1016): an item assigned to an absent
 * approver the viewer covers for goes in that approver's "Covering for"
 * section; one whose earlier stage the viewer decided stays visible there
 * without decisions (four-eyes).
 */

/** The viewer's covers, without themselves, keyed by approver. */
export function coversByApprover(
	covering: readonly ApprovalInboxCover[] | undefined,
	viewerEmployeeId: string,
): Map<string, ApprovalInboxCover> {
	return new Map(
		(covering ?? [])
			.filter((cover) => cover.approverId !== viewerEmployeeId)
			.map((cover) => [cover.approverId, cover]),
	);
}

/**
 * Whether the viewer may decide this approval in their own right (default 8,
 * own rights win): they are its approver, hold `manage Approval`, or are an
 * eligible manager of its requester and approver. Such an item is never filed
 * under "Covering for" and gets no four-eyes block from the deputy path.
 */
export function viewerHasOwnRight(
	viewer: Pick<
		ApprovalQueryParams,
		"approverId" | "includeAllApprovers" | "eligibleApprovalScopes"
	>,
	approval: { approverId: string | null | undefined; requesterEmployeeId: string | null | undefined },
): boolean {
	if (viewer.includeAllApprovers || approval.approverId === viewer.approverId) return true;
	const { approverId, requesterEmployeeId } = approval;
	if (!approverId || !requesterEmployeeId) return false;
	return (
		viewer.eligibleApprovalScopes?.some(
			(scope) =>
				scope.requesterEmployeeId === requesterEmployeeId &&
				scope.eligibleApproverIds.includes(viewer.approverId) &&
				scope.eligibleApproverIds.includes(approverId),
		) ?? false
	);
}

export function markCoveringFor(
	item: ApprovalInboxItem,
	approverId: string | null | undefined,
	covers: ReadonlyMap<string, ApprovalInboxCover>,
	ownRight = false,
): ApprovalInboxItem {
	if (ownRight) return item;
	const cover = approverId ? covers.get(approverId) : undefined;
	if (!cover || item.status !== "pending" || !isDeputyDecisionEntityType(item.type)) return item;
	return { ...item, coveringFor: { approverId: cover.approverId, approverName: cover.approverName } };
}

function withoutDeputyDecisions(capabilities: ApprovalInboxCapabilities): ApprovalInboxCapabilities {
	return {
		...capabilities,
		canApprove: false,
		canReject: false,
		canBulkApprove: false,
		decidedEarlierStage: true,
	};
}

export function markDecidedEarlierStage(item: ApprovalInboxItem): ApprovalInboxItem {
	return { ...item, capabilities: withoutDeputyDecisions(item.capabilities) };
}

export function markDecidedEarlierStageDetail(
	detail: ApprovalInboxDetailResult,
): ApprovalInboxDetailResult {
	return {
		...detail,
		item: markDecidedEarlierStage(detail.item),
		actions: withoutDeputyDecisions(detail.actions),
	};
}
