"use client";

import { IconAlertTriangle, IconCheck, IconTrendingUp, IconTarget } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useMemo } from "react";
import { getTargetHeatmapData } from "@/app/[locale]/(app)/settings/coverage-rules/actions";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/keys";
import type { HeatmapDataPoint } from "@/lib/coverage/domain/entities/coverage-snapshot";

interface CoverageHeatmapOverlayProps {
	organizationId: string;
	dateRange: { start: Date; end: Date };
	visible: boolean;
	onToggle: () => void;
}

/**
 * Get the coverage status color based on the status.
 */
function getStatusColor(status: "under" | "met" | "over"): string {
	switch (status) {
		case "under":
			return "bg-red-500/30 dark:bg-red-500/40";
		case "met":
			return "bg-green-500/30 dark:bg-green-500/40";
		case "over":
			return "bg-blue-500/30 dark:bg-blue-500/40";
	}
}

/**
 * Get the status icon based on the status.
 */
function getStatusIcon(status: "under" | "met" | "over") {
	switch (status) {
		case "under":
			return <IconAlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />;
		case "met":
			return <IconCheck className="h-4 w-4 text-green-600 dark:text-green-400" />;
		case "over":
			return <IconTrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />;
	}
}

/**
 * Format date for comparison (YYYY-MM-DD).
 */
function formatDateKey(date: Date): string {
	return date.toISOString().split("T")[0];
}

/**
 * Coverage toggle button for the scheduler toolbar.
 */
export function CoverageToggleButton({
	visible,
	onToggle,
	hasGaps,
}: {
	visible: boolean;
	onToggle: () => void;
	hasGaps: boolean;
}) {
	const { t } = useTranslate();

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant={visible ? "secondary" : "outline"}
						size="sm"
						onClick={onToggle}
						className={cn(
							"relative",
							hasGaps && !visible && "ring-2 ring-red-500 ring-offset-2",
						)}
					>
						<IconTarget className="mr-2 h-4 w-4" />
						{t("scheduling.coverage.toggleLabel", "Coverage")}
						{hasGaps && (
							<span className="absolute -right-1 -top-1 flex h-3 w-3">
								<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
								<span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
							</span>
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					<p>
						{visible
							? t("scheduling.coverage.hideOverlay", "Hide coverage overlay")
							: t("scheduling.coverage.showOverlay", "Show coverage targets overlay")}
					</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

/**
 * Coverage day indicator for the scheduler day headers.
 */
export function CoverageDayIndicator({ dataPoints }: { dataPoints: HeatmapDataPoint[] }) {
	const { t } = useTranslate();

	if (dataPoints.length === 0) return null;

	// Single iteration for all calculations (js-combine-iterations)
	let hasUnder = false;
	let hasOver = false;
	let totalGaps = 0;
	let totalUtilization = 0;
	for (const dp of dataPoints) {
		if (dp.status === "under") hasUnder = true;
		else if (dp.status === "over") hasOver = true;
		totalGaps += dp.gapCount;
		totalUtilization += dp.utilizationPercent;
	}
	const worstStatus = hasUnder ? "under" : hasOver ? "over" : "met";
	const avgUtilization = totalUtilization / dataPoints.length;

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<div
						className={cn(
							"absolute inset-0 pointer-events-none",
							getStatusColor(worstStatus),
						)}
					>
						<div className="absolute bottom-1 right-1 pointer-events-auto">
							{getStatusIcon(worstStatus)}
						</div>
					</div>
				</TooltipTrigger>
				<TooltipContent side="bottom" className="max-w-xs">
					<div className="space-y-1">
						<p className="font-medium">
							{worstStatus === "under"
								? t("scheduling.coverage.understaffed", "Understaffed")
								: worstStatus === "met"
									? t("scheduling.coverage.adequate", "Adequate staffing")
									: t("scheduling.coverage.overstaffed", "Overstaffed")}
						</p>
						{totalGaps > 0 && (
							<p className="text-sm text-muted-foreground">
								{t("scheduling.coverage.gapCount", "{{count}} staff shortage", {
									count: totalGaps,
								})}
							</p>
						)}
						<p className="text-sm text-muted-foreground">
							{t("scheduling.coverage.utilization", "{{percent}}% utilization", {
								percent: avgUtilization.toFixed(0),
							})}
						</p>
						{dataPoints.length > 1 && (
							<div className="mt-2 border-t pt-2">
								<p className="text-xs font-medium mb-1">
									{t("scheduling.coverage.byLocation", "By location:")}
								</p>
								{dataPoints.map((dp) => (
									<div
										key={dp.subareaId}
										className="flex items-center gap-2 text-xs"
									>
										{getStatusIcon(dp.status)}
										<span>
											{dp.locationName} - {dp.subareaName}
										</span>
									</div>
								))}
							</div>
						)}
					</div>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

/**
 * Hook to fetch and organize coverage heatmap data.
 */
export function useCoverageHeatmap(
	organizationId: string,
	dateRange: { start: Date; end: Date },
	enabled: boolean,
) {
	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.coverage.heatmap(organizationId, dateRange),
		queryFn: async () => {
			const result = await getTargetHeatmapData({
				startDate: dateRange.start,
				endDate: dateRange.end,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled,
	});

	// Group data points by date
	const dataByDate = useMemo(() => {
		if (!data) return new Map<string, HeatmapDataPoint[]>();

		const map = new Map<string, HeatmapDataPoint[]>();
		for (const point of data) {
			const key = formatDateKey(point.date);
			const existing = map.get(key) || [];
			existing.push(point);
			map.set(key, existing);
		}
		return map;
	}, [data]);

	// Check if there are any gaps
	const hasGaps = useMemo(() => {
		return data?.some((dp) => dp.status === "under") ?? false;
	}, [data]);

	return {
		data: data || [],
		dataByDate,
		hasGaps,
		isLoading,
		error,
	};
}

/**
 * Coverage summary bar to show at the top of the scheduler.
 */
export function CoverageSummaryBar({
	data,
	visible,
}: {
	data: HeatmapDataPoint[];
	visible: boolean;
}) {
	const { t } = useTranslate();

	if (!visible || data.length === 0) return null;

	// Single iteration for all counts (js-combine-iterations)
	let underCount = 0;
	let metCount = 0;
	let overCount = 0;
	let totalGaps = 0;
	for (const dp of data) {
		if (dp.status === "under") {
			underCount++;
			totalGaps += dp.gapCount;
		} else if (dp.status === "met") {
			metCount++;
		} else {
			overCount++;
		}
	}

	return (
		<div className="flex items-center gap-4 px-4 py-2 bg-muted/50 rounded-lg text-sm">
			<span className="font-medium">
				{t("scheduling.coverage.summary", "Coverage Summary:")}
			</span>

			{underCount > 0 && (
				<div className="flex items-center gap-1 text-red-600 dark:text-red-400">
					<IconAlertTriangle className="h-4 w-4" />
					<span>
						{t("scheduling.coverage.underSlots", "{{count}} understaffed", {
							count: underCount,
						})}
						{totalGaps > 0 && ` (${totalGaps} ${t("scheduling.coverage.gaps", "gaps")})`}
					</span>
				</div>
			)}

			{metCount > 0 && (
				<div className="flex items-center gap-1 text-green-600 dark:text-green-400">
					<IconCheck className="h-4 w-4" />
					<span>
						{t("scheduling.coverage.metSlots", "{{count}} adequate", {
							count: metCount,
						})}
					</span>
				</div>
			)}

			{overCount > 0 && (
				<div className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
					<IconTrendingUp className="h-4 w-4" />
					<span>
						{t("scheduling.coverage.overSlots", "{{count}} overstaffed", {
							count: overCount,
						})}
					</span>
				</div>
			)}
		</div>
	);
}

/**
 * Main coverage heatmap overlay component.
 * This component fetches coverage data and provides context for child components.
 */
export function CoverageHeatmapOverlay({
	organizationId,
	dateRange,
	visible,
	onToggle,
}: CoverageHeatmapOverlayProps) {
	const { data, dataByDate, hasGaps, isLoading } = useCoverageHeatmap(
		organizationId,
		dateRange,
		visible,
	);

	return (
		<>
			{/* Toggle button in toolbar */}
			<CoverageToggleButton visible={visible} onToggle={onToggle} hasGaps={hasGaps} />

			{/* Summary bar when visible */}
			{visible && !isLoading && <CoverageSummaryBar data={data} visible={visible} />}
		</>
	);
}

export type { HeatmapDataPoint };
