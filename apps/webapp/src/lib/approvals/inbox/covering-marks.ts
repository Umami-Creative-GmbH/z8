import { isDeputyDecisionEntityType } from "../deputy/deputy-decision";
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

export function markCoveringFor(
	item: ApprovalInboxItem,
	approverId: string | null | undefined,
	covers: ReadonlyMap<string, ApprovalInboxCover>,
): ApprovalInboxItem {
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
