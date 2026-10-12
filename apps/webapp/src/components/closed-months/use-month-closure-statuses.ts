"use client";

import { useQuery } from "@tanstack/react-query";
import { getMonthClosureStatuses } from "@/app/[locale]/(app)/settings/closed-months/actions";

/** Every closed-month status query shares this prefix, so a close refreshes them all. */
export const MONTH_CLOSURE_STATUSES_KEY = ["closed-months", "statuses"] as const;

/**
 * Closed, partly closed or open, for each month and the selected employees
 * (#762); every employee of the organization when `employeeIds` is omitted.
 */
export function useMonthClosureStatuses(
	months: readonly string[],
	employeeIds?: readonly string[],
) {
	return useQuery({
		queryKey: [...MONTH_CLOSURE_STATUSES_KEY, months, employeeIds ?? null],
		queryFn: async () => {
			const result = await getMonthClosureStatuses({
				months: [...months],
				employeeIds: employeeIds ? [...employeeIds] : undefined,
			});
			return result.success ? result.data : [];
		},
		enabled: months.length > 0,
		staleTime: 30_000,
	});
}
