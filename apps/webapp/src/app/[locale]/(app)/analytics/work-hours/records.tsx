"use client";

import type { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useLocale } from "next-intl";
import { MetricsTableHeader } from "@/components/analytics/metrics-table-header";
import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { WorkHoursAnalyticsData } from "@/lib/analytics/types";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";

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

type WorkHoursTranslate = ReturnType<typeof useTranslate>["t"];
type WorkHoursEmployeeData = WorkHoursAnalyticsData["byEmployee"][number];
type WorkHoursDistributionData = WorkHoursAnalyticsData["distribution"];
type WorkHoursBarData = { employee: string; hours: number }[];

export function VarianceTrendCard({
	data,
	t,
}: {
	data: WorkHoursDistributionData;
	t: WorkHoursTranslate;
}) {
	const locale = useLocale();
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t(
							"analytics.workHours.varianceTrend.title",
							"Overtime & Undertime Trend",
						)}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.workHours.varianceTrend.description",
						"Hours variance from expected work hours over time",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="flex min-h-40 items-center text-muted-foreground">
					{data.length === 0
						? t(
								"analytics.workHours.varianceTrend.empty",
								"No trend data available",
							)
						: t(
								"analytics.workHours.varianceTrend.unavailable",
								"Daily overtime and undertime hour values are unavailable from this report. Recorded daily status is shown below.",
							)}
				</p>
				{data.length > 0 && (
					<details>
						<summary className="cursor-pointer rounded-sm py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
							{t("analytics.workHours.dailyStatus", "View daily status")}
						</summary>
						<div className="max-h-80 overflow-auto">
							<Table>
								<thead>
									<tr>
										<th scope="col" className="p-2 text-left">
											{t("common.date", "Date")}
										</th>
										<th scope="col" className="p-2 text-left">
											{t("analytics.common.overtime", "Overtime")}
										</th>
										<th scope="col" className="p-2 text-left">
											{t("analytics.common.undertime", "Undertime")}
										</th>
									</tr>
								</thead>
								<TableBody>
									{data.map((day) => (
										<TableRow key={day.date}>
											<TableCell>
												<time dateTime={day.date}>
													{formatPlainDate(
														parsePlainDate(day.date),
														locale,
														"dateMedium",
													)}
												</time>
											</TableCell>
											<TableCell>
												{day.isOvertime
													? t("common.yes", "Yes")
													: t("common.no", "No")}
											</TableCell>
											<TableCell>
												{day.isUndertime
													? t("common.yes", "Yes")
													: t("common.no", "No")}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</details>
				)}
			</CardContent>
		</Card>
	);
}
export function DailyWorkHoursCard({
	data,
	t,
}: {
	data: WorkHoursDistributionData;
	t: WorkHoursTranslate;
}) {
	const locale = useLocale();
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{t("analytics.workHours.daily.title", "Daily Work Hours")}</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.workHours.daily.description",
						"Actual vs expected work hours per day",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{data.length > 0 ? (
					<ChartContainer
						config={{
							hours: {
								label: t("analytics.workHours.actualHours", "Actual Hours"),
								color: "var(--primary)",
							},
							expectedHours: {
								label: t("analytics.workHours.expectedHours", "Expected Hours"),
								color: "var(--muted-foreground)",
							},
						}}
						className="h-[300px] w-full"
					>
						<LineChart data={data}>
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
								isAnimationActive={false}
								type="monotone"
								dataKey="hours"
								stroke="var(--color-hours)"
								strokeWidth={2}
								dot={{ r: 3 }}
							/>
							<Line
								isAnimationActive={false}
								type="monotone"
								dataKey="expectedHours"
								stroke="var(--color-expectedHours)"
								strokeWidth={2}
								strokeDasharray="5 5"
								dot={{ r: 3 }}
							/>
						</LineChart>
					</ChartContainer>
				) : (
					<div className="flex h-[300px] items-center justify-center text-muted-foreground">
						{t(
							"analytics.workHours.daily.empty",
							"No daily hours data available",
						)}
					</div>
				)}
				{data.length > 0 && (
					<details>
						<summary className="cursor-pointer rounded-sm py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
							{t("analytics.workHours.dailyValues", "View daily hours")}
						</summary>
						<div className="max-h-80 overflow-auto">
							<Table
								aria-label={t(
									"analytics.workHours.daily.title",
									"Daily Work Hours",
								)}
							>
								<thead>
									<tr>
										<th scope="col" className="p-2 text-left">
											{t("common.date", "Date")}
										</th>
										<th scope="col" className="p-2 text-right">
											{t("analytics.workHours.actualHours", "Actual Hours")}
										</th>
										<th scope="col" className="p-2 text-right">
											{t("analytics.workHours.expectedHours", "Expected Hours")}
										</th>
									</tr>
								</thead>
								<TableBody>
									{data.map((day) => (
										<TableRow key={day.date}>
											<TableCell>
												<time dateTime={day.date}>
													{formatPlainDate(
														parsePlainDate(day.date),
														locale,
														"dateMedium",
													)}
												</time>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{day.hours.toLocaleString(locale)}h
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{day.expectedHours.toLocaleString(locale)}h
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</details>
				)}
			</CardContent>
		</Card>
	);
}

export function EmployeeWorkHoursCard({
	employees,
	t,
}: {
	employees: WorkHoursEmployeeData[];
	t: WorkHoursTranslate;
}) {
	const locale = useLocale();
	const hours = (value: number) =>
		Number(value.toFixed(1)).toLocaleString(locale, {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1,
		});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t(
							"analytics.workHours.employeeComparison.title",
							"Employee Work Hours",
						)}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.workHours.employeeComparison.description",
						"Total hours and variance from expected by employee",
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
					<section
						aria-label={t(
							"analytics.workHours.employeeComparison.title",
							"Employee Work Hours",
						)}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Named horizontal comparison region needs keyboard scrolling.
						tabIndex={0}
						className="max-w-full overflow-x-auto rounded-sm focus-visible:outline-2 focus-visible:outline-ring [&>div]:overflow-visible"
					>
						<Table className="min-w-[720px] tabular-nums [&_th:first-child]:sticky [&_td:first-child]:sticky [&_th:first-child]:left-0 [&_td:first-child]:left-0 [&_th:first-child]:bg-card [&_td:first-child]:bg-card [&_th:first-child]:z-10 [&_td:first-child]:z-10 [&_td:first-child]:whitespace-normal [&_td:first-child]:min-w-40">
							<MetricsTableHeader
								name={t("analytics.common.employee", "Employee")}
								metrics={[
									t("analytics.common.totalHours", "Total Hours"),
									t("analytics.workHours.expectedHours", "Expected Hours"),
									t("analytics.workHours.variance", "Variance"),
								]}
								summary={t("common.status", "Status")}
							/>
							<TableBody>
								{employees.map((employee) => (
									<TableRow key={employee.employeeId}>
										<TableCell className="font-medium">
											{employee.employeeName}
										</TableCell>
										<TableCell className="text-right">
											{hours(employee.totalHours)}h
										</TableCell>
										<TableCell className="text-right">
											{hours(employee.totalHours + employee.overtimeHours)}h
										</TableCell>
										<TableCell className="text-right">
											<span
												className={
													employee.overtimeHours >= 0
														? "text-foreground"
														: "text-destructive"
												}
											>
												{employee.overtimeHours >= 0 ? "+" : ""}
												{hours(employee.overtimeHours)}h
											</span>
										</TableCell>
										<TableCell>
											<Badge
												variant={
													employee.avgHoursPerWeek >= 35
														? "default"
														: employee.avgHoursPerWeek >= 30
															? "secondary"
															: "destructive"
												}
											>
												{Number(
													employee.avgHoursPerWeek.toFixed(0),
												).toLocaleString(locale)}
												{t(
													"analytics.workHours.hoursPerWeekAbbreviation",
													"h/wk",
												)}
											</Badge>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</section>
				)}
			</CardContent>
		</Card>
	);
}

export function WorkHoursDistributionCard({
	data,
	t,
}: {
	data: WorkHoursBarData;
	t: WorkHoursTranslate;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t(
							"analytics.workHours.distribution.title",
							"Work Hours Distribution",
						)}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.workHours.distribution.description",
						"Employee work hours comparison (horizontal bar)",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{data.length > 0 ? (
					<ChartContainer
						config={{
							hours: {
								label: t("analytics.common.hours", "Hours"),
								color: "var(--chart-4)",
							},
						}}
						className="h-[300px] w-full"
					>
						<BarChart data={data} layout="vertical">
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
							<Bar
								isAnimationActive={false}
								dataKey="hours"
								fill="var(--color-hours)"
								radius={4}
							/>
						</BarChart>
					</ChartContainer>
				) : (
					<div className="flex h-[300px] items-center justify-center text-muted-foreground">
						{t(
							"analytics.workHours.distribution.empty",
							"No distribution data available",
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
