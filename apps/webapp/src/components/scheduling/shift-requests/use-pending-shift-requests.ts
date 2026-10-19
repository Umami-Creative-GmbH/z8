"use client";

import { useQuery } from "@tanstack/react-query";
import { getPendingShiftRequests } from "@/app/[locale]/(app)/scheduling/actions";
import { queryKeys } from "@/lib/query/keys";

/** The organization's pending pickup and swap requests, for a planner. */
export function usePendingShiftRequests(approverId: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.shiftRequests.pending(approverId),
		queryFn: async () => {
			const result = await getPendingShiftRequests();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled,
	});
}
