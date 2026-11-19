import type { OvertimeBurnDownData } from "@/lib/analytics/types";

export const ALL_FILTER_VALUE = "all";

export type BreakdownDimension = "team" | "costCenter" | "manager";
export type FilterChoice = Pick<
	OvertimeBurnDownData["byTeam"][number],
	"id" | "label"
>;
export type FilterChoices = Record<
	"byTeam" | "byCostCenter" | "byManager",
	FilterChoice[]
>;

function retainChoices(previous: FilterChoice[] = [], next: FilterChoice[]) {
	return Array.from(
		new Map(
			[...previous, ...next].map(({ id, label }) => [id, { id, label }]),
		).values(),
	);
}

export interface OvertimeBurnDownState {
	loading: boolean;
	refreshing: boolean;
	failed: boolean;
	requestKey: string | null;
	data: OvertimeBurnDownData | null;
	choices: FilterChoices | null;
	teamId: string;
	costCenterId: string;
	managerId: string;
	breakdownDimension: BreakdownDimension;
}

type FilterName = "teamId" | "costCenterId" | "managerId";

export type OvertimeBurnDownAction =
	| { type: "filterChanged"; name: FilterName; value: string }
	| { type: "breakdownChanged"; value: BreakdownDimension }
	| { type: "loadingStarted"; background?: boolean }
	| { type: "dataLoaded"; data: OvertimeBurnDownData; requestKey?: string }
	| { type: "dataLoadFailed"; background?: boolean; refused?: boolean };

export const overtimeBurnDownInitialState: OvertimeBurnDownState = {
	loading: true,
	refreshing: false,
	failed: false,
	requestKey: null,
	data: null,
	choices: null,
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
		return {
			...state,
			loading: !action.background,
			refreshing: Boolean(action.background),
			failed: false,
		};
	}

	if (action.type === "dataLoaded") {
		return {
			...state,
			data: action.data,
			choices: {
				byTeam: retainChoices(state.choices?.byTeam, action.data.byTeam),
				byCostCenter: retainChoices(
					state.choices?.byCostCenter,
					action.data.byCostCenter,
				),
				byManager: retainChoices(
					state.choices?.byManager,
					action.data.byManager,
				),
			},
			requestKey: action.requestKey ?? null,
			loading: false,
			refreshing: false,
			failed: false,
		};
	}

	return {
		...state,
		data: action.background && !action.refused ? state.data : null,
		choices: action.refused ? null : state.choices,
		loading: false,
		refreshing: false,
		failed: true,
	};
}
