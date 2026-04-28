"use client";

import { DateTime } from "luxon";
import { useLocale } from "next-intl";
import { useState, useTransition } from "react";
import { useTranslate } from "@tolgee/react";

import { Link } from "@/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type {
	SelfServiceRequestItem,
	SelfServiceRequestResult,
	SelfServiceRequestSourceType,
	SelfServiceRequestStatus,
} from "@/lib/self-service-requests/types";
import { cancelMyAbsenceRequest } from "./actions";

interface MyRequestsClientProps {
	initialResult: SelfServiceRequestResult;
}

type StatusFilter = SelfServiceRequestStatus | "all";
type SourceTypeFilter = SelfServiceRequestSourceType | "all";
type Translate = (key: string, fallback: string) => string;

const sourceTypeLabels: Record<SelfServiceRequestSourceType, { key: string; fallback: string }> = {
	absence: { key: "myRequests.sourceTypes.absence", fallback: "Absence" },
	time_correction: { key: "myRequests.sourceTypes.timeCorrection", fallback: "Time" },
	travel_expense: { key: "myRequests.sourceTypes.travelExpense", fallback: "Expense" },
};

const statusLabels: Record<SelfServiceRequestStatus, { key: string; fallback: string }> = {
	pending: { key: "myRequests.status.pending", fallback: "Pending" },
	approved: { key: "myRequests.status.approved", fallback: "Approved" },
	rejected: { key: "myRequests.status.rejected", fallback: "Rejected" },
	cancelled: { key: "myRequests.status.cancelled", fallback: "Cancelled" },
};

function sourceErrorMessage(sourceType: SelfServiceRequestSourceType, t: Translate) {
	if (sourceType === "time_correction") {
		return t("myRequests.sourceError.timeCorrection", "Time correction requests could not be loaded.");
	}

	if (sourceType === "travel_expense") {
		return t("myRequests.sourceError.travelExpense", "Travel expense requests could not be loaded.");
	}

	return t("myRequests.sourceError.absence", "Absence requests could not be loaded.");
}

function requestTitle(item: SelfServiceRequestItem, t: Translate) {
	if (item.sourceType === "time_correction") {
		return t("myRequests.requests.timeCorrection.title", "Time correction request");
	}

	if (item.sourceType === "travel_expense") {
		return t("myRequests.requests.travelExpense.title", "Travel expense claim");
	}

	if (item.title === "absence") {
		return t("myRequests.requests.absence.title", "Absence request");
	}

	return item.title;
}

function requestSubtitle(item: SelfServiceRequestItem, locale: string, t: Translate) {
	if (item.sourceType === "time_correction") {
		return t("myRequests.requests.timeCorrection.subtitle", "Correction for a time entry");
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
	const [prefix, amountPart] = value.includes(separator)
		? value.split(separator)
		: [null, value];
	const amountMatch = /^(\d+(?:\.\d+)?) ([A-Z]{3})$/.exec(amountPart);

	if (!amountMatch) {
		return value;
	}

	const amount = Number(amountMatch[1]);
	const currency = amountMatch[2];
	const formattedAmount = new Intl.NumberFormat(locale, {
		style: "currency",
		currency,
	}).format(amount);

	return prefix ? `${prefix}${separator}${formattedAmount}` : formattedAmount;
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
			t(sourceTypeLabels[item.sourceType].key, sourceTypeLabels[item.sourceType].fallback),
			t(statusLabels[item.status].key, statusLabels[item.status].fallback),
		]
			.join(" ")
			.toLowerCase();

		return matchesStatus && matchesSourceType && searchableText.includes(normalizedSearch);
	});
	const rejectedItems = filteredItems.filter((item) => item.status === "rejected");

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<header className="px-4 lg:px-6">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("myRequests.title", "My Requests")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"myRequests.subtitle",
						"Track pending requests, required fixes, and recent decisions in one place.",
					)}
				</p>
			</header>

			<section
				aria-label={t("myRequests.summary.ariaLabel", "Request summary")}
				className="grid gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-6"
			>
				<SummaryCard
					label={t("myRequests.summary.pending", "Pending")}
					value={initialResult.counts.pending}
				/>
				<SummaryCard
					label={t("myRequests.summary.requiredFixes", "Required fixes")}
					value={initialResult.counts.requiredFixes}
				/>
				<SummaryCard
					label={t("myRequests.summary.recentDecisions", "Recent decisions")}
					value={initialResult.counts.recentDecisions}
				/>
				<SummaryCard
					label={t("myRequests.summary.totalLoaded", "Total loaded")}
					value={initialResult.counts.total}
				/>
			</section>

			{initialResult.sourceErrors.length > 0 ? (
				<section className="px-4 lg:px-6">
					<Alert variant="destructive">
						<AlertTitle>
							{t("myRequests.sourceError.title", "Some requests could not be loaded.")}
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

			{rejectedItems.length > 0 ? (
				<section className="px-4 lg:px-6">
					<Card className="border-destructive/30 bg-destructive/5">
						<CardHeader>
							<CardTitle>{t("myRequests.needsAttention.title", "Needs attention")}</CardTitle>
							<CardDescription>
								{t(
									"myRequests.needsAttention.description",
									"Rejected requests that may require a correction before resubmission.",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3">
							{rejectedItems.map((item) => (
								<div
									key={item.id}
									className="flex flex-col gap-3 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="min-w-0 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<p className="font-medium">{requestTitle(item, t)}</p>
											<Badge variant="destructive">
												{t("myRequests.status.rejected", "Rejected")}
											</Badge>
										</div>
									<p className="text-sm text-muted-foreground">
										{requestSubtitle(item, locale, t)}
									</p>
										<p className="text-sm">
											{item.decisionReason?.trim() ||
												t("myRequests.noReason", "No reason provided.")}
										</p>
									</div>
									<RequestAction item={item} preferFix />
								</div>
							))}
						</CardContent>
					</Card>
				</section>
			) : null}

			<section className="px-4 lg:px-6">
				<Card>
					<CardHeader>
						<CardTitle>{t("myRequests.all.title", "All requests")}</CardTitle>
						<CardDescription>
							{t(
								"myRequests.all.description",
								"Review requests across absences, time corrections, and expenses.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
							<label htmlFor="request-search" className="grid gap-2 text-sm font-medium">
								{t("myRequests.filters.search", "Search")}
								<Input
									id="request-search"
									name="request-search"
									autoComplete="off"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder={t("myRequests.filters.searchPlaceholder", "Search by title…")}
								/>
							</label>
							<label className="grid gap-2 text-sm font-medium">
								{t("myRequests.filters.status", "Status")}
								<select
									className="h-9 rounded-md border border-input bg-background px-3 text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
									value={statusFilter}
									onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
								>
									<option value="all">{t("myRequests.filters.allStatuses", "All statuses")}</option>
									<option value="pending">
										{t("myRequests.filters.pendingRequests", "Pending requests")}
									</option>
									<option value="approved">
										{t("myRequests.filters.approvedRequests", "Approved requests")}
									</option>
									<option value="rejected">
										{t("myRequests.filters.rejectedRequests", "Rejected requests")}
									</option>
									<option value="cancelled">
										{t("myRequests.filters.cancelledRequests", "Cancelled requests")}
									</option>
								</select>
							</label>
							<label className="grid gap-2 text-sm font-medium">
								{t("myRequests.filters.type", "Type")}
								<select
									className="h-9 rounded-md border border-input bg-background px-3 text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
									value={sourceTypeFilter}
									onChange={(event) => setSourceTypeFilter(event.target.value as SourceTypeFilter)}
								>
									<option value="all">{t("myRequests.filters.allTypes", "All types")}</option>
									<option value="absence">{t("myRequests.sourceTypes.absence", "Absence")}</option>
									<option value="time_correction">
										{t("myRequests.sourceTypes.timeCorrection", "Time")}
									</option>
									<option value="travel_expense">
										{t("myRequests.sourceTypes.travelExpense", "Expense")}
									</option>
								</select>
							</label>
						</div>

						{initialResult.items.length === 0 ? (
							<EmptyState
								title={t("myRequests.empty.none.title", "No requests yet")}
								description={t(
									"myRequests.empty.none.description",
									"Requests will appear here when they are submitted or loaded.",
								)}
							/>
						) : filteredItems.length === 0 ? (
							<EmptyState
								title={t("myRequests.empty.filtered.title", "No requests match your filters")}
								description={t(
									"myRequests.empty.filtered.description",
									"Requests will appear here when they are submitted or loaded.",
								)}
							/>
						) : (
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{t("myRequests.table.type", "Type")}</TableHead>
											<TableHead>{t("myRequests.table.request", "Request")}</TableHead>
											<TableHead>{t("myRequests.table.status", "Status")}</TableHead>
											<TableHead>{t("myRequests.table.submitted", "Submitted")}</TableHead>
											<TableHead>{t("myRequests.table.decision", "Decision")}</TableHead>
											<TableHead className="text-right">
												{t("myRequests.table.action", "Action")}
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{filteredItems.map((item) => (
											<TableRow key={item.id}>
												<TableCell>
													{t(
														sourceTypeLabels[item.sourceType].key,
														sourceTypeLabels[item.sourceType].fallback,
													)}
												</TableCell>
												<TableCell className="max-w-[320px] whitespace-normal">
													<div className="space-y-1">
														<p className="font-medium">{requestTitle(item, t)}</p>
														<p className="text-muted-foreground text-sm">
															{requestSubtitle(item, locale, t)}
														</p>
														{item.decisionReason ? (
															<p className="text-sm">
																{t("myRequests.reasonLabel", "Reason")}: {item.decisionReason}
															</p>
														) : null}
													</div>
												</TableCell>
												<TableCell>
													<StatusBadge status={item.status} />
												</TableCell>
												<TableCell>{formatDate(item.submittedAt, locale)}</TableCell>
												<TableCell>{formatDate(item.resolvedAt, locale)}</TableCell>
												<TableCell className="text-right">
													<RequestAction item={item} />
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>
			</section>
		</div>
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
		return <Badge variant="destructive">{t("myRequests.status.rejected", "Rejected")}</Badge>;
	}

	if (status === "approved") {
		return <Badge variant="default">{t("myRequests.status.approved", "Approved")}</Badge>;
	}

	if (status === "pending") {
		return <Badge variant="secondary">{t("myRequests.status.inReview", "In review")}</Badge>;
	}

	return <Badge variant="outline">{t("myRequests.status.cancelled", "Cancelled")}</Badge>;
}

function RequestAction({
	item,
	preferFix = false,
}: {
	item: SelfServiceRequestItem;
	preferFix?: boolean;
}) {
	const { t } = useTranslate();
	const [isCancelPending, startCancelTransition] = useTransition();
	const [cancelError, setCancelError] = useState<string | null>(null);
	const canFix = item.availableActions.includes("fix");
	const canView = item.availableActions.includes("view");
	const canCancel = item.availableActions.includes("cancel");
	const primaryAction = preferFix && canFix ? "fix" : canView ? "view" : canFix ? "fix" : null;
	const primaryActionLabel =
		primaryAction === "fix"
			? t("myRequests.actions.fix", "Fix")
			: primaryAction === "view"
				? t("myRequests.actions.view", "View")
				: null;

	if (!primaryActionLabel && !canCancel) {
		return (
			<span className="text-sm text-muted-foreground">
				{t("myRequests.actions.notAvailable", "Not available")}
			</span>
		);
	}

	function handleCancel() {
		if (
			!window.confirm(t("myRequests.actions.cancelConfirmation", "Cancel this absence request?"))
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
					t("myRequests.actions.cancelError", "Absence request could not be cancelled."),
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
						{t("myRequests.actions.cancel", "Cancel")}
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
