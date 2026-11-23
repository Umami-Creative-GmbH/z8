// TanStack Query keys of the Minijob monitor (#1989). Free of server imports, so Employee Detail
// and tests can invalidate them without loading the monitor's actions.

/** Every viewer's monitor of the employee: invalidate this after a change to its figures. */
export const minijobMonitorQueryPrefix = (employeeId: string) =>
	["employees", "minijob-monitor", employeeId] as const;

/**
 * The monitor as one viewer sees it in one organization: org admins get amounts, everyone else
 * tiers only, so the cache must never hand one viewer's figures to another.
 */
export const minijobMonitorQueryKey = (
	userId: string,
	organizationId: string,
	employeeId: string,
) => [...minijobMonitorQueryPrefix(employeeId), userId, organizationId] as const;

/** Prefix of the Minijob exceedances in Reviews & Conflicts; the query adds the organization. */
export const MINIJOB_REVIEWS_QUERY_KEY = ["contracts", "minijob-exceedances"] as const;
