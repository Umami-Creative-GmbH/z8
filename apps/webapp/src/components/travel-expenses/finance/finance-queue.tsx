"use client";

import {
	IconCash,
	IconChevronRight,
	IconHistory,
	IconInfoCircle,
	IconReceipt,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import {
	type FinanceQueueCoverage,
	getTravelExpenseFinanceQueue,
} from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { queryKeys } from "@/lib/query/keys";
import type { FinanceQueueFilter, SettlementAccount } from "@/lib/travel-expenses/settlement-store";
import { Link } from "@/navigation";
import { TRIP_ICON } from "../expense-icons";
import {
	formatMoney,
	formatPlainDate,
	formatPlainDateRange,
	formatRecordedInstant,
} from "../report/format";
import { reportName } from "../report-name";
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
				name: reportName(t, { kind: "trip", itemType: null, title: title.purpose }),
				dates: formatPlainDateRange(locale, title.startDate, title.endDate),
			};
		case "standalone":
			return {
				name: reportName(t, { kind: "standalone", itemType: null, title: title.description }),
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
			? TRIP_ICON
			: account.title.kind === "legacy_claim"
				? IconHistory
				: IconReceipt;
	return (
		<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
			<Icon aria-hidden="true" className="size-4" />
		</span>
	);
}

/**
 * The finance queue (#612): approved reports and approved legacy claims of the
 * organization with their employee-paid entitlement, company-paid costs and
 * balance. Recording happens on each expense's page. With `coverage:
 * "uncovered"` (#756), owners and admins see only what awaits reimbursement
 * and no expense officer covers.
 */
export function FinanceQueue({ coverage }: { coverage?: FinanceQueueCoverage } = {}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [selectedFilter, setFilter] = useState<FinanceQueueFilter>("open");
	const filter = coverage ? "open" : selectedFilter;
	const { data, isError, isFetching, isLoading, refetch } = useQuery({
		queryKey: queryKeys.travelExpenses.financeQueue(coverage ? `${filter}:${coverage}` : filter),
		queryFn: async () => {
			const result = coverage
				? await getTravelExpenseFinanceQueue(filter, coverage)
				: await getTravelExpenseFinanceQueue(filter);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		placeholderData: (previous) => previous,
	});
	const filterLabel: Record<FinanceQueueFilter, string> = {
		open: t("travelExpenses.finance.filter.open", "Open"),
		settled: t("travelExpenses.finance.filter.reimbursed", "Reimbursed"),
		all: t("travelExpenses.finance.filter.all", "All approved"),
	};

	return (
		<Card className="gap-4 overflow-hidden pb-0">
			<CardHeader>
				<h2 className="font-semibold leading-none">
					{t("travelExpenses.finance.queue.title", "Approved expenses")}
				</h2>
				<CardDescription>
					{t(
						"travelExpenses.finance.queue.description",
						"Open an expense to see its settlement and record a reimbursement.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className={isError && !data ? "space-y-4 pb-6" : undefined}>
				{coverage ? (
					<p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
						<span className="text-muted-foreground">
							{t(
								"travelExpenses.finance.coverageGap.queueFilter",
								"Approved expenses awaiting reimbursement that no expense officer covers.",
							)}
						</span>
						<Link
							href="/travel-expenses/finance"
							className="font-medium underline underline-offset-4"
						>
							{t("travelExpenses.finance.coverageGap.showAll", "Show all approved expenses")}
						</Link>
					</p>
				) : (
					<ToggleGroup
						type="single"
						variant="outline"
						value={filter}
						onValueChange={(value: string) => {
							if (FILTERS.includes(value as FinanceQueueFilter))
								setFilter(value as FinanceQueueFilter);
						}}
						aria-label={t("travelExpenses.finance.filter.label", "Show expenses")}
					>
						{FILTERS.map((value) => (
							<ToggleGroupItem key={value} value={value} className="whitespace-nowrap px-3">
								{filterLabel[value]}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				)}
				{isError && !data && (
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
				)}
			</CardContent>

			{isError && !data ? null : isLoading || !data ? (
				<div className="border-t px-6 py-4">
					<p className="sr-only">{t("travelExpenses.finance.loading", "Loading finance queue…")}</p>
					<Skeleton aria-hidden="true" className="h-48 w-full" />
				</div>
			) : data.accounts.length === 0 ? (
				<Empty className="rounded-none border-t md:p-10">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<IconCash aria-hidden="true" />
						</EmptyMedia>
						<EmptyDescription>
							{coverage
								? t(
										"travelExpenses.finance.coverageGap.empty",
										"An expense officer covers every approved expense awaiting reimbursement.",
									)
								: filter === "open"
									? t(
											"travelExpenses.finance.empty.allReimbursed",
											"Nothing left to record: every approved expense is reimbursed.",
										)
									: t("travelExpenses.finance.empty.any", "No approved expenses yet.")}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="border-t">
					{data.truncated && (
						<p
							role="status"
							className="flex items-start gap-2 border-b px-6 py-3 text-sm text-muted-foreground"
						>
							<IconInfoCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
							{t(
								"travelExpenses.finance.truncated",
								"Showing the {count} most recently approved expenses. Older matching expenses are not listed.",
								{ count: data.accounts.length },
							)}
						</p>
					)}
					<ul className="divide-y" aria-busy={isFetching}>
						{data.accounts.map((account) => {
							const title = accountTitle(t, locale, account);
							return (
								<li key={`${account.source.type}:${account.source.id}`}>
									<Link
										href={accountHref(account)}
										className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-2 sm:flex-nowrap"
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
										<IconChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
									</Link>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</Card>
	);
}
