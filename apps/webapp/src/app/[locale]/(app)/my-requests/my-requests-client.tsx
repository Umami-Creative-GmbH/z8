"use client";

import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useLocale } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
	SelfServiceRequestItem,
	SelfServiceRequestResult,
	SelfServiceRequestSourceType,
	SelfServiceRequestStatus,
} from "@/lib/self-service-requests/types";
import { Link } from "@/navigation";
import { cancelMyAbsenceRequest } from "./actions";

interface MyRequestsClientProps {
	initialResult: SelfServiceRequestResult;
}

type StatusFilter = SelfServiceRequestStatus | "all";
type SourceTypeFilter = SelfServiceRequestSourceType | "all";
type Translate = (key: string, fallback: string) => string;

const sourceTypeLabelKeys: Record<SelfServiceRequestSourceType, { key: string; fallback: string }> =
	{
		absence: { key: "myRequests:myRequests.sourceTypes.absence", fallback: "Absence" },
		time_correction: { key: "myRequests:myRequests.sourceTypes.timeCorrection", fallback: "Time" },
		travel_expense: { key: "myRequests:myRequests.sourceTypes.travelExpense", fallback: "Expense" },
	};

const statusLabelKeys: Record<SelfServiceRequestStatus, { key: string; fallback: string }> = {
	pending: { key: "myRequests:myRequests.status.pending", fallback: "Pending" },
	approved: { key: "myRequests:myRequests.status.approved", fallback: "Approved" },
	rejected: { key: "myRequests:myRequests.status.rejected", fallback: "Rejected" },
	cancelled: { key: "myRequests:myRequests.status.cancelled", fallback: "Cancelled" },
};

const RECENT_DECISION_DAYS = 30;
const travelExpenseAmountFormatters = new Map<string, Intl.NumberFormat>();

function getTravelExpenseAmountFormatter(locale: string, currency: string) {
	const formatterKey = `${locale}:${currency}`;
	const cachedFormatter = travelExpenseAmountFormatters.get(formatterKey);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = Intl.NumberFormat(locale, {
		style: "currency",
		currency,
	});
	travelExpenseAmountFormatters.set(formatterKey, formatter);
	return formatter;
}

function sourceErrorMessage(sourceType: SelfServiceRequestSourceType, t: Translate) {
	if (sourceType === "time_correction") {
		return t(
			"myRequests:myRequests.sourceError.timeCorrection",
			"Time correction requests could not be loaded.",
		);
	}

	if (sourceType === "travel_expense") {
		return t(
			"myRequests:myRequests.sourceError.travelExpense",
			"Travel expense requests could not be loaded.",
		);
	}

	return t("myRequests:myRequests.sourceError.absence", "Absence requests could not be loaded.");
}

function requestTitle(item: SelfServiceRequestItem, t: Translate) {
	if (item.sourceType === "time_correction") {
		return t("myRequests:myRequests.requests.timeCorrection.title", "Time correction request");
	}

	if (item.sourceType === "travel_expense") {
		return t("myRequests:myRequests.requests.travelExpense.title", "Travel expense claim");
	}

	if (item.title === "absence") {
		return t("myRequests:myRequests.requests.absence.title", "Absence request");
	}

	return item.title;
}

function requestSubtitle(item: SelfServiceRequestItem, locale: string, t: Translate) {
	if (item.sourceType === "time_correction") {
		return t(
			"myRequests:myRequests.requests.timeCorrection.subtitle",
			"Correction for a time entry",
		);
	}

	if (item.sourceType === "absence") {
		const dateRange = formatStoredDateRange(item.subtitle, locale);
		return dateRange ?? item.subtitle;
	}

	if (item.sourceType === "travel_expense") {
		return formatTravelExpenseSubtitle(item.subtitle, locale);
	}

	return item.subtitle;
}

function formatStoredDateRange(value: string, locale: string) {
	const match = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(value);
	if (!match) {
		return null;
	}

	const formatter = DateTime.DATE_MED;
	const start = DateTime.fromISO(match[1], { zone: "utc" }).setLocale(locale);
	const end = DateTime.fromISO(match[2], { zone: "utc" }).setLocale(locale);

	if (!start.isValid || !end.isValid) {
		return null;
	}

	return `${start.toLocaleString(formatter)} - ${end.toLocaleString(formatter)}`;
}

function formatTravelExpenseSubtitle(value: string, locale: string) {
	const separator = " · ";
	const [prefix, amountPart] = value.includes(separator) ? value.split(separator) : [null, value];
	const amountMatch = /^(\d+(?:\.\d+)?) ([A-Z]{3})$/.exec(amountPart);

	if (!amountMatch) {
		return value;
	}

	const amount = Number(amountMatch[1]);
	const currency = amountMatch[2];
	const formattedAmount = getTravelExpenseAmountFormatter(locale, currency).format(amount);

	return prefix ? `${prefix}${separator}${formattedAmount}` : formattedAmount;
}

function isRecentlyDecided(item: SelfServiceRequestItem, now: Date) {
	if ((item.status !== "approved" && item.status !== "rejected") || item.resolvedAt === null) {
		return false;
	}

	const cutoff = DateTime.fromJSDate(now).minus({ days: RECENT_DECISION_DAYS });
	return DateTime.fromJSDate(item.resolvedAt) >= cutoff;
}

function groupRequestItems(items: SelfServiceRequestItem[], now: Date) {
	return {
		needsAttention: items.filter((item) => item.status === "rejected"),
		inReview: items.filter((item) => item.status === "pending"),
		recentlyDecided: items.filter((item) => isRecentlyDecided(item, now)),
		all: items,
	};
}

export function MyRequestsClient({ initialResult }: MyRequestsClientProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [sourceTypeFilter, setSourceTypeFilter] = useState<SourceTypeFilter>("all");
	const [search, setSearch] = useState("");

	const normalizedSearch = search.trim().toLowerCase();
	const filteredItems = initialResult.items.filter((item) => {
		const matchesStatus = statusFilter === "all" || item.status === statusFilter;
		const matchesSourceType = sourceTypeFilter === "all" || item.sourceType === sourceTypeFilter;
		const searchableText = [
			requestTitle(item, t),
			requestSubtitle(item, locale, t),
			item.decisionReason ?? "",
			t(sourceTypeLabelKeys[item.sourceType].key, sourceTypeLabelKeys[item.sourceType].fallback),
			t(statusLabelKeys[item.status].key, statusLabelKeys[item.status].fallback),
		]
			.join(" ")
			.toLowerCase();

		return matchesStatus && matchesSourceType && searchableText.includes(normalizedSearch);
	});
	const groupedItems = groupRequestItems(filteredItems, new Date());

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<header className="px-4 lg:px-6">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("myRequests:myRequests.title", "My Requests")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"myRequests:myRequests.subtitle",
						"Track pending requests, required fixes, and recent decisions in one place.",
					)}
				</p>
			</header>

			<section
				aria-label={t("myRequests:myRequests.summary.ariaLabel", "Request summary")}
				className="grid gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-6"
			>
				<SummaryCard
					label={t("myRequests:myRequests.summary.pending", "Pending")}
					value={initialResult.counts.pending}
				/>
				<SummaryCard
					label={t("myRequests:myRequests.summary.requiredFixes", "Required fixes")}
					value={initialResult.counts.requiredFixes}
				/>
				<SummaryCard
					label={t("myRequests:myRequests.summary.recentDecisions", "Recent decisions")}
					value={initialResult.counts.recentDecisions}
				/>
				<SummaryCard
					label={t("myRequests:myRequests.summary.totalLoaded", "Total loaded")}
					value={initialResult.counts.total}
				/>
			</section>

			{initialResult.sourceErrors.length > 0 ? (
				<section className="px-4 lg:px-6">
					<Alert variant="destructive">
						<AlertTitle>
							{t("myRequests:myRequests.sourceError.title", "Some requests could not be loaded.")}
						</AlertTitle>
						<AlertDescription>
							<ul className="list-disc space-y-1 pl-4">
								{initialResult.sourceErrors.map((error) => (
									<li key={`${error.sourceType}-${error.message}`}>
										{sourceErrorMessage(error.sourceType, t)}
									</li>
								))}
							</ul>
						</AlertDescription>
					</Alert>
				</section>
			) : null}

			<section className="px-4 lg:px-6">
				<Card>
					<CardHeader>
						<CardTitle>{t("myRequests:myRequests.filters.title", "Find requests")}</CardTitle>
						<CardDescription>
							{t(
								"myRequests:myRequests.filters.description",
								"Filter every request section by text, status, or request type.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
							<label htmlFor="request-search" className="grid gap-2 text-sm font-medium">
								{t("myRequests:myRequests.filters.search", "Search")}
								<Input
									id="request-search"
									name="request-search"
									autoComplete="off"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder={t(
										"myRequests:myRequests.filters.searchPlaceholder",
										"Search by title…",
									)}
								/>
							</label>
							<label className="grid gap-2 text-sm font-medium">
								{t("myRequests:myRequests.filters.status", "Status")}
								<select
									className="h-9 rounded-md border border-input px-3 text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
									value={statusFilter}
									onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
								>
									<option value="all">
										{t("myRequests:myRequests.filters.allStatuses", "All statuses")}
									</option>
									<option value="pending">
										{t("myRequests:myRequests.filters.pendingRequests", "Pending requests")}
									</option>
									<option value="approved">
										{t("myRequests:myRequests.filters.approvedRequests", "Approved requests")}
									</option>
									<option value="rejected">
										{t("myRequests:myRequests.filters.rejectedRequests", "Rejected requests")}
									</option>
									<option value="cancelled">
										{t("myRequests:myRequests.filters.cancelledRequests", "Cancelled requests")}
									</option>
								</select>
							</label>
							<label className="grid gap-2 text-sm font-medium">
								{t("myRequests:myRequests.filters.type", "Type")}
								<select
									className="h-9 rounded-md border border-input px-3 text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
									value={sourceTypeFilter}
									onChange={(event) => setSourceTypeFilter(event.target.value as SourceTypeFilter)}
								>
									<option value="all">
										{t("myRequests:myRequests.filters.allTypes", "All types")}
									</option>
									<option value="absence">
										{t("myRequests:myRequests.sourceTypes.absence", "Absence")}
									</option>
									<option value="time_correction">
										{t("myRequests:myRequests.sourceTypes.timeCorrection", "Time")}
									</option>
									<option value="travel_expense">
										{t("myRequests:myRequests.sourceTypes.travelExpense", "Expense")}
									</option>
								</select>
							</label>
						</div>
					</CardContent>
				</Card>
			</section>

			{initialResult.items.length === 0 ? (
				<section className="px-4 lg:px-6">
					<EmptyState
						title={t("myRequests:myRequests.empty.none.title", "No requests yet")}
						description={t(
							"myRequests:myRequests.empty.none.description",
							"Requests will appear here when they are submitted or loaded.",
						)}
					/>
				</section>
			) : filteredItems.length === 0 ? (
				<section className="px-4 lg:px-6">
					<EmptyState
						title={t(
							"myRequests:myRequests.empty.filtered.title",
							"No requests match your filters",
						)}
						description={t(
							"myRequests:myRequests.empty.filtered.description",
							"Requests will appear here when they are submitted or loaded.",
						)}
					/>
				</section>
			) : (
				<>
					<RequestSection
						title={t("myRequests:myRequests.needsAttention.title", "Needs attention")}
						description={t(
							"myRequests:myRequests.needsAttention.description",
							"Rejected requests that may require a correction before resubmission.",
						)}
						items={groupedItems.needsAttention}
						preferFix
						tone="attention"
					/>
					<RequestSection
						title={t("myRequests:myRequests.inReview.title", "In review")}
						description={t(
							"myRequests:myRequests.inReview.description",
							"Requests waiting for approval or processing.",
						)}
						items={groupedItems.inReview}
					/>
					<RequestSection
						title={t("myRequests:myRequests.recentlyDecided.title", "Recently decided")}
						description={t(
							"myRequests:myRequests.recentlyDecided.description",
							"Approved and rejected decisions from the last 30 days.",
						)}
						items={groupedItems.recentlyDecided}
					/>
					<RequestSection
						title={t("myRequests:myRequests.all.title", "All requests")}
						description={t(
							"myRequests:myRequests.all.description",
							"Review requests across absences, time corrections, and expenses.",
						)}
						items={groupedItems.all}
						allowCancel={false}
					/>
				</>
			)}
		</div>
	);
}

function RequestSection({
	title,
	description,
	items,
	allowCancel = true,
	preferFix = false,
	tone = "default",
}: {
	title: string;
	description: string;
	items: SelfServiceRequestItem[];
	allowCancel?: boolean;
	preferFix?: boolean;
	tone?: "default" | "attention";
}) {
	const titleId = useId();

	if (items.length === 0) {
		return null;
	}

	return (
		<section aria-labelledby={titleId} className="px-4 lg:px-6">
			<Card className={tone === "attention" ? "border-destructive/30 bg-destructive/5" : undefined}>
				<CardHeader>
					<h2 id={titleId} className="font-semibold leading-none">
						{title}
					</h2>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					{items.map((item) => (
						<RequestCard
							key={item.id}
							item={item}
							allowCancel={allowCancel}
							preferFix={preferFix}
						/>
					))}
				</CardContent>
			</Card>
		</section>
	);
}

function RequestCard({
	item,
	allowCancel = true,
	preferFix = false,
}: {
	item: SelfServiceRequestItem;
	allowCancel?: boolean;
	preferFix?: boolean;
}) {
	const { t } = useTranslate();
	const locale = useLocale();

	return (
		<article className="rounded-lg border bg-background p-4 shadow-xs">
			<div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
				<div className="min-w-0 space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="outline">
							{t(
								sourceTypeLabelKeys[item.sourceType].key,
								sourceTypeLabelKeys[item.sourceType].fallback,
							)}
						</Badge>
						<StatusBadge status={item.status} />
					</div>
					<div className="space-y-1">
						<h3 className="font-medium text-base leading-tight">{requestTitle(item, t)}</h3>
						<p className="break-words text-muted-foreground text-sm">
							{requestSubtitle(item, locale, t)}
						</p>
						{item.decisionReason ? (
							<p className="break-words text-sm">
								<span className="font-medium">
									{t("myRequests:myRequests.reasonLabel", "Reason")}:
								</span>{" "}
								{item.decisionReason}
							</p>
						) : null}
					</div>
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
						<span>
							{t("myRequests:myRequests.card.submitted", "Submitted")}:{" "}
							{formatDate(item.submittedAt, locale)}
						</span>
						{item.resolvedAt ? (
							<span>
								{t("myRequests:myRequests.card.decision", "Decision")}:{" "}
								{formatDate(item.resolvedAt, locale)}
							</span>
						) : null}
					</div>
				</div>
				<RequestAction item={item} allowCancel={allowCancel} preferFix={preferFix} />
			</div>
		</article>
	);
}

function SummaryCard({ label, value }: { label: string; value: number }) {
	return (
		<Card>
			<CardHeader className="pb-0">
				<CardDescription>{label}</CardDescription>
				<CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
			</CardHeader>
		</Card>
	);
}

function StatusBadge({ status }: { status: SelfServiceRequestStatus }) {
	const { t } = useTranslate();

	if (status === "rejected") {
		return (
			<Badge variant="destructive">{t("myRequests:myRequests.status.rejected", "Rejected")}</Badge>
		);
	}

	if (status === "approved") {
		return (
			<Badge variant="default">{t("myRequests:myRequests.status.approved", "Approved")}</Badge>
		);
	}

	if (status === "pending") {
		return (
			<Badge variant="secondary">{t("myRequests:myRequests.status.inReview", "In review")}</Badge>
		);
	}

	return (
		<Badge variant="outline">{t("myRequests:myRequests.status.cancelled", "Cancelled")}</Badge>
	);
}

function RequestAction({
	item,
	allowCancel = true,
	preferFix = false,
}: {
	item: SelfServiceRequestItem;
	allowCancel?: boolean;
	preferFix?: boolean;
}) {
	const { t } = useTranslate();
	const [isCancelPending, startCancelTransition] = useTransition();
	const [cancelError, setCancelError] = useState<string | null>(null);
	const canFix = item.availableActions.includes("fix");
	const canView = item.availableActions.includes("view");
	const canCancel = allowCancel && item.availableActions.includes("cancel");
	const primaryAction = preferFix && canFix ? "fix" : canView ? "view" : canFix ? "fix" : null;
	const primaryActionLabel =
		primaryAction === "fix"
			? t("myRequests:myRequests.actions.fix", "Fix")
			: primaryAction === "view"
				? t("myRequests:myRequests.actions.view", "View")
				: null;

	if (!primaryActionLabel && !canCancel) {
		return (
			<span className="text-sm text-muted-foreground">
				{t("myRequests:myRequests.actions.notAvailable", "Not available")}
			</span>
		);
	}

	function handleCancel() {
		if (
			!window.confirm(
				t("myRequests:myRequests.actions.cancelConfirmation", "Cancel this absence request?"),
			)
		) {
			return;
		}

		setCancelError(null);
		startCancelTransition(async () => {
			const result = await cancelMyAbsenceRequest(item.sourceId);
			if (result.success) {
				setCancelError(null);
				return;
			}

			setCancelError(
				result.error ??
					t("myRequests:myRequests.actions.cancelError", "Absence request could not be cancelled."),
			);
		});
	}

	return (
		<div className="grid justify-items-end gap-2">
			<div className="flex flex-wrap justify-end gap-2">
				{primaryActionLabel ? (
					<Button asChild size="sm" variant={primaryAction === "fix" ? "default" : "outline"}>
						<Link href={item.sourceHref}>{primaryActionLabel}</Link>
					</Button>
				) : null}
				{canCancel ? (
					<Button
						type="button"
						size="sm"
						variant="destructive"
						disabled={isCancelPending}
						onClick={handleCancel}
					>
						{isCancelPending
							? t("myRequests:myRequests.actions.cancelling", "Cancelling…")
							: t("myRequests:myRequests.actions.cancel", "Cancel")}
					</Button>
				) : null}
			</div>
			{cancelError ? (
				<p role="alert" className="max-w-64 text-destructive text-sm">
					{cancelError}
				</p>
			) : null}
		</div>
	);
}

function EmptyState({ title, description }: { title: string; description: string }) {
	return (
		<div className="rounded-lg border border-dashed p-8 text-center">
			<p className="font-medium">{title}</p>
			<p className="mt-1 text-sm text-muted-foreground">{description}</p>
		</div>
	);
}

function formatDate(date: Date | null, locale: string) {
	if (!date) {
		return "-";
	}

	return DateTime.fromJSDate(date, { zone: "utc" })
		.setLocale(locale)
		.toLocaleString(DateTime.DATE_MED);
}
