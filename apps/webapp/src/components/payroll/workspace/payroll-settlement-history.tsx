"use client";

import { IconAlertTriangle, IconCircleCheck, IconRotate } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useMemo } from "react";
import { getPayrollSettlementHistoryAction } from "@/app/[locale]/(app)/payroll/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";
import { payrollDaysFormat } from "./payroll-day-format";
import type { PayrollPeriodRequest, PayrollTranslate } from "./state";

/**
 * Who settled or unsettled which days of the workspace's period and scope, newest
 * first: a compact list for the Settlement tab. One day's full history, with what was
 * paid, is in the Days tab's side panel.
 */
export function PayrollSettlementHistory({
	employeeNames,
	request,
	t,
}: {
	/** Employee names by id, from the period read. */
	employeeNames: ReadonlyMap<string, string>;
	request: PayrollPeriodRequest;
	t: PayrollTranslate;
}) {
	const locale = useLocale();
	const format = useMemo(() => payrollDaysFormat(locale), [locale]);
	const occurredAt = useMemo(
		() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
		[locale],
	);
	const { data, error, isPending } = useQuery({
		queryKey: queryKeys.payroll.settlementHistory(request),
		queryFn: async () => {
			const result = await getPayrollSettlementHistoryAction(request);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle role="heading" aria-level={2}>
					{t("payroll.settle.historyTitle", "Settlement history")}
				</CardTitle>
				<CardDescription>
					{t(
						"payroll.settle.historyDescription",
						"Days of {period} settled or unsettled, newest first.",
						{ period: request.label },
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{error ? (
					<p className="flex items-center gap-2 text-destructive text-sm">
						<IconAlertTriangle aria-hidden="true" className="size-4" />
						{t("payroll.days.panel.historyFailed", "The settlement history could not be loaded.")}
					</p>
				) : isPending || !data ? (
					<Skeleton className="h-24 w-full" aria-busy="true" />
				) : data.entries.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t("payroll.settle.historyEmpty", "No days of this period were settled yet.")}
					</p>
				) : (
					<>
						<ol
							className="flex max-h-96 flex-col divide-y overflow-y-auto rounded-lg border text-sm"
							aria-label={t("payroll.settle.historyTitle", "Settlement history")}
						>
							{data.entries.map((entry) => {
								const name =
									entry.actorName ?? t("payroll.days.panel.unknownActor", "a former user");
								return (
									<li key={entry.id} className="flex items-start gap-2 px-3 py-2">
										{entry.kind === "settled" ? (
											<IconCircleCheck
												aria-hidden="true"
												className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
											/>
										) : (
											<IconRotate
												aria-hidden="true"
												className="mt-0.5 size-4 shrink-0 text-muted-foreground"
											/>
										)}
										<div className="flex min-w-0 flex-col gap-0.5">
											<span className="truncate">
												<span className="font-medium">
													{employeeNames.get(entry.employeeId) ??
														t("payroll.settle.historyUnknownEmployee", "Employee")}
												</span>
												{" · "}
												<span className="tabular-nums">{format.shortDate(entry.date)}</span>
											</span>
											<span className="text-muted-foreground text-xs">
												{entry.kind === "settled"
													? t("payroll.days.panel.historySettled", "Settled by {name}", { name })
													: t("payroll.days.panel.historyUnsettled", "Unsettled by {name}", {
															name,
														})}
												{" · "}
												{occurredAt.format(new Date(entry.occurredAt))}
												{" · "}
												{entry.method === "export"
													? t("payroll.days.panel.methodExport", "With export {file}", {
															file:
																entry.payrollExportFileName ??
																t("payroll.days.panel.unknownExport", "(file no longer available)"),
														})
													: t("payroll.days.panel.methodManual", "Manually")}
											</span>
											{entry.reason ? (
												<span className="text-xs">
													{t("payroll.days.panel.historyReason", "Reason: {reason}", {
														reason: entry.reason,
													})}
												</span>
											) : null}
										</div>
									</li>
								);
							})}
						</ol>
						{data.hasMore ? (
							<p className="mt-2 text-muted-foreground text-xs">
								{t(
									"payroll.settle.historyTruncated",
									"Showing the latest {count} events. Open a day in the Days tab for its full history.",
									{ count: data.entries.length },
								)}
							</p>
						) : null}
					</>
				)}
			</CardContent>
		</Card>
	);
}
