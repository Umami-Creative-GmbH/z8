import type { ApprovalInboxItem } from "@/lib/approvals/inbox/types";
import type { ApprovalInboxFilters } from "@/lib/query/use-approval-inbox";

type SelectedIdDraft = {
	itemIdsKey: string;
	ids: Set<string>;
};

export type ApprovalInboxUiState = {
	filters: ApprovalInboxFilters;
	selectedIdDraft: SelectedIdDraft;
	detailApproval: ApprovalInboxItem | null;
	bulkRejectOpen: boolean;
	bulkRejectReason: string;
	sprintOpen: boolean;
};

export type ApprovalInboxUiAction =
	| { type: "filtersChanged"; filters: ApprovalInboxFilters; itemIdsKey: string }
	| { type: "selectionChanged"; itemIdsKey: string; ids: Set<string> }
	| { type: "detailApprovalChanged"; approval: ApprovalInboxItem | null }
	| { type: "bulkRejectOpenChanged"; open: boolean }
	| { type: "bulkRejectReasonChanged"; reason: string }
	| { type: "sprintOpenChanged"; open: boolean }
	| { type: "selectionCleared"; itemIdsKey: string };

export function createApprovalInboxUiState(filters: ApprovalInboxFilters): ApprovalInboxUiState {
	return {
		filters,
		selectedIdDraft: { itemIdsKey: "", ids: new Set() },
		detailApproval: null,
		bulkRejectOpen: false,
		bulkRejectReason: "",
		sprintOpen: false,
	};
}

export function approvalInboxUiReducer(
	state: ApprovalInboxUiState,
	action: ApprovalInboxUiAction,
): ApprovalInboxUiState {
	switch (action.type) {
		case "filtersChanged":
			return {
				...state,
				filters: action.filters,
				selectedIdDraft: { itemIdsKey: action.itemIdsKey, ids: new Set() },
			};
		case "selectionChanged":
			return {
				...state,
				selectedIdDraft: { itemIdsKey: action.itemIdsKey, ids: action.ids },
			};
		case "selectionCleared":
			return {
				...state,
				selectedIdDraft: { itemIdsKey: action.itemIdsKey, ids: new Set() },
			};
		case "detailApprovalChanged":
			return { ...state, detailApproval: action.approval };
		case "bulkRejectOpenChanged":
			return {
				...state,
				bulkRejectOpen: action.open,
				bulkRejectReason: action.open ? state.bulkRejectReason : "",
			};
		case "bulkRejectReasonChanged":
			return { ...state, bulkRejectReason: action.reason };
		case "sprintOpenChanged":
			return { ...state, sprintOpen: action.open };
	}
}
