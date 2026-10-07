"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getReportProjectIssuesAction } from "@/app/[locale]/(app)/travel-expenses/report-project-actions";
import { queryKeys } from "@/lib/query/keys";

/**
 * The draft's expenses whose project (own or inherited from the trip) is not
 * proven on their own date (#605 review). A trip project eligible on any trip
 * day may still fail another expense's day; submission refuses those, so the
 * editor marks them before the employee gets there. `fingerprint` names what
 * the answer depends on (the trip's project, dates and item projects), so a
 * change re-checks; `recheck` runs after an autosave committed a new date.
 */
export function useReportProjectIssues(reportId: string, fingerprint: string) {
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: queryKeys.travelExpenses.reportProjectIssues(reportId, fingerprint),
		queryFn: async () => {
			const result = await getReportProjectIssuesAction({ reportId });
			if (!result.success) throw new Error(result.error);
			return result.data.ineligibleItemIds;
		},
		placeholderData: keepPreviousData,
		refetchOnWindowFocus: false,
	});
	const recheck = useCallback(
		() =>
			queryClient.invalidateQueries({
				queryKey: ["travel-expenses", "reports", reportId, "project-issues"],
			}),
		[queryClient, reportId],
	);
	return { ineligibleItemIds: new Set(query.data ?? []), recheck };
}
