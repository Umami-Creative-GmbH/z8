"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { AnalyticsDateRangePicker } from "@/components/analytics/date-range-picker";
import { DataTableToolbar } from "@/components/data-table-server/data-table-toolbar";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAnalyticsDateRangeForPreset } from "@/lib/analytics/date-ranges";
import type {
	ApprovalBottleneckRow,
	DateRange,
	ManagerEffectivenessData,
} from "@/lib/analytics/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { getManagerEffectivenessData } from "./actions";

type BottleneckPageData = {
	loading: boolean;
	refreshing: boolean;
	range: DateRange | null;
	managerData: ManagerEffectivenessData | null;
	failed: boolean;
};

type BottleneckPageAction =
	| { type: "loading"; background: boolean }
	| {
			type: "loaded";
			range: DateRange;
			managerData: ManagerEffectivenessData | null;
			failed: boolean;
			background: boolean;
			refused: boolean;
	  };

const initialBottleneckData: BottleneckPageData = {
	loading: true,
	refreshing: false,
	range: null,
	managerData: null,
	failed: false,
};

function bottleneckDataReducer(
	state: BottleneckPageData,
	action: BottleneckPageAction,
): BottleneckPageData {
	if (action.type === "loading")
		return {
			...state,
			loading: !action.background,
			refreshing: action.background,
		};
	// Retain usable same-period results only for temporary background failures.
	// Explicit loss of authority invalidates every previously admitted dataset.
	const keep =
		action.background &&
		!action.refused &&
		state.range &&
		areDateRangesEqual(state.range, action.range);
	return {
		loading: false,
		refreshing: false,
		range: action.range,
		failed: action.failed,
		managerData: action.refused ? null : (action.managerData ?? (keep ? state.managerData : null)),
	};
}

type BottleneckListRow = Pick<
	ApprovalBottleneckRow,
	"id" | "label" | "pendingCount" | "pendingSlaWarnings" | "avgDecisionTimeHours" | "approvalRate"
>;

type AnalyticsTranslate = ReturnType<typeof useTranslate>["t"];

function formatMetric(value: number, decimals: number, locale: string) {
	// Preserve existing report rounding, then localize presentation only.
	return Number(value.toFixed(decimals)).toLocaleString(locale, {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
		useGrouping: false,
	});
}

function areDateRangesEqual(left: DateRange, right: DateRange) {
	return (
		left.start.getTime() === right.start.getTime() && left.end.getTime() === right.end.getTime()
	);
}

export function AnalyticsOverviewBottlenecks() {
	const organizationId = useOrganizationSettings((state) => state.organizationId);
	// Organization changes are a security boundary, unlike an in-place data refresh.
	return <BottlenecksSection key={organizationId ?? "pending"} />;
}

function BottlenecksSection() {
	const { t } = useTranslate();
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const hasUserChangedRange = useRef(false);
	const [dateRange, setDateRange] = useState<DateRange | null>(null);
	const [state, dispatch] = useReducer(bottleneckDataReducer, initialBottleneckData);
	const currentRange = Boolean(
		dateRange && state.range && areDateRangesEqual(dateRange, state.range),
	);
	const loading = state.loading || !currentRange;
	const { managerData } = currentRange ? state : initialBottleneckData;
	const managerDataUnavailable = !managerData;
	const { refreshing, failed } = state;
	const loadAnalyticsError = t(
		"analytics.overview.errors.loadData",
		"Failed to load analytics data",
	);

	useEffect(() => {
		if (!isHydrated || hasUserChangedRange.current) {
			return;
		}

		const nextDateRange = getAnalyticsDateRangeForPreset("current_month", {
			timezone,
		});
		setDateRange((currentDateRange) =>
			currentDateRange && areDateRangesEqual(currentDateRange, nextDateRange)
				? currentDateRange
				: nextDateRange,
		);
	}, [isHydrated, timezone]);

	const handleDateRangeChange = (range: DateRange) => {
		hasUserChangedRange.current = true;
		setDateRange(range);
	};

	const refreshGeneration = useRef(0);
	const runBottlenecksLoad = useCallback(
		async (background = false) => {
			if (!isHydrated || !dateRange) {
				return;
			}

			const expectedDefaultDateRange = getAnalyticsDateRangeForPreset("current_month", {
				timezone,
			});
			if (
				!hasUserChangedRange.current &&
				!areDateRangesEqual(dateRange, expectedDefaultDateRange)
			) {
				return;
			}

			const generation = ++refreshGeneration.current;
			const isLatest = () => generation === refreshGeneration.current;

			dispatch({ type: "loading", background });
			const [managerResult] = await Promise.allSettled([getManagerEffectivenessData(dateRange)]);
			if (!isLatest()) return;

			const loadFailed = managerResult.status === "rejected" || !managerResult.value.success;
			const refused =
				managerResult.status === "fulfilled" &&
				!managerResult.value.success &&
				["AuthenticationError", "AuthorizationError", "NotFoundError", "BillingError"].includes(
					managerResult.value.code ?? "",
				);
			if (loadFailed) toast.error(loadAnalyticsError);
			dispatch({
				type: "loaded",
				range: dateRange,
				background,
				refused,
				failed: loadFailed,
				managerData:
					managerResult.status === "fulfilled" && managerResult.value.success
						? managerResult.value.data
						: null,
			});
		},
		[dateRange, isHydrated, loadAnalyticsError, timezone],
	);
	useViewRefresh(() => runBottlenecksLoad(true));
	useEffect(() => {
		let active = true;
		queueMicrotask(() => {
			if (active) void runBottlenecksLoad();
		});
		return () => {
			active = false;
			refreshGeneration.current += 1;
		};
	}, [runBottlenecksLoad]);

	const managerBottleneckRows =
		managerData?.byManager.map((manager) => ({
			id: manager.managerId,
			label: manager.managerName,
			pendingCount: manager.pendingCount,
			pendingSlaWarnings: manager.pendingSlaWarnings,
			avgDecisionTimeHours: manager.avgDecisionTimeHours,
			approvalRate: manager.approvalRate,
		})) ?? [];

	const hasApprovalBottlenecks = Boolean(
		managerData &&
		(managerBottleneckRows.length > 0 ||
			managerData.byTeam.length > 0 ||
			managerData.byType.length > 0),
	);

	return (
		<section aria-busy={loading || refreshing} className="min-w-0 space-y-4">
			<DataTableToolbar
				filterControls={
					dateRange ? (
						<AnalyticsDateRangePicker value={dateRange} onChange={handleDateRangeChange} />
					) : (
						<p className="text-sm text-muted-foreground">
							{t(
								"analytics.common.loadingOrganizationSettings",
								"Loading organization settings before enabling presets.",
							)}
						</p>
					)
				}
			/>

			{loading && (
				<output
					className="flex items-center justify-center py-12"
					aria-label={t("analytics.overview.loadingLabel", "Loading analytics data")}
				>
					<IconLoader2
						className="size-6 animate-spin motion-reduce:animate-none text-muted-foreground"
						aria-hidden="true"
					/>
				</output>
			)}
			{refreshing ? (
				<output className="block text-sm text-muted-foreground">
					{t("analytics.overview.refreshing", "Refreshing analytics…")}
				</output>
			) : null}
			{failed && !loading ? (
				<Alert>
					<AlertDescription className="flex flex-wrap items-center justify-between gap-3">
						<span>
							{t(
								"analytics.overview.errors.retryDescription",
								"Some analytics could not be loaded. Previously loaded values, if shown, may be out of date.",
							)}
						</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={refreshing}
							onClick={() => void runBottlenecksLoad(true)}
						>
							{t("common.retry", "Retry")}
						</Button>
					</AlertDescription>
				</Alert>
			) : null}

			{!loading && (
				<ApprovalBottlenecksCard
					managerData={managerData}
					managerDataUnavailable={managerDataUnavailable}
					managerBottleneckRows={managerBottleneckRows}
					hasApprovalBottlenecks={hasApprovalBottlenecks}
					t={t}
				/>
			)}
		</section>
	);
}

function ApprovalBottlenecksCard({
	managerData,
	managerDataUnavailable,
	managerBottleneckRows,
	hasApprovalBottlenecks,
	t,
}: {
	managerData: ManagerEffectivenessData | null;
	managerDataUnavailable: boolean;
	managerBottleneckRows: BottleneckListRow[];
	hasApprovalBottlenecks: boolean;
	t: AnalyticsTranslate;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{t("analytics.overview.approvalBottlenecks.title", "Approval Bottlenecks")}</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.overview.approvalBottlenecks.description",
						"Teams and request types with pending work or SLA warnings",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{managerDataUnavailable ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"analytics.overview.approvalBottlenecks.unavailable",
							"Approval bottlenecks could not be loaded",
						)}
					</p>
				) : hasApprovalBottlenecks ? (
					<div className="grid gap-6 md:grid-cols-3">
						{managerBottleneckRows.length ? (
							<BottleneckList
								title={t("analytics.overview.approvalBottlenecks.byManager", "By Manager")}
								rows={managerBottleneckRows}
								t={t}
							/>
						) : null}
						{managerData?.byTeam.length ? (
							<BottleneckList
								title={t("analytics.overview.approvalBottlenecks.byTeam", "By Team")}
								rows={managerData.byTeam}
								t={t}
							/>
						) : null}
						{managerData?.byType.length ? (
							<BottleneckList
								title={t("analytics.overview.approvalBottlenecks.byType", "By Type")}
								rows={managerData.byType}
								t={t}
							/>
						) : null}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						{t("analytics.overview.approvalBottlenecks.empty", "No approval bottlenecks found")}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function BottleneckList({
	title,
	rows,
	t,
}: {
	title: string;
	rows: BottleneckListRow[];
	t: AnalyticsTranslate;
}) {
	const listId = useId();
	const locale = useLocale();

	return (
		<div className="space-y-3">
			<h3 id={listId} className="text-sm font-medium">
				{title}
			</h3>
			<ul aria-labelledby={listId} className="divide-y">
				{rows.slice(0, 3).map((row) => (
					<li
						key={row.id}
						className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"
					>
						<div className="min-w-0">
							<p className="break-words font-medium">{row.label}</p>
							<p className="text-sm text-muted-foreground">
								{t(
									"analytics.overview.approvalBottlenecks.pendingSummary",
									"{pendingCount} pending - {slaWarnings} SLA warnings",
									{
										pendingCount: row.pendingCount,
										slaWarnings: row.pendingSlaWarnings,
									},
								)}
							</p>
						</div>
						<div className="text-sm tabular-nums text-muted-foreground">
							<p>
								{t("analytics.overview.approvalBottlenecks.approvedRate", "{rate}% approved", {
									rate: formatMetric(row.approvalRate, 1, locale),
								})}
							</p>
							<p>
								{t("analytics.overview.approvalBottlenecks.avgDecision", "{hours}h avg decision", {
									hours: formatMetric(row.avgDecisionTimeHours, 1, locale),
								})}
							</p>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
