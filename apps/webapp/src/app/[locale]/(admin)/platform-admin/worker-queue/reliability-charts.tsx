"use client";

import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import type { WorkerReliabilityData } from "./reliability";

const Area = dynamic(() => import("recharts").then((mod) => mod.Area), { ssr: false });
const AreaChart = dynamic(() => import("recharts").then((mod) => mod.AreaChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then((mod) => mod.Bar), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), {
	ssr: false,
});
const ComposedChart = dynamic(() => import("recharts").then((mod) => mod.ComposedChart), {
	ssr: false,
});
const Line = dynamic(() => import("recharts").then((mod) => mod.Line), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false });

function formatDateLabel(dateKey: string, locale: string): string {
	const date = DateTime.fromISO(dateKey, { zone: "utc" });

	return date.isValid
		? date.setLocale(locale).toLocaleString({ month: "short", day: "numeric" })
		: dateKey;
}

function formatDuration(
	durationMs: number,
	millisecondFormatter: Intl.NumberFormat,
	secondFormatter: Intl.NumberFormat,
): string {
	if (durationMs < 1000) {
		return millisecondFormatter.format(durationMs);
	}

	return secondFormatter.format(durationMs / 1000);
}

function EmptyChartState({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-[300px] items-center justify-center rounded-md border border-dashed">
			<p className="max-w-xs text-center text-sm text-muted-foreground">{children}</p>
		</div>
	);
}

export function WorkerReliabilityCharts({ reliability }: { reliability: WorkerReliabilityData }) {
	const { t } = useTranslate();
	const params = useParams<{ locale?: string }>();
	const locale = params.locale ?? "en";
	const numberFormatter = new Intl.NumberFormat(locale);
	const decimalFormatter = new Intl.NumberFormat(locale, {
		maximumFractionDigits: 1,
		minimumFractionDigits: 1,
	});
	const millisecondFormatter = new Intl.NumberFormat(locale, {
		style: "unit",
		unit: "millisecond",
	});
	const secondFormatter = new Intl.NumberFormat(locale, {
		style: "unit",
		unit: "second",
		maximumFractionDigits: 1,
		minimumFractionDigits: 1,
	});
	const completedLabel = t("settings.workerQueue.reliability.completed", "Completed");
	const failedLabel = t("settings.workerQueue.reliability.failed", "Failed");
	const successRateLabel = t("settings.workerQueue.reliability.successRate", "Success rate");
	const averageDurationLabel = t(
		"settings.workerQueue.reliability.averageDuration",
		"Average duration",
	);
	const outcomeChartConfig = {
		completed: {
			label: completedLabel,
			color: "hsl(var(--chart-1))",
		},
		failed: {
			label: failedLabel,
			color: "hsl(var(--destructive))",
		},
		successRate: {
			label: successRateLabel,
			color: "hsl(var(--chart-2))",
		},
	} satisfies ChartConfig;
	const durationChartConfig = {
		averageDurationMs: {
			label: averageDurationLabel,
			color: "hsl(var(--chart-1))",
		},
	} satisfies ChartConfig;
	const outcomeData = reliability.outcomeSeries.map((point) => ({
		...point,
		dateLabel: formatDateLabel(point.date, locale),
	}));
	const durationData = reliability.durationSeries.map((point) => ({
		...point,
		dateLabel: formatDateLabel(point.date, locale),
	}));
	const formattedWindowDays = numberFormatter.format(reliability.summary.windowDays);

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.workerQueue.reliability.runOutcomes", "Run Outcomes")}</CardTitle>
					<CardDescription>
						{t(
							"settings.workerQueue.reliability.runOutcomesDescription",
							"Completed and failed cron executions over the last {days} days.",
							{ days: formattedWindowDays },
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{outcomeData.length === 0 ? (
						<EmptyChartState>
							{t(
								"settings.workerQueue.reliability.noExecutionHistory",
								"No cron execution history is available for this period.",
							)}
						</EmptyChartState>
					) : (
						<ChartContainer config={outcomeChartConfig} className="h-[300px] w-full">
							<ComposedChart accessibilityLayer data={outcomeData} margin={{ left: 12, right: 12 }}>
								<CartesianGrid vertical={false} />
								<XAxis dataKey="dateLabel" tickLine={false} axisLine={false} tickMargin={8} />
								<YAxis
									yAxisId="runs"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									allowDecimals={false}
								/>
								<YAxis
									yAxisId="successRate"
									orientation="right"
									domain={[0, 100]}
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									tickFormatter={(value) => `${numberFormatter.format(Number(value))}%`}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											formatter={(value, name) => {
												const labelByName = {
													completed: completedLabel,
													failed: failedLabel,
													successRate: successRateLabel,
												};
												const label = labelByName[name as keyof typeof labelByName] ?? name;
												const formattedValue =
													name === "successRate"
														? `${decimalFormatter.format(Number(value))}%`
														: numberFormatter.format(Number(value));

												return [formattedValue, label];
											}}
										/>
									}
								/>
								<Bar dataKey="completed" yAxisId="runs" fill="var(--color-completed)" radius={4} />
								<Bar dataKey="failed" yAxisId="runs" fill="var(--color-failed)" radius={4} />
								<Line
									dataKey="successRate"
									yAxisId="successRate"
									type="monotone"
									stroke="var(--color-successRate)"
									strokeWidth={2}
									dot={false}
									connectNulls
								/>
							</ComposedChart>
						</ChartContainer>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>
						{t("settings.workerQueue.reliability.durationTrend", "Duration Trend")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.workerQueue.reliability.durationTrendDescription",
							"Average runtime for executions that reported duration data.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{durationData.length === 0 ? (
						<EmptyChartState>
							{t(
								"settings.workerQueue.reliability.noDurationData",
								"No duration data is available for this period.",
							)}
						</EmptyChartState>
					) : (
						<ChartContainer config={durationChartConfig} className="h-[300px] w-full">
							<AreaChart accessibilityLayer data={durationData} margin={{ left: 12, right: 12 }}>
								<CartesianGrid vertical={false} />
								<XAxis dataKey="dateLabel" tickLine={false} axisLine={false} tickMargin={8} />
								<YAxis
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									tickFormatter={(value) =>
										formatDuration(Number(value), millisecondFormatter, secondFormatter)
									}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											formatter={(value) => [
												formatDuration(Number(value), millisecondFormatter, secondFormatter),
												averageDurationLabel,
											]}
										/>
									}
								/>
								<Area
									dataKey="averageDurationMs"
									type="monotone"
									fill="var(--color-averageDurationMs)"
									fillOpacity={0.28}
									stroke="var(--color-averageDurationMs)"
									strokeWidth={2}
								/>
							</AreaChart>
						</ChartContainer>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
