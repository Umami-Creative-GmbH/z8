import type {
	ApprovalInboxCapabilities,
	ApprovalInboxDetailResult,
	ApprovalInboxItem,
} from "./types";

function withoutDecisions(capabilities: ApprovalInboxCapabilities): ApprovalInboxCapabilities {
	return {
		...capabilities,
		canApprove: false,
		canReject: false,
		canBulkApprove: false,
		ownRequest: true,
	};
}

function isPendingOwnRequest(item: ApprovalInboxItem, viewerEmployeeId: string): boolean {
	return item.status === "pending" && item.requester.id === viewerEmployeeId;
}

/**
 * The viewer never decides their own request, even when managing approvals
 * lets them see it (#686): a pending one stays visible, read-only, for
 * someone else to decide.
 */
export function markOwnRequest(
	item: ApprovalInboxItem,
	viewerEmployeeId: string,
): ApprovalInboxItem {
	if (!isPendingOwnRequest(item, viewerEmployeeId)) return item;
	return { ...item, capabilities: withoutDecisions(item.capabilities) };
}

export function markOwnRequestDetail(
	detail: ApprovalInboxDetailResult,
	viewerEmployeeId: string,
): ApprovalInboxDetailResult {
	if (!isPendingOwnRequest(detail.item, viewerEmployeeId)) return detail;
	return {
		...detail,
		item: { ...detail.item, capabilities: withoutDecisions(detail.item.capabilities) },
		actions: withoutDecisions(detail.actions),
	};
}
