"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/reports/date-range-picker";
import { ExportButton } from "@/components/analytics/export-button";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { DateRange } from "@/lib/reports/types";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { getTeamPerformanceData } from "../actions";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export default function TeamPerformancePage() {
	const [dateRange, setDateRange] = useState<DateRange>(
		getDateRangeForPreset("current_month")
	);
	const [loading, setLoading] = useState(true);
	const [teamData, setTeamData] = useState<any>(null);

	useEffect(() => {
		async function loadData() {
			setLoading(true);
			try {
				// Organization ID is now derived server-side from authenticated session
				const result = await getTeamPerformanceData(dateRange);

				if (result.success && result.data) {
					setTeamData(result.data);
				}
			} catch (error) {
				console.error("Failed to load team performance data:", error);
				toast.error("Failed to load team performance data");
			} finally {
				setLoading(false);
			}
		}

		loadData();
	}, [dateRange]);

	const teams = teamData?.teams || [];

	// Prepare chart data
	const teamComparisonData = teams.map((team: any) => ({
		team: team.teamName,
		hours: team.totalHours,
	}));

	const overtimeData = teams.flatMap((team: any) =>
		team.employees.map((emp: any) => ({
			employee: emp.employeeName,
			team: team.teamName,
			overtime: emp.variance > 0 ? emp.variance : 0,
			undertime: emp.variance < 0 ? Math.abs(emp.variance) : 0,
		}))
	);

	return (
		<div className="space-y-6 px-4 lg:px-6">
			{/* Controls */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<DateRangePicker value={dateRange} onChange={setDateRange} />
				<ExportButton
					data={{
						data: teams,
						headers: [
							{ key: "teamName", label: "Team" },
							{ key: "totalHours", label: "Total Hours" },
							{ key: "avgHoursPerEmployee", label: "Avg per Employee" },
							{ key: "employeeCount", label: "Employee Count" },
						],
						filename: `team-performance-${dateRange.start.toISOString().split("T")[0]}`,
					}}
					disabled={!teamData}
				/>
			</div>

			{loading && (
				<div className="flex items-center justify-center py-12">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			)}

			{!loading && (
				<>
					{/* Team Comparison Chart */}
					<Card>
						<CardHeader>
							<CardTitle>Team Comparison</CardTitle>
							<CardDescription>
								Total work hours by team for the selected period
							</CardDescription>
						</CardHeader>
						<CardContent>
							{teamComparisonData.length > 0 ? (
								<ChartContainer
									config={{
										hours: {
											label: "Hours",
											color: "hsl(var(--primary))",
										},
									}}
									className="h-[300px]"
								>
									<BarChart data={teamComparisonData}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis
											dataKey="team"
											tickLine={false}
											tickMargin={10}
											axisLine={false}
										/>
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

			{/* Team Performance Table */}
			<Card>
				<CardHeader>
					<CardTitle>Team Performance Details</CardTitle>
					<CardDescription>
						Breakdown of work hours by team and employee
					</CardDescription>
				</CardHeader>
				<CardContent>
					{teams.length === 0 ? (
						<div className="flex h-[200px] items-center justify-center text-muted-foreground">
							No data available for the selected period
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Team</TableHead>
									<TableHead className="text-right">Total Hours</TableHead>
									<TableHead className="text-right">Avg per Employee</TableHead>
									<TableHead className="text-right">Employee Count</TableHead>
									<TableHead>Status</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{teams.map((team) => (
									<TableRow key={team.teamId}>
										<TableCell className="font-medium">{team.teamName}</TableCell>
										<TableCell className="text-right">
											{team.totalHours.toFixed(1)}h
										</TableCell>
										<TableCell className="text-right">
											{team.avgHoursPerEmployee.toFixed(1)}h
										</TableCell>
										<TableCell className="text-right">
											{team.employeeCount}
										</TableCell>
										<TableCell>
											<Badge variant="outline">On Track</Badge>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Overtime/Undertime Breakdown */}
			<Card>
				<CardHeader>
					<CardTitle>Overtime & Undertime</CardTitle>
					<CardDescription>
						Hours variance from expected work hours
					</CardDescription>
				</CardHeader>
				<CardContent>
					{overtimeData.length > 0 ? (
						<ChartContainer
							config={{
								overtime: {
									label: "Overtime",
									color: "hsl(var(--chart-1))",
								},
								undertime: {
									label: "Undertime",
									color: "hsl(var(--chart-2))",
								},
							}}
							className="h-[300px]"
						>
							<BarChart data={overtimeData}>
								<CartesianGrid strokeDasharray="3 3" />
								<XAxis
									dataKey="employee"
									tickLine={false}
									tickMargin={10}
									axisLine={false}
								/>
								<YAxis tickLine={false} axisLine={false} />
								<ChartTooltip content={<ChartTooltipContent />} />
								<Bar dataKey="overtime" fill="var(--color-overtime)" radius={4} stackId="a" />
								<Bar dataKey="undertime" fill="var(--color-undertime)" radius={4} stackId="a" />
							</BarChart>
						</ChartContainer>
					) : (
						<div className="h-[300px] flex items-center justify-center text-muted-foreground">
							No variance data available
						</div>
					)}
				</CardContent>
			</Card>
				</>
			)}
		</div>
	);
}
