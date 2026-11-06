export type OrgExplorerView = "reporting-lines" | "teams";

/** What the Org Explorer keeps in the URL, so a link shares it and the back button restores it. */
export type OrgExplorerUrlState = {
	view: OrgExplorerView;
	teamIds: string[];
	employeeId: string | null;
};

const VIEW_PARAM = "view";
const TEAM_PARAM = "team";
const EMPLOYEE_PARAM = "employee";

export function parseOrgExplorerUrlState(
	params: URLSearchParams,
): OrgExplorerUrlState {
	return {
		view: params.get(VIEW_PARAM) === "teams" ? "teams" : "reporting-lines",
		teamIds: [...new Set(params.getAll(TEAM_PARAM).filter(Boolean))],
		employeeId: params.get(EMPLOYEE_PARAM) || null,
	};
}

/**
 * The search string for `state`, keeping the other parameters of `current`. The
 * defaults stay out of the URL, so the plain route is the default view.
 */
export function orgExplorerSearch(
	state: OrgExplorerUrlState,
	current: URLSearchParams,
): string {
	const params = new URLSearchParams(current);
	params.delete(VIEW_PARAM);
	params.delete(TEAM_PARAM);
	params.delete(EMPLOYEE_PARAM);
	if (state.view !== "reporting-lines") params.set(VIEW_PARAM, state.view);
	for (const teamId of state.teamIds) params.append(TEAM_PARAM, teamId);
	if (state.employeeId) params.set(EMPLOYEE_PARAM, state.employeeId);
	const search = params.toString();
	return search ? `?${search}` : "";
}
