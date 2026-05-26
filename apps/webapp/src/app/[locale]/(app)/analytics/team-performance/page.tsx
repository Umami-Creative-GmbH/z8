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
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false });
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
import type { TeamPerformanceData } from "@/lib/analytics/types";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { DateRange } from "@/lib/reports/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { getTeamPerformanceData } from "../actions";

function areDateRangesEqual(left: DateRange, right: DateRange) {
	return (
		left.start.getTime() === right.start.getTime() &&
		left.end.getTime() === right.end.getTime()
	);
}

export default function TeamPerformancePage() {
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
	const [teamData, setTeamData] = useState<TeamPerformanceData | null>(null);

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
				const result = await getTeamPerformanceData(range);

				if (!isCurrent) {
					return;
				}

				if (result.success && result.data) {
					setTeamData(result.data);
				}
			} catch (error) {
				if (!isCurrent) {
					return;
				}

				console.error("Failed to load team performance data:", error);
				toast.error(t("analytics.teamPerformance.errors.loadData", "Failed to load team performance data"));
			}

			if (isCurrent) {
				setLoading(false);
			}
		}

		loadData();

		return () => {
			isCurrent = false;
		};
	}, [dateRange, isHydrated, timezone]);

	const teams = teamData?.teams || [];

	// Prepare chart data
	const teamComparisonData = teams.map((team) => ({
		team: team.teamName,
		hours: team.totalHours,
	}));

	const overtimeData = teams.flatMap((team) =>
		team.employees.map((emp) => ({
			employee: emp.employeeName,
			team: team.teamName,
			overtime: emp.variance > 0 ? emp.variance : 0,
			undertime: emp.variance < 0 ? Math.abs(emp.variance) : 0,
		})),
	);

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
						data: teams,
						headers: [
							{ key: "teamName", label: t("analytics.common.team", "Team") },
							{ key: "totalHours", label: t("analytics.common.totalHours", "Total Hours") },
							{ key: "avgHoursPerEmployee", label: t("analytics.teamPerformance.avgPerEmployee", "Avg per Employee") },
							{ key: "employeeCount", label: t("analytics.teamPerformance.employeeCount", "Employee Count") },
						],
						filename: "team-performance-" + (dateRange?.start.toISOString().split("T")[0] ?? "pending"),
					}}
					disabled={!teamData || !dateRange}
				/>
			</div>

			{loading && (
				<div className="flex items-center justify-center py-12">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			)}

			{!loading && (
				<>
					{/* Team Comparison Chart */}
					<Card>
						<CardHeader>
							<CardTitle>{t("analytics.teamPerformance.comparison.title", "Team Comparison")}</CardTitle>
							<CardDescription>{t("analytics.teamPerformance.comparison.description", "Total work hours by team for the selected period")}</CardDescription>
						</CardHeader>
						<CardContent>
							{teamComparisonData.length > 0 ? (
								<ChartContainer
									config={{
										hours: {
										label: t("analytics.common.hours", "Hours"),
											color: "hsl(var(--primary))",
										},
									}}
									className="h-[300px]"
								>
									<BarChart data={teamComparisonData}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis dataKey="team" tickLine={false} tickMargin={10} axisLine={false} />
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

					{/* Team Performance Table */}
					<Card>
						<CardHeader>
							<CardTitle>{t("analytics.teamPerformance.details.title", "Team Performance Details")}</CardTitle>
							<CardDescription>{t("analytics.teamPerformance.details.description", "Breakdown of work hours by team and employee")}</CardDescription>
						</CardHeader>
						<CardContent>
							{teams.length === 0 ? (
								<div className="flex h-[200px] items-center justify-center text-muted-foreground">
									{t("analytics.common.noDataForPeriod", "No data available for the selected period")}
								</div>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
										<TableHead>{t("analytics.common.team", "Team")}</TableHead>
										<TableHead className="text-right">{t("analytics.common.totalHours", "Total Hours")}</TableHead>
										<TableHead className="text-right">{t("analytics.teamPerformance.avgPerEmployee", "Avg per Employee")}</TableHead>
										<TableHead className="text-right">{t("analytics.teamPerformance.employeeCount", "Employee Count")}</TableHead>
										<TableHead>{t("common.status", "Status")}</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{teams.map((team) => (
											<TableRow key={team.teamId}>
												<TableCell className="font-medium">{team.teamName}</TableCell>
												<TableCell className="text-right">{team.totalHours.toFixed(1)}h</TableCell>
												<TableCell className="text-right">
													{team.avgHoursPerEmployee.toFixed(1)}h
												</TableCell>
												<TableCell className="text-right">{team.employeeCount}</TableCell>
												<TableCell>
											<Badge variant="outline">{t("analytics.teamPerformance.onTrack", "On Track")}</Badge>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>

					{/* Overtime/Undertime Breakdown */}
					<Card>
						<CardHeader>
							<CardTitle>{t("analytics.teamPerformance.variance.title", "Overtime & Undertime")}</CardTitle>
							<CardDescription>{t("analytics.teamPerformance.variance.description", "Hours variance from expected work hours")}</CardDescription>
						</CardHeader>
						<CardContent>
							{overtimeData.length > 0 ? (
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
									<BarChart data={overtimeData}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis dataKey="employee" tickLine={false} tickMargin={10} axisLine={false} />
										<YAxis tickLine={false} axisLine={false} />
										<ChartTooltip content={<ChartTooltipContent />} />
										<Bar dataKey="overtime" fill="var(--color-overtime)" radius={4} stackId="a" />
										<Bar dataKey="undertime" fill="var(--color-undertime)" radius={4} stackId="a" />
									</BarChart>
								</ChartContainer>
							) : (
								<div className="h-[300px] flex items-center justify-center text-muted-foreground">
									{t("analytics.teamPerformance.variance.empty", "No variance data available")}
								</div>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}
