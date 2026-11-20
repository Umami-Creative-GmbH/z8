"use client";

import { IconClock } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useMemo } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import type {
	DashboardWidgetData,
	DashboardWidgetSnapshot,
} from "./dashboard-types";
import { DashboardWidget } from "./dashboard-widget";
import { getQuickStatsStatus } from "./quick-stats-status";
import { useDashboardWidget } from "./use-dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WidgetReadError } from "./widget-read-error";

function PeriodSummary({
	title,
	actual,
	expected,
	expectedToDate,
	className,
}: {
	title: string;
	actual: number;
	expected: number;
	expectedToDate: number;
	className?: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const percentage = expected > 0 ? (actual / expected) * 100 : 0;
	const status = getQuickStatsStatus({ actual, expectedToDate });
	const number = useMemo(
		() =>
			new Intl.NumberFormat(locale, {
				minimumFractionDigits: 1,
				maximumFractionDigits: 1,
			}),
		[locale],
	);
	return (
		<div className={cn("min-w-0 space-y-2", className)}>
			<p className="text-sm text-muted-foreground">{title}</p>
			<p className="text-2xl font-semibold tabular-nums">
				{number.format(actual)}{" "}
				<span className="text-sm font-normal text-muted-foreground">
					{t("dashboard.quick-stats.hours", "hours")}
				</span>
			</p>
			<p className="text-sm text-muted-foreground">
				{t(
					"dashboard.quick-stats.progress",
					"{actual}h of {expected}h ({percent}%)",
					{
						actual: number.format(actual),
						expected: number.format(expected),
						percent: Math.round(percentage).toLocaleString(locale),
					},
				)}
			</p>
			<Progress
				aria-label={title}
				value={Math.min(100, Math.max(0, percentage))}
				className="h-1.5"
			/>
			<p className="text-sm text-muted-foreground">
				{status === "on-track"
					? t("dashboard.quick-stats.on-track", "On track")
					: status === "behind"
						? t("dashboard.quick-stats.behind", "Behind")
						: t("dashboard.quick-stats.good-pace", "Good pace")}
			</p>
		</div>
	);
}

export function QuickStatsWidget({
	initialSnapshot,
}: {
	initialSnapshot?: DashboardWidgetSnapshot<DashboardWidgetData["quick-stats"]>;
} = {}) {
	const { t } = useTranslate();
	const {
		data: stats,
		loading,
		refreshing,
		refetch,
		error,
	} = useDashboardWidget("quick-stats", initialSnapshot);
	if (!stats && !loading && !error) return null;
	return (
		<DashboardWidget id="quick-stats">
			<WidgetCard
				title={t("dashboard.quick-stats.title", "Time Tracking")}
				description={t(
					"dashboard.quick-stats.description",
					"Your weekly and monthly progress",
				)}
				icon={<IconClock className="size-4 text-blue-500" aria-hidden="true" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				{error ? (
					<WidgetReadError
						title={t("dashboard.quick-stats.title", "Time Tracking")}
						message={t(
							"dashboard.quick-stats.error",
							"Failed to load quick stats",
						)}
						retry={refetch}
						refreshing={refreshing}
					/>
				) : stats ? (
					// Stacked in a narrow card, week and month side by side from a medium card
					// (balance below), all three in one row only when the card is wide.
					<div className="grid gap-x-6 gap-y-5 @sm/widget:grid-cols-2 @2xl/widget:grid-cols-3">
						<PeriodSummary
							title={t("dashboard.quick-stats.this-week", "This Week")}
							{...stats.thisWeek}
						/>
						<PeriodSummary
							title={t("dashboard.quick-stats.this-month", "This Month")}
							className="border-t pt-5 @sm/widget:border-t-0 @sm/widget:border-l @sm/widget:pt-0 @sm/widget:pl-6"
							{...stats.thisMonth}
						/>
						<BalanceSummary
							stats={stats}
							className="border-t pt-5 @sm/widget:col-span-2 @2xl/widget:col-span-1 @2xl/widget:border-t-0 @2xl/widget:border-l @2xl/widget:pt-0 @2xl/widget:pl-6"
						/>
					</div>
				) : null}
			</WidgetCard>
		</DashboardWidget>
	);
}

function BalanceSummary({
	stats,
	className,
}: {
	stats: DashboardWidgetData["quick-stats"];
	className?: string;
}) {
	const { t } = useTranslate();
	return (
		<div className={cn("min-w-0 space-y-2", className)}>
			<p className="text-sm text-muted-foreground">
				{t("workBalance.label", "All-time balance")}
			</p>
			<p className="text-2xl font-semibold tabular-nums">
				{stats.workBalanceUnavailable
					? t("dashboard.refresh.balanceUnavailable", "Balance unavailable")
					: stats.workBalance
						? formatSignedWorkBalance(stats.workBalance.balanceMinutes)
						: t("workBalance.notCalculated", "Not calculated yet")}
			</p>
			<p className="text-sm text-muted-foreground">
				{stats.workBalanceUnavailable
					? t(
							"dashboard.refresh.balanceRetry",
							"Refresh to try loading the balance again.",
						)
					: stats.workBalance?.computedAt
						? t("workBalance.updatedEveryThreeHours", "Updated every 3 hours")
						: t(
								"workBalance.pendingDescription",
								"The worker will calculate this balance soon.",
							)}
			</p>
		</div>
	);
}
