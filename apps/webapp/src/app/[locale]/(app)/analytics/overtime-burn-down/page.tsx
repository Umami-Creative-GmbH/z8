"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import dynamic from "next/dynamic";
import { useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ExportButton, type ExportData } from "@/components/analytics/export-button";
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
import type { OvertimeBurnDownData, TrendDirection } from "@/lib/analytics/types";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { DateRange } from "@/lib/reports/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { getOvertimeBurnDownData } from "../actions";
import {
	ALL_FILTER_VALUE,
	type BreakdownDimension,
	overtimeBurnDownInitialState,
	overtimeBurnDownReducer,
} from "./state";

const Bar = dynamic(() => import("recharts").then((mod) => mod.Bar), { ssr: false });
const BarChart = dynamic(() => import("recharts").then((mod) => mod.BarChart), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), {
	ssr: false,
});
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false });

type TFunction = ReturnType<typeof useTranslate>["t"];
type BreakdownRow = OvertimeBurnDownData["byTeam"][number];
type ExportRow = {
	dimension: string;
	currentOvertime: number;
	previousOvertime: number;
	weekOverWeek: number;
	trendDirection: string;
};

function formatTrendDirection(
	trendDirection: TrendDirection,
	t: ReturnType<typeof useTranslate>["t"],
): string {
	if (trendDirection === "up") return t("analytics.overtimeBurnDown.trend.up", "Up");
	if (trendDirection === "down") return t("analytics.overtimeBurnDown.trend.down", "Down");
	return t("analytics.overtimeBurnDown.trend.flat", "Flat");
}

function areDateRangesEqual(left: DateRange, right: DateRange) {
	return (
		left.start.getTime() === right.start.getTime() && left.end.getTime() === right.end.getTime()
	);
}

function PageHeader({ t }: { t: TFunction }) {
	return (
		<div className="space-y-1">
			<h1 className="text-2xl font-semibold tracking-tight">
				{t("analytics.overtimeBurnDown.title", "Overtime Burn-Down")}
			</h1>
			<p className="text-sm text-muted-foreground">
				{t(
					"analytics.overtimeBurnDown.description",
					"Track weekly overtime reduction across teams.",
				)}
			</p>
		</div>
	);
}

function AnalyticsToolbar({
	t,
	dateRange,
	onDateRangeChange,
	data,
	teamId,
	costCenterId,
	managerId,
	breakdownDimension,
	onFilterChange,
	onBreakdownChange,
	exportData,
	exportDisabled,
}: {
	t: TFunction;
	dateRange: DateRange | null;
	onDateRangeChange: (range: DateRange) => void;
	data: OvertimeBurnDownData | null;
	teamId: string;
	costCenterId: string;
	managerId: string;
	breakdownDimension: BreakdownDimension;
	onFilterChange: (name: "teamId" | "costCenterId" | "managerId", value: string) => void;
	onBreakdownChange: (value: BreakdownDimension) => void;
	exportData: ExportData<ExportRow>;
	exportDisabled: boolean;
}) {
	return (
		<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			{dateRange ? (
				<DateRangePicker value={dateRange} onChange={onDateRangeChange} />
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
					<FilterSelect
						label={t("analytics.common.team", "Team")}
						ariaLabel={t("analytics.overtimeBurnDown.filters.teamLabel", "Team filter")}
						placeholder={t("analytics.overtimeBurnDown.filters.allTeams", "All teams")}
						allLabel={t("analytics.overtimeBurnDown.filters.allTeams", "All teams")}
						value={teamId}
						rows={data?.byTeam ?? []}
						onValueChange={(value) => onFilterChange("teamId", value)}
					/>
					<FilterSelect
						label={t("analytics.overtimeBurnDown.costCenter", "Cost Center")}
						ariaLabel={t(
							"analytics.overtimeBurnDown.filters.costCenterLabel",
							"Cost center filter",
						)}
						placeholder={t("analytics.overtimeBurnDown.filters.allCostCenters", "All cost centers")}
						allLabel={t("analytics.overtimeBurnDown.filters.allCostCenters", "All cost centers")}
						value={costCenterId}
						rows={data?.byCostCenter ?? []}
						onValueChange={(value) => onFilterChange("costCenterId", value)}
					/>
					<FilterSelect
						label={t("analytics.overtimeBurnDown.manager", "Manager")}
						ariaLabel={t("analytics.overtimeBurnDown.filters.managerLabel", "Manager filter")}
						placeholder={t("analytics.overtimeBurnDown.filters.allManagers", "All managers")}
						allLabel={t("analytics.overtimeBurnDown.filters.allManagers", "All managers")}
						value={managerId}
						rows={data?.byManager ?? []}
						onValueChange={(value) => onFilterChange("managerId", value)}
					/>
					<div className="space-y-1">
						<p className="text-xs text-muted-foreground">
							{t("analytics.overtimeBurnDown.breakdown", "Breakdown")}
						</p>
						<Select
							value={breakdownDimension}
							onValueChange={(value) => onBreakdownChange(value as BreakdownDimension)}
						>
							<SelectTrigger
								className="w-full sm:w-[160px]"
								aria-label={t(
									"analytics.overtimeBurnDown.filters.breakdownLabel",
									"Breakdown dimension",
								)}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="team">
									{t("analytics.overtimeBurnDown.byTeam", "By Team")}
								</SelectItem>
								<SelectItem value="costCenter">
									{t("analytics.overtimeBurnDown.byCostCenter", "By Cost Center")}
								</SelectItem>
								<SelectItem value="manager">
									{t("analytics.overtimeBurnDown.byManager", "By Manager")}
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
				<ExportButton data={exportData} disabled={exportDisabled} />
			</div>
		</div>
	);
}

function FilterSelect({
	label,
	ariaLabel,
	placeholder,
	allLabel,
	value,
	rows,
	onValueChange,
}: {
	label: string;
	ariaLabel: string;
	placeholder: string;
	allLabel: string;
	value: string;
	rows: BreakdownRow[];
	onValueChange: (value: string) => void;
}) {
	return (
		<div className="space-y-1">
			<p className="text-xs text-muted-foreground">{label}</p>
			<Select value={value} onValueChange={onValueChange}>
				<SelectTrigger className="w-full sm:w-[160px]" aria-label={ariaLabel}>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={ALL_FILTER_VALUE}>{allLabel}</SelectItem>
					{rows.map((row) => (
						<SelectItem key={row.id} value={row.id}>
							{row.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function LoadingState() {
	return (
		<div className="flex items-center justify-center py-12">
			<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
		</div>
	);
}

function SummaryCards({ summary, t }: { summary: OvertimeBurnDownData["summary"]; t: TFunction }) {
	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			<SummaryCard
				title={t("analytics.overtimeBurnDown.currentOvertime", "Current Overtime")}
				value={`${summary.currentOvertimeHours.toFixed(1)}h`}
				description={t(
					"analytics.overtimeBurnDown.selectedRangeDescription",
					"For selected date range and filters",
				)}
			/>
			<SummaryCard
				title={t("analytics.overtimeBurnDown.weekOverWeek", "Week-over-Week")}
				value={`${summary.wowDeltaHours > 0 ? "+" : ""}${summary.wowDeltaHours.toFixed(1)}h`}
				description={t(
					"analytics.overtimeBurnDown.previousPeriodDescription",
					"Compared with previous period",
				)}
			/>
			<SummaryCard
				title={t("analytics.overtimeBurnDown.improvingGroups", "Improving Groups")}
				value={String(summary.improvingGroups)}
				description={t(
					"analytics.overtimeBurnDown.improvingGroupsDescription",
					"Groups with decreasing overtime",
				)}
			/>
			<SummaryCard
				title={t("analytics.overtimeBurnDown.trendDirection", "Trend Direction")}
				value={formatTrendDirection(summary.trendDirection, t)}
				description={t(
					"analytics.overtimeBurnDown.trendDirectionDescription",
					"Overall overtime trajectory",
				)}
			/>
		</div>
	);
}

function SummaryCard({
	title,
	value,
	description,
}: {
	title: string;
	value: string;
	description: string;
}) {
	return (
		<Card>
			<CardHeader className="space-y-0 pb-2">
				<CardTitle className="text-sm font-medium">{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="text-2xl font-semibold">{value}</div>
				<p className="text-xs text-muted-foreground">{description}</p>
			</CardContent>
		</Card>
	);
}

function WeeklyTrendCard({ data, t }: { data: OvertimeBurnDownData | null; t: TFunction }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("analytics.overtimeBurnDown.weeklyTrend.title", "Weekly Burn-Down Trend")}
				</CardTitle>
				<CardDescription>
					{t(
						"analytics.overtimeBurnDown.weeklyTrend.description",
						"Weekly overtime reduction trend",
					)}
				</CardDescription>
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
								tickFormatter={(value: string) => DateTime.fromISO(value).toFormat("LLL dd")}
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
	);
}

function BreakdownCard({
	rows,
	breakdownLabel,
	t,
}: {
	rows: BreakdownRow[];
	breakdownLabel: string;
	t: TFunction;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("analytics.overtimeBurnDown.breakdown", "Breakdown")}</CardTitle>
				<CardDescription>
					{t(
						"analytics.overtimeBurnDown.breakdownDescription",
						"{label} level overtime burn-down details",
						{
							label: breakdownLabel,
						},
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{rows.length > 0 ? (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{breakdownLabel}</TableHead>
								<TableHead className="text-right">
									{t("analytics.overtimeBurnDown.currentOvertime", "Current Overtime")}
								</TableHead>
								<TableHead className="text-right">
									{t("analytics.overtimeBurnDown.previousOvertime", "Previous Overtime")}
								</TableHead>
								<TableHead className="text-right">
									{t("analytics.overtimeBurnDown.weekOverWeek", "Week-over-Week")}
								</TableHead>
								<TableHead>
									{t("analytics.overtimeBurnDown.trendDirection", "Trend Direction")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
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
	const [state, dispatch] = useReducer(overtimeBurnDownReducer, overtimeBurnDownInitialState);
	const { loading, data, teamId, costCenterId, managerId, breakdownDimension } = state;

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

	const handleFilterChange = (name: "teamId" | "costCenterId" | "managerId", value: string) => {
		dispatch({ type: "filterChanged", name, value });
	};

	useEffect(() => {
		if (!isHydrated || !dateRange) {
			return;
		}

		const expectedDefaultDateRange = getDateRangeForPreset("current_month", { timezone });
		if (!hasUserChangedRange.current && !areDateRangesEqual(dateRange, expectedDefaultDateRange)) {
			return;
		}

		const range = dateRange;
		let isMounted = true;

		async function loadData() {
			dispatch({ type: "loadingStarted" });
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
					dispatch({ type: "dataLoaded", data: result.data });
					return;
				}

				dispatch({ type: "dataLoadFailed" });
				toast.error(
					t("analytics.overtimeBurnDown.errors.loadData", "Failed to load overtime burn-down data"),
				);
			} catch (error) {
				console.error("Failed to load overtime burn-down data:", error);
				if (isMounted) {
					dispatch({ type: "dataLoadFailed" });
					toast.error(
						t(
							"analytics.overtimeBurnDown.errors.loadData",
							"Failed to load overtime burn-down data",
						),
					);
				}
			}
		}

		loadData();

		return () => {
			isMounted = false;
		};
	}, [dateRange, teamId, costCenterId, managerId, isHydrated, timezone, t]);

	const summary = data?.summary ?? {
		currentOvertimeHours: 0,
		wowDeltaHours: 0,
		improvingGroups: 0,
		trendDirection: "flat" as const,
	};

	const selectedBreakdownRows = (() => {
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
	})();

	const breakdownLabel =
		breakdownDimension === "team"
			? t("analytics.common.team", "Team")
			: breakdownDimension === "costCenter"
				? t("analytics.overtimeBurnDown.costCenter", "Cost Center")
				: t("analytics.overtimeBurnDown.manager", "Manager");

	const exportData: ExportData<ExportRow> = (() => {
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
				{
					key: "currentOvertime" as const,
					label: t("analytics.overtimeBurnDown.currentOvertime", "Current Overtime"),
				},
				{
					key: "previousOvertime" as const,
					label: t("analytics.overtimeBurnDown.previousOvertime", "Previous Overtime"),
				},
				{
					key: "weekOverWeek" as const,
					label: t("analytics.overtimeBurnDown.weekOverWeek", "Week-over-Week"),
				},
				{
					key: "trendDirection" as const,
					label: t("analytics.overtimeBurnDown.trendDirection", "Trend Direction"),
				},
			],
			filename:
				"overtime-burndown-" +
				breakdownDimension +
				"-" +
				(dateRange ? DateTime.fromJSDate(dateRange.start).toFormat("yyyy-MM-dd") : "pending"),
		};
	})();

	return (
		<div className="space-y-6 px-4 lg:px-6">
			<PageHeader t={t} />

			<AnalyticsToolbar
				t={t}
				dateRange={dateRange}
				onDateRangeChange={handleDateRangeChange}
				data={data}
				teamId={teamId}
				costCenterId={costCenterId}
				managerId={managerId}
				breakdownDimension={breakdownDimension}
				onFilterChange={handleFilterChange}
				onBreakdownChange={(value) => dispatch({ type: "breakdownChanged", value })}
				exportData={exportData}
				exportDisabled={loading || selectedBreakdownRows.length === 0 || !dateRange}
			/>

			{loading && <LoadingState />}

			{!loading && (
				<>
					<SummaryCards summary={summary} t={t} />
					<WeeklyTrendCard data={data} t={t} />
					<BreakdownCard rows={selectedBreakdownRows} breakdownLabel={breakdownLabel} t={t} />
				</>
			)}
		</div>
	);
}
