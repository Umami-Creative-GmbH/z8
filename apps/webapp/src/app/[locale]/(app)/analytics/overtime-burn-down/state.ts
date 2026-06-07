import type { OvertimeBurnDownData } from "@/lib/analytics/types";

export const ALL_FILTER_VALUE = "all";

export type BreakdownDimension = "team" | "costCenter" | "manager";

export interface OvertimeBurnDownState {
	loading: boolean;
	data: OvertimeBurnDownData | null;
	teamId: string;
	costCenterId: string;
	managerId: string;
	breakdownDimension: BreakdownDimension;
}

type FilterName = "teamId" | "costCenterId" | "managerId";

export type OvertimeBurnDownAction =
	| { type: "filterChanged"; name: FilterName; value: string }
	| { type: "breakdownChanged"; value: BreakdownDimension }
	| { type: "loadingStarted" }
	| { type: "dataLoaded"; data: OvertimeBurnDownData }
	| { type: "dataLoadFailed" };

export const overtimeBurnDownInitialState: OvertimeBurnDownState = {
	loading: true,
	data: null,
	teamId: ALL_FILTER_VALUE,
	costCenterId: ALL_FILTER_VALUE,
	managerId: ALL_FILTER_VALUE,
	breakdownDimension: "team",
};

export function overtimeBurnDownReducer(
	state: OvertimeBurnDownState,
	action: OvertimeBurnDownAction,
): OvertimeBurnDownState {
	if (action.type === "filterChanged") {
		return { ...state, [action.name]: action.value };
	}

	if (action.type === "breakdownChanged") {
		return { ...state, breakdownDimension: action.value };
	}

	if (action.type === "loadingStarted") {
		return { ...state, loading: true };
	}

	if (action.type === "dataLoaded") {
		return { ...state, data: action.data, loading: false };
	}

	return { ...state, data: null, loading: false };
}
