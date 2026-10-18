"use client";

import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { readPeriodReadiness } from "@/app/[locale]/(app)/time-tracking/actions/period-submissions";
import { queryKeys } from "@/lib/query/keys";
import type {
	EmployeePeriodReadinessView,
	PeriodSubmissionReadiness,
} from "@/lib/time-tracking/period-submissions/submission-readiness";

/** The organization and employee the period card was rendered for. */
export interface PeriodReadinessScope {
	organizationId: string;
	employeeId: string;
}

/**
 * The employee's period view with readiness (#1348), read through the authenticated readiness
 * action. Keyed by the organization and employee shown, so another organization's result is never
 * reused. A failed read throws: the card then shows readiness as unavailable, even when an
 * earlier read succeeded.
 */
export function usePeriodSubmissionReadiness(scope: PeriodReadinessScope) {
	return useQuery<EmployeePeriodReadinessView | null>({
		queryKey: queryKeys.periodSubmissions.readiness(scope.organizationId, scope.employeeId),
		queryFn: async () => {
			const result = await readPeriodReadiness(scope);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		// Readiness is advisory and changes with every relevant edit: always check on mount.
		staleTime: 0,
		retry: 1,
	});
}

/** The single invalidation entry point for anything that can change a period's readiness. */
export function invalidatePeriodSubmissionReadiness(queryClient: QueryClient): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: queryKeys.periodSubmissions.all });
}

/** `invalidatePeriodSubmissionReadiness` bound to the current query client. */
export function useInvalidatePeriodSubmissionReadiness(): () => Promise<void> {
	const queryClient = useQueryClient();
	return useCallback(() => invalidatePeriodSubmissionReadiness(queryClient), [queryClient]);
}

/** What the card can say about one period's readiness right now. */
export type PeriodReadinessState =
	| { kind: "checking" }
	| { kind: "unavailable" }
	/** `refreshing`: a newer check is running; the result shown is the last successful one. */
	| { kind: "assessed"; readiness: PeriodSubmissionReadiness; refreshing: boolean };

/**
 * The readiness state of the period starting on `startDate` from the query's state. A failed
 * read is unavailable whatever an earlier read said; a read still running with no result yet
 * (or retrying a failure) is checking.
 */
export function periodReadinessState(
	query: {
		isError: boolean;
		isFetching: boolean;
		data: EmployeePeriodReadinessView | null | undefined;
	},
	startDate: string,
): PeriodReadinessState {
	if (query.isError) return query.isFetching ? { kind: "checking" } : { kind: "unavailable" };
	if (query.data === undefined) return { kind: "checking" };
	const row = query.data?.periods.find((period) => period.startDate === startDate);
	if (!row) return query.isFetching ? { kind: "checking" } : { kind: "unavailable" };
	return { kind: "assessed", readiness: row.readiness, refreshing: query.isFetching };
}
