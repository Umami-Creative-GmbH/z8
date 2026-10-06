"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import {
	getTravelExpenseSettlement,
	type SettlementAccountView,
} from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";
import type { SettlementAccount, SettlementSource } from "@/lib/travel-expenses/settlement-store";
import { formatMoney, formatPlainDate } from "../report/format";
import { formatRecordedInstant } from "../report/report-status";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { RecordReimbursementForm } from "./record-reimbursement-form";
import { BalanceText, SettlementStateBadge } from "./settlement-status";

const NOT_VISIBLE = "Not found";

/**
 * The settlement of one approved expense (#612): what the employee is
 * entitled to, what finance recorded as paid and the derived balance. The
 * employee sees their own; finance sees any approved one and, with the settle
 * permission, records reimbursements. Everyone else sees nothing.
 */
export function SettlementPanel({ source }: { source: SettlementSource }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const queryKey = queryKeys.travelExpenses.settlement(source.type, source.id);
	const { data, isError, error, isFetching, refetch } = useQuery({
		queryKey,
		queryFn: async (): Promise<SettlementAccountView | null> => {
			const result = await getTravelExpenseSettlement(source);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		retry: (count, failure) => failure.message !== NOT_VISIBLE && count < 2,
	});

	if (isError && !data) {
		if (error.message === NOT_VISIBLE) return null;
		return (
			<TravelExpenseLoadError
				message={t(
					"travelExpenses.settlement.errors.load",
					"Unable to load the reimbursement balance. Please retry.",
				)}
				retry={() => {
					void refetch();
				}}
				isRetrying={isFetching}
			/>
		);
	}
	if (!data) {
		return (
			<div>
				<p className="sr-only">
					{t("travelExpenses.settlement.loading", "Loading reimbursement balance…")}
				</p>
				<Skeleton aria-hidden="true" className="h-32 w-full" />
			</div>
		);
	}
	const { account, viewer, canSettle } = data;
	if (!account.approved && account.entries.length === 0) return null;

	const settled = (next: SettlementAccount | null) => {
		if (next) queryClient.setQueryData(queryKey, { ...data, account: next });
		void queryClient.invalidateQueries({ queryKey: ["travel-expenses", "settlement"] });
		void queryClient.invalidateQueries({ queryKey: ["travel-expenses", "finance"] });
	};
	const headingId = `settlement-${source.type}-${source.id}`;

	return (
		<Card>
			<CardContent className="space-y-4 pt-6">
				<section aria-labelledby={headingId} className="space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h2 id={headingId} className="text-lg font-semibold">
							{t("travelExpenses.settlement.title", "Reimbursement")}
						</h2>
						<SettlementStateBadge state={account.summary.state} />
					</div>
					{account.summary.currencies.map((line) => (
						<div key={line.currency} className="space-y-2">
							<p className="text-base font-medium tabular-nums">
								<BalanceText line={line} />
							</p>
							<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
								<dt className="text-muted-foreground">
									{t("travelExpenses.settlement.entitlement", "Approved employee-paid amount")}
								</dt>
								<dd className="text-right tabular-nums">
									{formatMoney(locale, line.entitlement, line.currency)}
								</dd>
								<dt className="text-muted-foreground">
									{t("travelExpenses.settlement.reimbursed", "Reimbursed")}
								</dt>
								<dd className="text-right tabular-nums">
									{formatMoney(locale, line.reimbursed, line.currency)}
								</dd>
								{line.recovered !== "0.00" && (
									<>
										<dt className="text-muted-foreground">
											{t("travelExpenses.settlement.recovered", "Recovered")}
										</dt>
										<dd className="text-right tabular-nums">
											{formatMoney(locale, line.recovered, line.currency)}
										</dd>
									</>
								)}
							</dl>
						</div>
					))}
					{account.basis?.companyPaid &&
						account.basis.companyPaid !== "0.00" &&
						account.currency && (
							<p className="text-sm text-muted-foreground">
								{t(
									"travelExpenses.settlement.companyPaid",
									"Company-paid costs of {amount} are not owed to the employee.",
									{ amount: formatMoney(locale, account.basis.companyPaid, account.currency) },
								)}
							</p>
						)}
					{viewer === "owner" && account.summary.state === "outstanding" && (
						<p className="text-sm text-muted-foreground">
							{t(
								"travelExpenses.settlement.ownerOutstanding",
								"Finance records your reimbursement here once it has been paid.",
							)}
						</p>
					)}
				</section>

				{account.entries.length > 0 && (
					<section aria-labelledby={`${headingId}-history`} className="space-y-2">
						<h3 id={`${headingId}-history`} className="text-sm font-semibold">
							{t("travelExpenses.settlement.history", "Recorded payments")}
						</h3>
						<ul className="divide-y rounded-md border text-sm">
							{account.entries.map((entry) => (
								<li
									key={entry.id}
									className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2"
								>
									<span className="font-medium tabular-nums">
										{entry.kind === "recovery"
											? t("travelExpenses.settlement.entry.recovery", "Recovered {amount}", {
													amount: formatMoney(locale, entry.amount, entry.currency),
												})
											: t("travelExpenses.settlement.entry.reimbursement", "Paid {amount}", {
													amount: formatMoney(locale, entry.amount, entry.currency),
												})}
									</span>
									<span>{formatPlainDate(locale, entry.occurredOn)}</span>
									<span className="break-all text-muted-foreground">{entry.reference}</span>
									{viewer === "finance" && (
										<span className="w-full text-xs text-muted-foreground">
											{t(
												"travelExpenses.settlement.entry.recordedBy",
												"Recorded by {name}, {date}",
												{
													name: entry.recordedByName ?? "—",
													date: formatRecordedInstant(locale, entry.recordedAt),
												},
											)}
										</span>
									)}
									{entry.note && <span className="w-full text-muted-foreground">{entry.note}</span>}
								</li>
							))}
						</ul>
					</section>
				)}

				{viewer === "finance" &&
					canSettle &&
					account.approved &&
					account.summary.currencies
						.filter((line) => line.state === "outstanding" && line.currency === account.currency)
						.map((line) => (
							<RecordReimbursementForm
								key={`${line.currency}:${line.balance}`}
								source={source}
								line={line}
								onSettled={settled}
							/>
						))}
			</CardContent>
		</Card>
	);
}
