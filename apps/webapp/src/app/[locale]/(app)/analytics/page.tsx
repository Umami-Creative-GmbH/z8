"use client";

import { IconCalendarOff, IconCheck, IconClock, IconLoader2, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

// Dynamic imports for recharts to reduce initial bundle size
const Bar = dynamic(() => import("recharts").then((mod) => mod.Bar), { ssr: false });
const BarChart = dynamic(() => import("recharts").then((mod) => mod.BarChart), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), {
	ssr: false,
});
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false });

import { ExportButton } from "@/components/analytics/export-button";
import { DateRangePicker } from "@/components/reports/date-range-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type {
	AbsencePatternsData,
	ApprovalBottleneckRow,
	ManagerEffectivenessData,
	TeamPerformanceData,
} from "@/lib/analytics/types";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { DateRange } from "@/lib/reports/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import {
	getAbsencePatternsData,
	getManagerEffectivenessData,
	getTeamPerformanceData,
} from "./actions";

type AnalyticsPageData = {
	loading: boolean;
	teamData: TeamPerformanceData | null;
	absenceData: AbsencePatternsData | null;
	managerData: ManagerEffectivenessData | null;
	managerDataUnavailable: boolean;
};

type AnalyticsPageAction =
	| { type: "loading" }
	| {
			type: "loaded";
			teamData: TeamPerformanceData | null;
			absenceData: AbsencePatternsData | null;
			managerData: ManagerEffectivenessData | null;
			managerDataUnavailable: boolean;
	  }
	| { type: "failed" };

const initialAnalyticsData: AnalyticsPageData = {
	loading: true,
	teamData: null,
	absenceData: null,
	managerData: null,
	managerDataUnavailable: false,
};

function analyticsDataReducer(
	state: AnalyticsPageData,
	action: AnalyticsPageAction,
): AnalyticsPageData {
	switch (action.type) {
		case "loading":
			return { ...state, loading: true };
		case "loaded":
			return {
				loading: false,
				teamData: action.teamData,
				absenceData: action.absenceData,
				managerData: action.managerData,
				managerDataUnavailable: action.managerDataUnavailable,
			};
		case "failed":
			return {
				loading: false,
				teamData: null,
				absenceData: null,
				managerData: null,
				managerDataUnavailable: true,
			};
	}
}

type BottleneckListRow = Pick<
	ApprovalBottleneckRow,
	"id" | "label" | "pendingCount" | "pendingSlaWarnings" | "avgDecisionTimeHours" | "approvalRate"
>;

type AnalyticsTranslate = ReturnType<typeof useTranslate>["t"];

type AnalyticsKpiData = {
	totalEmployees: number;
	avgWorkHours: number;
	absenceRate: number;
	approvalRate: number | null;
};

function areDateRangesEqual(left: DateRange, right: DateRange) {
	return (
		left.start.getTime() === right.start.getTime() && left.end.getTime() === right.end.getTime()
	);
}

export default function AnalyticsOverviewPage() {
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
	const { loading, teamData, absenceData, managerData, managerDataUnavailable } = analyticsData;
	const loadAnalyticsError = t(
		"analytics.overview.errors.loadData",
		["Failed to load analytics", "data"].join(" "),
	);

	useEffect(() => {
		if (!isHydrated || hasUserChangedRange.current) {
			return;
		}

		const nextDateRange = getDateRangeForPreset("current_month", { timezone });
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

	useEffect(() => {
		if (!isHydrated || !dateRange) {
			return;
		}

		const expectedDefaultDateRange = getDateRangeForPreset("current_month", { timezone });
		if (!hasUserChangedRange.current && !areDateRangesEqual(dateRange, expectedDefaultDateRange)) {
			return;
		}

		let canceled = false;

		dispatchAnalyticsData({ type: "loading" });
		// Organization ID is now derived server-side from authenticated session
		Promise.allSettled([
			getTeamPerformanceData(dateRange),
			getAbsencePatternsData(dateRange),
			getManagerEffectivenessData(dateRange),
		])
			.then(([teamResult, absenceResult, managerResult]) => {
				if (canceled) {
					return;
				}

				const failedResults = [teamResult, absenceResult, managerResult].filter(
					(result) => result.status === "rejected" || !result.value.success,
				);
				if (failedResults.length > 0) {
					console.error(`${loadAnalyticsError}:`, failedResults);
					toast.error(loadAnalyticsError);
				}

				dispatchAnalyticsData({
					type: "loaded",
					teamData:
						teamResult.status === "fulfilled" && teamResult.value.success && teamResult.value.data
							? teamResult.value.data
							: null,
					absenceData:
						absenceResult.status === "fulfilled" &&
						absenceResult.value.success &&
						absenceResult.value.data
							? absenceResult.value.data
							: null,
					managerData:
						managerResult.status === "fulfilled" &&
						managerResult.value.success &&
						managerResult.value.data
							? managerResult.value.data
							: null,
					managerDataUnavailable: !(
						managerResult.status === "fulfilled" &&
						managerResult.value.success &&
						managerResult.value.data
					),
				});
			})
			.catch((error) => {
				if (canceled) {
					return;
				}

				console.error(`${loadAnalyticsError}:`, error);
				dispatchAnalyticsData({ type: "failed" });
				toast.error(loadAnalyticsError);
			});

		return () => {
			canceled = true;
		};
	}, [dateRange, isHydrated, loadAnalyticsError, timezone]);

	// Calculate KPIs from loaded data
	const kpiData = {
		totalEmployees: teamData?.teams.reduce((sum, team) => sum + team.employeeCount, 0) || 0,
		avgWorkHours: teamData?.organizationTotal
			? teamData.organizationTotal /
				(teamData.teams.reduce((sum, team) => sum + team.employeeCount, 0) || 1)
			: 0,
		absenceRate: absenceData?.summary.totalDays || 0,
		approvalRate: managerDataUnavailable ? null : (managerData?.approvalMetrics.approvalRate ?? 0),
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

	return (
		<div className="space-y-6 px-4 lg:px-6">
			<AnalyticsControls
				dateRange={dateRange}
				teamData={teamData}
				onDateRangeChange={handleDateRangeChange}
				t={t}
			/>

			{loading && <AnalyticsLoading t={t} />}

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
		<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			{dateRange ? (
				<DateRangePicker value={dateRange} onChange={onDateRangeChange} />
			) : (
				<p className="text-sm text-muted-foreground">
					{t(
						"analytics.common.loadingOrganizationSettings",
						"Loading organization settings before enabling presets.",
					)}
				</p>
			)}
			<ExportButton
				data={{
					data: teamData?.teams || [],
					headers: [
						{ key: "teamName", label: t("analytics.common.team", "Team") },
						{ key: "totalHours", label: t("analytics.common.totalHours", "Total Hours") },
						{ key: "employeeCount", label: t("analytics.common.employees", "Employees") },
					],
					filename: `analytics-overview-${dateRange?.start.toISOString().split("T")[0] ?? "pending"}`,
				}}
				disabled={!teamData || !dateRange}
			/>
		</div>
	);
}

function AnalyticsLoading({ t }: { t: AnalyticsTranslate }) {
	return (
		<output
			className="flex items-center justify-center py-12"
			aria-label={t("analytics.overview.loadingLabel", "Loading analytics data")}
		>
			<IconLoader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
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
	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			<KpiCard
				title={t("analytics.overview.kpis.totalEmployees.title", "Total Employees")}
				value={kpiData.totalEmployees}
				description={t(
					"analytics.overview.kpis.totalEmployees.description",
					"Active employees in organization",
				)}
				icon={<IconUsers className="size-4 text-muted-foreground" aria-hidden="true" />}
			/>
			<KpiCard
				title={t("analytics.overview.kpis.avgWorkHours.title", "Avg Work Hours")}
				value={`${kpiData.avgWorkHours.toFixed(1)}h`}
				description={t(
					"analytics.overview.kpis.avgWorkHours.description",
					"Per employee in selected period",
				)}
				icon={<IconClock className="size-4 text-muted-foreground" aria-hidden="true" />}
			/>
			<KpiCard
				title={t("analytics.overview.kpis.totalAbsenceDays.title", "Total Absence Days")}
				value={kpiData.absenceRate.toFixed(0)}
				description={t(
					"analytics.overview.kpis.totalAbsenceDays.description",
					"Total days in selected period",
				)}
				icon={<IconCalendarOff className="size-4 text-muted-foreground" aria-hidden="true" />}
			/>
			<KpiCard
				title={t("analytics.overview.kpis.approvalRate.title", "Approval Rate")}
				value={
					kpiData.approvalRate === null
						? t("analytics.common.unavailable", "Unavailable")
						: `${kpiData.approvalRate.toFixed(1)}%`
				}
				description={
					managerDataUnavailable
						? t(
								"analytics.overview.kpis.approvalRate.unavailableDescription",
								"Approval analytics could not be loaded",
							)
						: t("analytics.overview.kpis.approvalRate.description", "Of decided requests approved")
				}
				icon={<IconCheck className="size-4 text-muted-foreground" aria-hidden="true" />}
			/>
		</div>
	);
}

function KpiCard({
	title,
	value,
	description,
	icon,
}: {
	title: string;
	value: string | number;
	description: string;
	icon: ReactNode;
}) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-y-0 pb-2">
				<CardTitle className="text-sm font-medium">{title}</CardTitle>
				{icon}
			</CardHeader>
			<CardContent>
				<div className="text-2xl font-bold">{value}</div>
				<p className="text-xs text-muted-foreground">{description}</p>
			</CardContent>
		</Card>
	);
}

function AnalyticsCharts({
	workHoursChartData,
	absencePatternsChartData,
	t,
}: {
	workHoursChartData: { team: string; hours: number }[];
	absencePatternsChartData: { category: string; days: number }[];
	t: AnalyticsTranslate;
}) {
	return (
		<div className="grid gap-4 md:grid-cols-2">
			<AnalyticsBarChartCard
				title={t("analytics.overview.workHoursByTeam.title", "Work Hours by Team")}
				description={t(
					"analytics.overview.workHoursByTeam.description",
					"Total work hours logged per team",
				)}
				data={workHoursChartData}
				dataKey="hours"
				xAxisKey="team"
				label={t("analytics.common.hours", "Hours")}
				color="hsl(var(--primary))"
				t={t}
			/>
			<AnalyticsBarChartCard
				title={t("analytics.overview.absencePatterns.title", "Absence Patterns")}
				description={t(
					"analytics.overview.absencePatterns.description",
					"Absence distribution by category",
				)}
				data={absencePatternsChartData}
				dataKey="days"
				xAxisKey="category"
				label={t("analytics.common.days", "Days")}
				color="hsl(var(--destructive))"
				t={t}
			/>
		</div>
	);
}

function AnalyticsBarChartCard({
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
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				{data.length > 0 ? (
					<ChartContainer config={{ [dataKey]: { label, color } }} className="h-[300px]">
						<BarChart data={data}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} axisLine={false} />
							<YAxis tickLine={false} axisLine={false} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Bar dataKey={dataKey} fill={`var(--color-${dataKey})`} radius={4} />
						</BarChart>
					</ChartContainer>
				) : (
					<div className="h-[300px] flex items-center justify-center text-muted-foreground">
						{t("analytics.common.noDataAvailable", "No data available")}
					</div>
				)}
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
				<CardTitle>{t("analytics.overview.approvalBottlenecks.title", "Approval Bottlenecks")}</CardTitle>
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
	const listId = `approval-bottlenecks-${title.toLowerCase().replaceAll(" ", "-")}`;

	return (
		<div className="space-y-3">
			<h3 id={listId} className="text-sm font-medium">
				{title}
			</h3>
			<ul aria-labelledby={listId} className="divide-y rounded-md border">
				{rows.slice(0, 3).map((row) => (
					<li key={row.id} className="flex items-center justify-between gap-4 p-3 text-sm">
						<div className="min-w-0">
							<p className="truncate font-medium">{row.label}</p>
							<p className="text-xs text-muted-foreground">
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
						<div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
							<p>
								{t("analytics.overview.approvalBottlenecks.approvedRate", "{rate}% approved", {
									rate: row.approvalRate.toFixed(1),
								})}
							</p>
							<p>
								{t("analytics.overview.approvalBottlenecks.avgDecision", "{hours}h avg decision", {
									hours: row.avgDecisionTimeHours.toFixed(1),
								})}
							</p>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
