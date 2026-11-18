"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, use } from "react";
import { queryKeys } from "@/lib/query/keys";

export const ReportReadScope = createContext<readonly string[]>([]);

/** Keep existing invalidation prefixes without reusing a retired RSC arrival. */
export function useReportQueryKey(key: readonly unknown[]) {
	return [...key, ...use(ReportReadScope)];
}

/** Revalidate the originating report after a server-confirmed lifecycle change. */
export function useReportLifecycleRefresh(reportId: string) {
	const queryClient = useQueryClient();
	const scope = use(ReportReadScope);
	const [, organizationId, employeeId] = scope;
	const reportKey = queryKeys.travelExpenses.report(reportId);
	const historyKey = queryKeys.travelExpenses.history(
		organizationId && employeeId ? { organizationId, employeeId } : undefined,
	);
	return () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: reportKey,
				predicate: ({ queryKey }) => {
					const scopeStart = queryKey.length - scope.length;
					return (
						scopeStart >= reportKey.length &&
						scope.every((part, index) => queryKey[scopeStart + index] === part)
					);
				},
			}),
			queryClient.invalidateQueries({ queryKey: historyKey }),
		]);
}
