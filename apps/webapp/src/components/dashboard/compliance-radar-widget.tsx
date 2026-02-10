"use client";

import {
	IconAlertTriangle,
	IconArrowRight,
	IconExclamationCircle,
	IconInfoCircle,
	IconRadar,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useCallback } from "react";
import { getComplianceStats } from "@/app/[locale]/(app)/settings/compliance-radar/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { queryKeys } from "@/lib/query";
import { DashboardWidget } from "./dashboard-widget";
import { WidgetCard } from "./widget-card";

export function ComplianceRadarWidget() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Use TanStack Query for automatic deduplication and caching
	const { data, isLoading, isFetching } = useQuery({
		queryKey: queryKeys.complianceRadar.stats("widget"),
		queryFn: () => getComplianceStats(),
		staleTime: 60_000, // 1 minute
	});

	const stats = data?.success ? data.data : null;
	const loading = isLoading;
	const refreshing = isFetching && !isLoading;

	const refetch = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: queryKeys.complianceRadar.stats("widget") });
	}, [queryClient]);

	// Don't show widget if no findings
	if (!loading && (!stats || stats.totalOpen === 0)) return null;

	const hasCritical = stats?.bySeverity.critical ?? 0 > 0;
	const hasWarning = stats?.bySeverity.warning ?? 0 > 0;

	return (
		<DashboardWidget id="compliance-radar">
			<WidgetCard
				title={t("dashboard.compliance-radar.title", "Compliance Radar")}
				description={t(
					"dashboard.compliance-radar.description",
					"Labor-law compliance findings",
				)}
				icon={<IconRadar className="size-4 text-blue-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				<div className="space-y-4">
					{/* Status Banner */}
					<div
						className={cn(
							"flex items-center gap-2 rounded-xl px-4 py-3",
							hasCritical
								? "bg-gradient-to-r from-red-500 to-orange-500 text-white shadow-lg shadow-red-500/25"
								: hasWarning
									? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/25"
									: "bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-500/25",
						)}
					>
						<div className="flex items-center justify-center rounded-full bg-white/20 p-2">
							{hasCritical ? (
								<IconAlertTriangle className="size-5" aria-hidden="true" />
							) : hasWarning ? (
								<IconExclamationCircle className="size-5" aria-hidden="true" />
							) : (
								<IconInfoCircle className="size-5" aria-hidden="true" />
							)}
						</div>
						<div className="flex-1">
							<p className="font-semibold">
								{t("dashboard.compliance-radar.openFindings", "{count, plural, one {# open finding} other {# open findings}}", { count: stats?.totalOpen ?? 0 })}
							</p>
							<p className="text-xs opacity-90">
								{hasCritical
									? t("dashboard.compliance-radar.requires-attention", "Requires immediate attention")
									: hasWarning
										? t("dashboard.compliance-radar.review-recommended", "Review recommended")
										: t("dashboard.compliance-radar.for-awareness", "For awareness")}
							</p>
						</div>
					</div>

					{/* Severity Breakdown */}
					<div className="grid grid-cols-3 gap-2">
						{/* Critical */}
						<div className={cn(
							"rounded-lg p-3 text-center",
							(stats?.bySeverity.critical ?? 0) > 0
								? "bg-red-100 dark:bg-red-950"
								: "bg-muted/50"
						)}>
							<div className={cn(
								"text-2xl font-bold",
								(stats?.bySeverity.critical ?? 0) > 0 && "text-red-600"
							)}>
								{stats?.bySeverity.critical ?? 0}
							</div>
							<div className="text-xs text-muted-foreground">
								{t("dashboard.compliance-radar.critical", "Critical")}
							</div>
						</div>

						{/* Warning */}
						<div className={cn(
							"rounded-lg p-3 text-center",
							(stats?.bySeverity.warning ?? 0) > 0
								? "bg-orange-100 dark:bg-orange-950"
								: "bg-muted/50"
						)}>
							<div className={cn(
								"text-2xl font-bold",
								(stats?.bySeverity.warning ?? 0) > 0 && "text-orange-600"
							)}>
								{stats?.bySeverity.warning ?? 0}
							</div>
							<div className="text-xs text-muted-foreground">
								{t("dashboard.compliance-radar.warning", "Warning")}
							</div>
						</div>

						{/* Info */}
						<div className="rounded-lg bg-muted/50 p-3 text-center">
							<div className="text-2xl font-bold">
								{stats?.bySeverity.info ?? 0}
							</div>
							<div className="text-xs text-muted-foreground">
								{t("dashboard.compliance-radar.info", "Info")}
							</div>
						</div>
					</div>

					{/* Action Button */}
					<Button className="w-full group" asChild>
						<Link href="/settings/compliance-radar">
							{t("dashboard.compliance-radar.view-details", "View Compliance Details")}
							<IconArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
						</Link>
					</Button>
				</div>
			</WidgetCard>
		</DashboardWidget>
	);
}
