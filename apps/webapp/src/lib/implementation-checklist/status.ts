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
	manualCompleteIds: Set<ImplementationChecklistItemId>;
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
}

export function resolveImplementationChecklistItems({
	detectedCompleteIds,
	manualCompleteIds,
	goLiveResults = [],
}: ResolveImplementationChecklistItemsInput): ResolvedImplementationChecklistItem[] {
	return IMPLEMENTATION_CHECKLIST_ITEMS.map((item) => {
		const manuallyComplete = item.canManualComplete && manualCompleteIds.has(item.id);
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
			};
		}

		return {
			...item,
			status: "not-set-up" as const,
			completionSource: null,
			canToggleManualCompletion: item.canManualComplete,
			goLive: null,
			countsTowardProgress: false,
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
