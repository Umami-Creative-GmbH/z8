"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
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
		left.start.getTime() === right.start.getTime() && left.end.getTime() === right.end.getTime()
	);
}

type VacationTrendsTranslate = ReturnType<typeof useTranslate>["t"];

type VacationOverallData = NonNullable<VacationTrendsData["overall"]>;
type VacationEmployeeData = VacationTrendsData["byEmployee"][number];
type VacationMonthlyData = VacationTrendsData["byMonth"];
type VacationPeakMonthData = NonNullable<VacationTrendsData["patterns"]>["peakMonths"];

function VacationUtilizationCard({
	overallData,
	t,
}: {
	overallData: VacationOverallData;
	t: VacationTrendsTranslate;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("analytics.vacationTrends.utilization.title", "Vacation Utilization")}
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.vacationTrends.utilization.description",
						"Overall vacation days usage across organization",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<div className="space-y-1">
							<p className="text-sm font-medium">
								{t("analytics.vacationTrends.utilization.overall", "Overall Utilization")}
							</p>
							<p className="text-2xl font-bold">{overallData.utilizationRate.toFixed(1)}%</p>
						</div>
						<div className="text-right text-sm text-muted-foreground">
							<p>
								{t("analytics.vacationTrends.daysTaken", "{count} days taken", {
									count: overallData.totalDaysTaken,
								})}
							</p>
							<p>
								{t("analytics.vacationTrends.daysRemaining", "{count} days remaining", {
									count: overallData.totalDaysRemaining,
								})}
							</p>
						</div>
					</div>
					<Progress value={overallData.utilizationRate} className="h-2" />
				</div>
			</CardContent>
		</Card>
	);
}

function MonthlyUsageCard({ data, t }: { data: VacationMonthlyData; t: VacationTrendsTranslate }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("analytics.vacationTrends.monthlyUsage.title", "Monthly Vacation Usage")}
				</CardTitle>
				<CardDescription>
					{t("analytics.vacationTrends.monthlyUsage.description", "Vacation days taken per month")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{data.length > 0 ? (
					<ChartContainer
						config={{
							days: {
								label: t("analytics.common.days", "Days"),
								color: "hsl(var(--primary))",
							},
						}}
						className="h-[300px]"
					>
						<LineChart data={data}>
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
					<div className="flex h-[300px] items-center justify-center text-muted-foreground">
						{t("analytics.vacationTrends.monthlyUsage.empty", "No monthly usage data available")}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function VacationBalanceCard({
	employees,
	t,
}: {
	employees: VacationEmployeeData[];
	t: VacationTrendsTranslate;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("analytics.vacationTrends.balance.title", "Vacation Balance")}</CardTitle>
				<CardDescription>
					{t(
						"analytics.vacationTrends.balance.description",
						"Days allocated, taken, and remaining by employee",
					)}
				</CardDescription>
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
								<TableHead className="text-right">
									{t("analytics.vacationTrends.allocated", "Allocated")}
								</TableHead>
								<TableHead className="text-right">
									{t("analytics.vacationTrends.taken", "Taken")}
								</TableHead>
								<TableHead className="text-right">
									{t("analytics.vacationTrends.remaining", "Remaining")}
								</TableHead>
								<TableHead>
									{t("analytics.vacationTrends.utilizationLabel", "Utilization")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{employees.map((employee) => (
								<TableRow key={employee.employeeId}>
									<TableCell className="font-medium">{employee.employeeName}</TableCell>
									<TableCell className="text-right">{employee.allocated}</TableCell>
									<TableCell className="text-right">{employee.taken}</TableCell>
									<TableCell className="text-right">{employee.remaining}</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<Progress value={employee.utilizationRate} className="h-2 w-[100px]" />
											<span className="text-sm text-muted-foreground">
												{employee.utilizationRate.toFixed(0)}%
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
	);
}

function PeakMonthsCard({ data, t }: { data: VacationPeakMonthData; t: VacationTrendsTranslate }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("analytics.vacationTrends.peakMonths.title", "Peak Vacation Months")}
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.vacationTrends.peakMonths.description",
						"Months with highest vacation activity",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{data.length > 0 ? (
					<ChartContainer
						config={{
							count: {
								label: t("analytics.vacationTrends.vacationDays", "Vacation Days"),
								color: "hsl(var(--chart-3))",
							},
						}}
						className="h-[300px]"
					>
						<BarChart data={data}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis dataKey="month" tickLine={false} tickMargin={10} axisLine={false} />
							<YAxis tickLine={false} axisLine={false} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Bar dataKey="count" fill="var(--color-count)" radius={4} />
						</BarChart>
					</ChartContainer>
				) : (
					<div className="flex h-[300px] items-center justify-center text-muted-foreground">
						{t("analytics.vacationTrends.peakMonths.empty", "No peak month data available")}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export default function VacationTrendsPage() {
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
		if (!hasUserChangedRange.current && !areDateRangesEqual(dateRange, expectedDefaultDateRange)) {
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
				toast.error(
					t("analytics.vacationTrends.errors.loadData", "Failed to load vacation trends data"),
				);
			}

			if (isCurrent) {
				setLoading(false);
			}
		}

		loadData();

		return () => {
			isCurrent = false;
		};
	}, [dateRange, isHydrated, timezone, t]);

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
							{ key: "allocated", label: t("analytics.vacationTrends.allocated", "Allocated") },
							{ key: "taken", label: t("analytics.vacationTrends.taken", "Taken") },
							{ key: "remaining", label: t("analytics.vacationTrends.remaining", "Remaining") },
							{
								key: "utilizationRate",
								label: t("analytics.vacationTrends.utilizationPercent", "Utilization %"),
							},
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
					<VacationUtilizationCard overallData={overallData} t={t} />
					<MonthlyUsageCard data={monthlyUsageData} t={t} />
					<VacationBalanceCard employees={employees} t={t} />
					<PeakMonthsCard data={peakMonthsData} t={t} />
				</>
			)}
		</div>
	);
}
