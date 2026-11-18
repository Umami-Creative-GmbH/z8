"use client";

import { IconHistory, IconLoader2, IconReceipt } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { getMyTravelExpenseHistory } from "@/app/[locale]/(app)/travel-expenses/history-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { queryKeys } from "@/lib/query/keys";
import {
	countExpenseHistory,
	EXPENSE_HISTORY_FILTERS,
	type ExpenseHistoryFilter,
	type ExpenseHistoryRow,
	filterExpenseHistory,
	isExpenseHistoryFilter,
	type LegacyClaimHistoryRow,
	type ReportHistoryRow,
} from "@/lib/travel-expenses/expense-history";
import { Link } from "@/navigation";
import { ITEM_TYPE_ICONS, TRIP_ICON } from "./expense-icons";
import { BalanceText, ReimbursedBadge } from "./finance/settlement-status";
import { ContinueLegacyDraftButton } from "./legacy-draft-conversion";
import { DeleteDraftReportButton } from "./report/delete-draft-report";
import { formatMoney, formatPlainDate, formatPlainDateRange } from "./report/format";
import { ReportStatusBadge } from "./report/report-status";
import { reportName } from "./report-name";
import { TravelExpenseLoadError } from "./travel-expense-load-error";

type Translate = ReturnType<typeof useTranslate>["t"];

const secondaryLinkClass =
	"relative z-10 rounded-sm text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2";

function datesText(locale: string, dates: { start: string | null; end: string | null }) {
	if (dates.start && dates.start === dates.end) return formatPlainDate(locale, dates.start);
	return formatPlainDateRange(locale, dates.start, dates.end);
}

function filterLabel(t: Translate, filter: ExpenseHistoryFilter): string {
	switch (filter) {
		case "all":
			return t("travelExpenses.history.filter.all", "All");
		case "needs_action":
			return t("travelExpenses.history.filter.needsAction", "To finish");
		case "in_review":
			return t("travelExpenses.history.filter.inReview", "In review");
		case "approved":
			return t("travelExpenses.history.filter.approved", "Approved");
		case "awaiting_reimbursement":
			return t("travelExpenses.history.filter.awaitingReimbursement", "Awaiting reimbursement");
		case "rejected":
			return t("travelExpenses.history.filter.rejected", "Rejected");
	}
}

function claimTitle(t: Translate, row: LegacyClaimHistoryRow): string {
	switch (row.claimType) {
		case "receipt":
			return t("travelExpenses.history.legacy.receipt", "Receipt claim");
		case "mileage":
			return t("travelExpenses.history.legacy.mileage", "Mileage claim");
		case "per_diem":
			return t("travelExpenses.history.legacy.perDiem", "Per diem claim");
	}
}

function RowIcon({ row }: { row: ExpenseHistoryRow }) {
	const Icon =
		row.source === "legacy_claim"
			? IconHistory
			: row.kind === "trip"
				? TRIP_ICON
				: ITEM_TYPE_ICONS[row.itemType ?? "receipt"];
	return (
		<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
			<Icon aria-hidden="true" className="size-4" />
		</span>
	);
}

function Balance({ row }: { row: ExpenseHistoryRow }) {
	// A reimbursed expense says so in its badge.
	if (!row.balance || row.reimbursement === "reimbursed") return null;
	return (
		<>
			{row.balance.currencies.map((line) => (
				<span key={line.currency} className="block tabular-nums">
					<BalanceText line={line} />
				</span>
			))}
		</>
	);
}

function ReportRowContent({ row }: { row: ReportHistoryRow }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const dates = datesText(locale, row.dates);
	const editable = row.status === "draft" || row.status === "returned";
	return (
		<>
			<div className="min-w-0 flex-1 space-y-1">
				<p className="flex flex-wrap items-center gap-2">
					<Link
						href={row.href}
						className="truncate font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-2"
					>
						{reportName(t, row)}
					</Link>
					{row.adjustmentOf && (
						<Badge variant="outline">{t("travelExpenses.history.adjustment", "Adjustment")}</Badge>
					)}
				</p>
				<p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
					<span>
						{dates ??
							(row.kind === "trip"
								? t("travelExpenses.report.drafts.noTravelDates", "No travel dates yet")
								: t("travelExpenses.report.drafts.noDate", "No date yet"))}
					</span>
					{row.kind === "trip" ? (
						<span>
							{t(
								"travelExpenses.report.drafts.expenses",
								"{count, plural, one {# expense} other {# expenses}}",
								{ count: row.itemCount },
							)}
						</span>
					) : (
						row.receiptCount > 0 && (
							<span>
								{t(
									"travelExpenses.report.drafts.receipts",
									"{count, plural, one {# receipt} other {# receipts}}",
									{ count: row.receiptCount },
								)}
							</span>
						)
					)}
				</p>
				{row.adjustmentOf && (
					<p className="text-sm">
						<Link
							href={`/travel-expenses/reports/${row.adjustmentOf.reportId}`}
							className={secondaryLinkClass}
						>
							{row.adjustmentOf.title
								? t("travelExpenses.history.adjustmentOf", "Adjustment of “{title}”", {
										title: row.adjustmentOf.title,
									})
								: t(
										"travelExpenses.history.adjustmentOfUntitled",
										"Adjustment of an earlier report",
									)}
						</Link>
					</p>
				)}
				{row.continuedFromClaimId && (
					<p className="text-sm">
						<Link
							href={`/travel-expenses/${row.continuedFromClaimId}`}
							className={secondaryLinkClass}
						>
							{t("travelExpenses.history.continuedFrom", "Continued from an earlier claim")}
						</Link>
					</p>
				)}
			</div>
			<div className="text-sm sm:text-right">
				<p className="font-medium tabular-nums">
					<span className="sr-only">
						{t("travelExpenses.history.reimbursable", "Reimbursable to you")}:{" "}
					</span>
					{formatMoney(locale, row.totals.reimbursable, row.totals.currency)}
				</p>
				{row.totals.companyPaid !== "0.00" && (
					<p className="text-muted-foreground tabular-nums">
						{t("travelExpenses.history.companyPaid", "Company-paid {amount}", {
							amount: formatMoney(locale, row.totals.companyPaid, row.totals.currency),
						})}
					</p>
				)}
				{editable && row.totals.excludedItemCount > 0 && (
					<p className="text-muted-foreground">
						{t(
							"travelExpenses.history.notCounted",
							"{count, plural, one {# expense} other {# expenses}} not counted yet",
							{ count: row.totals.excludedItemCount },
						)}
					</p>
				)}
				<p className="text-muted-foreground">
					<Balance row={row} />
				</p>
			</div>
		</>
	);
}

function ClaimRowContent({ row }: { row: LegacyClaimHistoryRow }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const dates = datesText(locale, row.dates);
	return (
		<>
			<div className="min-w-0 flex-1 space-y-1">
				<p className="flex flex-wrap items-center gap-2">
					<Link
						href={row.href}
						className="truncate font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-2"
					>
						{claimTitle(t, row)}
						{row.destination ? ` · ${row.destination}` : ""}
					</Link>
					<Badge variant="secondary">
						{t("travelExpenses.history.legacy.badge", "Earlier claim")}
					</Badge>
				</p>
				<p className="text-sm text-muted-foreground">
					{dates ??
						t(
							"travelExpenses.detail.unknownDates",
							"Trip date context not recorded (legacy claim)",
						)}
				</p>
				{row.canContinue && (
					<div className="relative z-10 pt-1">
						<ContinueLegacyDraftButton claimId={row.id} />
					</div>
				)}
			</div>
			<div className="text-sm sm:text-right">
				<p className="font-medium tabular-nums">
					<span className="sr-only">{t("travelExpenses.history.claimed", "Claimed")}: </span>
					{formatMoney(locale, row.amount.amount, row.amount.currency)}
				</p>
				<p className="text-muted-foreground">
					<Balance row={row} />
				</p>
			</div>
		</>
	);
}

/** Deletes a draft that was never submitted (#684) from its row. */
function DeleteRowDraft({ row }: { row: ReportHistoryRow }) {
	const { t } = useTranslate();
	return (
		<div className="relative z-10 -my-1.5">
			<DeleteDraftReportButton
				compact
				reportId={row.id}
				continuesLegacyClaim={row.continuedFromClaimId !== null}
				label={t("travelExpenses.history.deleteDraft", "Delete draft “{title}”", {
					title: reportName(t, row),
				})}
			/>
		</div>
	);
}

function HistoryList({ rows, busy }: { rows: ExpenseHistoryRow[]; busy: boolean }) {
	return (
		<ul className="divide-y border-t" aria-busy={busy}>
			{rows.map((row) => (
				<li
					key={`${row.source}:${row.id}`}
					className="relative flex flex-col gap-2 px-6 py-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-start sm:gap-3"
				>
					<div className="flex min-w-0 flex-1 gap-3">
						<RowIcon row={row} />
						<div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:gap-3">
							{row.source === "report" ? (
								<ReportRowContent row={row} />
							) : (
								<ClaimRowContent row={row} />
							)}
						</div>
					</div>
					<div className="flex shrink-0 items-start gap-1 pl-11 sm:pl-0">
						{row.reimbursement === "reimbursed" ? (
							<ReimbursedBadge />
						) : (
							<ReportStatusBadge status={row.status} />
						)}
						{row.source === "report" && row.deletable && <DeleteRowDraft row={row} />}
					</div>
				</li>
			))}
		</ul>
	);
}

/**
 * The employee's travel expenses in one place (#617): drafts, returned,
 * submitted and decided reports and earlier claims, filterable by status and
 * by whether reimbursement is still awaited (#751), with reimbursable totals
 * and settlement balances. Loaded rows stay visible while
 * a refresh runs or fails.
 */
export function ExpenseHistory(scope: { organizationId: string; employeeId: string }) {
	const { t } = useTranslate();
	const [filter, setFilter] = useState<ExpenseHistoryFilter>("all");
	const { data, isError, isFetching, isLoading, refetch } = useQuery({
		queryKey: queryKeys.travelExpenses.history(scope),
		queryFn: async () => {
			const result = await getMyTravelExpenseHistory();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		// Coming back from a report always shows its current status.
		staleTime: 0,
	});
	const retry = () => {
		void refetch();
	};

	if (isError && !data) {
		return (
			<TravelExpenseLoadError
				message={t(
					"travelExpenses.history.errors.load",
					"Unable to load your travel expenses. Please retry.",
				)}
				retry={retry}
				isRetrying={isFetching}
			/>
		);
	}
	if (isLoading || !data) {
		return (
			<div role="status">
				<span className="sr-only">
					{t("travelExpenses.history.loading", "Loading your travel expenses…")}
				</span>
				<Skeleton aria-hidden="true" className="h-48 w-full" />
			</div>
		);
	}
	if (data.length === 0) {
		return (
			<Card className="py-0">
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<IconReceipt aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>
							{t("travelExpenses.history.emptyTitle", "No travel expenses yet")}
						</EmptyTitle>
						<EmptyDescription>
							{t(
								"travelExpenses.history.emptyDescription",
								"Start a trip to collect several expenses with shared travel details, or add a single receipt or mileage expense. Drafts save automatically, so you can finish them later.",
							)}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</Card>
		);
	}

	const counts = countExpenseHistory(data);
	const visible = filterExpenseHistory(data, filter);
	return (
		<section aria-labelledby="travel-expense-history" className="space-y-4">
			{isError && (
				<TravelExpenseLoadError
					message={t(
						"travelExpenses.history.errors.refresh",
						"Your expenses could not be refreshed; the list below may be out of date. Please retry.",
					)}
					retry={retry}
					isRetrying={isFetching}
				/>
			)}
			<Card className="gap-4 overflow-hidden pb-0">
				<CardHeader>
					<h2 id="travel-expense-history" className="font-semibold leading-none">
						{t("travelExpenses.history.title", "Your expenses")}
					</h2>
					<CardDescription>
						{t(
							"travelExpenses.history.description",
							"Drafts, submitted reports and earlier claims, most recently changed first.",
						)}
					</CardDescription>
					{isFetching && (
						<CardAction>
							<p role="status" className="flex items-center gap-1 text-sm text-muted-foreground">
								<IconLoader2 aria-hidden="true" className="size-3.5 animate-spin" />
								{t("travelExpenses.history.refreshing", "Refreshing…")}
							</p>
						</CardAction>
					)}
				</CardHeader>
				<CardContent>
					<div className="max-w-full overflow-x-auto pb-1">
						<ToggleGroup
							type="single"
							variant="outline"
							value={filter}
							onValueChange={(value: string) => {
								if (isExpenseHistoryFilter(value)) setFilter(value);
							}}
							aria-label={t("travelExpenses.history.filter.label", "Show expenses")}
						>
							{EXPENSE_HISTORY_FILTERS.map((value) => (
								<ToggleGroupItem key={value} value={value} className="whitespace-nowrap px-3">
									{filterLabel(t, value)}
									<span className="ml-1.5 tabular-nums text-muted-foreground">{counts[value]}</span>
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</div>
				</CardContent>
				{visible.length === 0 ? (
					<Empty className="rounded-none border-t md:p-10">
						<EmptyHeader>
							<EmptyDescription>
								{t("travelExpenses.history.emptyFilter", "No expenses with this status.")}
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button type="button" variant="outline" size="sm" onClick={() => setFilter("all")}>
								{t("travelExpenses.history.showAll", "Show all expenses")}
							</Button>
						</EmptyContent>
					</Empty>
				) : (
					<HistoryList rows={visible} busy={isFetching} />
				)}
			</Card>
		</section>
	);
}
