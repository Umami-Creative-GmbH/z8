"use client";

import { IconCalendarOff, IconCheck, IconClock, IconLoader2, IconUsers } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { ExportButton } from "@/components/analytics/export-button";
import { DateRangePicker } from "@/components/reports/date-range-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { DateRange } from "@/lib/reports/types";
import { getAbsencePatternsData, getTeamPerformanceData } from "./actions";

export default function AnalyticsOverviewPage() {
	const [dateRange, setDateRange] = useState<DateRange>(getDateRangeForPreset("current_month"));
	const [loading, setLoading] = useState(true);
	const [teamData, setTeamData] = useState<any>(null);
	const [absenceData, setAbsenceData] = useState<any>(null);

	useEffect(() => {
		async function loadData() {
			setLoading(true);
			try {
				// Organization ID is now derived server-side from authenticated session
				const [teamResult, absenceResult] = await Promise.all([
					getTeamPerformanceData(dateRange),
					getAbsencePatternsData(dateRange),
				]);

				if (teamResult.success && teamResult.data) {
					setTeamData(teamResult.data);
				}
				if (absenceResult.success && absenceResult.data) {
					setAbsenceData(absenceResult.data);
				}
			} catch (error) {
				console.error("Failed to load analytics data:", error);
				toast.error("Failed to load analytics data");
			} finally {
				setLoading(false);
			}
		}

		loadData();
	}, [dateRange]);

	// Calculate KPIs from loaded data
	const kpiData = {
		totalEmployees:
			teamData?.teams.reduce((sum: number, team: any) => sum + team.employeeCount, 0) || 0,
		avgWorkHours: teamData?.organizationTotal
			? teamData.organizationTotal /
				(teamData.teams.reduce((sum: number, team: any) => sum + team.employeeCount, 0) || 1)
			: 0,
		absenceRate: absenceData?.overall.totalDays || 0,
		approvalRate: 95.0, // TODO: Calculate from manager effectiveness data
	};

	// Prepare chart data
	const workHoursChartData =
		teamData?.teams.map((team: any) => ({
			team: team.teamName,
			hours: team.totalHours,
		})) || [];

	const absencePatternsChartData =
		absenceData?.byCategory.map((cat: any) => ({
			category: cat.categoryName,
			days: cat.totalDays,
		})) || [];

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
				<div className="flex items-center justify-center py-12">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			)}

			{/* KPI Cards */}
			{!loading && (
				<>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Total Employees</CardTitle>
								<IconUsers className="size-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{kpiData.totalEmployees}</div>
								<p className="text-xs text-muted-foreground">Active employees in organization</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Avg Work Hours</CardTitle>
								<IconClock className="size-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{kpiData.avgWorkHours.toFixed(1)}h</div>
								<p className="text-xs text-muted-foreground">Per employee in selected period</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Total Absence Days</CardTitle>
								<IconCalendarOff className="size-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{kpiData.absenceRate.toFixed(0)}</div>
								<p className="text-xs text-muted-foreground">Total days in selected period</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Approval Rate</CardTitle>
								<IconCheck className="size-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{kpiData.approvalRate.toFixed(1)}%</div>
								<p className="text-xs text-muted-foreground">Of submitted requests approved</p>
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
				</>
			)}
		</div>
	);
}
