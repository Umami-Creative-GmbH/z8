import type { ApprovalInboxTopItems } from "@/lib/approvals/inbox/top-items";
import {
	type ApprovalInboxType,
	SUPPORTED_APPROVAL_INBOX_TYPES,
} from "@/lib/approvals/inbox/types";
import type { PendingApprovalsData } from "./dashboard-types";

/**
 * The Pending Approvals widget's data from the inbox's most urgent items (#1978). A failed
 * source is told apart as the inbox tells it: a type whose count failed still lists its rows
 * but is missing from the totals, so it counts at least its rows in hand; one whose list, or
 * "Covering for" rows, failed is missing from the list too. A failure of unknown kind reads
 * as not loaded. A failed "Covering for" header count changes nothing here: no total uses it.
 */
export function pendingApprovalsData({
	counts,
	total,
	coveringCount,
	listed,
	items,
	warnings,
}: ApprovalInboxTopItems): PendingApprovalsData {
	const notCounted = new Set<string>();
	const notLoaded = new Set<string>();
	for (const warning of warnings) {
		if (warning.failure === "covering_count") continue;
		(warning.failure === "count" ? notCounted : notLoaded).add(warning.source);
	}
	const inTypeOrder = (failed: Set<string>): ApprovalInboxType[] =>
		SUPPORTED_APPROVAL_INBOX_TYPES.filter((type) => failed.has(type));
	const typeCounts = SUPPORTED_APPROVAL_INBOX_TYPES.flatMap((type) => {
		const counted = counts[type] ?? 0;
		if (!notCounted.has(type)) return counted > 0 ? [{ type, count: counted }] : [];
		// Its own count is missing: its rows in hand are the most that is known to wait.
		const atLeast = Math.max(counted, listed[type] ?? 0);
		return atLeast > 0 ? [{ type, count: atLeast, atLeast: true as const }] : [];
	});
	return {
		// Never fewer than its types: a lower bound raises the total as it raises its pill.
		total: notCounted.size > 0 ? typeCounts.reduce((sum, { count }) => sum + count, 0) : total,
		coveringCount,
		notLoadedTypes: inTypeOrder(notLoaded),
		notCountedTypes: inTypeOrder(notCounted),
		typeCounts,
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
