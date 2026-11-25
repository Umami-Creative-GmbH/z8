"use client";

import {
	IconAlertTriangle,
	IconArrowBackUp,
	IconBan,
	IconCalendarEvent,
	IconCheck,
	IconClock,
	IconClockEdit,
	IconFileDescription,
	IconHourglassEmpty,
	IconReceipt,
	IconSearch,
	IconShieldCheck,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { type ReactNode, useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { ArrivalNotice } from "@/components/time-tracking/arrival-focus";
import { focusArrivalTarget } from "@/components/time-tracking/arrival-focus-target";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useInvalidatePeriodSubmissionReadiness } from "@/lib/query/period-submission-readiness";
import { needsFix } from "@/lib/self-service-requests/needs-fix";
import type {
	ComplianceExceptionKind,
	ComplianceExceptionRequestDetails,
	ExpenseReportRequestDetails,
	SelfServiceRequestCounts,
	SelfServiceRequestItem,
	SelfServiceRequestResult,
	SelfServiceRequestSourceType,
	SelfServiceRequestStatus,
} from "@/lib/self-service-requests/types";
import {
	myRequestFocusTargetId,
	parseMyRequestsFocus,
} from "@/lib/time-tracking/period-submissions/blocker-navigation";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { cancelMyAbsenceRequest, cancelMyTimeCorrectionRequest } from "./actions";

interface MyRequestsClientProps {
	initialResult: SelfServiceRequestResult;
	/** The `request` query parameter: the pending request a period blocker link opens (#1349). */
	focusRequest?: string;
}

type StatusFilter = SelfServiceRequestStatus | "all";
type SourceTypeFilter = SelfServiceRequestSourceType | "all";
type Translate = (
	key: string,
	fallback: string,
	params?: Record<string, string | number>,
) => string;

const sourceTypeLabelKeys: Record<SelfServiceRequestSourceType, { key: string; fallback: string }> =
	{
		absence: {
			key: "myRequests:myRequests.types.absence",
			fallback: "Absence",
		},
		time_correction: {
			key: "myRequests:myRequests.types.timeCorrection",
			fallback: "Time correction",
		},
		travel_expense_report: {
			key: "myRequests:myRequests.types.expenseReport",
			fallback: "Expense report",
		},
		travel_expense: {
			key: "myRequests:myRequests.types.earlierClaim",
			fallback: "Earlier claim",
		},
		compliance_exception: {
			key: "myRequests:myRequests.types.complianceException",
			fallback: "Compliance exception",
		},
	};

/** The type filter's options, in the order they are offered. */
const SOURCE_TYPE_OPTIONS: SelfServiceRequestSourceType[] = [
	"absence",
	"time_correction",
	"travel_expense_report",
	"travel_expense",
	"compliance_exception",
];

/** The status filter's options, in the order they are offered. */
const STATUS_OPTIONS: SelfServiceRequestStatus[] = [
	"pending",
	"returned",
	"approved",
	"rejected",
	"expired",
	"cancelled",
];

type TablerIcon = typeof IconClock;

const sourceTypeIcons: Record<SelfServiceRequestSourceType, TablerIcon> = {
	absence: IconCalendarEvent,
	time_correction: IconClockEdit,
	travel_expense_report: IconFileDescription,
	travel_expense: IconReceipt,
	compliance_exception: IconShieldCheck,
};

const complianceExceptionTitleKeys: Record<
	ComplianceExceptionKind,
	{ key: string; fallback: string }
> = {
	rest_period: {
		key: "myRequests:myRequests.requests.complianceException.restPeriod",
		fallback: "Rest period exception",
	},
	overtime_daily: {
		key: "myRequests:myRequests.requests.complianceException.overtimeDaily",
		fallback: "Daily overtime exception",
	},
	overtime_weekly: {
		key: "myRequests:myRequests.requests.complianceException.overtimeWeekly",
		fallback: "Weekly overtime exception",
	},
	overtime_monthly: {
		key: "myRequests:myRequests.requests.complianceException.overtimeMonthly",
		fallback: "Monthly overtime exception",
	},
};

/** Pending requests are called "In review" everywhere on this page: summary, filter, badge, section. */
const statusLabelKeys: Record<SelfServiceRequestStatus, { key: string; fallback: string }> = {
	pending: { key: "myRequests:myRequests.status.inReview", fallback: "In review" },
	returned: {
		key: "myRequests:myRequests.status.returned",
		fallback: "Returned",
	},
	expired: {
		key: "myRequests:myRequests.status.expired",
		fallback: "Expired",
	},
	approved: {
		key: "myRequests:myRequests.status.approved",
		fallback: "Approved",
	},
	rejected: {
		key: "myRequests:myRequests.status.rejected",
		fallback: "Rejected",
	},
	cancelled: {
		key: "myRequests:myRequests.status.cancelled",
		fallback: "Cancelled",
	},
};

const RECENT_DECISION_HOURS = 30 * 24;
const travelExpenseAmountFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

const selectClassName =
	"h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

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

/**
 * Medium dates in an explicit zone: "UTC" for stored calendar dates (held as UTC midnights), the
 * viewer's own zone for request instants, so they read on the same day as a validity window.
 */
function getDateFormatter(locale: string, timeZone = "UTC") {
	const formatterKey = `${locale}:${timeZone}`;
	const cachedFormatter = dateFormatters.get(formatterKey);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = new Intl.DateTimeFormat(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
		timeZone,
	});
	dateFormatters.set(formatterKey, formatter);
	return formatter;
}

/** Medium dates with short times in an explicit zone: a compliance exception's validity window. */
function getDateTimeFormatter(locale: string, timeZone: string) {
	const formatterKey = `${locale}:${timeZone}`;
	const cachedFormatter = dateTimeFormatters.get(formatterKey);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone,
	});
	dateTimeFormatters.set(formatterKey, formatter);
	return formatter;
}

function sourceTypeLabel(sourceType: SelfServiceRequestSourceType, t: Translate) {
	return t(sourceTypeLabelKeys[sourceType].key, sourceTypeLabelKeys[sourceType].fallback);
}

function statusLabel(status: SelfServiceRequestStatus, t: Translate) {
	return t(statusLabelKeys[status].key, statusLabelKeys[status].fallback);
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
			"myRequests:myRequests.sourceError.earlierClaim",
			"Earlier claims could not be loaded.",
		);
	}

	if (sourceType === "travel_expense_report") {
		return t(
			"myRequests:myRequests.sourceError.expenseReport",
			"Expense reports could not be loaded.",
		);
	}

	if (sourceType === "compliance_exception") {
		return t(
			"myRequests:myRequests.sourceError.complianceException",
			"Compliance exceptions could not be loaded.",
		);
	}

	return t("myRequests:myRequests.sourceError.absence", "Absence requests could not be loaded.");
}

/** An earlier claim's title names its type, as the finance list's "Earlier {type} claim" does. */
const earlierClaimTitleKeys: Partial<Record<string, { key: string; fallback: string }>> = {
	receipt: {
		key: "myRequests:myRequests.requests.earlierClaim.receipt",
		fallback: "Earlier receipt claim",
	},
	mileage: {
		key: "myRequests:myRequests.requests.earlierClaim.mileage",
		fallback: "Earlier mileage claim",
	},
	per_diem: {
		key: "myRequests:myRequests.requests.earlierClaim.perDiem",
		fallback: "Earlier per diem claim",
	},
};

function requestTitle(item: SelfServiceRequestItem, t: Translate) {
	if (item.sourceType === "time_correction") {
		return t("myRequests:myRequests.requests.timeCorrection.title", "Time correction request");
	}

	if (item.sourceType === "travel_expense") {
		const claimType = item.details?.kind === "earlier_claim" ? item.details.claimType : null;
		const named = claimType ? earlierClaimTitleKeys[claimType] : undefined;
		if (named) return t(named.key, named.fallback);
		return t("myRequests:myRequests.requests.earlierClaim.title", "Earlier claim");
	}

	if (item.details?.kind === "expense_report") {
		return expenseReportName(item.title, item.details, t);
	}

	if (item.details?.kind === "compliance_exception") {
		const label = complianceExceptionTitleKeys[item.details.exceptionType];
		if (label) return t(label.key, label.fallback);
		return t("myRequests:myRequests.requests.complianceException.title", "Compliance exception");
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

	if (item.details?.kind === "expense_report") {
		const adjustment = expenseReportAdjustmentLabel(item.details, t);
		const kind = expenseReportKindLabel(item.details, t);
		// A trip with only a start or end date arrives as one "YYYY-MM-DD".
		const dates =
			formatStoredDateRange(item.subtitle, locale) ?? formatStoredDate(item.subtitle, locale);
		return [adjustment, kind, dates].filter(Boolean).join(" · ");
	}

	if (item.details?.kind === "compliance_exception") {
		return formatComplianceExceptionSubtitle(item.details, locale, t);
	}

	return item.subtitle;
}

/**
 * A report's name, as `reportName` in `components/travel-expenses/report-name.ts` gives it: the
 * trip purpose or the standalone expense's description or route, else an "Untitled …" fallback.
 * Its copy lives in this page's namespace, which is the one loaded here.
 */
function expenseReportName(title: string, details: ExpenseReportRequestDetails, t: Translate) {
	if (title.trim()) return title;
	if (details.reportKind === "trip") {
		return t("myRequests:myRequests.requests.expenseReport.untitledTrip", "Untitled trip");
	}
	if (details.itemType === "mileage") {
		return t("myRequests:myRequests.requests.expenseReport.untitledMileage", "Untitled mileage");
	}
	return t("myRequests:myRequests.requests.expenseReport.untitledReceipt", "Untitled receipt");
}

/**
 * The report an adjustment adjusts, as the expense history names it. An adjustment copies its
 * original's name and dates, so without this the two would read the same.
 */
function expenseReportAdjustmentLabel(details: ExpenseReportRequestDetails, t: Translate) {
	if (!details.adjustmentOf) return null;
	if (details.adjustmentOf.title) {
		return t(
			"myRequests:myRequests.requests.expenseReport.adjustmentOf",
			"Adjustment of “{title}”",
			{
				title: details.adjustmentOf.title,
			},
		);
	}
	return t(
		"myRequests:myRequests.requests.expenseReport.adjustmentOfUntitled",
		"Adjustment of an earlier report",
	);
}

/** A report's kind, as `reportKindLabel` gives it: trip report, standalone receipt or mileage. */
function expenseReportKindLabel(details: ExpenseReportRequestDetails, t: Translate) {
	if (details.reportKind === "trip") {
		return t("myRequests:myRequests.requests.expenseReport.kind.trip", "Trip report");
	}
	if (details.itemType === "mileage") {
		return t(
			"myRequests:myRequests.requests.expenseReport.kind.standaloneMileage",
			"Standalone mileage",
		);
	}
	return t(
		"myRequests:myRequests.requests.expenseReport.kind.standaloneReceipt",
		"Standalone receipt",
	);
}

function formatPlannedDuration(minutes: number, t: Translate) {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours > 0 && rest > 0) {
		return t(
			"myRequests:myRequests.requests.complianceException.durationHoursMinutes",
			"{hours} h {minutes} min",
			{ hours, minutes: rest },
		);
	}

	if (hours > 0) {
		return t("myRequests:myRequests.requests.complianceException.durationHours", "{hours} h", {
			hours,
		});
	}

	return t("myRequests:myRequests.requests.complianceException.durationMinutes", "{minutes} min", {
		minutes: rest,
	});
}

/**
 * The planned duration and the 24-hour validity window, read in the viewer's effective time zone
 * (their own setting, else the organization's, else UTC).
 */
function formatComplianceExceptionSubtitle(
	details: ComplianceExceptionRequestDetails,
	locale: string,
	t: Translate,
) {
	const window = getDateTimeFormatter(locale, details.timeZone).formatRange(
		details.validFrom,
		details.validUntil,
	);
	const validity = t(
		"myRequests:myRequests.requests.complianceException.validity",
		"Valid: {window} ({timeZone})",
		{ window, timeZone: details.timeZone },
	);
	if (details.plannedDurationMinutes === null || details.plannedDurationMinutes <= 0) {
		return validity;
	}

	const planned = t(
		"myRequests:myRequests.requests.complianceException.planned",
		"Planned: {duration}",
		{ duration: formatPlannedDuration(details.plannedDurationMinutes, t) },
	);
	return `${planned} · ${validity}`;
}

function plainDateToUtcDate(value: string) {
	try {
		const date = Temporal.PlainDate.from(value);
		return new Date(Date.UTC(date.year, date.month - 1, date.day));
	} catch {
		return null;
	}
}

/** An absence's stored calendar range ("YYYY-MM-DD to YYYY-MM-DD"), formatted as one locale range. */
function formatStoredDateRange(value: string, locale: string) {
	const match = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(value);
	if (!match) {
		return null;
	}

	const start = plainDateToUtcDate(match[1]);
	const end = plainDateToUtcDate(match[2]);
	if (!start || !end) {
		return null;
	}

	return getDateFormatter(locale).formatRange(start, end);
}

/** One stored calendar date ("YYYY-MM-DD"), formatted in the locale. */
function formatStoredDate(value: string, locale: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return null;
	}
	const date = plainDateToUtcDate(value);
	return date ? getDateFormatter(locale).format(date) : null;
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

/** A request instant's date in the viewer's effective time zone. */
function formatDate(date: Date, locale: string, timeZone: string) {
	return getDateFormatter(locale, timeZone).format(date);
}

function isRecentlyDecided(item: SelfServiceRequestItem, now: Date) {
	if ((item.status !== "approved" && item.status !== "rejected") || item.resolvedAt === null) {
		return false;
	}

	const cutoff = Temporal.Instant.fromEpochMilliseconds(now.getTime()).subtract({
		hours: RECENT_DECISION_HOURS,
	});
	return (
		Temporal.Instant.compare(
			Temporal.Instant.fromEpochMilliseconds(item.resolvedAt.getTime()),
			cutoff,
		) >= 0
	);
}

/**
 * Each request appears once in the working sections (fix, review, recent decision) and once in the
 * history. A rejection that needs a fix is shown under "Needs attention", not again as a decision;
 * so is a returned expense report. Expired compliance exceptions appear in the history only.
 */
function groupRequestItems(items: SelfServiceRequestItem[], now: Date) {
	return {
		needsAttention: items.filter(needsFix),
		inReview: items.filter((item) => item.status === "pending"),
		recentlyDecided: items.filter((item) => !needsFix(item) && isRecentlyDecided(item, now)),
		all: items,
	};
}

function matchesSearch(item: SelfServiceRequestItem, search: string, locale: string, t: Translate) {
	const searchableText = [
		requestTitle(item, t),
		requestSubtitle(item, locale, t),
		item.decisionReason ?? "",
		sourceTypeLabel(item.sourceType, t),
		statusLabel(item.status, t),
	]
		.join(" ")
		.toLowerCase();

	return searchableText.includes(search.trim().toLowerCase());
}

/**
 * The pending request a period blocker link asks to focus (#1349), picked from the requests this
 * page already loaded for the signed-in employee. The link's identity is never looked up anywhere
 * else, so a forged, foreign, decided or unloaded identity finds nothing.
 */
function findFocusedRequest(items: SelfServiceRequestItem[], focusRequest: string | undefined) {
	const focus = parseMyRequestsFocus(focusRequest);
	if (!focus) return { requested: false, item: null } as const;
	const item =
		items.find(
			(candidate) =>
				candidate.status === "pending" &&
				candidate.sourceType === focus.sourceType &&
				candidate.sourceId === focus.sourceId,
		) ?? null;
	return { requested: true, item } as const;
}

/**
 * The filters, plus the period blocker focus (#1349): a newly focused request is revealed by
 * resetting any filter hiding it, then takes focus once it renders.
 */
function useMyRequestsFilters(
	items: SelfServiceRequestItem[],
	focusRequest: string | undefined,
	locale: string,
	t: Translate,
) {
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [sourceTypeFilter, setSourceTypeFilter] = useState<SourceTypeFilter>("all");
	const [search, setSearch] = useState("");
	const focused = findFocusedRequest(items, focusRequest);
	const focusedItem = focused.item;

	// A newly focused request is revealed: any filter hiding it is set to show it.
	const [revealedFocus, setRevealedFocus] = useState<string | undefined>(undefined);
	if (focusedItem && revealedFocus !== focusRequest) {
		setRevealedFocus(focusRequest);
		if (statusFilter !== "all" && statusFilter !== focusedItem.status) {
			setStatusFilter(focusedItem.status);
		}
		if (sourceTypeFilter !== "all" && sourceTypeFilter !== focusedItem.sourceType) {
			setSourceTypeFilter(focusedItem.sourceType);
		}
		if (!matchesSearch(focusedItem, search, locale, t)) setSearch("");
	}

	const focusedItemId = focusedItem?.id ?? null;
	useEffect(() => {
		if (!focusedItemId || revealedFocus !== focusRequest) return;
		const target = document.getElementById(myRequestFocusTargetId(focusedItemId));
		if (target) focusArrivalTarget(target);
	}, [focusedItemId, focusRequest, revealedFocus]);
	// The notice is for an arrival only: a focused request the employee then cancels (or that is
	// decided) while they stay here leaves no notice and takes no focus.
	const arrivedUnavailable = focused.requested && !focusedItem && revealedFocus !== focusRequest;

	const filteredItems = items.filter((item) => {
		const matchesStatus = statusFilter === "all" || item.status === statusFilter;
		const matchesSourceType = sourceTypeFilter === "all" || item.sourceType === sourceTypeFilter;

		return matchesStatus && matchesSourceType && matchesSearch(item, search, locale, t);
	});

	const isFiltered = statusFilter !== "all" || sourceTypeFilter !== "all" || search.trim() !== "";
	function clearFilters() {
		setStatusFilter("all");
		setSourceTypeFilter("all");
		setSearch("");
	}

	return {
		statusFilter,
		setStatusFilter,
		sourceTypeFilter,
		setSourceTypeFilter,
		search,
		setSearch,
		isFiltered,
		clearFilters,
		arrivedUnavailable,
		filteredItems,
		totalCount: items.length,
	};
}

export function MyRequestsClient({ initialResult, focusRequest }: MyRequestsClientProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const router = useRouter();
	const [isRefreshing, startRefresh] = useTransition();
	const filters = useMyRequestsFilters(initialResult.items, focusRequest, locale, t);
	const { arrivedUnavailable, filteredItems } = filters;
	// The page's reading time: "recent" is a 30-day window, so it need not tick while the page is open.
	const [now] = useState(() => new Date());
	const groupedItems = groupRequestItems(filteredItems, now);
	const hasSourceErrors = initialResult.sourceErrors.length > 0;

	return (
		<div
			className="@container/main page-frame flex flex-1 flex-col gap-6"
			aria-busy={isRefreshing}
		>
			<PageHeader
				title={t("myRequests:myRequests.title", "My Requests")}
				scope={t(
					"myRequests:myRequests.scopeAllRequests",
					"Your absence, time-correction, compliance exception and expense requests in the active organization",
				)}
			/>

			{arrivedUnavailable ? (
				<section>
					<FocusedRequestUnavailable key={focusRequest} />
				</section>
			) : null}

			<RequestSummary counts={initialResult.counts} />

			{hasSourceErrors ? (
				<section>
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
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-3"
							disabled={isRefreshing}
							onClick={() => startRefresh(() => router.refresh())}
						>
							{isRefreshing ? t("common.refreshing", "Refreshing…") : t("common.retry", "Retry")}
						</Button>
					</Alert>
				</section>
			) : null}

			{initialResult.items.length === 0 ? (
				<section>
					{hasSourceErrors ? (
						<EmptyState
							title={t("myRequests:myRequests.empty.unavailable.title", "No requests loaded")}
							description={t(
								"myRequests:myRequests.empty.unavailable.description",
								"Retry the unavailable sources to check your requests.",
							)}
						/>
					) : (
						<EmptyState
							title={t("myRequests:myRequests.empty.none.title", "No requests yet")}
							description={t(
								"myRequests:myRequests.empty.none.description",
								"Requests will appear here when they are submitted or loaded.",
							)}
						/>
					)}
				</section>
			) : (
				<>
					<RequestFilters filters={filters} />

					{filteredItems.length === 0 ? (
						<section>
							<EmptyState
								title={t(
									"myRequests:myRequests.empty.filtered.title",
									"No requests match your filters",
								)}
								description={t(
									"myRequests:myRequests.empty.filtered.hint",
									"Try another search term, status or type.",
								)}
								action={
									<Button type="button" variant="outline" size="sm" onClick={filters.clearFilters}>
										{t("table.clearFilters", "Clear filters")}
									</Button>
								}
							/>
						</section>
					) : (
						<>
							<RequestSection
								title={t("myRequests:myRequests.needsAttention.title", "Needs attention")}
								description={t(
									"myRequests:myRequests.needsAttention.fixDescription",
									"Returned or rejected requests that need a correction before resubmission.",
								)}
								items={groupedItems.needsAttention}
								timeZone={initialResult.timeZone}
								preferFix
								tone="attention"
							/>
							<RequestSection
								title={t("myRequests:myRequests.inReview.title", "In review")}
								items={groupedItems.inReview}
								timeZone={initialResult.timeZone}
								focusTargets
							/>
							<RequestSection
								title={t("myRequests:myRequests.recentlyDecided.title", "Recently decided")}
								description={t(
									"myRequests:myRequests.recentlyDecided.description",
									"Approved and rejected decisions from the last 30 days.",
								)}
								items={groupedItems.recentlyDecided}
								timeZone={initialResult.timeZone}
								allowCancel={false}
							/>
							<RequestHistory items={groupedItems.all} timeZone={initialResult.timeZone} />
						</>
					)}
				</>
			)}
		</div>
	);
}

/** One shared surface, ordered by urgency. Counts cover every loaded request, before filters. */
function RequestSummary({ counts }: { counts: SelfServiceRequestCounts }) {
	const { t } = useTranslate();
	return (
		<section
			aria-label={t("myRequests:myRequests.summary.ariaLabel", "Request summary")}
			className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4"
		>
			<SummaryCell
				label={t("myRequests:myRequests.summary.requiredFixes", "Required fixes")}
				value={counts.requiredFixes}
				tone={counts.requiredFixes > 0 ? "attention" : "default"}
			/>
			<SummaryCell
				label={t("myRequests:myRequests.status.inReview", "In review")}
				value={counts.pending}
			/>
			<SummaryCell
				label={t("myRequests:myRequests.summary.recentDecisions", "Recent decisions")}
				hint={t("myRequests:myRequests.summary.recentWindow", "Last 30 days")}
				value={counts.recentDecisions}
			/>
			<SummaryCell
				label={t("myRequests:myRequests.summary.totalLoaded", "Total loaded")}
				value={counts.total}
			/>
		</section>
	);
}

function SummaryCell({
	label,
	hint,
	value,
	tone = "default",
}: {
	label: string;
	hint?: string;
	value: number;
	tone?: "default" | "attention";
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1 bg-card p-4 md:px-5">
			<p className="flex items-center gap-1.5 text-muted-foreground text-sm">
				{tone === "attention" ? (
					<IconAlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
				) : null}
				<span className="min-w-0 truncate">{label}</span>
			</p>
			<p
				className={cn(
					"font-semibold text-2xl tabular-nums",
					tone === "attention" && "text-destructive",
				)}
			>
				{value}
			</p>
			{hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
		</div>
	);
}

function RequestFilters({ filters }: { filters: ReturnType<typeof useMyRequestsFilters> }) {
	const { t } = useTranslate();
	const searchId = useId();
	const {
		statusFilter,
		setStatusFilter,
		sourceTypeFilter,
		setSourceTypeFilter,
		search,
		setSearch,
		isFiltered,
		clearFilters,
		filteredItems,
		totalCount,
	} = filters;
	return (
		<section
			aria-label={t("myRequests:myRequests.filters.title", "Find requests")}
			className="flex flex-col gap-2"
		>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_auto] lg:items-end">
				<label
					htmlFor={searchId}
					className="grid gap-1.5 font-medium text-sm sm:col-span-2 lg:col-span-1"
				>
					{t("myRequests:myRequests.filters.search", "Search")}
					<span className="relative block">
						<IconSearch
							className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							id={searchId}
							name="request-search"
							type="search"
							autoComplete="off"
							className="pl-9"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder={t(
								"myRequests:myRequests.filters.searchRequestsPlaceholder",
								"Title, dates, amount or reason…",
							)}
						/>
					</span>
				</label>
				<label className="grid gap-1.5 font-medium text-sm">
					{t("myRequests:myRequests.filters.status", "Status")}
					<select
						className={selectClassName}
						value={statusFilter}
						onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
					>
						<option value="all">
							{t("myRequests:myRequests.filters.allStatuses", "All statuses")}
						</option>
						{STATUS_OPTIONS.map((status) => (
							<option key={status} value={status}>
								{statusLabel(status, t)}
							</option>
						))}
					</select>
				</label>
				<label className="grid gap-1.5 font-medium text-sm">
					{t("myRequests:myRequests.filters.type", "Type")}
					<select
						className={selectClassName}
						value={sourceTypeFilter}
						onChange={(event) => setSourceTypeFilter(event.target.value as SourceTypeFilter)}
					>
						<option value="all">
							{t("myRequests:myRequests.filters.allTypes", "All types")}
						</option>
						{SOURCE_TYPE_OPTIONS.map((sourceType) => (
							<option key={sourceType} value={sourceType}>
								{sourceTypeLabel(sourceType, t)}
							</option>
						))}
					</select>
				</label>
				{isFiltered ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="justify-self-start lg:mb-0.5"
						onClick={clearFilters}
					>
						<IconX aria-hidden="true" />
						{t("table.clearFilters", "Clear filters")}
					</Button>
				) : null}
			</div>
			<p className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
				{isFiltered
					? t(
							"myRequests:myRequests.filters.resultCount",
							"Showing {visible} of {total} requests",
							{ visible: filteredItems.length, total: totalCount },
						)
					: null}
			</p>
		</section>
	);
}

function SectionHeading({
	id,
	title,
	count,
	description,
	tone = "default",
}: {
	id: string;
	title: string;
	count: number;
	description?: string;
	tone?: "default" | "attention";
}) {
	return (
		<div className="mb-3 space-y-1">
			<div className="flex items-center gap-2">
				{tone === "attention" ? (
					<IconAlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden="true" />
				) : null}
				<h2 id={id} className="font-semibold text-lg">
					{title}
				</h2>
				<span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs tabular-nums">
					{count}
				</span>
			</div>
			{description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
		</div>
	);
}

function RequestSection({
	title,
	description,
	items,
	timeZone,
	allowCancel = true,
	preferFix = false,
	tone = "default",
	focusTargets = false,
}: {
	title: string;
	description?: string;
	items: SelfServiceRequestItem[];
	/** The viewer's effective time zone, in which request instants are read. */
	timeZone: string;
	allowCancel?: boolean;
	preferFix?: boolean;
	tone?: "default" | "attention";
	/** Whether a period blocker link can focus this section's cards (one section only: ids are unique). */
	focusTargets?: boolean;
}) {
	const titleId = useId();

	if (items.length === 0) {
		return null;
	}

	return (
		<section aria-labelledby={titleId}>
			<SectionHeading
				id={titleId}
				title={title}
				count={items.length}
				description={description}
				tone={tone}
			/>
			<div
				className={cn(
					"divide-y overflow-hidden rounded-xl border bg-card",
					tone === "attention" && "border-destructive/40",
				)}
			>
				{items.map((item) => (
					<RequestCard
						key={item.id}
						item={item}
						timeZone={timeZone}
						allowCancel={allowCancel}
						preferFix={preferFix}
						targetId={focusTargets ? myRequestFocusTargetId(item.id) : undefined}
					/>
				))}
			</div>
		</section>
	);
}

function RequestTypeIcon({ sourceType }: { sourceType: SelfServiceRequestSourceType }) {
	const Icon = sourceTypeIcons[sourceType];
	return (
		<span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground sm:flex">
			<Icon className="size-[1.125rem]" aria-hidden="true" />
		</span>
	);
}

function RequestCard({
	item,
	timeZone,
	allowCancel = true,
	preferFix = false,
	targetId,
}: {
	item: SelfServiceRequestItem;
	timeZone: string;
	allowCancel?: boolean;
	preferFix?: boolean;
	targetId?: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const titleId = useId();
	const title = requestTitle(item, t);
	const subtitle = requestSubtitle(item, locale, t);

	return (
		<article
			id={targetId}
			aria-labelledby={titleId}
			tabIndex={targetId ? -1 : undefined}
			className="scroll-mt-24 p-4 outline-none focus:ring-2 focus:ring-ring focus:ring-inset md:px-5"
		>
			<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-6">
				<div className="flex min-w-0 gap-3">
					<RequestTypeIcon sourceType={item.sourceType} />
					<div className="min-w-0 flex-1 space-y-1">
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
							<h3 id={titleId} className="break-words font-medium text-base leading-snug">
								{title}
							</h3>
							<StatusBadge status={item.status} />
						</div>
						<p className="break-words text-muted-foreground text-sm">{subtitle}</p>
						<div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-sm tabular-nums">
							<span>{sourceTypeLabel(item.sourceType, t)}</span>
							<span>
								{t("myRequests:myRequests.card.submitted", "Submitted")}:{" "}
								{formatDate(item.submittedAt, locale, timeZone)}
							</span>
							{item.resolvedAt ? (
								<span>
									<ResolvedAtLabel item={item} />: {formatDate(item.resolvedAt, locale, timeZone)}
								</span>
							) : null}
						</div>
						{item.decisionReason ? (
							<p
								className={cn(
									"mt-2 break-words rounded-md border-l-2 bg-muted/50 px-3 py-2 text-sm",
									item.status === "rejected" || item.status === "returned"
										? "border-destructive"
										: "border-border",
								)}
							>
								<span className="font-medium">
									{item.status === "returned"
										? t("myRequests:myRequests.returnNoteLabel", "Reviewer's note")
										: t("myRequests:myRequests.reasonLabel", "Reason")}
									:
								</span>{" "}
								{item.decisionReason}
							</p>
						) : null}
					</div>
				</div>
				<RequestAction
					item={item}
					title={title}
					subtitle={subtitle}
					titleId={titleId}
					allowCancel={allowCancel}
					preferFix={preferFix}
				/>
			</div>
		</article>
	);
}

/**
 * What a request's `resolvedAt` marks: a decision, or for a returned report the return, which
 * hands it back to the employee to fix rather than deciding it.
 */
function ResolvedAtLabel({ item }: { item: SelfServiceRequestItem }) {
	const { t } = useTranslate();
	return item.status === "returned"
		? t("myRequests:myRequests.card.returned", "Returned")
		: t("myRequests:myRequests.card.decision", "Decision");
}

/** Every loaded request once, as an aligned record table; it opens records but never cancels them. */
function RequestHistory({
	items,
	timeZone,
}: {
	items: SelfServiceRequestItem[];
	timeZone: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const titleId = useId();

	return (
		<section aria-labelledby={titleId}>
			<SectionHeading
				id={titleId}
				title={t("myRequests:myRequests.all.title", "All requests")}
				count={items.length}
			/>
			<div className="overflow-hidden rounded-xl border bg-card">
				<Table mobileLayout="stacked" aria-labelledby={titleId}>
					<TableHeader className="bg-muted/40">
						<TableRow className="hover:bg-transparent">
							<TableHead className="pl-4 md:pl-5">
								{t("myRequests:myRequests.history.request", "Request")}
							</TableHead>
							<TableHead>{t("myRequests:myRequests.filters.type", "Type")}</TableHead>
							<TableHead>{t("myRequests:myRequests.filters.status", "Status")}</TableHead>
							<TableHead>{t("myRequests:myRequests.card.submitted", "Submitted")}</TableHead>
							<TableHead>{t("myRequests:myRequests.card.decision", "Decision")}</TableHead>
							<TableHead className="pr-4 text-right md:pr-5">
								<span className="sr-only">{t("common.actions", "Actions")}</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{items.map((item) => (
							<RequestHistoryRow key={item.id} item={item} locale={locale} timeZone={timeZone} />
						))}
					</TableBody>
				</Table>
			</div>
		</section>
	);
}

function RequestHistoryRow({
	item,
	locale,
	timeZone,
}: {
	item: SelfServiceRequestItem;
	locale: string;
	timeZone: string;
}) {
	const { t } = useTranslate();
	const titleId = useId();
	const primaryAction = getPrimaryRequestAction(item, false);

	return (
		<TableRow>
			<TableCell className="max-w-0 whitespace-normal py-3 pl-4 md:w-[40%] md:pl-5">
				<div id={titleId} className="break-words font-medium">
					{requestTitle(item, t)}
				</div>
				<div className="break-words text-muted-foreground text-sm">
					{requestSubtitle(item, locale, t)}
				</div>
			</TableCell>
			<TableCell className="text-muted-foreground">{sourceTypeLabel(item.sourceType, t)}</TableCell>
			<TableCell>
				<StatusBadge status={item.status} />
			</TableCell>
			<TableCell className="tabular-nums">
				{formatDate(item.submittedAt, locale, timeZone)}
			</TableCell>
			<TableCell className="text-muted-foreground tabular-nums">
				{item.resolvedAt === null ? (
					"—"
				) : item.status === "returned" ? (
					<>
						<ResolvedAtLabel item={item} />: {formatDate(item.resolvedAt, locale, timeZone)}
					</>
				) : (
					formatDate(item.resolvedAt, locale, timeZone)
				)}
			</TableCell>
			<TableCell className="pr-4 sm:text-right md:pr-5">
				{primaryAction ? (
					<Button asChild size="sm" variant={primaryAction === "fix" ? "default" : "ghost"}>
						<Link href={item.sourceHref} aria-describedby={titleId}>
							{primaryAction === "fix"
								? t("myRequests:myRequests.actions.fix", "Fix")
								: t("myRequests:myRequests.actions.view", "View")}
						</Link>
					</Button>
				) : null}
			</TableCell>
		</TableRow>
	);
}

const statusBadgeStyles: Record<SelfServiceRequestStatus, { className: string; Icon: TablerIcon }> = {
	pending: {
		className:
			"border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
		Icon: IconClock,
	},
	approved: {
		className:
			"border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
		Icon: IconCheck,
	},
	returned: {
		className:
			"border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-200",
		Icon: IconArrowBackUp,
	},
	rejected: {
		className: "border-destructive/30 bg-destructive/10 text-destructive dark:bg-destructive/20",
		Icon: IconX,
	},
	expired: {
		className: "text-muted-foreground",
		Icon: IconHourglassEmpty,
	},
	cancelled: {
		className: "text-muted-foreground",
		Icon: IconBan,
	},
};

function StatusBadge({ status }: { status: SelfServiceRequestStatus }) {
	const { t } = useTranslate();
	const { className, Icon } = statusBadgeStyles[status];

	return (
		<Badge variant="outline" className={className}>
			<Icon aria-hidden="true" />
			{statusLabel(status, t)}
		</Badge>
	);
}

function getPrimaryRequestAction(item: SelfServiceRequestItem, preferFix: boolean) {
	const canFix = item.availableActions.includes("fix");
	if (preferFix && canFix) return "fix";
	if (item.availableActions.includes("view")) return "view";
	return canFix ? "fix" : null;
}

function RequestAction({
	item,
	title,
	subtitle,
	titleId,
	allowCancel = true,
	preferFix = false,
}: {
	item: SelfServiceRequestItem;
	title: string;
	subtitle: string;
	titleId: string;
	allowCancel?: boolean;
	preferFix?: boolean;
}) {
	const { t } = useTranslate();
	const [isCancelPending, startCancelTransition] = useTransition();
	const [cancelError, setCancelError] = useState<string | null>(null);
	const invalidateReadiness = useInvalidatePeriodSubmissionReadiness();
	const canCancel =
		allowCancel &&
		(item.sourceType === "absence" || item.sourceType === "time_correction") &&
		item.availableActions.includes("cancel");
	const primaryAction = getPrimaryRequestAction(item, preferFix);
	const primaryActionLabel =
		primaryAction === "fix"
			? t("myRequests:myRequests.actions.fix", "Fix")
			: primaryAction === "view"
				? t("myRequests:myRequests.actions.view", "View")
				: null;

	if (!primaryActionLabel && !canCancel) {
		return null;
	}

	function handleCancel() {
		setCancelError(null);
		startCancelTransition(async () => {
			try {
				const result =
					item.sourceType === "time_correction"
						? await cancelMyTimeCorrectionRequest(item.sourceId)
						: await cancelMyAbsenceRequest(item.sourceId);
				if (result.success) {
					setCancelError(null);
					toast.success(t("myRequests:myRequests.actions.cancelled", "Request cancelled"));
					// A pending request keeps its submission period open (#1350).
					void invalidateReadiness();
					return;
				}

				setCancelError(
					result.error ??
						t(
							"myRequests:myRequests.actions.cancelRequestError",
							"Request could not be cancelled.",
						),
				);
			} catch {
				setCancelError(
					t("myRequests:myRequests.actions.cancelRequestError", "Request could not be cancelled."),
				);
			}
		});
	}

	return (
		<div className="grid gap-2 md:justify-items-end">
			<div className="flex flex-wrap gap-2 md:justify-end">
				{canCancel ? (
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="text-destructive hover:bg-destructive/10 hover:text-destructive"
								disabled={isCancelPending}
								aria-describedby={titleId}
							>
								{isCancelPending
									? t("myRequests:myRequests.actions.cancelling", "Cancelling…")
									: t("myRequests:myRequests.actions.cancelRequest", "Cancel request")}
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>
									{t(
										"myRequests:myRequests.actions.cancelRequestConfirmation",
										"Cancel this request?",
									)}
								</AlertDialogTitle>
								<AlertDialogDescription>
									{t(
										"myRequests:myRequests.actions.cancelRequestDescription",
										"It is withdrawn from review and can't be reopened. To ask again, submit a new request.",
									)}
								</AlertDialogDescription>
							</AlertDialogHeader>
							<div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
								<p className="break-words font-medium">{title}</p>
								<p className="break-words text-muted-foreground">{subtitle}</p>
							</div>
							<AlertDialogFooter>
								<AlertDialogCancel>
									{t("myRequests:myRequests.actions.keepRequest", "Keep request")}
								</AlertDialogCancel>
								<AlertDialogAction
									className={buttonVariants({ variant: "destructive" })}
									onClick={handleCancel}
								>
									{t("myRequests:myRequests.actions.cancelRequest", "Cancel request")}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				) : null}
				{primaryActionLabel ? (
					<Button asChild size="sm" variant={primaryAction === "fix" ? "default" : "outline"}>
						<Link href={item.sourceHref} aria-describedby={titleId}>
							{primaryActionLabel}
						</Link>
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

/**
 * Shown when a period blocker link's request is not pending among the loaded requests: decided,
 * cancelled, older than what is loaded, or not the employee's at all. It says nothing about which,
 * and re-checks period readiness so the blocker does not stay misleadingly actionable.
 */
function FocusedRequestUnavailable() {
	const { t } = useTranslate();
	const invalidateReadiness = useInvalidatePeriodSubmissionReadiness();

	useEffect(() => {
		void invalidateReadiness();
	}, [invalidateReadiness]);

	return (
		<ArrivalNotice>
			{t(
				"myRequests:myRequests.focus.unavailable",
				"This request is no longer pending, or it can't be shown here. Period readiness is being checked again.",
			)}
		</ArrivalNotice>
	);
}

function EmptyState({
	title,
	description,
	action,
}: {
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
			<div className="space-y-1">
				<p className="font-medium">{title}</p>
				<p className="text-muted-foreground text-sm">{description}</p>
			</div>
			{action}
		</div>
	);
}
