import { describe, expect, it } from "vitest";
import { getInitialOrganizationsState, organizationsReducer } from "./state";

describe("organizationsReducer", () => {
	it("updates filters and resets pagination together", () => {
		const state = getInitialOrganizationsState({ search: "old", status: "active" });

		const nextState = organizationsReducer(state, {
			type: "filtersChanged",
			search: "new",
			status: "suspended",
		});

		expect(nextState.search).toBe("new");
		expect(nextState.status).toBe("suspended");
		expect(nextState.page).toBe(1);
	});

	it("clears delete dialog state after closing", () => {
		const organization = { id: "org-1", name: "Acme" } as never;
		const state = organizationsReducer(
			getInitialOrganizationsState({ search: "", status: "all" }),
			{ type: "deleteDialogOpened", organization },
		);

		const nextState = organizationsReducer(
			{ ...state, deleteImmediate: true, deleteSkipNotification: true, deleteConfirmName: "Acme" },
			{ type: "deleteDialogClosed" },
		);

		expect(nextState.deleteDialogOrg).toBeNull();
		expect(nextState.deleteImmediate).toBe(false);
		expect(nextState.deleteSkipNotification).toBe(false);
		expect(nextState.deleteConfirmName).toBe("");
	});
});
