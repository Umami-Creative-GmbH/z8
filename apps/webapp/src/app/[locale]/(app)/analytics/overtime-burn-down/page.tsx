"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { useShallow } from "zustand/react/shallow";
import { AnalyticsDateRangePicker } from "@/components/analytics/date-range-picker";
import {
	ExportButton,
	type ExportData,
} from "@/components/analytics/export-button";
import { DataTableToolbar } from "@/components/data-table-server/data-table-toolbar";
import {
	EmployeeSingleSelect,
	toSelectableEmployee,
} from "@/components/employee-select";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
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
import { LoadingRegion } from "@/components/ui/loading-region";
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
import { getAnalyticsDateRangeForPreset } from "@/lib/analytics/date-ranges";
import type {
	DateRange,
	OvertimeBurnDownData,
	TrendDirection,
} from "@/lib/analytics/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { getOvertimeBurnDownData } from "../actions";
import {
	ALL_FILTER_VALUE,
	type BreakdownDimension,
	type FilterChoice,
	type FilterChoices,
	overtimeBurnDownInitialState,
	overtimeBurnDownReducer,
} from "./state";

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
	if (trendDirection === "up")
		return t("analytics.overtimeBurnDown.trend.up", "Up");
	if (trendDirection === "down")
		return t("analytics.overtimeBurnDown.trend.down", "Down");
	return t("analytics.overtimeBurnDown.trend.flat", "Flat");
}

function areDateRangesEqual(left: DateRange, right: DateRange) {
	return (
		left.start.getTime() === right.start.getTime() &&
		left.end.getTime() === right.end.getTime()
	);
}

function formatHours(hours: number, locale: string) {
	return `${Number(hours.toFixed(1)).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`;
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
	data: FilterChoices | null;
	teamId: string;
	costCenterId: string;
	managerId: string;
	breakdownDimension: BreakdownDimension;
	onFilterChange: (
		name: "teamId" | "costCenterId" | "managerId",
		value: string,
	) => void;
	onBreakdownChange: (value: BreakdownDimension) => void;
	exportData: ExportData<ExportRow>;
	exportDisabled: boolean;
}) {
	return (
		<DataTableToolbar
			filterControls={
				<div className="grid min-w-0 w-full gap-4">
					{dateRange ? (
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
					)}
					<div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
						<FilterSelect
							label={t("analytics.common.team", "Team")}
							ariaLabel={t(
								"analytics.overtimeBurnDown.filters.teamLabel",
								"Team filter",
							)}
							placeholder={t(
								"analytics.overtimeBurnDown.filters.allTeams",
								"All teams",
							)}
							allLabel={t(
								"analytics.overtimeBurnDown.filters.allTeams",
								"All teams",
							)}
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
							placeholder={t(
								"analytics.overtimeBurnDown.filters.allCostCenters",
								"All cost centers",
							)}
							allLabel={t(
								"analytics.overtimeBurnDown.filters.allCostCenters",
								"All cost centers",
							)}
							value={costCenterId}
							rows={data?.byCostCenter ?? []}
							onValueChange={(value) => onFilterChange("costCenterId", value)}
						/>
						<div className="min-w-0 space-y-2">
							<p className="text-sm text-muted-foreground">
								{t("analytics.overtimeBurnDown.manager", "Manager")}
							</p>
							<EmployeeSingleSelect
								value={managerId === ALL_FILTER_VALUE ? null : managerId}
								onChange={(value) =>
									onFilterChange("managerId", value ?? ALL_FILTER_VALUE)
								}
								employees={(data?.byManager ?? []).map((row) =>
									toSelectableEmployee({
										id: row.id,
										name: row.label,
										role: "manager",
									}),
								)}
								allowClear
								clearLabel={t(
									"analytics.overtimeBurnDown.filters.allManagers",
									"All managers",
								)}
								placeholder={t(
									"analytics.overtimeBurnDown.filters.allManagers",
									"All managers",
								)}
								aria-label={t(
									"analytics.overtimeBurnDown.filters.managerLabel",
									"Manager filter",
								)}
								triggerClassName="w-full min-w-0"
							/>
						</div>
						<div className="min-w-0 space-y-2">
							<p className="text-sm text-muted-foreground">
								{t("analytics.overtimeBurnDown.breakdown", "Breakdown")}
							</p>
							<Select
								value={breakdownDimension}
								onValueChange={(value) =>
									onBreakdownChange(value as BreakdownDimension)
								}
							>
								<SelectTrigger
									className="w-full min-w-0"
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
										{t(
											"analytics.overtimeBurnDown.byCostCenter",
											"By Cost Center",
										)}
									</SelectItem>
									<SelectItem value="manager">
										{t("analytics.overtimeBurnDown.byManager", "By Manager")}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
			}
			actions={<ExportButton data={exportData} disabled={exportDisabled} />}
		/>
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
	rows: FilterChoice[];
	onValueChange: (value: string) => void;
}) {
	return (
		<div className="min-w-0 space-y-2">
			<p className="text-sm text-muted-foreground">{label}</p>
			<Select value={value} onValueChange={onValueChange}>
				<SelectTrigger className="w-full min-w-0" aria-label={ariaLabel}>
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
		<LoadingRegion
			className="flex items-center justify-center py-12"
			label={{
				labelKey: "analytics.overtimeBurnDown.loading",
				labelDefault: "Loading overtime data",
			}}
		>
			<IconLoader2
				aria-hidden="true"
				className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
			/>
		</LoadingRegion>
	);
}

function SummaryCards({
	summary,
	t,
}: {
	summary: OvertimeBurnDownData["summary"];
	t: TFunction;
}) {
	const locale = useLocale();
	return (
		<dl className="grid divide-y rounded-xl border bg-card sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
			<SummaryCard
				title={t(
					"analytics.overtimeBurnDown.currentOvertime",
					"Current Overtime",
				)}
				value={formatHours(summary.currentOvertimeHours, locale)}
				description={t(
					"analytics.overtimeBurnDown.selectedRangeDescription",
					"For selected date range and filters",
				)}
			/>
			<SummaryCard
				title={t("analytics.overtimeBurnDown.weekOverWeek", "Week-over-Week")}
				value={`${summary.wowDeltaHours > 0 ? "+" : ""}${formatHours(summary.wowDeltaHours, locale)}`}
				description={t(
					"analytics.overtimeBurnDown.previousPeriodDescription",
					"Compared with previous period",
				)}
			/>
			<SummaryCard
				title={t(
					"analytics.overtimeBurnDown.improvingGroups",
					"Improving Groups",
				)}
				value={summary.improvingGroups.toLocaleString(locale)}
				description={t(
					"analytics.overtimeBurnDown.improvingGroupsDescription",
					"Groups with decreasing overtime",
				)}
			/>
			<SummaryCard
				title={t(
					"analytics.overtimeBurnDown.trendDirection",
					"Trend Direction",
				)}
				value={formatTrendDirection(summary.trendDirection, t)}
				description={t(
					"analytics.overtimeBurnDown.trendDirectionDescription",
					"Overall overtime trajectory",
				)}
			/>
		</dl>
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
		<div className="min-w-0 space-y-2 p-5 sm:border-r last:border-r-0">
			<dt className="text-sm text-muted-foreground">{title}</dt>
			<dd className="text-2xl font-semibold tabular-nums">{value}</dd>
			<dd className="text-sm text-muted-foreground">{description}</dd>
		</div>
	);
}

function WeeklyTrendCard({
	data,
	t,
}: {
	data: OvertimeBurnDownData | null;
	t: TFunction;
}) {
	const locale = useLocale();
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>
						{t(
							"analytics.overtimeBurnDown.weeklyTrend.title",
							"Weekly Burn-Down Trend",
						)}
					</h2>
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
					<>
						<ChartContainer
							config={{
								overtimeHours: {
									label: t("analytics.common.overtimeHours", "Overtime Hours"),
									color: "var(--chart-1)",
								},
							}}
							className="h-[320px] w-full"
						>
							<BarChart data={data?.weeklySeries ?? []}>
								<CartesianGrid strokeDasharray="3 3" />
								<XAxis
									dataKey="weekStart"
									tickLine={false}
									tickMargin={10}
									axisLine={false}
									tickFormatter={(value: string) =>
										Temporal.PlainDate.from(value).toLocaleString(locale, {
											month: "short",
											day: "2-digit",
										})
									}
								/>
								<YAxis tickLine={false} axisLine={false} />
								<ChartTooltip
									content={<ChartTooltipContent />}
									labelFormatter={(value) =>
										Temporal.PlainDate.from(String(value)).toLocaleString(
											locale,
											{ dateStyle: "medium" },
										)
									}
								/>
								<Bar
									dataKey="overtimeHours"
									fill="var(--color-overtimeHours)"
									radius={4}
								/>
							</BarChart>
						</ChartContainer>
						<details className="mt-4 text-sm">
							<summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
								{t(
									"analytics.overtimeBurnDown.chartValues",
									"View weekly values",
								)}
							</summary>
							<ul className="mt-3 divide-y">
								{data?.weeklySeries.map((week) => (
									<li
										key={week.weekStart}
										className="flex flex-wrap justify-between gap-2 py-2 tabular-nums"
									>
										<span>
											{Temporal.PlainDate.from(week.weekStart).toLocaleString(
												locale,
												{ dateStyle: "medium" },
											)}
										</span>
										<span>{formatHours(week.overtimeHours, locale)}</span>
									</li>
								))}
							</ul>
						</details>
					</>
				) : (
					<div className="flex h-[320px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
						{t(
							"analytics.overtimeBurnDown.weeklyTrend.empty",
							"No trend data available yet",
						)}
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
	const locale = useLocale();
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{t("analytics.overtimeBurnDown.breakdown", "Breakdown")}</h2>
				</CardTitle>
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
					<Table
						mobileLayout="scroll"
						className="tabular-nums"
						aria-label={t("analytics.overtimeBurnDown.breakdown", "Breakdown")}
					>
						<TableHeader>
							<TableRow>
								<TableHead>{breakdownLabel}</TableHead>
								<TableHead className="text-right">
									{t(
										"analytics.overtimeBurnDown.currentOvertime",
										"Current Overtime",
									)}
								</TableHead>
								<TableHead className="text-right">
									{t(
										"analytics.overtimeBurnDown.previousOvertime",
										"Previous Overtime",
									)}
								</TableHead>
								<TableHead className="text-right">
									{t(
										"analytics.overtimeBurnDown.weekOverWeek",
										"Week-over-Week",
									)}
								</TableHead>
								<TableHead>
									{t(
										"analytics.overtimeBurnDown.trendDirection",
										"Trend Direction",
									)}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={row.id}>
									<TableCell className="min-w-40 max-w-72 whitespace-normal break-words font-medium">
										{row.label}
									</TableCell>
									<TableCell className="text-right">
										{formatHours(row.currentOvertimeHours, locale)}
									</TableCell>
									<TableCell className="text-right">
										{formatHours(row.previousOvertimeHours, locale)}
									</TableCell>
									<TableCell className="text-right">
										{row.wowDeltaHours > 0 ? "+" : ""}
										{formatHours(row.wowDeltaHours, locale)}
									</TableCell>
									<TableCell>
										{formatTrendDirection(row.trendDirection, t)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				) : (
					<div className="flex h-[240px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
						{t(
							"analytics.overtimeBurnDown.breakdownEmpty",
							"No breakdown data available yet",
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function buildOvertimeExport(
	selectedBreakdownRows: BreakdownRow[],
	breakdownLabel: string,
	breakdownDimension: BreakdownDimension,
	dateRange: DateRange | null,
	timezone: string,
	t: TFunction,
): ExportData<ExportRow> {
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
				label: t(
					"analytics.overtimeBurnDown.currentOvertime",
					"Current Overtime",
				),
			},
			{
				key: "previousOvertime" as const,
				label: t(
					"analytics.overtimeBurnDown.previousOvertime",
					"Previous Overtime",
				),
			},
			{
				key: "weekOverWeek" as const,
				label: t("analytics.overtimeBurnDown.weekOverWeek", "Week-over-Week"),
			},
			{
				key: "trendDirection" as const,
				label: t(
					"analytics.overtimeBurnDown.trendDirection",
					"Trend Direction",
				),
			},
		],
		filename:
			"overtime-burndown-" +
			breakdownDimension +
			"-" +
			(dateRange
				? Temporal.Instant.fromEpochMilliseconds(dateRange.start.getTime())
						.toZonedDateTimeISO(timezone)
						.toPlainDate()
						.toString()
				: "pending"),
	};
}

export default function OvertimeBurnDownPage() {
	const organizationId = useOrganizationSettings(
		(state) => state.organizationId,
	);
	return <OvertimeBurnDown key={organizationId ?? "pending"} />;
}

function OvertimeBurnDown() {
	const { t } = useTranslate();
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const hasUserChangedRange = useRef(false);
	const [dateRange, setDateRange] = useState<DateRange | null>(null);
	const [state, dispatch] = useReducer(
		overtimeBurnDownReducer,
		overtimeBurnDownInitialState,
	);
	const {
		loading,
		refreshing,
		failed,
		teamId,
		costCenterId,
		managerId,
		breakdownDimension,
	} = state;
	const requestKey = JSON.stringify([
		dateRange?.start.getTime(),
		dateRange?.end.getTime(),
		teamId,
		costCenterId,
		managerId,
	]);
	const data = state.requestKey === requestKey ? state.data : null;

	useEffect(() => {
		if (!isHydrated || hasUserChangedRange.current) {
			return;
		}

		const nextDateRange = getAnalyticsDateRangeForPreset("current_month", {
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

	const handleFilterChange = (
		name: "teamId" | "costCenterId" | "managerId",
		value: string,
	) => {
		dispatch({ type: "filterChanged", name, value });
	};

	const refreshGeneration = useRef(0);
	const runAnalyticsLoad = useCallback(
		async (background = false) => {
			if (!isHydrated || !dateRange) {
				return;
			}

			const expectedDefaultDateRange = getAnalyticsDateRangeForPreset(
				"current_month",
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

			async function loadData() {
				dispatch({ type: "loadingStarted", background });
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

					if (!isLatest()) {
						return;
					}

					if (result.success && result.data) {
						dispatch({ type: "dataLoaded", data: result.data, requestKey });
						return true;
					}

					dispatch({
						type: "dataLoadFailed",
						background,
						refused: [
							"AuthenticationError",
							"AuthorizationError",
							"NotFoundError",
							"BillingError",
						].includes(result.success ? "" : (result.code ?? "")),
					});
					toast.error(
						t(
							"analytics.overtimeBurnDown.errors.loadData",
							"Failed to load overtime burn-down data",
						),
					);
					return false;
				} catch (error) {
					console.error("Failed to load overtime burn-down data:", error);
					if (isLatest()) {
						dispatch({ type: "dataLoadFailed", background });
						toast.error(
							t(
								"analytics.overtimeBurnDown.errors.loadData",
								"Failed to load overtime burn-down data",
							),
						);
					}
					return false;
				}
			}

			const succeeded = await loadData();
			if (succeeded === false && background)
				throw new Error("Overtime analytics refresh failed");
		},
		[
			dateRange,
			teamId,
			costCenterId,
			managerId,
			isHydrated,
			timezone,
			t,
			requestKey,
		],
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

	const exportData = buildOvertimeExport(
		selectedBreakdownRows,
		breakdownLabel,
		breakdownDimension,
		dateRange,
		timezone,
		t,
	);

	return (
		<div className="min-w-0 space-y-6">
			<AnalyticsToolbar
				t={t}
				dateRange={dateRange}
				onDateRangeChange={handleDateRangeChange}
				data={state.choices}
				teamId={teamId}
				costCenterId={costCenterId}
				managerId={managerId}
				breakdownDimension={breakdownDimension}
				onFilterChange={handleFilterChange}
				onBreakdownChange={(value) =>
					dispatch({ type: "breakdownChanged", value })
				}
				exportData={exportData}
				exportDisabled={
					loading || !data || selectedBreakdownRows.length === 0 || !dateRange
				}
			/>

			{loading && <LoadingState />}
			{refreshing && (
				<p role="status" className="text-sm text-muted-foreground">
					{t(
						"analytics.overtimeBurnDown.refreshing",
						"Refreshing overtime data",
					)}
				</p>
			)}
			{failed && (
				<Alert variant="destructive">
					<AlertDescription className="flex flex-wrap items-center justify-between gap-3">
						<span>
							{t(
								"analytics.overtimeBurnDown.errors.retryDescription",
								"Overtime data could not be loaded. Retry the selected period and filters.",
							)}
						</span>
						<Button
							variant="outline"
							size="sm"
							onClick={() =>
								void runAnalyticsLoad(Boolean(data)).catch(() => {})
							}
						>
							{t("common.retry", "Retry")}
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{!loading && data && (
				<>
					<SummaryCards summary={data.summary} t={t} />
					<WeeklyTrendCard data={data} t={t} />
					<BreakdownCard
						rows={selectedBreakdownRows}
						breakdownLabel={breakdownLabel}
						t={t}
					/>
				</>
			)}
		</div>
	);
}
