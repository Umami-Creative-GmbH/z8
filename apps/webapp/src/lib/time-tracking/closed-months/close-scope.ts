import type { CloseMonthScope } from "./store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * The close scope a client sent, or `null` when it is not one: an unknown kind or a missing
 * or malformed id. Whether the team or location belongs to the organization is the close's
 * own check.
 */
export function parseCloseMonthScope(input: unknown): CloseMonthScope | null {
	if (typeof input !== "object" || input === null) return null;
	const scope = input as Record<string, unknown>;
	switch (scope.kind) {
		case "organization":
			return { kind: "organization" };
		case "team":
			return isUuid(scope.teamId) ? { kind: "team", teamId: scope.teamId } : null;
		case "location":
			return isUuid(scope.locationId) ? { kind: "location", locationId: scope.locationId } : null;
		default:
			return null;
	}
}

const ORGANIZATION_VALUE = "organization";
const TEAM_PREFIX = "team:";
const LOCATION_PREFIX = "location:";

/** The scope as one string, for a select and a query key; a team never equals a location. */
export function closeScopeValue(scope: CloseMonthScope): string {
	switch (scope.kind) {
		case "organization":
			return ORGANIZATION_VALUE;
		case "team":
			return `${TEAM_PREFIX}${scope.teamId}`;
		case "location":
			return `${LOCATION_PREFIX}${scope.locationId}`;
	}
}

/**
 * The scope `closeScopeValue` gave, or `null` for anything else: a malformed value never
 * widens to an organization close.
 */
export function closeScopeFromValue(value: string): CloseMonthScope | null {
	if (value === ORGANIZATION_VALUE) return { kind: "organization" };
	if (value.startsWith(TEAM_PREFIX)) {
		return parseCloseMonthScope({ kind: "team", teamId: value.slice(TEAM_PREFIX.length) });
	}
	if (value.startsWith(LOCATION_PREFIX)) {
		return parseCloseMonthScope({
			kind: "location",
			locationId: value.slice(LOCATION_PREFIX.length),
		});
	}
	return null;
}
