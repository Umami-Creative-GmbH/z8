"use client";

import {
	IconCash,
	IconChevronLeft,
	IconChevronRight,
	IconFilterOff,
	IconHistory,
	IconReceipt,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useId, useState } from "react";
import {
	type FinanceQueueCoverage,
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
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { TRIP_ICON } from "../expense-icons";
import { formatMoney, formatRecordedInstant } from "../report/format";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import {
	BulkReimbursementDialog,
	type BulkReimbursementItem,
	isReimbursableInFull,
	settlementSourceKey,
} from "./bulk-reimbursement-dialog";
import { payrollRunLabel } from "./payroll-run-notice";
import { BalanceText, SettlementStateBadge } from "./settlement-status";
import { settlementTitle } from "./settlement-title";

type Translate = ReturnType<typeof useTranslate>["t"];

function accountHref(account: SettlementAccount): string {
	return account.source.type === "report"
		? `/travel-expenses/reports/${account.source.id}`
		: `/travel-expenses/${account.source.id}`;
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

function accountKey(account: SettlementAccount): string {
	return settlementSourceKey(account.source);
}

/** Bulk reimbursement (#754) pays an account in full, so only such accounts are offered. */
const isSelectable = isReimbursableInFull;

function accountLabel(t: Translate, locale: string, account: SettlementAccount): string {
	return `${account.employeeName ?? "—"} · ${settlementTitle(t, locale, account.title).name}`;
}

/**
 * The accounts selected on the current page and view. Changing the view
 * (filters, status, page) starts with nothing selected.
 */
function useSelection(viewKey: string, accounts: readonly SettlementAccount[]) {
	const [state, setState] = useState<{ viewKey: string; keys: ReadonlySet<string> }>({
		viewKey,
		keys: new Set(),
	});
	const keys = state.viewKey === viewKey ? state.keys : new Set<string>();
	const selectable = accounts.filter(isSelectable);
	const selected = selectable.filter((account) => keys.has(accountKey(account)));
	function set(next: Iterable<string>) {
		setState({ viewKey, keys: new Set(next) });
	}
	return {
		selectable,
		selected,
		isSelected: (account: SettlementAccount) => keys.has(accountKey(account)),
		toggle(account: SettlementAccount, checked: boolean) {
			const next = new Set(keys);
			if (checked) next.add(accountKey(account));
			else next.delete(accountKey(account));
			set(next);
		},
		toggleAll(checked: boolean) {
			set(checked ? selectable.map(accountKey) : []);
		},
		clear: () => set([]),
	};
}

function hasFilters(view: FinanceQueueView): boolean {
	return Boolean(view.employeeId || view.teamId || view.currency || view.notExported);
}

/**
 * The view lives in the search params (#753): it survives opening an expense
 * and coming back. Changing it replaces the history entry, without navigating,
 * and keeps the coverage-gap filter (#756) the page was opened with.
 */
function useFinanceQueueView(coverage: FinanceQueueCoverage | undefined) {
	const searchParams = useSearchParams();
	const parsed = parseFinanceQueueView(new URLSearchParams(searchParams.toString()));
	// The coverage gap lists only what awaits reimbursement.
	const view: FinanceQueueView = coverage ? { ...parsed, status: "open" } : parsed;
	function setView(next: FinanceQueueView) {
		const params = new URLSearchParams(financeQueueSearch(next));
		if (coverage) params.set("coverage", coverage);
		const search = params.toString();
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

function SelectionBar({
	selection,
	onMark,
}: {
	selection: ReturnType<typeof useSelection>;
	onMark: () => void;
}) {
	const { t } = useTranslate();
	const { selectable, selected } = selection;
	const all = selectable.length > 0 && selected.length === selectable.length;
	return (
		<div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-6 py-2">
			<Checkbox
				aria-label={t(
					"travelExpenses.finance.bulk.selectAll",
					"Select all expenses awaiting reimbursement on this page",
				)}
				checked={all ? true : selected.length > 0 ? "indeterminate" : false}
				disabled={selectable.length === 0}
				onCheckedChange={(checked) => selection.toggleAll(checked === true)}
			/>
			<span className="text-sm text-muted-foreground tabular-nums">
				{t("travelExpenses.finance.bulk.selected", "{count} selected", { count: selected.length })}
			</span>
			<Button size="sm" className="ml-auto" disabled={selected.length === 0} onClick={onMark}>
				<IconCash aria-hidden="true" className="size-4" />
				{t("travelExpenses.finance.bulk.action", "Mark as reimbursed")}
			</Button>
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
 * balance, filtered and paged (#753). Partial payments and recoveries are
 * recorded on each expense's page; officers who record reimbursements can also
 * select expenses awaiting reimbursement here and mark them reimbursed in full at once (#754).
 * With `coverage: "uncovered"` (#756), owners and admins see only what awaits
 * reimbursement and no expense officer covers.
 */
export function FinanceQueue({ coverage }: { coverage?: FinanceQueueCoverage } = {}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { view, setView } = useFinanceQueueView(coverage);
	const search = financeQueueSearch(view);
	const { data, isError, isFetching, isLoading, refetch } = useQuery({
		queryKey: queryKeys.travelExpenses.financeQueue(search, coverage),
		queryFn: async () => {
			const result = coverage
				? await getTravelExpenseFinanceQueue(view, coverage)
				: await getTravelExpenseFinanceQueue(view);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		placeholderData: (previous) => previous,
	});
	const queryClient = useQueryClient();
	const canSettle = data?.canSettle ?? false;
	const selection = useSelection(`${search}|${coverage ?? ""}`, data?.accounts ?? []);
	// What was selected when the dialog opened: a reload meanwhile changes neither the request nor its results.
	const [bulkItems, setBulkItems] = useState<BulkReimbursementItem[] | null>(null);
	function openBulk() {
		setBulkItems(
			selection.selected.map((account) => ({ account, label: accountLabel(t, locale, account) })),
		);
	}
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
					)}
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
									: coverage
										? t(
												"travelExpenses.finance.coverageGap.empty",
												"An expense officer covers every approved expense awaiting reimbursement.",
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
					{canSettle && <SelectionBar selection={selection} onMark={openBulk} />}
					<ul className="divide-y" aria-busy={isFetching}>
						{data.accounts.map((account) => {
							const title = settlementTitle(t, locale, account.title);
							return (
								<li key={accountKey(account)} className={cn(canSettle && "flex items-center")}>
									{canSettle && (
										<div className="flex w-10 shrink-0 justify-end">
											{isSelectable(account) && (
												<Checkbox
													aria-label={t("travelExpenses.finance.bulk.select", "Select {name}", {
														name: accountLabel(t, locale, account),
													})}
													checked={selection.isSelected(account)}
													onCheckedChange={(checked) => selection.toggle(account, checked === true)}
												/>
											)}
										</div>
									)}
									<Link
										href={accountHref(account)}
										className={cn(
											"flex flex-wrap items-center gap-x-3 gap-y-1 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-2 sm:flex-nowrap",
											canSettle ? "min-w-0 flex-1 pr-6 pl-3" : "px-6",
										)}
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
												{account.payrollRun && (
													<span className="font-medium text-foreground">
														{t("travelExpenses.finance.inPayrollRun", "Included in {run}", {
															run: payrollRunLabel(t, locale, account.payrollRun),
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
					{canSettle && bulkItems && (
						<BulkReimbursementDialog
							items={bulkItems}
							open
							onOpenChange={(open) => {
								if (!open) setBulkItems(null);
							}}
							onFinished={() => {
								selection.clear();
								void queryClient.invalidateQueries({
									queryKey: queryKeys.travelExpenses.finance(),
								});
							}}
						/>
					)}
				</div>
			)}
		</Card>
	);
}
