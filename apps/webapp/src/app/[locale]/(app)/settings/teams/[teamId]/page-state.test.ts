import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/query", () => ({ queryKeys: {} }));

import { initialTeamPageUiState, teamPageUiReducer } from "./page-state";

describe("teamPageUiReducer available employees", () => {
	it("marks the picker loading and clears an earlier error when a fetch starts", () => {
		const failed = teamPageUiReducer(initialTeamPageUiState, {
			type: "loadAvailableEmployeesFailed",
			error: "Boom",
		});
		const state = teamPageUiReducer(failed, { type: "loadAvailableEmployeesStarted" });

		expect(state.isLoadingAvailableEmployees).toBe(true);
		expect(state.availableEmployeesError).toBeNull();
	});

	it("settles the picker with the fetched employees", () => {
		const loading = teamPageUiReducer(initialTeamPageUiState, {
			type: "loadAvailableEmployeesStarted",
		});
		const state = teamPageUiReducer(loading, { type: "setAvailableEmployees", employees: [] });

		expect(state.isLoadingAvailableEmployees).toBe(false);
		expect(state.availableEmployeesError).toBeNull();
		expect(state.availableEmployees).toEqual([]);
	});

	it("settles the picker with the failure", () => {
		const loading = teamPageUiReducer(initialTeamPageUiState, {
			type: "loadAvailableEmployeesStarted",
		});
		const state = teamPageUiReducer(loading, {
			type: "loadAvailableEmployeesFailed",
			error: "Could not load employees to add",
		});

		expect(state.isLoadingAvailableEmployees).toBe(false);
		expect(state.availableEmployeesError).toBe("Could not load employees to add");
	});
});
