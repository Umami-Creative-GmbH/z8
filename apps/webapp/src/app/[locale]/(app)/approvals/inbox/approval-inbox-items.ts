import { isGraverSourceFailure } from "@/lib/approvals/inbox/source-failure";
import type {
	ApprovalInboxFastLaneGroup,
	ApprovalInboxItem,
	ApprovalInboxWarning,
} from "@/lib/approvals/inbox/types";

export type ApprovalInboxFastLaneGroupView = {
	key: ApprovalInboxFastLaneGroup;
	items: ApprovalInboxItem[];
};

const RISK_RANK: Record<ApprovalInboxItem["triage"]["riskLevel"], number> = {
	low: 1,
	medium: 2,
	high: 3,
};

/**
 * One warning per source (#1978): its gravest across pages, as the server keeps it within a
 * page, in the order the sources first failed.
 */
export function dedupeWarnings(warnings: ApprovalInboxWarning[]): ApprovalInboxWarning[] {
	const bySource = new Map<string, ApprovalInboxWarning>();

	for (const warning of warnings) {
		const known = bySource.get(warning.source);
		if (!known || isGraverSourceFailure(warning.failure, known.failure)) {
			bySource.set(warning.source, warning);
		}
	}

	return [...bySource.values()];
}

export function groupFastLaneItems(items: ApprovalInboxItem[]): ApprovalInboxFastLaneGroupView[] {
	const groups = new Map<ApprovalInboxFastLaneGroup, ApprovalInboxItem[]>();

	for (const item of items) {
		const groupKey = item.triage.fastLaneGroup;
		if (groupKey === null) {
			continue;
		}

		groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
	}

	return Array.from(groups, ([key, groupedItems]) => ({
		key,
		items: groupedItems,
	}));
}

/**
 * The viewer's own requests (#686) and covered requests whose earlier stage
 * the viewer decided (four-eyes, #1016) are never selected, sprinted or
 * fast-laned.
 */
export function isDecidableByViewer(item: ApprovalInboxItem): boolean {
	return item.capabilities.ownRequest !== true && item.capabilities.decidedEarlierStage !== true;
}

/** An item a bulk decision may take: decidable, and not one decided singly only (#1977). */
export function isSelectableForBulkDecision(item: ApprovalInboxItem): boolean {
	return isDecidableByViewer(item) && item.capabilities.singleDecisionOnly !== true;
}

export function sortSprintItems(items: ApprovalInboxItem[]): ApprovalInboxItem[] {
	return items.toSorted((first, second) => {
		const riskDifference = RISK_RANK[second.triage.riskLevel] - RISK_RANK[first.triage.riskLevel];
		if (riskDifference !== 0) {
			return riskDifference;
		}

		return second.timing.ageDays - first.timing.ageDays;
	});
}

export function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
