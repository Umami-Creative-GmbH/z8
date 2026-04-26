"use client";

import { IconCalendarOff, IconCheck, IconClock, IconLoader2, IconUsers } from "@tabler/icons-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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

type BottleneckListRow = Pick<
	ApprovalBottleneckRow,
	"id" | "label" | "pendingCount" | "pendingSlaWarnings" | "avgDecisionTimeHours" | "approvalRate"
>;

export default function AnalyticsOverviewPage() {
	const [dateRange, setDateRange] = useState<DateRange>(() =>
		getDateRangeForPreset("current_month"),
	);
	const [analyticsData, setAnalyticsData] = useState<AnalyticsPageData>({
		loading: true,
		teamData: null,
		absenceData: null,
		managerData: null,
		managerDataUnavailable: false,
	});
	const { loading, teamData, absenceData, managerData, managerDataUnavailable } = analyticsData;

	useEffect(() => {
		let canceled = false;

		setAnalyticsData((current) => ({ ...current, loading: true }));
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
					console.error("Failed to load analytics data:", failedResults);
					toast.error("Failed to load analytics data");
				}

				setAnalyticsData({
					loading: false,
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

				console.error("Failed to load analytics data:", error);
				setAnalyticsData({
					loading: false,
					teamData: null,
					absenceData: null,
					managerData: null,
					managerDataUnavailable: true,
				});
				toast.error("Failed to load analytics data");
			});

		return () => {
			canceled = true;
		};
	}, [dateRange]);

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
			{/* Controls */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<DateRangePicker value={dateRange} onChange={setDateRange} />
				<ExportButton
					data={{
						data: teamData?.teams || [],
						headers: [
							{ key: "teamName", label: "Team" },
							{ key: "totalHours", label: "Total Hours" },
							{ key: "employeeCount", label: "Employees" },
						],
						filename: `analytics-overview-${dateRange.start.toISOString().split("T")[0]}`,
					}}
					disabled={!teamData}
				/>
			</div>

			{/* Loading State */}
			{loading && (
				<div
					className="flex items-center justify-center py-12"
					role="status"
					aria-label="Loading analytics data"
				>
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
				</div>
			)}

			{/* KPI Cards */}
			{!loading && (
				<>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Total Employees</CardTitle>
								<IconUsers className="size-4 text-muted-foreground" aria-hidden="true" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{kpiData.totalEmployees}</div>
								<p className="text-xs text-muted-foreground">Active employees in organization</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Avg Work Hours</CardTitle>
								<IconClock className="size-4 text-muted-foreground" aria-hidden="true" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{kpiData.avgWorkHours.toFixed(1)}h</div>
								<p className="text-xs text-muted-foreground">Per employee in selected period</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Total Absence Days</CardTitle>
								<IconCalendarOff className="size-4 text-muted-foreground" aria-hidden="true" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{kpiData.absenceRate.toFixed(0)}</div>
								<p className="text-xs text-muted-foreground">Total days in selected period</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Approval Rate</CardTitle>
								<IconCheck className="size-4 text-muted-foreground" aria-hidden="true" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">
									{kpiData.approvalRate === null
										? "Unavailable"
										: `${kpiData.approvalRate.toFixed(1)}%`}
								</div>
								<p className="text-xs text-muted-foreground">
									{managerDataUnavailable
										? "Approval analytics could not be loaded"
										: "Of decided requests approved"}
								</p>
							</CardContent>
						</Card>
					</div>

					{/* Charts */}
					<div className="grid gap-4 md:grid-cols-2">
						<Card>
							<CardHeader>
								<CardTitle>Work Hours by Team</CardTitle>
								<CardDescription>Total work hours logged per team</CardDescription>
							</CardHeader>
							<CardContent>
								{workHoursChartData.length > 0 ? (
									<ChartContainer
										config={{
											hours: {
												label: "Hours",
												color: "hsl(var(--primary))",
											},
										}}
										className="h-[300px]"
									>
										<BarChart data={workHoursChartData}>
											<CartesianGrid strokeDasharray="3 3" />
											<XAxis dataKey="team" tickLine={false} tickMargin={10} axisLine={false} />
											<YAxis tickLine={false} axisLine={false} />
											<ChartTooltip content={<ChartTooltipContent />} />
											<Bar dataKey="hours" fill="var(--color-hours)" radius={4} />
										</BarChart>
									</ChartContainer>
								) : (
									<div className="h-[300px] flex items-center justify-center text-muted-foreground">
										No data available
									</div>
								)}
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle>Absence Patterns</CardTitle>
								<CardDescription>Absence distribution by category</CardDescription>
							</CardHeader>
							<CardContent>
								{absencePatternsChartData.length > 0 ? (
									<ChartContainer
										config={{
											days: {
												label: "Days",
												color: "hsl(var(--destructive))",
											},
										}}
										className="h-[300px]"
									>
										<BarChart data={absencePatternsChartData}>
											<CartesianGrid strokeDasharray="3 3" />
											<XAxis dataKey="category" tickLine={false} tickMargin={10} axisLine={false} />
											<YAxis tickLine={false} axisLine={false} />
											<ChartTooltip content={<ChartTooltipContent />} />
											<Bar dataKey="days" fill="var(--color-days)" radius={4} />
										</BarChart>
									</ChartContainer>
								) : (
									<div className="h-[300px] flex items-center justify-center text-muted-foreground">
										No data available
									</div>
								)}
							</CardContent>
						</Card>
					</div>

					<Card>
						<CardHeader>
							<CardTitle>Approval Bottlenecks</CardTitle>
							<CardDescription>
								Teams and request types with pending work or SLA warnings
							</CardDescription>
						</CardHeader>
						<CardContent>
							{managerDataUnavailable ? (
								<p className="text-sm text-muted-foreground">
									Approval bottlenecks could not be loaded
								</p>
							) : hasApprovalBottlenecks ? (
								<div className="grid gap-6 md:grid-cols-3">
									{managerBottleneckRows.length ? (
										<BottleneckList title="By Manager" rows={managerBottleneckRows} />
									) : null}
									{managerData?.byTeam.length ? (
										<BottleneckList title="By Team" rows={managerData.byTeam} />
									) : null}
									{managerData?.byType.length ? (
										<BottleneckList title="By Type" rows={managerData.byType} />
									) : null}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">No approval bottlenecks found</p>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}

function BottleneckList({ title, rows }: { title: string; rows: BottleneckListRow[] }) {
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
								{row.pendingCount} pending - {row.pendingSlaWarnings} SLA warnings
							</p>
						</div>
						<div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
							<p>{row.approvalRate.toFixed(1)}% approved</p>
							<p>{row.avgDecisionTimeHours.toFixed(1)}h avg decision</p>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
