import { describe, expect, it } from "vitest";
import {
	orgExplorerSearch,
	parseOrgExplorerUrlState,
} from "./org-explorer-url";

describe("Org Explorer URL state", () => {
	it("defaults to Reporting lines with no filter and nobody selected", () => {
		expect(parseOrgExplorerUrlState(new URLSearchParams())).toEqual({
			view: "reporting-lines",
			teamIds: [],
			employeeId: null,
		});
	});

	it("reads the view, the team filter and the selected person", () => {
		expect(
			parseOrgExplorerUrlState(
				new URLSearchParams("view=teams&team=t1&team=t2&team=t1&employee=e1"),
			),
		).toEqual({ view: "teams", teamIds: ["t1", "t2"], employeeId: "e1" });
	});

	it("falls back to Reporting lines for an unknown view and ignores empty values", () => {
		expect(
			parseOrgExplorerUrlState(
				new URLSearchParams("view=graph&team=&employee="),
			),
		).toEqual({ view: "reporting-lines", teamIds: [], employeeId: null });
	});

	it("writes only what differs from the default and keeps other parameters", () => {
		expect(
			orgExplorerSearch(
				{ view: "teams", teamIds: ["t1", "t2"], employeeId: "e1" },
				new URLSearchParams("tab=x&view=reporting-lines&team=old"),
			),
		).toBe("?tab=x&view=teams&team=t1&team=t2&employee=e1");
		expect(
			orgExplorerSearch(
				{ view: "reporting-lines", teamIds: [], employeeId: null },
				new URLSearchParams("view=teams&team=t1&employee=e1"),
			),
		).toBe("");
	});

	it("round-trips a state through the URL", () => {
		const state = {
			view: "teams" as const,
			teamIds: ["a", "b"],
			employeeId: "e",
		};

		expect(
			parseOrgExplorerUrlState(
				new URLSearchParams(orgExplorerSearch(state, new URLSearchParams())),
			),
		).toEqual(state);
	});
});
