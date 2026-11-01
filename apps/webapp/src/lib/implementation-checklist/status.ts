import { type ManualConfirmation, manualConfirmationCounts } from "./confirmation/freshness";
import {
	IMPLEMENTATION_CHECKLIST_ITEMS,
	type ImplementationChecklistDefinition,
	type ImplementationChecklistItemId,
} from "./definition";
import { goLiveItemStatus } from "./go-live/readiness";
import type { GoLiveCheckResult, ImplementationChecklistItemStatus } from "./go-live/types";

export type ImplementationChecklistStatus = ImplementationChecklistItemStatus;
export type ImplementationChecklistCompletionSource = "automatic" | "manual" | null;

export interface ResolveImplementationChecklistItemsInput {
	detectedCompleteIds: Set<ImplementationChecklistItemId>;
	/** Items with a stored manual confirmation. */
	manualCompleteIds: Set<ImplementationChecklistItemId>;
	/**
	 * When and how fresh each stored confirmation is. A confirmation without an
	 * entry counts as before; a stale or unchecked one is kept but doesn't count.
	 */
	manualConfirmations?: ReadonlyMap<ImplementationChecklistItemId, ManualConfirmation>;
	/** Results of the go-live checks; an item with a result takes its status from it. */
	goLiveResults?: readonly GoLiveCheckResult[];
}

export interface ResolvedImplementationChecklistItem extends ImplementationChecklistDefinition {
	status: ImplementationChecklistStatus;
	completionSource: ImplementationChecklistCompletionSource;
	canToggleManualCompletion: boolean;
	/** The item's go-live check result, or null when it has no go-live check. */
	goLive: GoLiveCheckResult | null;
	/** Verified go-live items, and configured items without a go-live check. */
	countsTowardProgress: boolean;
	/** The stored manual confirmation, counting or not; null when there is none. */
	manualConfirmation: ManualConfirmation | null;
}

export function resolveImplementationChecklistItems({
	detectedCompleteIds,
	manualCompleteIds,
	manualConfirmations,
	goLiveResults = [],
}: ResolveImplementationChecklistItemsInput): ResolvedImplementationChecklistItem[] {
	return IMPLEMENTATION_CHECKLIST_ITEMS.map((item) => {
		const confirmed = item.canManualComplete && manualCompleteIds.has(item.id);
		const manualConfirmation = confirmed ? (manualConfirmations?.get(item.id) ?? null) : null;
		const manuallyComplete =
			confirmed &&
			(manualConfirmation === null || manualConfirmationCounts(manualConfirmation.freshness));
		const goLive = goLiveResults.find((result) => result.itemId === item.id) ?? null;

		if (goLive) {
			// A manual confirmation is kept, but never raises a go-live item to verified.
			const status = goLiveItemStatus(goLive);
			return {
				...item,
				status,
				completionSource: manuallyComplete
					? ("manual" as const)
					: status === "verified"
						? ("automatic" as const)
						: null,
				canToggleManualCompletion: item.canManualComplete,
				goLive,
				countsTowardProgress: status === "verified",
				manualConfirmation,
			};
		}

		if (item.detector === "automatic" && detectedCompleteIds.has(item.id)) {
			return {
				...item,
				status: "configured" as const,
				completionSource: "automatic" as const,
				canToggleManualCompletion: false,
				goLive: null,
				countsTowardProgress: true,
				manualConfirmation: null,
			};
		}

		if (manuallyComplete) {
			return {
				...item,
				status: "configured" as const,
				completionSource: "manual" as const,
				canToggleManualCompletion: true,
				goLive: null,
				countsTowardProgress: true,
				manualConfirmation,
			};
		}

		return {
			...item,
			status: "not-set-up" as const,
			completionSource: null,
			canToggleManualCompletion: item.canManualComplete,
			goLive: null,
			countsTowardProgress: false,
			manualConfirmation,
		};
	});
}

/** Checklist progress: how many items are done out of all items. */
export function summarizeImplementationChecklist(
	items: readonly ResolvedImplementationChecklistItem[],
): { completedCount: number; totalCount: number } {
	return {
		completedCount: items.filter((item) => item.countsTowardProgress).length,
		totalCount: items.length,
	};
}
