"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
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
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { getOvertimeBurnDownData } from "../actions";

const ALL_FILTER_VALUE = "all";
const Bar = dynamic(() => import("recharts").then((mod) => mod.Bar), { ssr: false });
const BarChart = dynamic(() => import("recharts").then((mod) => mod.BarChart), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), {
	ssr: false,
});
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false });

function formatTrendDirection(trendDirection: TrendDirection, t: ReturnType<typeof useTranslate>["t"]): string {
	if (trendDirection === "up") return t("analytics.overtimeBurnDown.trend.up", "Up");
	if (trendDirection === "down") return t("analytics.overtimeBurnDown.trend.down", "Down");
	return t("analytics.overtimeBurnDown.trend.flat", "Flat");
}

function areDateRangesEqual(left: DateRange, right: DateRange) {
	return (
		left.start.getTime() === right.start.getTime() &&
		left.end.getTime() === right.end.getTime()
	);
}

export default function OvertimeBurnDownPage() {
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
	const [data, setData] = useState<OvertimeBurnDownData | null>(null);
	const [teamId, setTeamId] = useState(ALL_FILTER_VALUE);
	const [costCenterId, setCostCenterId] = useState(ALL_FILTER_VALUE);
	const [managerId, setManagerId] = useState(ALL_FILTER_VALUE);
	const [breakdownDimension, setBreakdownDimension] = useState<"team" | "costCenter" | "manager">(
		"team",
	);

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
					range,
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
				toast.error(t("analytics.overtimeBurnDown.errors.loadData", "Failed to load overtime burn-down data"));
			} catch (error) {
				console.error("Failed to load overtime burn-down data:", error);
				if (isMounted) {
					setData(null);
					toast.error(t("analytics.overtimeBurnDown.errors.loadData", "Failed to load overtime burn-down data"));
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
	}, [dateRange, teamId, costCenterId, managerId, isHydrated, timezone]);

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
			? t("analytics.common.team", "Team")
			: breakdownDimension === "costCenter"
				? t("analytics.overtimeBurnDown.costCenter", "Cost Center")
				: t("analytics.overtimeBurnDown.manager", "Manager");

	const exportData = useMemo(() => {
		const rows = selectedBreakdownRows.map((row) => ({
			dimension: row.label,
			currentOvertime: row.currentOvertimeHours,
			previousOvertime: row.previousOvertimeHours,
			weekOverWeek: row.wowDeltaHours,
			trendDirection: formatTrendDirection(row.trendDirection, t),
		}));

		return {
			data: rows,
			headers: [
				{ key: "dimension" as const, label: breakdownLabel },
				{ key: "currentOvertime" as const, label: t("analytics.overtimeBurnDown.currentOvertime", "Current Overtime") },
				{ key: "previousOvertime" as const, label: t("analytics.overtimeBurnDown.previousOvertime", "Previous Overtime") },
				{ key: "weekOverWeek" as const, label: t("analytics.overtimeBurnDown.weekOverWeek", "Week-over-Week") },
				{ key: "trendDirection" as const, label: t("analytics.overtimeBurnDown.trendDirection", "Trend Direction") },
			],
			filename: `overtime-burndown-${breakdownDimension}-${dateRange ? DateTime.fromJSDate(dateRange.start).toFormat("yyyy-MM-dd") : "pending"}`,
		};
	}, [selectedBreakdownRows, breakdownLabel, breakdownDimension, dateRange, t]);

	return (
		<div className="space-y-6 px-4 lg:px-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">{t("analytics.overtimeBurnDown.title", "Overtime Burn-Down")}</h1>
				<p className="text-sm text-muted-foreground">
					{t("analytics.overtimeBurnDown.description", "Track weekly overtime reduction across teams.")}
				</p>
			</div>

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
				<div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-end">
					<div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2 lg:grid-cols-4">
						<div className="space-y-1">
							<p className="text-xs text-muted-foreground">{t("analytics.common.team", "Team")}</p>
							<Select value={teamId} onValueChange={setTeamId}>
								<SelectTrigger className="w-full sm:w-[160px]" aria-label={t("analytics.overtimeBurnDown.filters.teamLabel", "Team filter")}>
									<SelectValue placeholder={t("analytics.overtimeBurnDown.filters.allTeams", "All teams")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_FILTER_VALUE}>{t("analytics.overtimeBurnDown.filters.allTeams", "All teams")}</SelectItem>
									{(data?.byTeam ?? []).map((row) => (
										<SelectItem key={row.id} value={row.id}>
											{row.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<p className="text-xs text-muted-foreground">{t("analytics.overtimeBurnDown.costCenter", "Cost Center")}</p>
							<Select value={costCenterId} onValueChange={setCostCenterId}>
								<SelectTrigger className="w-full sm:w-[160px]" aria-label={t("analytics.overtimeBurnDown.filters.costCenterLabel", "Cost center filter")}>
									<SelectValue placeholder={t("analytics.overtimeBurnDown.filters.allCostCenters", "All cost centers")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_FILTER_VALUE}>{t("analytics.overtimeBurnDown.filters.allCostCenters", "All cost centers")}</SelectItem>
									{(data?.byCostCenter ?? []).map((row) => (
										<SelectItem key={row.id} value={row.id}>
											{row.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<p className="text-xs text-muted-foreground">{t("analytics.overtimeBurnDown.manager", "Manager")}</p>
							<Select value={managerId} onValueChange={setManagerId}>
								<SelectTrigger className="w-full sm:w-[160px]" aria-label={t("analytics.overtimeBurnDown.filters.managerLabel", "Manager filter")}>
									<SelectValue placeholder={t("analytics.overtimeBurnDown.filters.allManagers", "All managers")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_FILTER_VALUE}>{t("analytics.overtimeBurnDown.filters.allManagers", "All managers")}</SelectItem>
									{(data?.byManager ?? []).map((row) => (
										<SelectItem key={row.id} value={row.id}>
											{row.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<p className="text-xs text-muted-foreground">{t("analytics.overtimeBurnDown.breakdown", "Breakdown")}</p>
							<Select
								value={breakdownDimension}
								onValueChange={(value) =>
									setBreakdownDimension(value as "team" | "costCenter" | "manager")
								}
							>
								<SelectTrigger className="w-full sm:w-[160px]" aria-label={t("analytics.overtimeBurnDown.filters.breakdownLabel", "Breakdown dimension")}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="team">{t("analytics.overtimeBurnDown.byTeam", "By Team")}</SelectItem>
									<SelectItem value="costCenter">{t("analytics.overtimeBurnDown.byCostCenter", "By Cost Center")}</SelectItem>
									<SelectItem value="manager">{t("analytics.overtimeBurnDown.byManager", "By Manager")}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
					<ExportButton
						data={exportData}
						disabled={loading || selectedBreakdownRows.length === 0 || !dateRange}
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
								<CardTitle className="text-sm font-medium">{t("analytics.overtimeBurnDown.currentOvertime", "Current Overtime")}</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-semibold">
									{summary.currentOvertimeHours.toFixed(1)}h
								</div>
							<p className="text-xs text-muted-foreground">{t("analytics.overtimeBurnDown.selectedRangeDescription", "For selected date range and filters")}</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">{t("analytics.overtimeBurnDown.weekOverWeek", "Week-over-Week")}</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-semibold">
									{summary.wowDeltaHours > 0 ? "+" : ""}
									{summary.wowDeltaHours.toFixed(1)}h
								</div>
							<p className="text-xs text-muted-foreground">{t("analytics.overtimeBurnDown.previousPeriodDescription", "Compared with previous period")}</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">{t("analytics.overtimeBurnDown.improvingGroups", "Improving Groups")}</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-semibold">{summary.improvingGroups}</div>
							<p className="text-xs text-muted-foreground">{t("analytics.overtimeBurnDown.improvingGroupsDescription", "Groups with decreasing overtime")}</p>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">{t("analytics.overtimeBurnDown.trendDirection", "Trend Direction")}</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-semibold">
								{formatTrendDirection(summary.trendDirection, t)}
								</div>
							<p className="text-xs text-muted-foreground">{t("analytics.overtimeBurnDown.trendDirectionDescription", "Overall overtime trajectory")}</p>
							</CardContent>
						</Card>
					</div>

					<Card>
						<CardHeader>
						<CardTitle>{t("analytics.overtimeBurnDown.weeklyTrend.title", "Weekly Burn-Down Trend")}</CardTitle>
						<CardDescription>{t("analytics.overtimeBurnDown.weeklyTrend.description", "Weekly overtime reduction trend")}</CardDescription>
						</CardHeader>
						<CardContent>
							{(data?.weeklySeries.length ?? 0) > 0 ? (
								<ChartContainer
									config={{
										overtimeHours: {
									label: t("analytics.common.overtimeHours", "Overtime Hours"),
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
								{t("analytics.overtimeBurnDown.weeklyTrend.empty", "No trend data available yet")}
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
						<CardTitle>{t("analytics.overtimeBurnDown.breakdown", "Breakdown")}</CardTitle>
						<CardDescription>{t("analytics.overtimeBurnDown.breakdownDescription", "{label} level overtime burn-down details", { label: breakdownLabel })}</CardDescription>
						</CardHeader>
						<CardContent>
							{selectedBreakdownRows.length > 0 ? (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{breakdownLabel}</TableHead>
									<TableHead className="text-right">{t("analytics.overtimeBurnDown.currentOvertime", "Current Overtime")}</TableHead>
									<TableHead className="text-right">{t("analytics.overtimeBurnDown.previousOvertime", "Previous Overtime")}</TableHead>
									<TableHead className="text-right">{t("analytics.overtimeBurnDown.weekOverWeek", "Week-over-Week")}</TableHead>
									<TableHead>{t("analytics.overtimeBurnDown.trendDirection", "Trend Direction")}</TableHead>
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
									<TableCell>{formatTrendDirection(row.trendDirection, t)}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							) : (
								<div className="flex h-[240px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
								{t("analytics.overtimeBurnDown.breakdownEmpty", "No breakdown data available yet")}
								</div>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}
