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
import { getWorkHoursAnalyticsData } from "../actions";
import { Area, AreaChart, Line, LineChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export default function WorkHoursPage() {
	const [dateRange, setDateRange] = useState<DateRange>(
		getDateRangeForPreset("current_month")
	);
	const [loading, setLoading] = useState(true);
	const [workHoursData, setWorkHoursData] = useState<any>(null);

	useEffect(() => {
		async function loadData() {
			setLoading(true);
			try {
				const orgId = "placeholder-org-id"; // TODO: Get from auth context
				const result = await getWorkHoursAnalyticsData(orgId, dateRange);

				if (result.success && result.data) {
					setWorkHoursData(result.data);
				}
			} catch (error) {
				console.error("Failed to load work hours analytics data:", error);
				toast.error("Failed to load work hours analytics data");
			} finally {
				setLoading(false);
			}
		}

		loadData();
	}, [dateRange]);

	const employees = workHoursData?.employees || [];

	// Prepare chart data
	const trendData = workHoursData?.overtimeTrend || [];
	const dailyHoursData = workHoursData?.dailyHours || [];
	const distributionData = employees.map((emp: any) => ({
		employee: emp.employeeName,
		hours: emp.totalHours,
	}));

	return (
		<div className="space-y-6 px-4 lg:px-6">
			{/* Controls */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<DateRangePicker value={dateRange} onChange={setDateRange} />
				<ExportButton
					data={{
						data: employees,
						headers: [
							{ key: "employeeName", label: "Employee" },
							{ key: "totalHours", label: "Total Hours" },
							{ key: "expectedHours", label: "Expected Hours" },
							{ key: "variance", label: "Variance" },
							{ key: "percentageOfExpected", label: "% of Expected" },
						],
						filename: `work-hours-${dateRange.start.toISOString().split("T")[0]}`,
					}}
					disabled={!workHoursData}
				/>
			</div>

			{loading && (
				<div className="flex items-center justify-center py-12">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			)}

			{!loading && (
				<>
					{/* Overtime/Undertime Trend */}
					<Card>
						<CardHeader>
							<CardTitle>Overtime & Undertime Trend</CardTitle>
							<CardDescription>
								Hours variance from expected work hours over time
							</CardDescription>
						</CardHeader>
						<CardContent>
							{trendData.length > 0 ? (
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
									<AreaChart data={trendData}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis
											dataKey="date"
											tickLine={false}
											tickMargin={10}
											axisLine={false}
										/>
										<YAxis tickLine={false} axisLine={false} />
										<ChartTooltip content={<ChartTooltipContent />} />
										<Area
											type="monotone"
											dataKey="overtime"
											stackId="1"
											stroke="var(--color-overtime)"
											fill="var(--color-overtime)"
											fillOpacity={0.6}
										/>
										<Area
											type="monotone"
											dataKey="undertime"
											stackId="2"
											stroke="var(--color-undertime)"
											fill="var(--color-undertime)"
											fillOpacity={0.6}
										/>
									</AreaChart>
								</ChartContainer>
							) : (
								<div className="h-[300px] flex items-center justify-center text-muted-foreground">
									No trend data available
								</div>
							)}
						</CardContent>
					</Card>

					{/* Daily Work Hours */}
					<Card>
						<CardHeader>
							<CardTitle>Daily Work Hours</CardTitle>
							<CardDescription>
								Actual vs expected work hours per day
							</CardDescription>
						</CardHeader>
						<CardContent>
							{dailyHoursData.length > 0 ? (
								<ChartContainer
									config={{
										actual: {
											label: "Actual Hours",
											color: "hsl(var(--primary))",
										},
										expected: {
											label: "Expected Hours",
											color: "hsl(var(--muted-foreground))",
										},
									}}
									className="h-[300px]"
								>
									<LineChart data={dailyHoursData}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis
											dataKey="date"
											tickLine={false}
											tickMargin={10}
											axisLine={false}
										/>
										<YAxis tickLine={false} axisLine={false} />
										<ChartTooltip content={<ChartTooltipContent />} />
										<Line
											type="monotone"
											dataKey="actual"
											stroke="var(--color-actual)"
											strokeWidth={2}
											dot={{ r: 3 }}
										/>
										<Line
											type="monotone"
											dataKey="expected"
											stroke="var(--color-expected)"
											strokeWidth={2}
											strokeDasharray="5 5"
											dot={{ r: 3 }}
										/>
									</LineChart>
								</ChartContainer>
							) : (
								<div className="h-[300px] flex items-center justify-center text-muted-foreground">
									No daily hours data available
								</div>
							)}
						</CardContent>
					</Card>

					{/* Employee Work Hours Comparison */}
					<Card>
						<CardHeader>
							<CardTitle>Employee Work Hours</CardTitle>
							<CardDescription>
								Total hours and variance from expected by employee
							</CardDescription>
						</CardHeader>
						<CardContent>
							{employees.length === 0 ? (
								<div className="flex h-[200px] items-center justify-center text-muted-foreground">
									No data available for the selected period
								</div>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Employee</TableHead>
											<TableHead className="text-right">Total Hours</TableHead>
											<TableHead className="text-right">Expected Hours</TableHead>
											<TableHead className="text-right">Variance</TableHead>
											<TableHead>Status</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{employees.map((emp: any) => (
											<TableRow key={emp.employeeId}>
												<TableCell className="font-medium">
													{emp.employeeName}
												</TableCell>
												<TableCell className="text-right">
													{emp.totalHours.toFixed(1)}h
												</TableCell>
												<TableCell className="text-right">
													{emp.expectedHours.toFixed(1)}h
												</TableCell>
												<TableCell className="text-right">
													<span
														className={
															emp.variance >= 0
																? "text-green-600"
																: "text-orange-600"
														}
													>
														{emp.variance >= 0 ? "+" : ""}
														{emp.variance.toFixed(1)}h
													</span>
												</TableCell>
												<TableCell>
													<Badge
														variant={
															emp.percentageOfExpected >= 90
																? "default"
																: emp.percentageOfExpected >= 75
																	? "secondary"
																	: "destructive"
														}
													>
														{emp.percentageOfExpected.toFixed(0)}%
													</Badge>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>

					{/* Work Hours Distribution */}
					<Card>
						<CardHeader>
							<CardTitle>Work Hours Distribution</CardTitle>
							<CardDescription>
								Employee work hours comparison (horizontal bar)
							</CardDescription>
						</CardHeader>
						<CardContent>
							{distributionData.length > 0 ? (
								<ChartContainer
									config={{
										hours: {
											label: "Hours",
											color: "hsl(var(--chart-4))",
										},
									}}
									className="h-[300px]"
								>
									<BarChart data={distributionData} layout="vertical">
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis type="number" tickLine={false} axisLine={false} />
										<YAxis
											dataKey="employee"
											type="category"
											tickLine={false}
											tickMargin={10}
											axisLine={false}
											width={120}
										/>
										<ChartTooltip content={<ChartTooltipContent />} />
										<Bar dataKey="hours" fill="var(--color-hours)" radius={4} />
									</BarChart>
								</ChartContainer>
							) : (
								<div className="h-[300px] flex items-center justify-center text-muted-foreground">
									No distribution data available
								</div>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}
