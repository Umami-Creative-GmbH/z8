"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useLocale } from "next-intl";
import {
	useCallback,
	useEffect,
	useId,
	useReducer,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { DataTableToolbar } from "@/components/data-table-server/data-table-toolbar";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Dynamic imports for recharts to reduce initial bundle size
const Bar = dynamic(() => import("recharts").then((mod) => mod.Bar), {
	ssr: false,
});
const BarChart = dynamic(() => import("recharts").then((mod) => mod.BarChart), {
	ssr: false,
});
const CartesianGrid = dynamic(
	() => import("recharts").then((mod) => mod.CartesianGrid),
	{
		ssr: false,
	},
);
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), {
	ssr: false,
});
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), {
	ssr: false,
});

import { AnalyticsDateRangePicker } from "@/components/analytics/date-range-picker";
import { ExportButton } from "@/components/analytics/export-button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { getAnalyticsDateRangeForPreset } from "@/lib/analytics/date-ranges";
import type {
	AbsencePatternsData,
	ApprovalBottleneckRow,
	DateRange,
	ManagerEffectivenessData,
	TeamPerformanceData,
} from "@/lib/analytics/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import {
	getAbsencePatternsData,
	getManagerEffectivenessData,
	getTeamPerformanceData,
} from "./actions";

type AnalyticsPageData = {
	loading: boolean;
	refreshing: boolean;
	range: DateRange | null;
	teamData: TeamPerformanceData | null;
	absenceData: AbsencePatternsData | null;
	managerData: ManagerEffectivenessData | null;
	failed: boolean;
};

type AnalyticsPageAction =
	| { type: "loading"; background: boolean }
	| {
			type: "loaded";
			range: DateRange;
			teamData: TeamPerformanceData | null;
			absenceData: AbsencePatternsData | null;
			managerData: ManagerEffectivenessData | null;
			failed: boolean;
			background: boolean;
			refused: boolean;
	  };

const initialAnalyticsData: AnalyticsPageData = {
	loading: true,
	refreshing: false,
	range: null,
	teamData: null,
	absenceData: null,
	managerData: null,
	failed: false,
};

function analyticsDataReducer(
	state: AnalyticsPageData,
	action: AnalyticsPageAction,
): AnalyticsPageData {
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
		teamData: action.refused
			? null
			: (action.teamData ?? (keep ? state.teamData : null)),
		absenceData: action.refused
			? null
			: (action.absenceData ?? (keep ? state.absenceData : null)),
		managerData: action.refused
			? null
			: (action.managerData ?? (keep ? state.managerData : null)),
	};
}

type BottleneckListRow = Pick<
	ApprovalBottleneckRow,
	| "id"
	| "label"
	| "pendingCount"
	| "pendingSlaWarnings"
	| "avgDecisionTimeHours"
	| "approvalRate"
>;

type AnalyticsTranslate = ReturnType<typeof useTranslate>["t"];

type AnalyticsKpiData = {
	totalEmployees: number | null;
	avgWorkHours: number | null;
	absenceRate: number | null;
	approvalRate: number | null;
};

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
		left.start.getTime() === right.start.getTime() &&
		left.end.getTime() === right.end.getTime()
	);
}

export default function AnalyticsOverviewPage() {
	const organizationId = useOrganizationSettings(
		(state) => state.organizationId,
	);
	// Organization changes are a security boundary, unlike an in-place data refresh.
	return <AnalyticsOverview key={organizationId ?? "pending"} />;
}

function AnalyticsOverview() {
	const { t } = useTranslate();
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const hasUserChangedRange = useRef(false);
	const [dateRange, setDateRange] = useState<DateRange | null>(null);
	const [analyticsData, dispatchAnalyticsData] = useReducer(
		analyticsDataReducer,
		initialAnalyticsData,
	);
	const currentRange = Boolean(
		dateRange &&
			analyticsData.range &&
			areDateRangesEqual(dateRange, analyticsData.range),
	);
	const loading = analyticsData.loading || !currentRange;
	const { teamData, absenceData, managerData } = currentRange
		? analyticsData
		: initialAnalyticsData;
	const managerDataUnavailable = !managerData;
	const { refreshing, failed } = analyticsData;
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
	const runAnalyticsLoad = useCallback(
		async (background = false) => {
			if (!isHydrated || !dateRange) {
				return;
			}

			const expectedDefaultDateRange = getAnalyticsDateRangeForPreset(
				"current_month",
				{ timezone },
			);
			if (
				!hasUserChangedRange.current &&
				!areDateRangesEqual(dateRange, expectedDefaultDateRange)
			) {
				return;
			}

			const generation = ++refreshGeneration.current;

			const isLatest = () => generation === refreshGeneration.current;

			dispatchAnalyticsData({ type: "loading", background });
			// Each action independently resolves and authorizes the active organization.
			const [teamResult, absenceResult, managerResult] =
				await Promise.allSettled([
					getTeamPerformanceData(dateRange),
					getAbsencePatternsData(dateRange),
					getManagerEffectivenessData(dateRange),
				]);
			if (!isLatest()) return;
			const results = [teamResult, absenceResult, managerResult];
			const failed = results.some(
				(result) => result.status === "rejected" || !result.value.success,
			);
			const refused = results.some(
				(result) =>
					result.status === "fulfilled" &&
					!result.value.success &&
					[
						"AuthenticationError",
						"AuthorizationError",
						"NotFoundError",
						"BillingError",
					].includes(result.value.code ?? ""),
			);
			if (failed) toast.error(loadAnalyticsError);
			dispatchAnalyticsData({
				type: "loaded",
				range: dateRange,
				background,
				refused,
				failed,
				teamData:
					teamResult.status === "fulfilled" && teamResult.value.success
						? teamResult.value.data
						: null,
				absenceData:
					absenceResult.status === "fulfilled" && absenceResult.value.success
						? absenceResult.value.data
						: null,
				managerData:
					managerResult.status === "fulfilled" && managerResult.value.success
						? managerResult.value.data
						: null,
			});
		},
		[dateRange, isHydrated, loadAnalyticsError, timezone],
	);
	useViewRefresh(() => runAnalyticsLoad(true));
	useEffect(() => {
		let active = true;
		queueMicrotask(() => {
			if (active) void runAnalyticsLoad();
		});
		return () => {
			active = false;
			refreshGeneration.current += 1;
		};
	}, [runAnalyticsLoad]);

	const {
		kpiData,
		workHoursChartData,
		absencePatternsChartData,
		managerBottleneckRows,
		hasApprovalBottlenecks,
	} = summarizeAnalytics(teamData, absenceData, managerData);

	return (
		<div
			className="min-w-0 space-y-6 px-4 lg:px-6"
			aria-busy={loading || refreshing}
		>
			<AnalyticsControls
				dateRange={dateRange}
				teamData={loading ? null : teamData}
				onDateRangeChange={handleDateRangeChange}
				t={t}
			/>

			{loading && <AnalyticsLoading t={t} />}
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
							onClick={() => void runAnalyticsLoad(true)}
						>
							{t("common.retry", "Retry")}
						</Button>
					</AlertDescription>
				</Alert>
			) : null}

			{!loading && (
				<>
					<AnalyticsKpiCards
						kpiData={kpiData}
						managerDataUnavailable={managerDataUnavailable}
						t={t}
					/>
					<AnalyticsCharts
						workHoursChartData={workHoursChartData}
						absencePatternsChartData={absencePatternsChartData}
						teamUnavailable={!teamData}
						absenceUnavailable={!absenceData}
						t={t}
					/>
					<ApprovalBottlenecksCard
						managerData={managerData}
						managerDataUnavailable={managerDataUnavailable}
						managerBottleneckRows={managerBottleneckRows}
						hasApprovalBottlenecks={hasApprovalBottlenecks}
						t={t}
					/>
				</>
			)}
		</div>
	);
}

function summarizeAnalytics(
	teamData: TeamPerformanceData | null,
	absenceData: AbsencePatternsData | null,
	managerData: ManagerEffectivenessData | null,
) {
	// Calculate KPIs from loaded data
	const kpiData = {
		totalEmployees: teamData
			? teamData.teams.reduce((sum, team) => sum + team.employeeCount, 0)
			: null,
		avgWorkHours: teamData
			? teamData.organizationTotal /
				(teamData.teams.reduce((sum, team) => sum + team.employeeCount, 0) || 1)
			: null,
		absenceRate: absenceData?.summary.totalDays ?? null,
		approvalRate: managerData?.approvalMetrics.approvalRate ?? null,
	};

	// Prepare chart data
	const workHoursChartData =
		teamData?.teams.map((team) => ({
			team: team.teamName,
			hours: team.totalHours,
		})) || [];

	const absencePatternsChartData =
		absenceData?.byType.map((cat) => ({
			category: cat.categoryName,
			days: cat.totalDays,
		})) || [];
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

	return {
		kpiData,
		workHoursChartData,
		absencePatternsChartData,
		managerBottleneckRows,
		hasApprovalBottlenecks,
	};
}

function AnalyticsControls({
	dateRange,
	teamData,
	onDateRangeChange,
	t,
}: {
	dateRange: DateRange | null;
	teamData: TeamPerformanceData | null;
	onDateRangeChange: (range: DateRange) => void;
	t: AnalyticsTranslate;
}) {
	return (
		<DataTableToolbar
			filterControls={
				dateRange ? (
					<AnalyticsDateRangePicker
						value={dateRange}
						onChange={onDateRangeChange}
					/>
				) : (
					<p className="text-sm text-muted-foreground">
						{t(
							"analytics.common.loadingOrganizationSettings",
							"Loading organization settings before enabling presets.",
						)}
					</p>
				)
			}
			actions={
				<ExportButton
					data={{
						data: teamData?.teams || [],
						headers: [
							{ key: "teamName", label: t("analytics.common.team", "Team") },
							{
								key: "totalHours",
								label: t("analytics.common.totalHours", "Total Hours"),
							},
							{
								key: "employeeCount",
								label: t("analytics.common.employees", "Employees"),
							},
						],
						filename: `analytics-overview-${dateRange?.start.toISOString().split("T")[0] ?? "pending"}`,
					}}
					disabled={!teamData || !dateRange}
				/>
			}
		/>
	);
}

function AnalyticsLoading({ t }: { t: AnalyticsTranslate }) {
	return (
		<output
			className="flex items-center justify-center py-12"
			aria-label={t(
				"analytics.overview.loadingLabel",
				"Loading analytics data",
			)}
		>
			<IconLoader2
				className="size-6 animate-spin motion-reduce:animate-none text-muted-foreground"
				aria-hidden="true"
			/>
		</output>
	);
}

function AnalyticsKpiCards({
	kpiData,
	managerDataUnavailable,
	t,
}: {
	kpiData: AnalyticsKpiData;
	managerDataUnavailable: boolean;
	t: AnalyticsTranslate;
}) {
	const locale = useLocale();
	return (
		<dl className="grid grid-cols-2 rounded-xl border bg-card text-card-foreground lg:grid-cols-4">
			<KpiCard
				title={t(
					"analytics.overview.kpis.totalEmployees.title",
					"Total Employees",
				)}
				value={
					kpiData.totalEmployees === null
						? t("analytics.common.unavailable", "Unavailable")
						: formatMetric(kpiData.totalEmployees, 0, locale)
				}
				description={t(
					"analytics.overview.kpis.totalEmployees.description",
					"Active employees in organization",
				)}
			/>
			<KpiCard
				title={t(
					"analytics.overview.kpis.avgWorkHours.title",
					"Avg Work Hours",
				)}
				value={
					kpiData.avgWorkHours === null
						? t("analytics.common.unavailable", "Unavailable")
						: `${formatMetric(kpiData.avgWorkHours, 1, locale)}h`
				}
				description={t(
					"analytics.overview.kpis.avgWorkHours.description",
					"Per employee in selected period",
				)}
			/>
			<KpiCard
				title={t(
					"analytics.overview.kpis.totalAbsenceDays.title",
					"Total Absence Days",
				)}
				value={
					kpiData.absenceRate === null
						? t("analytics.common.unavailable", "Unavailable")
						: formatMetric(kpiData.absenceRate, 0, locale)
				}
				description={t(
					"analytics.overview.kpis.totalAbsenceDays.description",
					"Total days in selected period",
				)}
			/>
			<KpiCard
				title={t("analytics.overview.kpis.approvalRate.title", "Approval Rate")}
				value={
					kpiData.approvalRate === null
						? t("analytics.common.unavailable", "Unavailable")
						: `${formatMetric(kpiData.approvalRate, 1, locale)}%`
				}
				description={
					managerDataUnavailable
						? t(
								"analytics.overview.kpis.approvalRate.unavailableDescription",
								"Approval analytics could not be loaded",
							)
						: t(
								"analytics.overview.kpis.approvalRate.description",
								"Of decided requests approved",
							)
				}
			/>
		</dl>
	);
}

function KpiCard({
	title,
	value,
	description,
}: {
	title: string;
	value: string | number;
	description: string;
}) {
	return (
		<div className="min-w-0 space-y-2 border-b p-4 odd:border-r [&:nth-child(n+3)]:border-b-0 lg:border-r lg:border-b-0 lg:p-5 lg:last:border-r-0">
			<dt className="text-sm font-medium text-muted-foreground">{title}</dt>
			<dd className="break-words text-2xl font-semibold tabular-nums tracking-tight">
				{value}
			</dd>
			<dd className="text-sm text-muted-foreground">{description}</dd>
		</div>
	);
}

function AnalyticsCharts({
	teamUnavailable,
	absenceUnavailable,
	workHoursChartData,
	absencePatternsChartData,
	t,
}: {
	teamUnavailable: boolean;
	absenceUnavailable: boolean;
	workHoursChartData: { team: string; hours: number }[];
	absencePatternsChartData: { category: string; days: number }[];
	t: AnalyticsTranslate;
}) {
	return (
		<div className="grid gap-4 md:grid-cols-2">
			<AnalyticsBarChartCard
				title={t(
					"analytics.overview.workHoursByTeam.title",
					"Work Hours by Team",
				)}
				description={t(
					"analytics.overview.workHoursByTeam.description",
					"Total work hours logged per team",
				)}
				unavailable={teamUnavailable}
				data={workHoursChartData}
				dataKey="hours"
				xAxisKey="team"
				label={t("analytics.common.hours", "Hours")}
				color="var(--primary)"
				t={t}
			/>
			<AnalyticsBarChartCard
				title={t(
					"analytics.overview.absencePatterns.title",
					"Absence Patterns",
				)}
				description={t(
					"analytics.overview.absencePatterns.description",
					"Absence distribution by category",
				)}
				unavailable={absenceUnavailable}
				data={absencePatternsChartData}
				dataKey="days"
				xAxisKey="category"
				label={t("analytics.common.days", "Days")}
				color="var(--chart-2)"
				t={t}
			/>
		</div>
	);
}

function AnalyticsBarChartCard({
	unavailable,
	title,
	description,
	data,
	dataKey,
	xAxisKey,
	label,
	color,
	t,
}: {
	title: string;
	description: string;
	unavailable: boolean;
	data: Record<string, string | number>[];
	dataKey: string;
	xAxisKey: string;
	label: string;
	color: string;
	t: AnalyticsTranslate;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{title}</h2>
				</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				{unavailable ? (
					<p className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
						{t(
							"analytics.overview.errors.loadData",
							"Failed to load analytics data",
						)}
					</p>
				) : data.length > 0 ? (
					<ChartContainer
						config={{ [dataKey]: { label, color } }}
						className="h-72 w-full min-w-0"
					>
						<BarChart data={data}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis
								dataKey={xAxisKey}
								tickLine={false}
								tickMargin={10}
								axisLine={false}
							/>
							<YAxis tickLine={false} axisLine={false} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Bar
								dataKey={dataKey}
								fill={`var(--color-${dataKey})`}
								radius={4}
							/>
						</BarChart>
					</ChartContainer>
				) : (
					<div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
						{t("analytics.common.noDataAvailable", "No data available")}
					</div>
				)}
				{!unavailable && data.length > 0 ? (
					<details className="mt-4 text-sm">
						<summary className="cursor-pointer rounded-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
							{t("analytics.overview.chartValues", "View chart values")}
						</summary>
						<dl className="mt-3 divide-y">
							{data.map((row) => (
								<div
									key={row[xAxisKey]}
									className="flex flex-wrap justify-between gap-2 py-2"
								>
									<dt className="break-words">{row[xAxisKey]}</dt>
									<dd className="tabular-nums">
										{row[dataKey]} {label}
									</dd>
								</div>
							))}
						</dl>
					</details>
				) : null}
			</CardContent>
		</Card>
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
					<h2>
						{t(
							"analytics.overview.approvalBottlenecks.title",
							"Approval Bottlenecks",
						)}
					</h2>
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
								title={t(
									"analytics.overview.approvalBottlenecks.byManager",
									"By Manager",
								)}
								rows={managerBottleneckRows}
								t={t}
							/>
						) : null}
						{managerData?.byTeam.length ? (
							<BottleneckList
								title={t(
									"analytics.overview.approvalBottlenecks.byTeam",
									"By Team",
								)}
								rows={managerData.byTeam}
								t={t}
							/>
						) : null}
						{managerData?.byType.length ? (
							<BottleneckList
								title={t(
									"analytics.overview.approvalBottlenecks.byType",
									"By Type",
								)}
								rows={managerData.byType}
								t={t}
							/>
						) : null}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						{t(
							"analytics.overview.approvalBottlenecks.empty",
							"No approval bottlenecks found",
						)}
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
								{t(
									"analytics.overview.approvalBottlenecks.approvedRate",
									"{rate}% approved",
									{
										rate: formatMetric(row.approvalRate, 1, locale),
									},
								)}
							</p>
							<p>
								{t(
									"analytics.overview.approvalBottlenecks.avgDecision",
									"{hours}h avg decision",
									{
										hours: formatMetric(row.avgDecisionTimeHours, 1, locale),
									},
								)}
							</p>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
