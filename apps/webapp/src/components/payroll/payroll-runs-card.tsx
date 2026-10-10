"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import {
	discardScopedPayrollRunAction,
	getScopedPayrollRunsAction,
} from "@/app/[locale]/(app)/payroll/actions";
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
	if (!runs || runs.length === 0) return null;

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
					{runs.map((run) => (
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
							<DiscardPayrollRunButton
								includedReports={run.includedReports}
								discard={() => discardScopedPayrollRunAction(run.jobId)}
								onDiscarded={() =>
									void queryClient.invalidateQueries({
										queryKey: queryKeys.travelExpenses.scopedPayrollRuns(),
									})
								}
							/>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
