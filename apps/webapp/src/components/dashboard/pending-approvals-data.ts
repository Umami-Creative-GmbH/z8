import type { ApprovalInboxTopItems } from "@/lib/approvals/inbox/top-items";
import {
	type ApprovalInboxType,
	SUPPORTED_APPROVAL_INBOX_TYPES,
} from "@/lib/approvals/inbox/types";
import type { PendingApprovalsData } from "./dashboard-types";

/**
 * The Pending Approvals widget's data from the inbox's most urgent items (#1978). A failed
 * source is told apart as the inbox tells it: a type whose count failed still lists its rows
 * but is missing from the totals; one whose list, or "Covering for" rows, failed is missing
 * from the list too. A failure of unknown kind reads as not loaded.
 */
export function pendingApprovalsData({
	counts,
	total,
	coveringCount,
	items,
	warnings,
}: ApprovalInboxTopItems): PendingApprovalsData {
	const notCounted = new Set<string>();
	const notLoaded = new Set<string>();
	for (const warning of warnings) {
		(warning.failure === "count" ? notCounted : notLoaded).add(warning.source);
	}
	const inTypeOrder = (failed: Set<string>): ApprovalInboxType[] =>
		SUPPORTED_APPROVAL_INBOX_TYPES.filter((type) => failed.has(type));
	return {
		total,
		coveringCount,
		notLoadedTypes: inTypeOrder(notLoaded),
		notCountedTypes: inTypeOrder(notCounted),
		typeCounts: SUPPORTED_APPROVAL_INBOX_TYPES.flatMap((type) =>
			(counts[type] ?? 0) > 0 ? [{ type, count: counts[type] }] : [],
		),
		preview: items.map((item) => ({
			id: item.id,
			type: item.type,
			requesterName: item.requester.name,
			title: item.summary.localized?.title ?? item.summary.title,
			detail: item.summary.localized?.detail ?? item.summary.detail,
			coveringForName: item.coveringFor?.approverName ?? null,
			// Like the badge, the count includes an org-wide viewer's own pending request.
			ownRequest: item.capabilities.ownRequest === true,
		})),
	};
}
