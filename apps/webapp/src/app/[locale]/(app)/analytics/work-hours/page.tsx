"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	XAxis,
	YAxis,
} from "recharts";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ExportButton } from "@/components/analytics/export-button";
import { DateRangePicker } from "@/components/reports/date-range-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { WorkHoursAnalyticsData } from "@/lib/analytics/types";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { DateRange } from "@/lib/reports/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { getWorkHoursAnalyticsData } from "../actions";

function areDateRangesEqual(left: DateRange, right: DateRange) {
	return (
		left.start.getTime() === right.start.getTime() &&
		left.end.getTime() === right.end.getTime()
	);
}

export default function WorkHoursPage() {
	const { t } = useTranslate();
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const hasUserChangedRange = useRef(false);
	const [dateRange, setDateRange] = useState<DateRange | null>(null);
	const [loading, setLoading] = useState(true);
	const [workHoursData, setWorkHoursData] = useState<WorkHoursAnalyticsData | null>(null);

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
		if (
			!hasUserChangedRange.current &&
			!areDateRangesEqual(dateRange, expectedDefaultDateRange)
		) {
			return;
		}
		const range = dateRange;
		let isCurrent = true;

		async function loadData() {
			setLoading(true);
			try {
				// Organization ID is now derived server-side from authenticated session
				const result = await getWorkHoursAnalyticsData(range);

				if (!isCurrent) {
					return;
				}

				if (result.success && result.data) {
					setWorkHoursData(result.data);
				}
			} catch (error) {
				if (!isCurrent) {
					return;
				}

				console.error("Failed to load work hours analytics data:", error);
				toast.error(t("analytics.workHours.errors.loadData", "Failed to load work hours analytics data"));
			} finally {
				if (isCurrent) {
					setLoading(false);
				}
			}
		}

		loadData();

		return () => {
			isCurrent = false;
		};
	}, [dateRange, isHydrated, timezone]);

	const employees = workHoursData?.byEmployee || [];

	// Prepare chart data
	const trendData = workHoursData?.distribution || [];
	const dailyHoursData = workHoursData?.distribution || [];
	const distributionData = employees.map((emp) => ({
		employee: emp.employeeName,
		hours: emp.totalHours,
	}));

	return (
		<div className="space-y-6 px-4 lg:px-6">
			{/* Controls */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				{dateRange ? (
					<DateRangePicker value={dateRange} onChange={handleDateRangeChange} />
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
						data: employees,
						headers: [
							{ key: "employeeName", label: t("analytics.common.employee", "Employee") },
							{ key: "totalHours", label: t("analytics.common.totalHours", "Total Hours") },
							{ key: "overtimeHours", label: t("analytics.common.overtimeHours", "Overtime Hours") },
							{ key: "undertimeHours", label: t("analytics.common.undertimeHours", "Undertime Hours") },
							{ key: "avgHoursPerWeek", label: t("analytics.workHours.avgHoursPerWeek", "Avg Hours/Week") },
						],
						filename: `work-hours-${dateRange?.start.toISOString().split("T")[0] ?? "pending"}`,
					}}
					disabled={!workHoursData || !dateRange}
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
							<CardTitle>{t("analytics.workHours.varianceTrend.title", "Overtime & Undertime Trend")}</CardTitle>
							<CardDescription>{t("analytics.workHours.varianceTrend.description", "Hours variance from expected work hours over time")}</CardDescription>
						</CardHeader>
						<CardContent>
							{trendData.length > 0 ? (
								<ChartContainer
									config={{
										overtime: {
										label: t("analytics.common.overtime", "Overtime"),
											color: "hsl(var(--chart-1))",
										},
										undertime: {
										label: t("analytics.common.undertime", "Undertime"),
											color: "hsl(var(--chart-2))",
										},
									}}
									className="h-[300px]"
								>
									<AreaChart data={trendData}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis dataKey="date" tickLine={false} tickMargin={10} axisLine={false} />
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
									{t("analytics.workHours.varianceTrend.empty", "No trend data available")}
								</div>
							)}
						</CardContent>
					</Card>

					{/* Daily Work Hours */}
					<Card>
						<CardHeader>
							<CardTitle>{t("analytics.workHours.daily.title", "Daily Work Hours")}</CardTitle>
							<CardDescription>{t("analytics.workHours.daily.description", "Actual vs expected work hours per day")}</CardDescription>
						</CardHeader>
						<CardContent>
							{dailyHoursData.length > 0 ? (
								<ChartContainer
									config={{
										actual: {
										label: t("analytics.workHours.actualHours", "Actual Hours"),
											color: "hsl(var(--primary))",
										},
										expected: {
										label: t("analytics.workHours.expectedHours", "Expected Hours"),
											color: "hsl(var(--muted-foreground))",
										},
									}}
									className="h-[300px]"
								>
									<LineChart data={dailyHoursData}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis dataKey="date" tickLine={false} tickMargin={10} axisLine={false} />
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
									{t("analytics.workHours.daily.empty", "No daily hours data available")}
								</div>
							)}
						</CardContent>
					</Card>

					{/* Employee Work Hours Comparison */}
					<Card>
						<CardHeader>
							<CardTitle>{t("analytics.workHours.employeeComparison.title", "Employee Work Hours")}</CardTitle>
							<CardDescription>{t("analytics.workHours.employeeComparison.description", "Total hours and variance from expected by employee")}</CardDescription>
						</CardHeader>
						<CardContent>
							{employees.length === 0 ? (
								<div className="flex h-[200px] items-center justify-center text-muted-foreground">
									{t("analytics.common.noDataForPeriod", "No data available for the selected period")}
								</div>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
										<TableHead>{t("analytics.common.employee", "Employee")}</TableHead>
										<TableHead className="text-right">{t("analytics.common.totalHours", "Total Hours")}</TableHead>
										<TableHead className="text-right">{t("analytics.workHours.expectedHours", "Expected Hours")}</TableHead>
										<TableHead className="text-right">{t("analytics.workHours.variance", "Variance")}</TableHead>
										<TableHead>{t("common.status", "Status")}</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{employees.map((emp) => (
											<TableRow key={emp.employeeId}>
												<TableCell className="font-medium">{emp.employeeName}</TableCell>
												<TableCell className="text-right">{emp.totalHours.toFixed(1)}h</TableCell>
												<TableCell className="text-right">
													{(emp.totalHours + emp.overtimeHours).toFixed(1)}h
												</TableCell>
												<TableCell className="text-right">
													<span
														className={
															emp.overtimeHours >= 0 ? "text-green-600" : "text-orange-600"
														}
													>
														{emp.overtimeHours >= 0 ? "+" : ""}
														{emp.overtimeHours.toFixed(1)}h
													</span>
												</TableCell>
												<TableCell>
													<Badge
														variant={
															emp.avgHoursPerWeek >= 35
																? "default"
																: emp.avgHoursPerWeek >= 30
																	? "secondary"
																	: "destructive"
														}
													>
														{emp.avgHoursPerWeek.toFixed(0)}h/wk
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
							<CardTitle>{t("analytics.workHours.distribution.title", "Work Hours Distribution")}</CardTitle>
							<CardDescription>{t("analytics.workHours.distribution.description", "Employee work hours comparison (horizontal bar)")}</CardDescription>
						</CardHeader>
						<CardContent>
							{distributionData.length > 0 ? (
								<ChartContainer
									config={{
										hours: {
										label: t("analytics.common.hours", "Hours"),
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
									{t("analytics.workHours.distribution.empty", "No distribution data available")}
								</div>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}
