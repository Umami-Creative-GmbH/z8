"use client";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useLocale } from "next-intl";

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
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), {
	ssr: false,
});
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), {
	ssr: false,
});

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
import type { TeamPerformanceData } from "@/lib/analytics/types";

type Teams = TeamPerformanceData["teams"];
export function TeamComparison({ teams }: { teams: Teams }) {
	const { t } = useTranslate();
	const teamComparisonData = teams.map((team) => ({
		team: team.teamName,
		hours: team.totalHours,
	}));
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t("analytics.teamPerformance.comparison.title", "Team Comparison")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.teamPerformance.comparison.description",
						"Total work hours by team for the selected period",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{teamComparisonData.length > 0 ? (
					<ChartContainer
						config={{
							hours: {
								label: t("analytics.common.hours", "Hours"),
								color: "var(--primary)",
							},
						}}
						className="h-[300px]"
					>
						<BarChart data={teamComparisonData}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis
								dataKey="team"
								tickLine={false}
								tickMargin={10}
								axisLine={false}
							/>
							<YAxis tickLine={false} axisLine={false} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Bar dataKey="hours" fill="var(--color-hours)" radius={4} />
						</BarChart>
					</ChartContainer>
				) : (
					<div className="h-[300px] flex items-center justify-center text-muted-foreground">
						{t("analytics.common.noDataAvailable", "No data available")}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
export function TeamDetails({ teams }: { teams: Teams }) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t(
							"analytics.teamPerformance.details.title",
							"Team Performance Details",
						)}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.teamPerformance.details.description",
						"Breakdown of work hours by team and employee",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{teams.length === 0 ? (
					<div className="flex h-[200px] items-center justify-center text-muted-foreground">
						{t(
							"analytics.common.noDataForPeriod",
							"No data available for the selected period",
						)}
					</div>
				) : (
					<section
						aria-label={t(
							"analytics.teamPerformance.details.title",
							"Team Performance Details",
						)}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Named horizontal comparison region needs keyboard scrolling.
						tabIndex={0}
						className="max-w-full overflow-x-auto rounded-sm focus-visible:outline-2 focus-visible:outline-ring [&>div]:overflow-visible"
					>
						<Table
							aria-label={t(
								"analytics.teamPerformance.details.title",
								"Team Performance Details",
							)}
							className="min-w-[42rem] tabular-nums [&_tr>:first-child]:sticky [&_tr>:first-child]:left-0 [&_tr>:first-child]:z-10 [&_tr>:first-child]:bg-card [&_tr>:first-child]:max-w-48 [&_tr>:first-child]:whitespace-normal"
						>
							<MetricsTableHeader
								name={t("analytics.common.team", "Team")}
								metrics={[
									t("analytics.common.totalHours", "Total Hours"),
									t(
										"analytics.teamPerformance.avgPerEmployee",
										"Avg per Employee",
									),
									t(
										"analytics.teamPerformance.employeeCount",
										"Employee Count",
									),
								]}
								summary={t("common.status", "Status")}
							/>
							<TableBody>
								{teams.map((team) => (
									<TableRow key={team.teamId}>
										<TableCell className="font-medium">
											{team.teamName}
										</TableCell>
										<TableCell className="text-right">
											{Number(team.totalHours.toFixed(1)).toLocaleString(
												locale,
												{
													minimumFractionDigits: 1,
													maximumFractionDigits: 1,
												},
											)}
											h
										</TableCell>
										<TableCell className="text-right">
											{Number(
												team.avgHoursPerEmployee.toFixed(1),
											).toLocaleString(locale, {
												minimumFractionDigits: 1,
												maximumFractionDigits: 1,
											})}
											h
										</TableCell>
										<TableCell className="text-right">
											{team.employeeCount}
										</TableCell>
										<TableCell>
											<Badge variant="outline">
												{t("analytics.teamPerformance.onTrack", "On Track")}
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
export function VarianceComparison({ teams }: { teams: Teams }) {
	const { t } = useTranslate();
	const overtimeData = teams.flatMap((team) =>
		team.employees.map((emp) => ({
			employee: emp.employeeName,
			team: team.teamName,
			overtime: Math.max(emp.variance, 0),
			undertime: emp.variance < 0 ? Math.abs(emp.variance) : 0,
		})),
	);
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t(
							"analytics.teamPerformance.variance.title",
							"Overtime & Undertime",
						)}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.teamPerformance.variance.description",
						"Hours variance from expected work hours",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{overtimeData.length > 0 ? (
					<ChartContainer
						config={{
							overtime: {
								label: t("analytics.common.overtime", "Overtime"),
								color: "var(--chart-1)",
							},
							undertime: {
								label: t("analytics.common.undertime", "Undertime"),
								color: "var(--chart-2)",
							},
						}}
						className="h-[300px]"
					>
						<BarChart data={overtimeData}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis
								dataKey="employee"
								tickLine={false}
								tickMargin={10}
								axisLine={false}
							/>
							<YAxis tickLine={false} axisLine={false} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Bar
								dataKey="overtime"
								fill="var(--color-overtime)"
								radius={4}
								stackId="a"
							/>
							<Bar
								dataKey="undertime"
								fill="var(--color-undertime)"
								radius={4}
								stackId="a"
							/>
						</BarChart>
					</ChartContainer>
				) : (
					<div className="h-[300px] flex items-center justify-center text-muted-foreground">
						{t(
							"analytics.teamPerformance.variance.empty",
							"No variance data available",
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
