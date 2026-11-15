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
import type { DateRange, WorkHoursAnalyticsData } from "@/lib/analytics/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { getWorkHoursAnalyticsData } from "../actions";
import {
	DailyWorkHoursCard,
	EmployeeWorkHoursCard,
	VarianceTrendCard,
	WorkHoursDistributionCard,
} from "./records";

function areDateRangesEqual(left: DateRange, right: DateRange) {
	return (
		left.start.getTime() === right.start.getTime() &&
		left.end.getTime() === right.end.getTime()
	);
}

type LoadState = {
	data: WorkHoursAnalyticsData | null;
	requestKey: string | null;
	loading: boolean;
	refreshing: boolean;
	failed: boolean;
};
type LoadAction =
	| { type: "loading"; background: boolean }
	| { type: "loaded"; data: WorkHoursAnalyticsData; requestKey: string }
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

export default function WorkHoursPage() {
	const organizationId = useOrganizationSettings(
		(state) => state.organizationId,
	);
	return <WorkHours key={organizationId ?? "pending"} />;
}

function WorkHours() {
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
	const workHoursData = state.requestKey === requestKey ? state.data : null;

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
				const result = await getWorkHoursAnalyticsData(range);
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
				console.error("Failed to load work hours analytics data:", error);
				dispatch({ type: "failed", keep: background });
			}
			if (!succeeded) {
				toast.error(
					t(
						"analytics.workHours.errors.loadData",
						"Failed to load work hours analytics data",
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

	const employees = workHoursData?.byEmployee || [];

	return (
		<div className="min-w-0 space-y-6 px-4 lg:px-6">
			{/* Controls */}
			<WorkHoursControls
				dateRange={dateRange}
				onChange={handleDateRangeChange}
				workHoursData={workHoursData}
				requestKey={requestKey}
				pending={loading || refreshing}
				failed={failed}
			/>

			{refreshing && (
				<p role="status" className="text-sm text-muted-foreground">
					{t(
						"analytics.workHours.refreshing",
						"Refreshing work hours analytics data",
					)}
				</p>
			)}
			{failed && (
				<Alert variant="destructive">
					<AlertDescription className="flex flex-wrap items-center justify-between gap-3">
						<span>
							{workHoursData
								? t(
										"analytics.workHours.refreshFailed",
										"Refresh failed. Showing previously loaded data for this period. Export is unavailable until retry succeeds.",
									)
								: t(
										"analytics.workHours.errors.loadData",
										"Failed to load work hours analytics data",
									)}
						</span>
						<Button
							variant="outline"
							size="sm"
							disabled={loading || refreshing}
							onClick={() =>
								void runAnalyticsLoad(Boolean(workHoursData)).catch(
									() => undefined,
								)
							}
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
						labelKey: "analytics.workHours.loading",
						labelDefault: "Loading work hours analytics data",
					}}
				>
					<IconLoader2
						aria-hidden="true"
						className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
					/>
				</LoadingRegion>
			)}

			{!loading && workHoursData && (
				<>
					<div className="grid min-w-0 gap-6 xl:grid-cols-2">
						<DailyWorkHoursCard data={workHoursData.distribution} t={t} />
						<VarianceTrendCard data={workHoursData.distribution} t={t} />
					</div>
					<EmployeeWorkHoursCard employees={employees} t={t} />
					<WorkHoursDistributionCard
						data={employees.map((employee) => ({
							employee: employee.employeeName,
							hours: employee.totalHours,
						}))}
						t={t}
					/>
				</>
			)}
		</div>
	);
}

function WorkHoursControls({
	dateRange,
	onChange,
	workHoursData,
	requestKey,
	pending,
	failed,
}: {
	dateRange: DateRange | null;
	onChange: (range: DateRange) => void;
	workHoursData: WorkHoursAnalyticsData | null;
	requestKey: string;
	pending: boolean;
	failed: boolean;
}) {
	const { t } = useTranslate();
	return (
		<DataTableToolbar
			filterControls={
				dateRange ? (
					<AnalyticsDateRangePicker value={dateRange} onChange={onChange} />
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
						data: workHoursData?.byEmployee ?? [],
						headers: [
							{
								key: "employeeName",
								label: t("analytics.common.employee", "Employee"),
							},
							{
								key: "totalHours",
								label: t("analytics.common.totalHours", "Total Hours"),
							},
							{
								key: "overtimeHours",
								label: t("analytics.common.overtimeHours", "Overtime Hours"),
							},
							{
								key: "undertimeHours",
								label: t("analytics.common.undertimeHours", "Undertime Hours"),
							},
							{
								key: "avgHoursPerWeek",
								label: t(
									"analytics.workHours.avgHoursPerWeek",
									"Avg Hours/Week",
								),
							},
						],
						filename: `work-hours-${dateRange?.start.toISOString().split("T")[0] ?? "pending"}`,
					}}
					exportScope={requestKey}
					disabled={!workHoursData || !dateRange || pending || failed}
				/>
			}
		/>
	);
}
