import { Temporal } from "temporal-polyfill";

export type CountryOption = { code: string; name: string };
export type StateOption = CountryOption;
export type HolidayType = "public" | "bank" | "optional" | "school" | "observance";

export type HolidayPreview = {
	name: string;
	date: string;
	startDate: string;
	endDate: string;
	type: string;
	region?: string;
	isDuplicate: boolean;
};

export type HolidayImportState = {
	step: number;
	countries: CountryOption[];
	states: StateOption[];
	regions: StateOption[];
	selectedCountry: string;
	selectedState: string;
	selectedRegion: string;
	selectedYear: number;
	selectedTypes: HolidayType[];
	holidays: HolidayPreview[];
	selectedHolidays: Set<string>;
	presetName: string;
	presetColor: string;
	setAsOrgDefault: boolean;
	countriesLoading: boolean;
	statesLoading: boolean;
	regionsLoading: boolean;
	previewLoading: boolean;
	importLoading: boolean;
};

export const holidayTypes: { value: HolidayType; label: string }[] = [
	{ value: "public", label: "Public Holidays" },
	{ value: "bank", label: "Bank Holidays" },
];

export function initialHolidayImportState(): HolidayImportState {
	return {
		step: 1,
		countries: [],
		states: [],
		regions: [],
		selectedCountry: "",
		selectedState: "",
		selectedRegion: "",
		selectedYear: Temporal.Now.plainDateISO("UTC").year,
		selectedTypes: ["public"],
		holidays: [],
		selectedHolidays: new Set(),
		presetName: "",
		presetColor: "#4F46E5",
		setAsOrgDefault: false,
		countriesLoading: false,
		statesLoading: false,
		regionsLoading: false,
		previewLoading: false,
		importLoading: false,
	};
}

export type HolidayImportAction = (state: HolidayImportState) => HolidayImportState;

export type HolidayImportSetState = <K extends keyof HolidayImportState>(
	key: K,
	value: HolidayImportState[K] | ((current: HolidayImportState[K]) => HolidayImportState[K]),
) => void;

export function setHolidayImportState<K extends keyof HolidayImportState>(
	key: K,
	value: HolidayImportState[K] | ((current: HolidayImportState[K]) => HolidayImportState[K]),
): HolidayImportAction {
	return (state) => {
		const next = { ...state };
		next[key] = typeof value === "function" ? value(state[key]) : value;
		return next;
	};
}

export function holidayImportReducer(
	state: HolidayImportState,
	action: HolidayImportAction,
): HolidayImportState {
	return action(state);
}
