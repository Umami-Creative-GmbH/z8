"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "./keys";

/**
 * The single invalidation entry point for anything that can change a period's submission
 * readiness (#1348, #1350): clocking, manual work, corrections, absences, request cancel or
 * withdraw, and period submit or withdraw. A mounted period card checks again at once; elsewhere
 * the cached result is marked stale, so the card checks when it is shown again.
 *
 * It lives here, free of server actions, so clocking and other flows can call it without loading
 * the readiness read.
 */
export function invalidatePeriodSubmissionReadiness(queryClient: QueryClient): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: queryKeys.periodSubmissions.all });
}

/** `invalidatePeriodSubmissionReadiness` bound to the current query client. */
export function useInvalidatePeriodSubmissionReadiness(): () => Promise<void> {
	const queryClient = useQueryClient();
	return useCallback(() => invalidatePeriodSubmissionReadiness(queryClient), [queryClient]);
}
