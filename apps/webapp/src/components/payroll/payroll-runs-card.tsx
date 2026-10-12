"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import {
	discardScopedPayrollRunAction,
	getScopedPayrollRunsAction,
} from "@/app/[locale]/(app)/payroll/actions";
import { getPayrollRunsToConfirmAction } from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { ConfirmPayrollRunButton } from "@/components/travel-expenses/finance/confirm-payroll-run-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { queryKeys } from "@/lib/query/keys";
import { formatPlainDateRange } from "@/lib/travel-expenses/format";
import { DiscardPayrollRunButton } from "./discard-payroll-run-button";

/**
 * The unconfirmed payroll runs (#852) a payroll access holder may discard:
 * exports that carry expense reports nobody has confirmed as paid yet. Hidden
 * while there are none, so organizations paying by bank transfer never see it.
 */
export function PayrollRunsCard() {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const { data: runs } = useQuery({
		queryKey: queryKeys.travelExpenses.scopedPayrollRuns(),
		queryFn: async () => {
			const result = await getScopedPayrollRunsAction();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	// A payroll access holder who also records reimbursements confirms here too (#853).
	const { data: toConfirm } = useQuery({
		queryKey: queryKeys.travelExpenses.payrollRunsToConfirm(),
		queryFn: async () => {
			const result = await getPayrollRunsToConfirmAction();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: Boolean(runs && runs.length > 0),
	});
	if (!runs || runs.length === 0) return null;
	const confirmable = new Map((toConfirm ?? []).map((run) => [run.jobId, run]));
	const refresh = () =>
		void queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.payrollRuns() });

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("payroll.runs.title", "Unconfirmed payroll runs")}</CardTitle>
				<CardDescription>
					{t(
						"payroll.runs.description",
						"These exports carry expense reports awaiting reimbursement. An expense officer confirms each run once payroll has paid it; discard a run whose file is not paid.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="divide-y">
					{runs.map((run) => {
						const confirmRun = confirmable.get(run.jobId);
						return (
							<li key={run.jobId} className="flex items-center justify-between gap-4 py-2">
								<div className="min-w-0">
									<p className="font-medium tabular-nums">
										{formatPlainDateRange(locale, run.periodStart, run.periodEnd)}
									</p>
									<p className="text-sm text-muted-foreground">
										{t(
											"payroll.runs.reports",
											"{count, plural, one {# expense report} other {# expense reports}}",
											{ count: run.includedReports },
										)}
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									{confirmRun && <ConfirmPayrollRunButton run={confirmRun} onConfirmed={refresh} />}
									{/* A run confirmed for some report is final (#853). */}
									{!run.partlyConfirmed && (
										<DiscardPayrollRunButton
											includedReports={run.includedReports}
											discard={() => discardScopedPayrollRunAction(run.jobId)}
											// Freed reports change payroll run readiness too (#854).
											onDiscarded={refresh}
										/>
									)}
								</div>
							</li>
						);
					})}
				</ul>
			</CardContent>
		</Card>
	);
}
