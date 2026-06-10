import { describe, expect, it } from "vitest";
import { approvalInboxUiReducer, createApprovalInboxUiState } from "./approval-inbox-state";

describe("approval inbox ui reducer", () => {
	it("clears selection when filters change", () => {
		const state = createApprovalInboxUiState({ status: "pending" });
		const selectedState = approvalInboxUiReducer(state, {
			type: "selectionChanged",
			itemIdsKey: "one\u001ftwo",
			ids: new Set(["one", "two"]),
		});

		const nextState = approvalInboxUiReducer(selectedState, {
			type: "filtersChanged",
			filters: { status: "pending", types: ["time_entry"] },
			itemIdsKey: "one\u001ftwo",
		});

		expect(nextState.filters).toEqual({ status: "pending", types: ["time_entry"] });
		expect(nextState.selectedIdDraft).toEqual({ itemIdsKey: "one\u001ftwo", ids: new Set() });
	});

	it("clears the reject reason when the reject panel closes", () => {
		const state = approvalInboxUiReducer(createApprovalInboxUiState({ status: "pending" }), {
			type: "bulkRejectReasonChanged",
			reason: "Not enough detail",
		});

		const nextState = approvalInboxUiReducer(state, {
			type: "bulkRejectOpenChanged",
			open: false,
		});

		expect(nextState.bulkRejectOpen).toBe(false);
		expect(nextState.bulkRejectReason).toBe("");
	});
});
