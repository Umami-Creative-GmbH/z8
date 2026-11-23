"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";
import { queryKeys } from "@/lib/query/keys";

/** Refreshes the workspace summary: the status strip, the Overview and its blockers. */
type RefreshWorkspaceSummary = () => Promise<unknown>;

const RefreshWorkspaceSummaryContext = createContext<RefreshWorkspaceSummary | null>(null);

/** Lets settlement controls anywhere in the workspace refresh its summary. */
export function PayrollSettlementRefreshProvider({
	children,
	refreshSummary,
}: {
	children: ReactNode;
	refreshSummary: RefreshWorkspaceSummary;
}) {
	return (
		<RefreshWorkspaceSummaryContext.Provider value={refreshSummary}>
			{children}
		</RefreshWorkspaceSummaryContext.Provider>
	);
}

/**
 * What to run after days were settled or unsettled (#1896, #1897, #1899): refreshes the
 * workspace summary, every period read, the exports to confirm and the settlement
 * histories, so the status strip, the Overview's changed-since-settled blockers and the
 * tabs all show the new state.
 */
export function usePayrollSettlementChanged(): () => Promise<void> {
	const queryClient = useQueryClient();
	const refreshSummary = useContext(RefreshWorkspaceSummaryContext);
	return async () => {
		await Promise.all([
			refreshSummary?.(),
			queryClient.invalidateQueries({ queryKey: queryKeys.payroll.periods() }),
			queryClient.invalidateQueries({ queryKey: queryKeys.payroll.exportsToConfirm() }),
			queryClient.invalidateQueries({ queryKey: queryKeys.payroll.settlementHistories() }),
			queryClient.invalidateQueries({ queryKey: queryKeys.payroll.daySettlementHistories() }),
		]);
	};
}
