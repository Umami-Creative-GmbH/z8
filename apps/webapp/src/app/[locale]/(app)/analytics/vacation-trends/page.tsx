"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { ExportButton } from "@/components/analytics/export-button";
import { DateRangePicker } from "@/components/reports/date-range-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { VacationTrendsData } from "@/lib/analytics/types";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { DateRange } from "@/lib/reports/types";
import { getVacationTrendsData } from "../actions";

export default function VacationTrendsPage() {
	const [dateRange, setDateRange] = useState<DateRange>(getDateRangeForPreset("current_year"));
	const [loading, setLoading] = useState(true);
	const [vacationData, setVacationData] = useState<VacationTrendsData | null>(null);

	useEffect(() => {
		async function loadData() {
			setLoading(true);
			try {
				// Organization ID is now derived server-side from authenticated session
				const result = await getVacationTrendsData(dateRange);

				if (result.success && result.data) {
					setVacationData(result.data);
				}
			} catch (error) {
				console.error("Failed to load vacation trends data:", error);
				toast.error("Failed to load vacation trends data");
			} finally {
				setLoading(false);
			}
		}

		loadData();
	}, [dateRange]);

	const overallData = vacationData?.overall || {
		totalDaysAllocated: 0,
		totalDaysTaken: 0,
		totalDaysRemaining: 0,
		utilizationRate: 0,
	};

	const employees = vacationData?.byEmployee || [];

	// Prepare chart data
	const monthlyUsageData = vacationData?.byMonth || [];
	const peakMonthsData = vacationData?.patterns?.peakMonths || [];

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
							{ key: "allocated", label: "Allocated" },
							{ key: "taken", label: "Taken" },
							{ key: "remaining", label: "Remaining" },
							{ key: "utilizationRate", label: "Utilization %" },
						],
						filename: `vacation-trends-${dateRange.start.toISOString().split("T")[0]}`,
					}}
					disabled={!vacationData}
				/>
			</div>

			{loading && (
				<div className="flex items-center justify-center py-12">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			)}

			{!loading && (
				<>
					{/* Overall Vacation Utilization */}
					<Card>
						<CardHeader>
							<CardTitle>Vacation Utilization</CardTitle>
							<CardDescription>Overall vacation days usage across organization</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								<div className="flex items-center justify-between">
									<div className="space-y-1">
										<p className="text-sm font-medium">Overall Utilization</p>
										<p className="text-2xl font-bold">{overallData.utilizationRate.toFixed(1)}%</p>
									</div>
									<div className="text-right text-sm text-muted-foreground">
										<p>{overallData.totalDaysTaken} days taken</p>
										<p>{overallData.totalDaysRemaining} days remaining</p>
									</div>
								</div>
								<Progress value={overallData.utilizationRate} className="h-2" />
							</div>
						</CardContent>
					</Card>

					{/* Monthly Vacation Usage */}
					<Card>
						<CardHeader>
							<CardTitle>Monthly Vacation Usage</CardTitle>
							<CardDescription>Vacation days taken per month</CardDescription>
						</CardHeader>
						<CardContent>
							{monthlyUsageData.length > 0 ? (
								<ChartContainer
									config={{
										days: {
											label: "Days",
											color: "hsl(var(--primary))",
										},
									}}
									className="h-[300px]"
								>
									<LineChart data={monthlyUsageData}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis dataKey="month" tickLine={false} tickMargin={10} axisLine={false} />
										<YAxis tickLine={false} axisLine={false} />
										<ChartTooltip content={<ChartTooltipContent />} />
										<Line
											type="monotone"
											dataKey="days"
											stroke="var(--color-days)"
											strokeWidth={2}
											dot={{ r: 4 }}
										/>
									</LineChart>
								</ChartContainer>
							) : (
								<div className="h-[300px] flex items-center justify-center text-muted-foreground">
									No monthly usage data available
								</div>
							)}
						</CardContent>
					</Card>

					{/* Vacation Balance by Employee */}
					<Card>
						<CardHeader>
							<CardTitle>Vacation Balance</CardTitle>
							<CardDescription>Days allocated, taken, and remaining by employee</CardDescription>
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
											<TableHead className="text-right">Allocated</TableHead>
											<TableHead className="text-right">Taken</TableHead>
											<TableHead className="text-right">Remaining</TableHead>
											<TableHead>Utilization</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{employees.map((emp) => (
											<TableRow key={emp.employeeId}>
												<TableCell className="font-medium">{emp.employeeName}</TableCell>
												<TableCell className="text-right">{emp.allocated}</TableCell>
												<TableCell className="text-right">{emp.taken}</TableCell>
												<TableCell className="text-right">{emp.remaining}</TableCell>
												<TableCell>
													<div className="flex items-center gap-2">
														<Progress value={emp.utilizationRate} className="h-2 w-[100px]" />
														<span className="text-sm text-muted-foreground">
															{emp.utilizationRate.toFixed(0)}%
														</span>
													</div>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>

					{/* Peak Vacation Months */}
					<Card>
						<CardHeader>
							<CardTitle>Peak Vacation Months</CardTitle>
							<CardDescription>Months with highest vacation activity</CardDescription>
						</CardHeader>
						<CardContent>
							{peakMonthsData.length > 0 ? (
								<ChartContainer
									config={{
										count: {
											label: "Vacation Days",
											color: "hsl(var(--chart-3))",
										},
									}}
									className="h-[300px]"
								>
									<BarChart data={peakMonthsData}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis dataKey="month" tickLine={false} tickMargin={10} axisLine={false} />
										<YAxis tickLine={false} axisLine={false} />
										<ChartTooltip content={<ChartTooltipContent />} />
										<Bar dataKey="count" fill="var(--color-count)" radius={4} />
									</BarChart>
								</ChartContainer>
							) : (
								<div className="h-[300px] flex items-center justify-center text-muted-foreground">
									No peak month data available
								</div>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}
