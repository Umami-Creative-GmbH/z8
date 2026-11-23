// TanStack Query keys of the Minijob monitor (#1989). Free of server imports, so Employee Detail
// and tests can invalidate them without loading the monitor's actions.

export const minijobMonitorQueryKey = (employeeId: string) =>
	["employees", "minijob-monitor", employeeId] as const;

/** Prefix of the Minijob exceedances in Reviews & Conflicts; the query adds the organization. */
export const MINIJOB_REVIEWS_QUERY_KEY = ["contracts", "minijob-exceedances"] as const;
