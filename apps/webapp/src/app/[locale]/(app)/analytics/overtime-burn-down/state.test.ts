import { describe, expect, it } from "vitest";
import type { OvertimeBurnDownData } from "@/lib/analytics/types";
import {
	ALL_FILTER_VALUE,
	overtimeBurnDownInitialState,
	overtimeBurnDownReducer,
} from "./state";

describe("overtimeBurnDownReducer", () => {
	it("updates related filters without changing the selected breakdown", () => {
		const state = overtimeBurnDownReducer(overtimeBurnDownInitialState, {
			type: "filterChanged",
			name: "teamId",
			value: "team-1",
		});

		expect(state).toEqual({
			...overtimeBurnDownInitialState,
			teamId: "team-1",
		});
	});

	it("sets fetch data and loading together from one transition", () => {
		const data: OvertimeBurnDownData = {
			summary: {
				currentOvertimeHours: 0,
				wowDeltaHours: 0,
				improvingGroups: 0,
				trendDirection: "flat",
			},
			weeklySeries: [],
			byTeam: [],
			byCostCenter: [],
			byManager: [],
		};
		const loadingState = overtimeBurnDownReducer(overtimeBurnDownInitialState, {
			type: "loadingStarted",
		});
		const loadedState = overtimeBurnDownReducer(loadingState, {
			type: "dataLoaded",
			data,
		});

		expect(loadedState.loading).toBe(false);
		expect(loadedState.data).toBe(data);
		expect(loadedState.teamId).toBe(ALL_FILTER_VALUE);
	});
});
