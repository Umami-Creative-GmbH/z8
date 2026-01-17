"use client";

import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Dynamic imports for recharts to reduce initial bundle size
const Area = dynamic(() => import("recharts").then((mod) => mod.Area), { ssr: false });
const AreaChart = dynamic(() => import("recharts").then((mod) => mod.AreaChart), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), {
	ssr: false,
});
const Line = dynamic(() => import("recharts").then((mod) => mod.Line), { ssr: false });
const LineChart = dynamic(() => import("recharts").then((mod) => mod.LineChart), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false });
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import type { ProjectTimeSeriesPoint } from "@/lib/reports/project-types";

interface ProjectHoursChartProps {
	data: ProjectTimeSeriesPoint[];
}

export function ProjectHoursChart({ data }: ProjectHoursChartProps) {
	const { t } = useTranslate();

	const chartConfig = {
		hours: {
			label: t("reports.projects.chart.dailyHours", "Daily Hours"),
			color: "hsl(var(--chart-1))",
		},
		cumulativeHours: {
			label: t("reports.projects.chart.cumulativeHours", "Cumulative Hours"),
			color: "hsl(var(--chart-2))",
		},
	} satisfies ChartConfig;

	if (data.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t("reports.projects.chart.hoursOverTime", "Hours Over Time")}</CardTitle>
					<CardDescription>
						{t(
							"reports.projects.chart.noDataAvailable",
							"No time tracking data available for this period",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex items-center justify-center py-12">
					<p className="text-sm text-muted-foreground">
						{t(
							"reports.projects.chart.noWorkPeriods",
							"No work periods recorded in the selected date range",
						)}
					</p>
				</CardContent>
			</Card>
		);
	}

	// Format dates for display
	const formattedData = data.map((point) => ({
		...point,
		dateLabel: new Date(point.date).toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
		}),
	}));

	return (
		<div className="grid gap-4 md:grid-cols-2">
			{/* Daily Hours Chart */}
			<Card>
				<CardHeader>
					<CardTitle>{t("reports.projects.chart.dailyHours", "Daily Hours")}</CardTitle>
					<CardDescription>
						{t(
							"reports.projects.chart.dailyDescription",
							"Hours worked per day during the selected period",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ChartContainer config={chartConfig} className="h-[300px] w-full">
						<AreaChart accessibilityLayer data={formattedData} margin={{ left: 12, right: 12 }}>
							<CartesianGrid vertical={false} />
							<XAxis
								dataKey="dateLabel"
								tickLine={false}
								axisLine={false}
								tickMargin={8}
								tickFormatter={(value) => value}
							/>
							<YAxis
								tickLine={false}
								axisLine={false}
								tickMargin={8}
								tickFormatter={(value) => `${value}h`}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										formatter={(value) => [
											`${Number(value).toFixed(1)}h`,
											t("reports.projects.chart.hoursLabel", "Hours"),
										]}
									/>
								}
							/>
							<Area
								dataKey="hours"
								type="monotone"
								fill="var(--color-hours)"
								fillOpacity={0.4}
								stroke="var(--color-hours)"
								strokeWidth={2}
							/>
						</AreaChart>
					</ChartContainer>
				</CardContent>
			</Card>

			{/* Cumulative Hours Chart */}
			<Card>
				<CardHeader>
					<CardTitle>{t("reports.projects.chart.cumulativeHours", "Cumulative Hours")}</CardTitle>
					<CardDescription>
						{t("reports.projects.chart.cumulativeDescription", "Total hours accumulated over time")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ChartContainer config={chartConfig} className="h-[300px] w-full">
						<LineChart accessibilityLayer data={formattedData} margin={{ left: 12, right: 12 }}>
							<CartesianGrid vertical={false} />
							<XAxis
								dataKey="dateLabel"
								tickLine={false}
								axisLine={false}
								tickMargin={8}
								tickFormatter={(value) => value}
							/>
							<YAxis
								tickLine={false}
								axisLine={false}
								tickMargin={8}
								tickFormatter={(value) => `${value}h`}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										formatter={(value) => [
											`${Number(value).toFixed(1)}h`,
											t("reports.projects.chart.cumulativeLabel", "Cumulative"),
										]}
									/>
								}
							/>
							<Line
								dataKey="cumulativeHours"
								type="monotone"
								stroke="var(--color-cumulativeHours)"
								strokeWidth={2}
								dot={false}
							/>
						</LineChart>
					</ChartContainer>
				</CardContent>
			</Card>
		</div>
	);
}
