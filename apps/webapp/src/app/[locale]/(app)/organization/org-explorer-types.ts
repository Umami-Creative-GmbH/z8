/** At or above this many current employees, the Org Explorer loads on demand. */
export const SMALL_ORG_EMPLOYEE_LIMIT = 100;
/** The most people one on-demand request loads. */
export const ORG_EXPLORER_BATCH_LIMIT = 200;

/** How many of `remaining` people the next page shows, at most a batch. */
export function nextPageSize(remaining: number) {
	return Math.max(0, Math.min(remaining, ORG_EXPLORER_BATCH_LIMIT));
}

/**
 * A person on the current roster, with their team memberships and reporting
 * lines. Ids point at other people on the current roster, who may not be loaded
 * yet in a large organization.
 */
export type OrgExplorerPerson = {
	employeeId: string;
	userId: string;
	name: string;
	pronouns: string | null;
	email: string;
	image: string | null;
	position: string | null;
	/** The primary team, always one of `teamIds`. */
	primaryTeamId: string | null;
	/** Team memberships, the primary team first. */
	teamIds: string[];
	/**
	 * Current managers, the reporting line first: the primary manager, or, when
	 * they left or none is marked, the first remaining manager by name.
	 */
	managerIds: string[];
	/** The current manager marked primary, if any. Not set for the fallback. */
	primaryManagerId: string | null;
	/** Everyone who reports to this person, through any of their managers. */
	reportIds: string[];
	/** The direct reports whose reporting line runs to this person: their children in the tree. */
	lineReportIds: string[];
};

export type OrgExplorerTeam = {
	teamId: string;
	name: string;
	description: string | null;
	/** The team lead, who need not be a member. */
	leadEmployeeId: string | null;
	/** Team memberships of people on the current roster. */
	memberCount: number;
};

export type OrgExplorerData = {
	/** Whether every person on the current roster is loaded. */
	complete: boolean;
	employeeCount: number;
	viewerEmployeeId: string;
	teams: OrgExplorerTeam[];
	people: OrgExplorerPerson[];
	/** People with no reporting line of their own who have direct reports. */
	rootIds: string[];
	noReportingLineCount: number;
	noTeamCount: number;
};

/** The people groups a large organization loads on demand. */
export type OrgExplorerGroup = "noReportingLine" | "noTeam";

/**
 * A page of a team's members or of a group, with everyone on their reporting
 * lines up to the top. `nextOffset` asks for the next page, or is null after
 * the last.
 */
export type OrgExplorerPage = {
	people: OrgExplorerPerson[];
	nextOffset: number | null;
};

export type OrgExplorerSearchResult = {
	employeeId: string;
	name: string;
	pronouns: string | null;
	email: string;
	position: string | null;
	image: string | null;
};
