"use client";

import {
	IconChevronRight,
	IconHistory,
	IconPlaneDeparture,
	IconReceipt,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { getTravelExpenseFinanceQueue } from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { queryKeys } from "@/lib/query/keys";
import type { FinanceQueueFilter, SettlementAccount } from "@/lib/travel-expenses/settlement-store";
import { Link } from "@/navigation";
import { formatMoney, formatPlainDate, formatPlainDateRange } from "../report/format";
import { formatRecordedInstant } from "../report/report-status";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { BalanceText, SettlementStateBadge } from "./settlement-status";

type Translate = ReturnType<typeof useTranslate>["t"];

const FILTERS: FinanceQueueFilter[] = ["open", "settled", "all"];

function accountHref(account: SettlementAccount): string {
	return account.source.type === "report"
		? `/travel-expenses/reports/${account.source.id}`
		: `/travel-expenses/${account.source.id}`;
}

function accountTitle(t: Translate, locale: string, account: SettlementAccount) {
	const { title } = account;
	switch (title.kind) {
		case "trip":
			return {
				name: title.purpose ?? t("travelExpenses.report.drafts.untitledTrip", "Untitled trip"),
				dates: formatPlainDateRange(locale, title.startDate, title.endDate),
			};
		case "standalone":
			return {
				name: title.description ?? t("travelExpenses.report.drafts.untitled", "Untitled receipt"),
				dates: title.expenseDate ? formatPlainDate(locale, title.expenseDate) : null,
			};
		case "legacy_claim":
			return {
				name: t("travelExpenses.finance.legacyClaim", "Legacy {type} claim", {
					type: title.claimType.replace("_", " "),
				}),
				dates: formatPlainDateRange(locale, title.startDate, title.endDate),
			};
	}
}

function SourceIcon({ account }: { account: SettlementAccount }) {
	const Icon =
		account.title.kind === "trip"
			? IconPlaneDeparture
			: account.title.kind === "legacy_claim"
				? IconHistory
				: IconReceipt;
	return <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;
}

/**
 * The finance queue (#612): approved reports and approved legacy claims of the
 * organization with their employee-paid entitlement, company-paid costs and
 * balance. Recording happens on each expense's page.
 */
export function FinanceQueue() {
	const { t } = useTranslate();
	const locale = useLocale();
	const [filter, setFilter] = useState<FinanceQueueFilter>("open");
	const { data, isError, isFetching, isLoading, refetch } = useQuery({
		queryKey: queryKeys.travelExpenses.financeQueue(filter),
		queryFn: async () => {
			const result = await getTravelExpenseFinanceQueue(filter);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		placeholderData: (previous) => previous,
	});
	const filterLabel: Record<FinanceQueueFilter, string> = {
		open: t("travelExpenses.finance.filter.open", "Open"),
		settled: t("travelExpenses.finance.filter.settled", "Settled"),
		all: t("travelExpenses.finance.filter.all", "All approved"),
	};

	return (
		<div className="space-y-4">
			<ToggleGroup
				type="single"
				variant="outline"
				value={filter}
				onValueChange={(value: string) => {
					if (FILTERS.includes(value as FinanceQueueFilter)) setFilter(value as FinanceQueueFilter);
				}}
				aria-label={t("travelExpenses.finance.filter.label", "Show expenses")}
			>
				{FILTERS.map((value) => (
					<ToggleGroupItem key={value} value={value}>
						{filterLabel[value]}
					</ToggleGroupItem>
				))}
			</ToggleGroup>

			{isError && !data ? (
				<TravelExpenseLoadError
					message={t(
						"travelExpenses.finance.errors.load",
						"Unable to load the finance queue. Please retry.",
					)}
					retry={() => {
						void refetch();
					}}
					isRetrying={isFetching}
				/>
			) : isLoading || !data ? (
				<div>
					<p className="sr-only">{t("travelExpenses.finance.loading", "Loading finance queue…")}</p>
					<Skeleton aria-hidden="true" className="h-64 w-full" />
				</div>
			) : data.accounts.length === 0 ? (
				<Card>
					<CardContent className="py-10 text-center text-sm text-muted-foreground">
						{filter === "open"
							? t(
									"travelExpenses.finance.empty.open",
									"Nothing to settle: every approved expense is settled.",
								)
							: t("travelExpenses.finance.empty.any", "No approved expenses yet.")}
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardContent className="p-0">
						<ul className="divide-y" aria-busy={isFetching}>
							{data.accounts.map((account) => {
								const title = accountTitle(t, locale, account);
								return (
									<li key={`${account.source.type}:${account.source.id}`}>
										<Link
											href={accountHref(account)}
											className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/50 focus-visible:outline-2 sm:flex-nowrap"
										>
											<SourceIcon account={account} />
											<div className="min-w-0 flex-1">
												<p className="truncate font-medium">
													{account.employeeName ?? "—"} · {title.name}
												</p>
												<p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
													{title.dates && <span>{title.dates}</span>}
													{account.basis?.approvedAt && (
														<span>
															{t("travelExpenses.finance.approvedOn", "Approved {date}", {
																date: formatRecordedInstant(locale, account.basis.approvedAt),
															})}
														</span>
													)}
													{account.currency &&
														account.basis?.companyPaid &&
														account.basis.companyPaid !== "0.00" && (
															<span>
																{t("travelExpenses.finance.companyPaid", "Company-paid {amount}", {
																	amount: formatMoney(
																		locale,
																		account.basis.companyPaid,
																		account.currency,
																	),
																})}
															</span>
														)}
												</p>
											</div>
											<div className="text-right text-sm">
												{account.summary.currencies.map((line) => (
													<p key={line.currency} className="tabular-nums">
														<span className="text-muted-foreground">
															{t("travelExpenses.finance.employeePaid", "Employee-paid {amount}", {
																amount: formatMoney(locale, line.entitlement, line.currency),
															})}
														</span>
														<br />
														<span className="font-medium">
															<BalanceText line={line} />
														</span>
													</p>
												))}
											</div>
											<SettlementStateBadge state={account.summary.state} />
											<IconChevronRight
												aria-hidden="true"
												className="size-4 text-muted-foreground"
											/>
										</Link>
									</li>
								);
							})}
						</ul>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
