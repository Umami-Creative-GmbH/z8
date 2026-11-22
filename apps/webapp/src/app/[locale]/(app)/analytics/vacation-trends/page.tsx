"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { DataTableToolbar } from "@/components/data-table-server/data-table-toolbar";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { LoadingRegion } from "@/components/ui/loading-region";

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
const Line = dynamic(() => import("recharts").then((mod) => mod.Line), {
	ssr: false,
});
const LineChart = dynamic(
	() => import("recharts").then((mod) => mod.LineChart),
	{ ssr: false },
);
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), {
	ssr: false,
});
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), {
	ssr: false,
});

import { AnalyticsDateRangePicker } from "@/components/analytics/date-range-picker";
import { ExportButton } from "@/components/analytics/export-button";
import { MetricsTableHeader } from "@/components/analytics/metrics-table-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { getAnalyticsDateRangeForPreset } from "@/lib/analytics/date-ranges";
import type {
	AbsencePatternsData,
	DateRange,
	VacationTrendsData,
} from "@/lib/analytics/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { getAbsencePatternsData, getVacationTrendsData } from "../actions";

function areDateRangesEqual(left: DateRange, right: DateRange) {
	return (
		left.start.getTime() === right.start.getTime() &&
		left.end.getTime() === right.end.getTime()
	);
}

type VacationTrendsTranslate = ReturnType<typeof useTranslate>["t"];

type VacationOverallData = NonNullable<VacationTrendsData["overall"]>;
type VacationEmployeeData = VacationTrendsData["byEmployee"][number];
type VacationMonthlyData = VacationTrendsData["byMonth"];
type VacationPeakMonthData = Array<{ month: string; count: number }>;

function VacationUtilizationCard({
	overallData,
	t,
}: {
	overallData: VacationOverallData;
	t: VacationTrendsTranslate;
}) {
	const locale = useLocale();
	const days = (count: number) =>
		t("analytics.vacationTrends.dayValue", "{count} days", {
			count: count.toLocaleString(locale),
		});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t(
							"analytics.vacationTrends.utilization.title",
							"Vacation Utilization",
						)}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.vacationTrends.utilization.description",
						"Overall vacation days usage across organization",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<dl className="grid divide-y sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
					{[
						[
							t(
								"analytics.vacationTrends.utilization.overall",
								"Overall Utilization",
							),
							`${overallData.utilizationRate.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
						],
						[
							t("analytics.vacationTrends.allocated", "Allocated"),
							days(overallData.totalDaysAllocated),
						],
						[
							t("analytics.vacationTrends.taken", "Taken"),
							days(overallData.totalDaysTaken),
						],
						[
							t("analytics.vacationTrends.remaining", "Remaining"),
							days(overallData.totalDaysRemaining),
						],
					].map(([label, value]) => (
						<div
							key={label}
							className="min-w-0 space-y-2 py-4 sm:px-4 sm:border-r last:border-r-0"
						>
							<dt className="text-sm text-muted-foreground">{label}</dt>
							<dd className="text-2xl font-semibold tabular-nums">{value}</dd>
						</div>
					))}
				</dl>
				<Progress
					aria-label={t(
						"analytics.vacationTrends.utilization.overall",
						"Overall Utilization",
					)}
					value={overallData.utilizationRate}
					className="h-2"
				/>
			</CardContent>
		</Card>
	);
}

function MonthlyUsageCard({
	data,
	t,
}: {
	data: VacationMonthlyData;
	t: VacationTrendsTranslate;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t(
							"analytics.vacationTrends.monthlyUsage.title",
							"Monthly Vacation Usage",
						)}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.vacationTrends.monthlyUsage.description",
						"Vacation days taken per month",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{data.length > 0 ? (
					<ChartContainer
						config={{
							daysTaken: {
								label: t("analytics.common.days", "Days"),
								color: "var(--primary)",
							},
						}}
						className="h-[260px] w-full"
					>
						<LineChart data={data}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis
								dataKey="month"
								tickLine={false}
								tickMargin={10}
								axisLine={false}
							/>
							<YAxis tickLine={false} axisLine={false} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Line
								type="monotone"
								dataKey="daysTaken"
								stroke="var(--color-daysTaken)"
								strokeWidth={2}
								dot={{ r: 4 }}
							/>
						</LineChart>
					</ChartContainer>
				) : (
					<div className="flex h-[300px] items-center justify-center text-muted-foreground">
						{t(
							"analytics.vacationTrends.monthlyUsage.empty",
							"No monthly usage data available",
						)}
					</div>
				)}
				<MonthlyValues
					rows={data.map((row) => ({ month: row.month, days: row.daysTaken }))}
					t={t}
				/>
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
	const locale = useLocale();
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t("analytics.vacationTrends.balance.title", "Vacation Balance")}
					</h2>
				</CardTitle>
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
						{t(
							"analytics.common.noDataForPeriod",
							"No data available for the selected period",
						)}
					</div>
				) : (
					<Table
						aria-label={t(
							"analytics.vacationTrends.balance.description",
							"Days allocated, taken, and remaining by employee",
						)}
						className="min-w-[44rem] tabular-nums [&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-10 [&_th:first-child]:bg-card"
					>
						<MetricsTableHeader
							name={t("analytics.common.employee", "Employee")}
							metrics={[
								t("analytics.vacationTrends.allocated", "Allocated"),
								t("analytics.vacationTrends.taken", "Taken"),
								t("analytics.vacationTrends.remaining", "Remaining"),
							]}
							summary={t(
								"analytics.vacationTrends.utilizationLabel",
								"Utilization",
							)}
						/>
						<TableBody>
							{employees.map((employee) => (
								<TableRow key={employee.employeeId}>
									<TableCell className="sticky left-0 z-10 max-w-48 whitespace-normal bg-card font-medium">
										<span>{employee.employeeName}</span>
										{employee.allowanceConfigured === false && (
											<p className="mt-1 text-sm font-normal text-muted-foreground">
												{t(
													"analytics.vacationTrends.allowanceMissing",
													"Allowance not configured",
												)}
											</p>
										)}
									</TableCell>
									<TableCell className="text-right">
										{employee.allocated.toLocaleString(locale)}
									</TableCell>
									<TableCell className="text-right">
										{employee.taken.toLocaleString(locale)}
									</TableCell>
									<TableCell className="text-right">
										{employee.remaining.toLocaleString(locale)}
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<Progress
												aria-label={employee.employeeName}
												value={employee.utilizationRate}
												className="h-2 w-[100px]"
											/>
											<span className="text-sm text-muted-foreground">
												{employee.utilizationRate.toLocaleString(locale, {
													maximumFractionDigits: 0,
												})}
												%
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

function PeakMonthsCard({
	data,
	t,
}: {
	data: VacationPeakMonthData;
	t: VacationTrendsTranslate;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t(
							"analytics.vacationTrends.peakMonths.title",
							"Peak Vacation Months",
						)}
					</h2>
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
								label: t(
									"analytics.vacationTrends.vacationDays",
									"Vacation Days",
								),
								color: "var(--primary)",
							},
						}}
						className="h-[260px] w-full"
					>
						<BarChart data={data}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis
								dataKey="month"
								tickLine={false}
								tickMargin={10}
								axisLine={false}
							/>
							<YAxis tickLine={false} axisLine={false} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Bar dataKey="count" fill="var(--color-count)" radius={4} />
						</BarChart>
					</ChartContainer>
				) : (
					<div className="flex h-[300px] items-center justify-center text-muted-foreground">
						{t(
							"analytics.vacationTrends.peakMonths.empty",
							"No peak month data available",
						)}
					</div>
				)}
				<MonthlyValues
					rows={data.map((row) => ({ month: row.month, days: row.count }))}
					t={t}
				/>
			</CardContent>
		</Card>
	);
}

function MonthlyValues({
	rows,
	t,
}: {
	rows: Array<{ month: string; days: number }>;
	t: VacationTrendsTranslate;
}) {
	const locale = useLocale();
	if (!rows.length) return null;
	return (
		<details className="mt-4 text-sm">
			<summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
				{t("analytics.vacationTrends.monthlyValues", "View monthly values")}
			</summary>
			<ul className="mt-3 divide-y">
				{rows.map((row) => (
					<li
						key={row.month}
						className="flex flex-wrap justify-between gap-2 py-2 tabular-nums"
					>
						<span>{row.month}</span>
						<span>
							{t("analytics.vacationTrends.dayValue", "{count} days", {
								count: row.days.toLocaleString(locale),
							})}
						</span>
					</li>
				))}
			</ul>
		</details>
	);
}

function AbsencePatternsCard({
	data,
	unavailable,
	t,
}: {
	data: Array<{ category: string; days: number }>;
	unavailable: boolean;
	t: VacationTrendsTranslate;
}) {
	const daysLabel = t("analytics.common.days", "Days");
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t("analytics.overview.absencePatterns.title", "Absence Patterns")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.overview.absencePatterns.description",
						"Absence distribution by category",
					)}
				</CardDescription>
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
						config={{
							days: {
								label: daysLabel,
								color: "var(--chart-2)",
							},
						}}
						className="h-72 w-full min-w-0"
					>
						<BarChart data={data}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis
								dataKey="category"
								tickLine={false}
								tickMargin={10}
								axisLine={false}
							/>
							<YAxis tickLine={false} axisLine={false} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Bar dataKey="days" fill="var(--color-days)" radius={4} />
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
									key={row.category}
									className="flex flex-wrap justify-between gap-2 py-2"
								>
									<dt className="break-words">{row.category}</dt>
									<dd className="tabular-nums">
										{row.days} {daysLabel}
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

function VacationToolbar({
	dateRange,
	onDateRangeChange,
	employees,
	exportDisabled,
	t,
}: {
	dateRange: DateRange | null;
	onDateRangeChange: (range: DateRange) => void;
	employees: VacationEmployeeData[];
	exportDisabled: boolean;
	t: VacationTrendsTranslate;
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
						data: employees,
						headers: [
							{
								key: "employeeName",
								label: t("analytics.common.employee", "Employee"),
							},
							{
								key: "allocated",
								label: t("analytics.vacationTrends.allocated", "Allocated"),
							},
							{
								key: "taken",
								label: t("analytics.vacationTrends.taken", "Taken"),
							},
							{
								key: "remaining",
								label: t("analytics.vacationTrends.remaining", "Remaining"),
							},
							{
								key: "utilizationRate",
								label: t(
									"analytics.vacationTrends.utilizationPercent",
									"Utilization %",
								),
							},
						],
						filename: `vacation-trends-${dateRange?.start.toISOString().split("T")[0] ?? "pending"}`,
					}}
					disabled={exportDisabled}
				/>
			}
		/>
	);
}

export default function VacationTrendsPage() {
	const organizationId = useOrganizationSettings(
		(state) => state.organizationId,
	);
	return <VacationTrends key={organizationId ?? "pending"} />;
}

function VacationTrends() {
	const { t } = useTranslate();
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const hasUserChangedRange = useRef(false);
	const [dateRange, setDateRange] = useState<DateRange | null>(null);
	const [state, setState] = useState<{
		data: VacationTrendsData | null;
		absenceData: AbsencePatternsData | null;
		key: string;
		loading: boolean;
		refreshing: boolean;
		failed: boolean;
		absenceFailed: boolean;
	}>({
		data: null,
		absenceData: null,
		key: "",
		loading: true,
		refreshing: false,
		failed: false,
		absenceFailed: false,
	});
	const requestKey = JSON.stringify([
		dateRange?.start.getTime(),
		dateRange?.end.getTime(),
		timezone,
	]);
	const vacationData = state.key === requestKey ? state.data : null;
	const absenceData = state.key === requestKey ? state.absenceData : null;
	const loading =
		state.loading || (!vacationData && !absenceData && !state.failed);

	useEffect(() => {
		if (!isHydrated || hasUserChangedRange.current) {
			return;
		}

		const nextDateRange = getAnalyticsDateRangeForPreset("current_year", {
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
				"current_year",
				{ timezone },
			);
			if (
				!hasUserChangedRange.current &&
				!areDateRangesEqual(dateRange, expectedDefaultDateRange)
			) {
				return;
			}
			const range = dateRange;
			const generation = ++refreshGeneration.current;

			const isLatest = () => generation === refreshGeneration.current;

			setState((current) => ({
				...current,
				loading: !background,
				refreshing: background,
				failed: false,
				absenceFailed: false,
			}));

			const [vacationResult, absenceResult] = await Promise.allSettled([
				getVacationTrendsData(range),
				getAbsencePatternsData(range),
			]);
			if (!isLatest()) {
				return;
			}

			const refusalCodes = [
				"AuthenticationError",
				"AuthorizationError",
				"NotFoundError",
				"BillingError",
			];
			const isRefused = (
				result: PromiseSettledResult<{ success: boolean; code?: string }>,
			) =>
				result.status === "fulfilled" &&
				!result.value.success &&
				refusalCodes.includes(result.value.code ?? "");

			const refused = isRefused(vacationResult) || isRefused(absenceResult);
			const vacationOk =
				vacationResult.status === "fulfilled" &&
				vacationResult.value.success &&
				Boolean(vacationResult.value.data);
			const absenceOk =
				absenceResult.status === "fulfilled" &&
				absenceResult.value.success &&
				Boolean(absenceResult.value.data);
			const vacationFailed = !vacationOk;
			const absenceFailed = !absenceOk;
			const anyFailed = vacationFailed || absenceFailed;

			if (anyFailed) {
				if (vacationResult.status === "rejected") {
					console.error(
						"Failed to load vacation trends data:",
						vacationResult.reason,
					);
				}
				if (absenceResult.status === "rejected") {
					console.error(
						"Failed to load absence patterns data:",
						absenceResult.reason,
					);
				}
				toast.error(
					t(
						"analytics.vacationTrends.errors.loadData",
						"Failed to load vacation trends data",
					),
				);
			}

			setState((current) => {
				const keepPrevious =
					background && !refused && current.key === requestKey;
				return {
					data: refused
						? null
						: vacationOk &&
							  vacationResult.status === "fulfilled" &&
							  vacationResult.value.success
							? vacationResult.value.data
							: keepPrevious
								? current.data
								: null,
					absenceData: refused
						? null
						: absenceOk &&
							  absenceResult.status === "fulfilled" &&
							  absenceResult.value.success
							? absenceResult.value.data
							: keepPrevious
								? current.absenceData
								: null,
					key: requestKey,
					loading: false,
					refreshing: false,
					failed: anyFailed,
					absenceFailed: refused
						? true
						: absenceFailed && !(keepPrevious && current.absenceData),
				};
			});

			if (anyFailed && background)
				throw new Error("Vacation analytics refresh failed");
		},
		[dateRange, isHydrated, timezone, t, requestKey],
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

	const employees = vacationData?.byEmployee ?? [];

	return (
		<div className="space-y-6">
			{/* Controls */}
			<VacationToolbar
				dateRange={dateRange}
				onDateRangeChange={handleDateRangeChange}
				employees={employees}
				exportDisabled={
					!vacationData ||
					!dateRange ||
					state.failed ||
					state.refreshing ||
					loading
				}
				t={t}
			/>
			<VacationContent
				vacationData={vacationData}
				absenceData={absenceData}
				absenceUnavailable={state.absenceFailed || !absenceData}
				loading={loading}
				failed={state.failed}
				refreshing={state.refreshing}
				onRetry={() =>
					void runAnalyticsLoad(Boolean(vacationData || absenceData)).catch(
						() => {},
					)
				}
				t={t}
			/>
		</div>
	);
}

function VacationContent({
	vacationData,
	absenceData,
	absenceUnavailable,
	loading,
	failed,
	refreshing,
	onRetry,
	t,
}: {
	vacationData: VacationTrendsData | null;
	absenceData: AbsencePatternsData | null;
	absenceUnavailable: boolean;
	loading: boolean;
	failed: boolean;
	refreshing: boolean;
	onRetry: () => void;
	t: VacationTrendsTranslate;
}) {
	const overallData = vacationData?.overall;

	const employees = vacationData?.byEmployee || [];

	// Prepare chart data
	const monthlyUsageData = vacationData?.byMonth || [];
	const peakMonthsData = (vacationData?.patterns?.peakMonths ?? []).flatMap(
		(month) => {
			const row = monthlyUsageData.find((row) => row.month === month);
			return row ? [{ month, count: row.daysTaken }] : [];
		},
	);
	const absencePatternsChartData =
		absenceData?.byType.map((cat) => ({
			category: cat.categoryName,
			days: cat.totalDays,
		})) || [];

	return (
		<>
			{refreshing && (
				<p role="status" className="text-sm text-muted-foreground">
					{t("analytics.vacationTrends.refreshing", "Refreshing vacation data")}
				</p>
			)}
			{failed && (
				<Alert variant="destructive">
					<AlertDescription className="flex flex-wrap items-center justify-between gap-3">
						<span>
							{t(
								"analytics.vacationTrends.errors.retryDescription",
								"Vacation data could not be loaded. Retry the selected period.",
							)}
						</span>
						<Button variant="outline" onClick={() => onRetry()}>
							{t("common.retry", "Retry")}
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{loading && (
				<LoadingRegion
					className="flex items-center justify-center py-12"
					label={{
						labelKey: "analytics.vacationTrends.loading",
						labelDefault: "Loading vacation data",
					}}
				>
					<IconLoader2
						aria-hidden="true"
						className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
					/>
				</LoadingRegion>
			)}

			{!loading && overallData && (
				<>
					{employees.some(
						(employee) => employee.allowanceConfigured === false,
					) && (
						<Alert>
							<AlertDescription>
								{t(
									"analytics.vacationTrends.allowanceSource",
									"Some employees have no stored allowance. Totals use the existing stored allowances only.",
								)}
							</AlertDescription>
						</Alert>
					)}
					<VacationUtilizationCard overallData={overallData} t={t} />
					<VacationBalanceCard employees={employees} t={t} />
					<div className="grid min-w-0 gap-6 xl:grid-cols-2">
						<MonthlyUsageCard data={monthlyUsageData} t={t} />
						<PeakMonthsCard data={peakMonthsData} t={t} />
					</div>
				</>
			)}

			{!loading && (absenceData || overallData) && (
				<AbsencePatternsCard
					data={absencePatternsChartData}
					unavailable={absenceUnavailable}
					t={t}
				/>
			)}
		</>
	);
}
