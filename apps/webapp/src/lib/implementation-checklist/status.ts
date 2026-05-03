import {
	IMPLEMENTATION_CHECKLIST_ITEMS,
	type ImplementationChecklistDefinition,
	type ImplementationChecklistItemId,
} from "./definition";

export type ImplementationChecklistStatus = "complete" | "not-started";
export type ImplementationChecklistCompletionSource = "automatic" | "manual" | null;

export interface ResolveImplementationChecklistItemsInput {
	detectedCompleteIds: Set<ImplementationChecklistItemId>;
	manualCompleteIds: Set<ImplementationChecklistItemId>;
}

export interface ResolvedImplementationChecklistItem extends ImplementationChecklistDefinition {
	status: ImplementationChecklistStatus;
	completionSource: ImplementationChecklistCompletionSource;
	canToggleManualCompletion: boolean;
}

export function resolveImplementationChecklistItems({
	detectedCompleteIds,
	manualCompleteIds,
}: ResolveImplementationChecklistItemsInput): ResolvedImplementationChecklistItem[] {
	return IMPLEMENTATION_CHECKLIST_ITEMS.map((item) => {
		if (detectedCompleteIds.has(item.id)) {
			return {
				...item,
				status: "complete" as const,
				completionSource: "automatic" as const,
				canToggleManualCompletion: false,
			};
		}

		if (item.canManualComplete && manualCompleteIds.has(item.id)) {
			return {
				...item,
				status: "complete" as const,
				completionSource: "manual" as const,
				canToggleManualCompletion: true,
			};
		}

		return {
			...item,
			status: "not-started" as const,
			completionSource: null,
			canToggleManualCompletion: item.canManualComplete,
		};
	});
}
