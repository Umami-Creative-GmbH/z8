"use client";

import { focusManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { readPeriodReadiness } from "@/app/[locale]/(app)/time-tracking/actions/period-submissions";
import { queryKeys } from "@/lib/query/keys";
import { invalidatePeriodSubmissionReadiness } from "@/lib/query/period-submission-readiness";
import type {
	EmployeePeriodReadinessView,
	PeriodSubmissionReadiness,
} from "@/lib/time-tracking/period-submissions/submission-readiness";

/** The organization and employee the period card was rendered for. */
export interface PeriodReadinessScope {
	organizationId: string;
	employeeId: string;
}

/** How often a visible card checks readiness again (#1350). */
export const PERIOD_READINESS_POLL_MS = 30_000;

/**
 * The employee's period view with readiness (#1348), read through the authenticated readiness
 * action. Keyed by the organization and employee shown, so another organization's result is never
 * reused. A failed read throws: the card then shows readiness as unavailable, even when an
 * earlier read succeeded.
 *
 * It stays current (#1350): every 30 seconds while the page is visible (never while hidden), and
 * again when the page becomes visible or the window regains focus. Unmounting stops it. A newer
 * check silently replaces a running one, so a late answer never overwrites a newer result.
 */
export function usePeriodSubmissionReadiness(scope: PeriodReadinessScope) {
	const queryClient = useQueryClient();
	const { organizationId, employeeId } = scope;
	const query = useQuery<EmployeePeriodReadinessView | null>({
		queryKey: queryKeys.periodSubmissions.readiness(organizationId, employeeId),
		queryFn: async () => {
			const result = await readPeriodReadiness({ organizationId, employeeId });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		// Readiness is advisory and changes with every relevant edit: always check on mount.
		staleTime: 0,
		retry: 1,
		refetchInterval: PERIOD_READINESS_POLL_MS,
		refetchIntervalInBackground: false,
		// Becoming visible again; the app's default leaves focus refetching off.
		refetchOnWindowFocus: "always",
	});

	// Query only watches visibility; focusing a window that stayed visible counts too. A check
	// already running (the visibility one) is joined, not repeated.
	useEffect(() => {
		const onFocus = () => {
			if (!focusManager.isFocused()) return;
			void queryClient.refetchQueries(
				{
					queryKey: queryKeys.periodSubmissions.readiness(organizationId, employeeId),
					exact: true,
				},
				{ cancelRefetch: false },
			);
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [queryClient, organizationId, employeeId]);

	return query;
}

/**
 * Check readiness again when the shown result is known to be stale: after the employee's own
 * submit or withdraw, or a Retry. `rechecking` holds until the newest check has settled (a poll or
 * focus check that replaces this one is waited for too), so the card can show Checking instead of
 * the stale result's Submit.
 */
export function usePeriodReadinessRecheck(): { rechecking: boolean; recheck: () => Promise<void> } {
	const queryClient = useQueryClient();
	const [pending, setPending] = useState(0);
	const recheck = useCallback(async () => {
		setPending((count) => count + 1);
		await invalidatePeriodSubmissionReadiness(queryClient).finally(() =>
			setPending((count) => count - 1),
		);
	}, [queryClient]);
	return { rechecking: pending > 0, recheck };
}

/** What the card can say about one period's readiness right now. */
export type PeriodReadinessState =
	| { kind: "checking" }
	| { kind: "unavailable" }
	/** The last successful result, also while a newer check runs. */
	| { kind: "assessed"; readiness: PeriodSubmissionReadiness };

/**
 * The readiness state of the period starting on `startDate` from the query's state.
 *
 * - A failed read is unavailable whatever an earlier read said, and stays unavailable while a
 *   background check runs, so an unchanged failure is not announced again at every poll.
 * - With no result yet, it is checking.
 * - Otherwise it is the last successful result, also while a background check runs (#1350,
 *   decision 1): polling and focus checks do not flicker Submit.
 */
export function periodReadinessState(
	query: {
		isError: boolean;
		isFetching: boolean;
		data: EmployeePeriodReadinessView | null | undefined;
	},
	startDate: string,
): PeriodReadinessState {
	if (query.isError) return { kind: "unavailable" };
	if (query.data === undefined) return { kind: "checking" };
	const row = query.data?.periods.find((period) => period.startDate === startDate);
	if (!row) return query.isFetching ? { kind: "checking" } : { kind: "unavailable" };
	return { kind: "assessed", readiness: row.readiness };
}
