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

/**
 * The viewer never decides their own request, even when managing approvals
 * lets them see it (#686): it stays visible, read-only, for someone else.
 */
export function asViewerItem(
	item: ApprovalInboxItem,
	viewerEmployeeId: string | undefined,
): ApprovalInboxItem {
	if (!viewerEmployeeId || item.requester.id !== viewerEmployeeId) return item;
	return { ...item, capabilities: withoutDecisions(item.capabilities) };
}

export function asViewerDetail(
	detail: ApprovalInboxDetailResult,
	viewerEmployeeId: string,
): ApprovalInboxDetailResult {
	if (detail.item.requester.id !== viewerEmployeeId) return detail;
	return {
		...detail,
		item: asViewerItem(detail.item, viewerEmployeeId),
		actions: withoutDecisions(detail.actions),
	};
}
