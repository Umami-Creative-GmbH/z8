export type AbsencesView = "calendar" | "table";

/** What /absences keeps in the URL, so a reload or a shared link returns to the same records. */
export type AbsencesUrlState = {
	view: AbsencesView;
	year: number;
};

/** The calendar years the absence record reads accept. */
export const ABSENCES_MIN_YEAR = 1900;
export const ABSENCES_MAX_YEAR = 2100;

const VIEW_PARAM = "view";
const YEAR_PARAM = "year";

type ParamValue = string | string[] | null | undefined;

function firstParamValue(value: ParamValue) {
	return Array.isArray(value) ? value[0] : (value ?? undefined);
}

/** A view value from the URL or the tabs; anything but `table` is the calendar. */
export function parseAbsencesView(value: unknown): AbsencesView {
	return value === "table" ? "table" : "calendar";
}

function parseYear(value: string | undefined) {
	if (!value || !/^\d{4}$/.test(value)) return null;
	const year = Number(value);
	return year >= ABSENCES_MIN_YEAR && year <= ABSENCES_MAX_YEAR ? year : null;
}

/**
 * The view and year for `/absences`. `currentYear` is the organization's current calendar year;
 * unknown or out-of-range values fall back to the defaults.
 */
export function parseAbsencesUrlState(
	params: { view?: ParamValue; year?: ParamValue },
	currentYear: number,
): AbsencesUrlState {
	return {
		view: parseAbsencesView(firstParamValue(params.view)),
		year: parseYear(firstParamValue(params.year)) ?? currentYear,
	};
}

/**
 * The search string for `state`, keeping the other parameters of `current`. The defaults stay
 * out of the URL, so the plain route is the calendar for the current year.
 */
export function absencesSearch(
	state: AbsencesUrlState,
	currentYear: number,
	current: URLSearchParams,
): string {
	const params = new URLSearchParams(current);
	params.delete(VIEW_PARAM);
	params.delete(YEAR_PARAM);
	if (state.view !== "calendar") params.set(VIEW_PARAM, state.view);
	if (state.year !== currentYear) params.set(YEAR_PARAM, String(state.year));
	const search = params.toString();
	return search ? `?${search}` : "";
}
