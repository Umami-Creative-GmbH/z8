"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { ExportButton } from "@/components/analytics/export-button";
import { DateRangePicker } from "@/components/reports/date-range-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { OvertimeBurnDownData, OvertimeBurnDownGroupedRow, TrendDirection } from "@/lib/analytics/types";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { DateRange } from "@/lib/reports/types";
import { getOvertimeBurnDownData } from "../actions";

const ALL_FILTER_VALUE = "all";

function formatTrendDirection(trendDirection: TrendDirection): string {
	if (trendDirection === "up") return "Up";
	if (trendDirection === "down") return "Down";
	return "Flat";
}

export default function OvertimeBurnDownPage() {
	const [dateRange, setDateRange] = useState<DateRange>(getDateRangeForPreset("current_month"));
	const [loading, setLoading] = useState(true);
	const [data, setData] = useState<OvertimeBurnDownData | null>(null);
	const [teamId, setTeamId] = useState(ALL_FILTER_VALUE);
	const [costCenterId, setCostCenterId] = useState(ALL_FILTER_VALUE);
	const [managerId, setManagerId] = useState(ALL_FILTER_VALUE);
	const [breakdownDimension, setBreakdownDimension] = useState<"team" | "costCenter" | "manager">(
		"team",
	);

	useEffect(() => {
		let isMounted = true;

		async function loadData() {
			setLoading(true);
			try {
				const filters: {
					teamId?: string;
					costCenterId?: string;
					managerId?: string;
				} = {};

				if (teamId !== ALL_FILTER_VALUE) {
					filters.teamId = teamId;
				}

				if (costCenterId !== ALL_FILTER_VALUE) {
					filters.costCenterId = costCenterId;
				}

				if (managerId !== ALL_FILTER_VALUE) {
					filters.managerId = managerId;
				}

				const result = await getOvertimeBurnDownData(
					dateRange,
					Object.keys(filters).length > 0 ? filters : undefined,
				);

				if (!isMounted) {
					return;
				}

				if (result.success && result.data) {
					setData(result.data);
					return;
				}

				setData(null);
				toast.error("Failed to load overtime burn-down data");
			} catch (error) {
				console.error("Failed to load overtime burn-down data:", error);
				if (isMounted) {
					setData(null);
					toast.error("Failed to load overtime burn-down data");
				}
			} finally {
				if (isMounted) {
					setLoading(false);
				}
			}
		}

		loadData();

		return () => {
			isMounted = false;
		};
	}, [dateRange, teamId, costCenterId, managerId]);

	const summary = data?.summary ?? {
		currentOvertimeHours: 0,
		wowDeltaHours: 0,
		improvingGroups: 0,
		trendDirection: "flat" as const,
	};

	const selectedBreakdownRows = useMemo<OvertimeBurnDownGroupedRow[]>(() => {
		if (!data) {
			return [];
		}

		if (breakdownDimension === "costCenter") {
			return data.byCostCenter;
		}

		if (breakdownDimension === "manager") {
			return data.byManager;
		}

		return data.byTeam;
	}, [breakdownDimension, data]);

	const breakdownLabel =
		breakdownDimension === "team"
			? "Team"
			: breakdownDimension === "costCenter"
				? "Cost Center"
				: "Manager";

	const exportData = useMemo(() => {
		const rows = selectedBreakdownRows.map((row) => ({
			dimension: row.label,
			currentOvertime: row.currentOvertimeHours,
			previousOvertime: row.previousOvertimeHours,
			weekOverWeek: row.wowDeltaHours,
			trendDirection: formatTrendDirection(row.trendDirection),
		}));

		return {
			data: rows,
			headers: [
				{ key: "dimension" as const, label: breakdownLabel },
				{ key: "currentOvertime" as const, label: "Current Overtime" },
				{ key: "previousOvertime" as const, label: "Previous Overtime" },
				{ key: "weekOverWeek" as const, label: "Week-over-Week" },
				{ key: "trendDirection" as const, label: "Trend Direction" },
			],
			filename: `overtime-burndown-${breakdownDimension}-${DateTime.fromJSDate(dateRange.start).toFormat("yyyy-MM-dd")}`,
		};
	}, [selectedBreakdownRows, breakdownLabel, breakdownDimension, dateRange.start]);

	return (
		<div className="space-y-6 px-4 lg:px-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">Overtime Burn-Down</h1>
				<p className="text-sm text-muted-foreground">
					Track weekly overtime reduction across teams.
				</p>
			</div>

			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<DateRangePicker value={dateRange} onChange={setDateRange} />
				<div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-end">
					<div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2 lg:grid-cols-4">
						<div className="space-y-1">
							<p className="text-xs text-muted-foreground">Team</p>
							<Select value={teamId} onValueChange={setTeamId}>
								<SelectTrigger className="w-full sm:w-[160px]" aria-label="Team filter">
									<SelectValue placeholder="All teams" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_FILTER_VALUE}>All teams</SelectItem>
									{(data?.byTeam ?? []).map((row) => (
										<SelectItem key={row.id} value={row.id}>
											{row.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<p className="text-xs text-muted-foreground">Cost Center</p>
							<Select value={costCenterId} onValueChange={setCostCenterId}>
								<SelectTrigger className="w-full sm:w-[160px]" aria-label="Cost center filter">
									<SelectValue placeholder="All cost centers" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_FILTER_VALUE}>All cost centers</SelectItem>
									{(data?.byCostCenter ?? []).map((row) => (
										<SelectItem key={row.id} value={row.id}>
											{row.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<p className="text-xs text-muted-foreground">Manager</p>
							<Select value={managerId} onValueChange={setManagerId}>
								<SelectTrigger className="w-full sm:w-[160px]" aria-label="Manager filter">
									<SelectValue placeholder="All managers" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_FILTER_VALUE}>All managers</SelectItem>
									{(data?.byManager ?? []).map((row) => (
										<SelectItem key={row.id} value={row.id}>
											{row.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<p className="text-xs text-muted-foreground">Breakdown</p>
							<Select
								value={breakdownDimension}
								onValueChange={(value) =>
									setBreakdownDimension(value as "team" | "costCenter" | "manager")
								}
							>
								<SelectTrigger className="w-full sm:w-[160px]" aria-label="Breakdown dimension">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="team">By Team</SelectItem>
									<SelectItem value="costCenter">By Cost Center</SelectItem>
									<SelectItem value="manager">By Manager</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
					<ExportButton
						data={exportData}
						disabled={loading || selectedBreakdownRows.length === 0}
					/>
				</div>
			</div>

			{loading && (
				<div className="flex items-center justify-center py-12">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			)}

			{!loading && (
				<>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						<Card>
							<CardHeader className="space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Current Overtime</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-semibold">
									{summary.currentOvertimeHours.toFixed(1)}h
								</div>
								<p className="text-xs text-muted-foreground">For selected date range and filters</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Week-over-Week</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-semibold">
									{summary.wowDeltaHours > 0 ? "+" : ""}
									{summary.wowDeltaHours.toFixed(1)}h
								</div>
								<p className="text-xs text-muted-foreground">Compared with previous period</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Improving Groups</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-semibold">{summary.improvingGroups}</div>
								<p className="text-xs text-muted-foreground">Groups with decreasing overtime</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Trend Direction</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-semibold">
									{formatTrendDirection(summary.trendDirection)}
								</div>
								<p className="text-xs text-muted-foreground">Overall overtime trajectory</p>
							</CardContent>
						</Card>
					</div>

					<Card>
						<CardHeader>
							<CardTitle>Weekly Burn-Down Trend</CardTitle>
							<CardDescription>Weekly overtime reduction trend</CardDescription>
						</CardHeader>
						<CardContent>
							{(data?.weeklySeries.length ?? 0) > 0 ? (
								<ChartContainer
									config={{
										overtimeHours: {
											label: "Overtime Hours",
											color: "hsl(var(--chart-1))",
										},
									}}
									className="h-[320px]"
								>
									<BarChart data={data?.weeklySeries ?? []}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis
											dataKey="weekStart"
											tickLine={false}
											tickMargin={10}
											axisLine={false}
											tickFormatter={(value: string) =>
												DateTime.fromISO(value).toFormat("LLL dd")
											}
										/>
										<YAxis tickLine={false} axisLine={false} />
										<ChartTooltip
											content={<ChartTooltipContent />}
											labelFormatter={(value) => DateTime.fromISO(String(value)).toFormat("DDD")}
										/>
										<Bar dataKey="overtimeHours" fill="var(--color-overtimeHours)" radius={4} />
									</BarChart>
								</ChartContainer>
							) : (
								<div className="flex h-[320px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
									No trend data available yet
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Breakdown</CardTitle>
							<CardDescription>{breakdownLabel} level overtime burn-down details</CardDescription>
						</CardHeader>
						<CardContent>
							{selectedBreakdownRows.length > 0 ? (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{breakdownLabel}</TableHead>
											<TableHead className="text-right">Current Overtime</TableHead>
											<TableHead className="text-right">Previous Overtime</TableHead>
											<TableHead className="text-right">Week-over-Week</TableHead>
											<TableHead>Trend Direction</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{selectedBreakdownRows.map((row) => (
											<TableRow key={row.id}>
												<TableCell className="font-medium">{row.label}</TableCell>
												<TableCell className="text-right">
													{row.currentOvertimeHours.toFixed(1)}h
												</TableCell>
												<TableCell className="text-right">
													{row.previousOvertimeHours.toFixed(1)}h
												</TableCell>
												<TableCell className="text-right">
													{row.wowDeltaHours > 0 ? "+" : ""}
													{row.wowDeltaHours.toFixed(1)}h
												</TableCell>
												<TableCell>{formatTrendDirection(row.trendDirection)}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							) : (
								<div className="flex h-[240px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
									No breakdown data available yet
								</div>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}
