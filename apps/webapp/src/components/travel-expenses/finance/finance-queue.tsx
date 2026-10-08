"use client";

import {
	IconCash,
	IconChevronLeft,
	IconChevronRight,
	IconFilterOff,
	IconHistory,
	IconReceipt,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useId } from "react";
import {
	getTravelExpenseFinanceQueue,
	getTravelExpenseFinanceQueueFilterOptions,
} from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { queryKeys } from "@/lib/query/keys";
import {
	DEFAULT_FINANCE_QUEUE_VIEW,
	FINANCE_QUEUE_STATUSES,
	type FinanceQueueStatus,
	type FinanceQueueView,
	financeQueueSearch,
	parseFinanceQueueView,
} from "@/lib/travel-expenses/finance-queue-params";
import type { SettlementAccount } from "@/lib/travel-expenses/settlement-store";
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

function hasFilters(view: FinanceQueueView): boolean {
	return Boolean(view.employeeId || view.teamId || view.currency || view.notExported);
}

/**
 * The view lives in the search params (#753): it survives opening an expense
 * and coming back. Changing it replaces the history entry, without navigating.
 */
function useFinanceQueueView() {
	const searchParams = useSearchParams();
	const view = parseFinanceQueueView(new URLSearchParams(searchParams.toString()));
	function setView(next: FinanceQueueView) {
		const search = financeQueueSearch(next);
		window.history.replaceState(
			null,
			"",
			search ? `${window.location.pathname}?${search}` : window.location.pathname,
		);
	}
	return { view, setView };
}

function QueueFilters({
	view,
	onChange,
}: {
	view: FinanceQueueView;
	onChange: (view: FinanceQueueView) => void;
}) {
	const { t } = useTranslate();
	const notExportedId = useId();
	const { data: options } = useQuery({
		queryKey: queryKeys.travelExpenses.financeQueueFilters(),
		queryFn: async () => {
			const result = await getTravelExpenseFinanceQueueFilterOptions();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		staleTime: 60_000,
	});
	// Any change of filter starts again on the first page.
	const filter = (patch: Partial<FinanceQueueView>) => onChange({ ...view, ...patch, page: 1 });
	const employeeOptions = (options?.employees ?? []).map((employee) => ({
		code: employee.id,
		name: employee.name ?? "—",
	}));
	const teamOptions = (options?.teams ?? []).map((team) => ({ code: team.id, name: team.name }));
	const allEmployees = t("travelExpenses.finance.filter.employee.all", "All employees");
	const allTeams = t("travelExpenses.finance.filter.team.all", "All teams");
	const allCurrencies = t("travelExpenses.finance.filter.currency.all", "All currencies");
	const currencyOptions = (options?.currencies ?? []).map((currency) => ({
		code: currency,
		name: currency,
	}));

	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-center">
			<SearchableSelect
				aria-label={t("travelExpenses.finance.filter.employee.label", "Employee")}
				options={employeeOptions}
				value={view.employeeId ?? ""}
				onValueChange={(value) => filter({ employeeId: value || null })}
				placeholder={allEmployees}
				searchPlaceholder={t("travelExpenses.finance.filter.employee.search", "Search employees…")}
				emptyText={t("travelExpenses.finance.filter.employee.none", "No employee found.")}
				allowEmpty
				emptyLabel={allEmployees}
			/>
			<SearchableSelect
				aria-label={t("travelExpenses.finance.filter.team.label", "Team at approval")}
				options={teamOptions}
				value={view.teamId ?? ""}
				onValueChange={(value) => filter({ teamId: value || null })}
				placeholder={allTeams}
				searchPlaceholder={t("travelExpenses.finance.filter.team.search", "Search teams…")}
				emptyText={t("travelExpenses.finance.filter.team.none", "No team found.")}
				allowEmpty
				emptyLabel={allTeams}
			/>
			<SearchableSelect
				aria-label={t("travelExpenses.finance.filter.currency.label", "Currency")}
				options={currencyOptions}
				value={view.currency ?? ""}
				onValueChange={(value) => filter({ currency: value || null })}
				placeholder={allCurrencies}
				searchPlaceholder={t("travelExpenses.finance.filter.currency.search", "Search currencies…")}
				emptyText={t("travelExpenses.finance.filter.currency.none", "No currency found.")}
				allowEmpty
				emptyLabel={allCurrencies}
			/>
			<div className="flex min-h-9 items-center gap-2">
				<Checkbox
					id={notExportedId}
					checked={view.notExported}
					onCheckedChange={(checked) => filter({ notExported: checked === true })}
				/>
				<Label htmlFor={notExportedId} className="whitespace-nowrap font-normal">
					{t("travelExpenses.finance.filter.notExported", "Not yet exported")}
				</Label>
			</div>
		</div>
	);
}

function QueuePagination({
	view,
	hasMore,
	onChange,
}: {
	view: FinanceQueueView;
	hasMore: boolean;
	onChange: (view: FinanceQueueView) => void;
}) {
	const { t } = useTranslate();
	if (view.page === 1 && !hasMore) return null;
	return (
		<nav
			aria-label={t("travelExpenses.finance.pagination.label", "Finance queue pages")}
			className="flex items-center justify-between gap-3 border-t px-6 py-3"
		>
			<Button
				variant="outline"
				size="sm"
				disabled={view.page === 1}
				onClick={() => onChange({ ...view, page: view.page - 1 })}
			>
				<IconChevronLeft aria-hidden="true" className="size-4" />
				{t("travelExpenses.finance.pagination.previous", "Previous")}
			</Button>
			<span className="text-sm text-muted-foreground tabular-nums">
				{t("travelExpenses.finance.pagination.page", "Page {page}", { page: view.page })}
			</span>
			<Button
				variant="outline"
				size="sm"
				disabled={!hasMore}
				onClick={() => onChange({ ...view, page: view.page + 1 })}
			>
				{t("travelExpenses.finance.pagination.next", "Next")}
				<IconChevronRight aria-hidden="true" className="size-4" />
			</Button>
		</nav>
	);
}

/**
 * The finance queue (#612): approved reports and approved legacy claims in the
 * reader's scope with their employee-paid entitlement, company-paid costs and
 * balance, filtered and paged (#753). Recording happens on each expense's page.
 */
export function FinanceQueue() {
	const { t } = useTranslate();
	const locale = useLocale();
	const { view, setView } = useFinanceQueueView();
	const search = financeQueueSearch(view);
	const { data, isError, isFetching, isLoading, refetch } = useQuery({
		queryKey: queryKeys.travelExpenses.financeQueue(search),
		queryFn: async () => {
			const result = await getTravelExpenseFinanceQueue(view);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		placeholderData: (previous) => previous,
	});
	const statusLabel: Record<FinanceQueueStatus, string> = {
		open: t("travelExpenses.finance.filter.open", "Open"),
		reimbursed: t("travelExpenses.finance.filter.reimbursed", "Reimbursed"),
		all: t("travelExpenses.finance.filter.all", "All approved"),
	};
	const filtered = hasFilters(view);

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
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<ToggleGroup
						type="single"
						variant="outline"
						value={view.status}
						onValueChange={(value: string) => {
							const status = FINANCE_QUEUE_STATUSES.find((entry) => entry === value);
							if (status) setView({ ...view, status, page: 1 });
						}}
						aria-label={t("travelExpenses.finance.filter.label", "Show expenses")}
					>
						{FINANCE_QUEUE_STATUSES.map((value) => (
							<ToggleGroupItem key={value} value={value} className="whitespace-nowrap px-3">
								{statusLabel[value]}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					{filtered && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setView({ ...DEFAULT_FINANCE_QUEUE_VIEW, status: view.status })}
						>
							<IconFilterOff aria-hidden="true" className="size-4" />
							{t("travelExpenses.finance.filter.clear", "Clear filters")}
						</Button>
					)}
				</div>
				<QueueFilters view={view} onChange={setView} />
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
				<>
					<Empty className="rounded-none border-t md:p-10">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<IconCash aria-hidden="true" />
							</EmptyMedia>
							<EmptyDescription>
								{filtered || view.page > 1
									? t(
											"travelExpenses.finance.empty.filtered",
											"No approved expenses match these filters.",
										)
									: view.status === "open"
										? t(
												"travelExpenses.finance.empty.allReimbursed",
												"Nothing left to record: every approved expense is reimbursed.",
											)
										: t("travelExpenses.finance.empty.any", "No approved expenses yet.")}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
					<QueuePagination view={view} hasMore={data.hasMore} onChange={setView} />
				</>
			) : (
				<div className="border-t">
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
					<QueuePagination view={view} hasMore={data.hasMore} onChange={setView} />
				</div>
			)}
		</Card>
	);
}
