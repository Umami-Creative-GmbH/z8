/**
 * The go-live group's settings as the checklist shows them (#1513). Safe for
 * client components: the store in `group-settings.ts` is server-only.
 */

/** The longest reason a go-live exclusion may give. */
export const GO_LIVE_EXCLUSION_REASON_MAX_LENGTH = 500;

/** Why a go-live group command changed nothing. */
export type GoLiveGroupRefusal =
	| "team_not_found"
	| "employee_not_found"
	| "reason_required"
	| "reason_too_long"
	| "already_excluded"
	| "exclusion_not_found";

export type GoLiveGroupCommandResult = { ok: true } | { ok: false; refusal: GoLiveGroupRefusal };

/** An open go-live exclusion of a current-roster employee, for the "Excluded" list. */
export interface GoLiveExclusionView {
	id: string;
	employeeId: string;
	displayName: string;
	reason: string;
	/** Who created it; null when their account is gone. */
	createdByName: string | null;
	/** When it was created, as an ISO instant. */
	createdAt: string;
}

/** The go-live group's settings, for the checklist's group card. */
export interface GoLiveGroupSettings {
	/** The organization's teams, by name. */
	teams: { id: string; name: string }[];
	/** The teams the group is narrowed to; empty for the whole roster. */
	chosenTeamIds: string[];
	/** Open exclusions of current-roster employees, by name. */
	exclusions: GoLiveExclusionView[];
}
