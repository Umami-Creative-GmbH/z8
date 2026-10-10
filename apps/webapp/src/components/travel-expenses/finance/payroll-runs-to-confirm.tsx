"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { getPayrollRunsToConfirmAction } from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { queryKeys } from "@/lib/query/keys";
import { formatMoney, formatPlainDateRange } from "@/lib/travel-expenses/format";
import { ConfirmPayrollRunButton } from "./confirm-payroll-run-dialog";

/**
 * The unconfirmed payroll runs (#853) that include expense reports the reader
 * may confirm as paid: expense officers who record reimbursements, owners and
 * admins. Hidden while there are none, so organizations paying by bank
 * transfer never see it.
 */
export function PayrollRunsToConfirm({
	openJobId = null,
}: {
	/** The run whose confirm dialog opens right away: a run notification's link (#855). */
	openJobId?: string | null;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const { data: runs } = useQuery({
		queryKey: queryKeys.travelExpenses.payrollRunsToConfirm(),
		queryFn: async () => {
			const result = await getPayrollRunsToConfirmAction();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	if (!runs || runs.length === 0) return null;

	return (
		// Officers' payroll run notifications (#855) link here.
		<Card id="payroll-runs" className="scroll-mt-20">
			<CardHeader>
				<CardTitle>
					{t("travelExpenses.finance.payrollRuns.title", "Payroll runs awaiting confirmation")}
				</CardTitle>
				<CardDescription>
					{t(
						"travelExpenses.finance.payrollRuns.description",
						"These payroll exports carry expense reports. Once payroll has paid a run, confirm it to record the reimbursements.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="divide-y">
					{runs.map((run) => (
						<li key={run.jobId} className="flex flex-wrap items-center justify-between gap-4 py-2">
							<div className="min-w-0">
								<p className="font-medium tabular-nums">
									{formatPlainDateRange(locale, run.periodStart, run.periodEnd)}
									<span className="ml-2 text-sm font-normal text-muted-foreground">
										{run.formatName}
									</span>
								</p>
								<p className="text-sm text-muted-foreground">
									{t(
										"travelExpenses.finance.payrollRuns.reports",
										"{count, plural, one {# expense report} other {# expense reports}} for you to confirm, {amount}",
										{
											count: run.confirmableReports,
											amount: formatMoney(locale, run.confirmableAmount, "EUR"),
										},
									)}
								</p>
							</div>
							<ConfirmPayrollRunButton
								run={run}
								defaultOpen={run.jobId === openJobId}
								onConfirmed={() =>
									void queryClient.invalidateQueries({ queryKey: ["travel-expenses"] })
								}
							/>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
