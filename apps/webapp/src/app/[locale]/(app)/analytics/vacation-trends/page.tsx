"use client";

import { IconLoader2 } from "@tabler/icons-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

// Dynamic imports for recharts to reduce initial bundle size
const Bar = dynamic(() => import("recharts").then((mod) => mod.Bar), { ssr: false });
const BarChart = dynamic(() => import("recharts").then((mod) => mod.BarChart), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), {
	ssr: false,
});
const Line = dynamic(() => import("recharts").then((mod) => mod.Line), { ssr: false });
const LineChart = dynamic(() => import("recharts").then((mod) => mod.LineChart), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false });
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
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { getVacationTrendsData } from "../actions";

function areDateRangesEqual(left: DateRange, right: DateRange) {
	return (
		left.start.getTime() === right.start.getTime() &&
		left.end.getTime() === right.end.getTime()
	);
}

export default function VacationTrendsPage() {
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const hasUserChangedRange = useRef(false);
	const [dateRange, setDateRange] = useState<DateRange | null>(null);
	const [loading, setLoading] = useState(true);
	const [vacationData, setVacationData] = useState<VacationTrendsData | null>(null);

	useEffect(() => {
		if (!isHydrated || hasUserChangedRange.current) {
			return;
		}

		const nextDateRange = getDateRangeForPreset("current_year", { timezone });
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

		const expectedDefaultDateRange = getDateRangeForPreset("current_year", { timezone });
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
				const result = await getVacationTrendsData(range);

				if (!isCurrent) {
					return;
				}

				if (result.success && result.data) {
					setVacationData(result.data);
				}
			} catch (error) {
				if (!isCurrent) {
					return;
				}

				console.error("Failed to load vacation trends data:", error);
				toast.error("Failed to load vacation trends data");
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
				{dateRange ? (
					<DateRangePicker value={dateRange} onChange={handleDateRangeChange} />
				) : (
					<p className="text-sm text-muted-foreground">
						Loading organization settings before enabling presets.
					</p>
				)}
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
						filename: `vacation-trends-${dateRange?.start.toISOString().split("T")[0] ?? "pending"}`,
					}}
					disabled={!vacationData || !dateRange}
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
