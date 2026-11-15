"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { AnalyticsDateRangePicker } from "@/components/analytics/date-range-picker";
import { ExportButton } from "@/components/analytics/export-button";
import { DataTableToolbar } from "@/components/data-table-server/data-table-toolbar";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { getAnalyticsDateRangeForPreset } from "@/lib/analytics/date-ranges";
import type { DateRange, TeamPerformanceData } from "@/lib/analytics/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { getTeamPerformanceData } from "../actions";
import { TeamComparison, TeamDetails, VarianceComparison } from "./records";

function areDateRangesEqual(left: DateRange, right: DateRange) {
	return (
		left.start.getTime() === right.start.getTime() &&
		left.end.getTime() === right.end.getTime()
	);
}

type LoadState = {
	data: TeamPerformanceData | null;
	requestKey: string | null;
	loading: boolean;
	refreshing: boolean;
	failed: boolean;
};
type LoadAction =
	| { type: "loading"; background: boolean }
	| { type: "loaded"; data: TeamPerformanceData; requestKey: string }
	| { type: "failed"; keep: boolean };
function loadReducer(state: LoadState, action: LoadAction): LoadState {
	if (action.type === "loading")
		return {
			...state,
			loading: !action.background,
			refreshing: action.background,
		};
	if (action.type === "loaded")
		return {
			data: action.data,
			requestKey: action.requestKey,
			loading: false,
			refreshing: false,
			failed: false,
		};
	return {
		...state,
		data: action.keep ? state.data : null,
		loading: false,
		refreshing: false,
		failed: true,
	};
}

export default function TeamPerformancePage() {
	const organizationId = useOrganizationSettings(
		(state) => state.organizationId,
	);
	return <TeamPerformance key={organizationId ?? "pending"} />;
}

function TeamPerformance() {
	const { t } = useTranslate();
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const hasUserChangedRange = useRef(false);
	const [dateRange, setDateRange] = useState<DateRange | null>(null);
	const [state, dispatch] = useReducer(loadReducer, {
		data: null,
		requestKey: null,
		loading: true,
		refreshing: false,
		failed: false,
	});
	const { loading, refreshing, failed } = state;
	const requestKey = JSON.stringify([
		dateRange?.start.getTime(),
		dateRange?.end.getTime(),
		timezone,
	]);
	const teamData = state.requestKey === requestKey ? state.data : null;

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

			dispatch({ type: "loading", background });
			let succeeded = false;
			try {
				const result = await getTeamPerformanceData(range);
				if (!isLatest()) return;
				if (result.success && result.data) {
					dispatch({ type: "loaded", data: result.data, requestKey });
					succeeded = true;
				} else {
					const refused =
						!result.success &&
						[
							"AuthenticationError",
							"AuthorizationError",
							"NotFoundError",
							"BillingError",
						].includes(result.code ?? "");
					dispatch({ type: "failed", keep: background && !refused });
				}
			} catch (error) {
				if (!isLatest()) return;
				console.error("Failed to load team performance data:", error);
				dispatch({ type: "failed", keep: background });
			}
			if (!succeeded) {
				toast.error(
					t(
						"analytics.teamPerformance.errors.loadData",
						"Failed to load team performance data",
					),
				);
				if (background) throw new Error("Team performance refresh failed");
			}
		},
		[dateRange, isHydrated, timezone, t, requestKey],
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

	const teams = teamData?.teams || [];

	return (
		<div className="min-w-0 space-y-6 px-4 lg:px-6">
			{/* Controls */}
			<DataTableToolbar
				filterControls={
					dateRange ? (
						<AnalyticsDateRangePicker
							value={dateRange}
							onChange={handleDateRangeChange}
						/>
					) : (
						<p className="text-sm text-muted-foreground">
							{t(
								"analytics.common.loadingOrganizationSettings",
								"Loading organization settings before enabling presets.",
							)}
						</p>
					)
				}
				actions={
					<ExportButton
						data={{
							data: teams,
							headers: [
								{ key: "teamName", label: t("analytics.common.team", "Team") },
								{
									key: "totalHours",
									label: t("analytics.common.totalHours", "Total Hours"),
								},
								{
									key: "avgHoursPerEmployee",
									label: t(
										"analytics.teamPerformance.avgPerEmployee",
										"Avg per Employee",
									),
								},
								{
									key: "employeeCount",
									label: t(
										"analytics.teamPerformance.employeeCount",
										"Employee Count",
									),
								},
							],
							filename: `team-performance-${dateRange?.start.toISOString().split("T")[0] ?? "pending"}`,
						}}
						exportScope={requestKey}
						disabled={
							!teamData || !dateRange || loading || refreshing || failed
						}
					/>
				}
			/>

			{refreshing && (
				<p role="status" className="text-sm text-muted-foreground">
					{t(
						"analytics.teamPerformance.refreshing",
						"Refreshing team performance data",
					)}
				</p>
			)}
			{failed && (
				<Alert variant="destructive">
					<AlertDescription className="flex flex-wrap items-center justify-between gap-3">
						<span>
							{teamData
								? t(
										"analytics.teamPerformance.refreshFailed",
										"Refresh failed. Showing previously loaded data for this period. Export is unavailable until retry succeeds.",
									)
								: t(
										"analytics.teamPerformance.errors.loadData",
										"Failed to load team performance data",
									)}
						</span>
						<Button
							variant="outline"
							size="sm"
							disabled={loading || refreshing}
							onClick={() => void runAnalyticsLoad()}
						>
							{t("common.retry", "Retry")}
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{loading && (
				<LoadingRegion
					className="flex items-center justify-center gap-2 py-12"
					label={{
						labelKey: "analytics.teamPerformance.loading",
						labelDefault: "Loading team performance data",
					}}
				>
					<IconLoader2
						aria-hidden="true"
						className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
					/>
				</LoadingRegion>
			)}

			{!loading && teamData && (
				<>
					<div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
						<TeamComparison teams={teams} />
						<TeamDetails teams={teams} />
					</div>
					<VarianceComparison teams={teams} />
				</>
			)}
		</div>
	);
}
