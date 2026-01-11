"use client";

import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const chartConfig = {
	hours: {
		label: "Daily Hours",
		color: "hsl(var(--chart-1))",
	},
	cumulativeHours: {
		label: "Cumulative Hours",
		color: "hsl(var(--chart-2))",
	},
} satisfies ChartConfig;

export function ProjectHoursChart({ data }: ProjectHoursChartProps) {
	if (data.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Hours Over Time</CardTitle>
					<CardDescription>No time tracking data available for this period</CardDescription>
				</CardHeader>
				<CardContent className="flex items-center justify-center py-12">
					<p className="text-sm text-muted-foreground">
						No work periods recorded in the selected date range
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
					<CardTitle>Daily Hours</CardTitle>
					<CardDescription>Hours worked per day during the selected period</CardDescription>
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
										formatter={(value) => [`${Number(value).toFixed(1)}h`, "Hours"]}
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
					<CardTitle>Cumulative Hours</CardTitle>
					<CardDescription>Total hours accumulated over time</CardDescription>
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
										formatter={(value) => [`${Number(value).toFixed(1)}h`, "Cumulative"]}
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
