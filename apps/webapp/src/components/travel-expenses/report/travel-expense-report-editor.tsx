"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getMyTravelExpenseReport } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";
import type { ReportView } from "@/lib/travel-expenses/report-store";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { ReceiptItemEditor } from "./receipt-item-editor";

/**
 * Dedicated page body of a draft expense report. The item form is created
 * once from the first load; later loads (receipt changes, refetches) only
 * refresh receipts, so they never discard what the employee is typing.
 */
export function TravelExpenseReportEditor({
	reportId,
	maxReceiptBytes,
}: {
	reportId: string;
	maxReceiptBytes: number;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const queryKey = queryKeys.travelExpenses.report(reportId);
	const { data, isLoading, isFetching, isError, refetch } = useQuery({
		queryKey,
		queryFn: async (): Promise<ReportView> => {
			const result = await getMyTravelExpenseReport(reportId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		// The form owns unsaved values; focus refetches would only refresh receipts.
		refetchOnWindowFocus: false,
	});
	const item = data?.items[0];

	return (
		<div className="space-y-4">
			{isError && (
				<TravelExpenseLoadError
					message={t(
						"travelExpenses.report.errors.load",
						"Unable to load this expense. Please retry.",
					)}
					retry={() => {
						void refetch();
					}}
					isRetrying={isFetching}
				/>
			)}
			{isLoading && (
				<div role="status">
					<p className="sr-only">{t("travelExpenses.report.loading", "Loading expense…")}</p>
					<Skeleton aria-hidden="true" className="h-96 w-full" />
				</div>
			)}
			{data && item && (
				<Card>
					<CardContent className="space-y-6 pt-6">
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="text-lg font-semibold">
								{t("travelExpenses.report.standaloneTitle", "Standalone receipt")}
							</h2>
							<Badge variant="secondary">{t("travelExpenses.status.draft", "Draft")}</Badge>
						</div>
						<ReceiptItemEditor
							key={item.id}
							reportId={data.id}
							item={item}
							receipts={item.receipts}
							reimbursementCurrency={data.reimbursementCurrency}
							maxReceiptBytes={maxReceiptBytes}
							onReceiptsChanged={() => queryClient.invalidateQueries({ queryKey })}
							onSaved={() => {
								void queryClient.invalidateQueries({
									queryKey: queryKeys.travelExpenses.draftReports(),
								});
							}}
						/>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
