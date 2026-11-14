"use client";

import { IconClock } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useMemo } from "react";
import { Progress } from "@/components/ui/progress";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import { Link } from "@/navigation";
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
}: {
	title: string;
	actual: number;
	expected: number;
	expectedToDate: number;
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
		<div className="min-w-0 space-y-3 p-5">
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
				icon={<IconClock className="size-4" aria-hidden="true" />}
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
					<div className="-mx-5 grid divide-y min-[380px]:grid-cols-2 sm:grid-cols-3 min-[380px]:divide-x min-[380px]:[&>div:last-child]:col-span-2 sm:[&>div:last-child]:col-span-1 sm:divide-y-0">
						<PeriodSummary
							title={t("dashboard.quick-stats.this-week", "This Week")}
							{...stats.thisWeek}
						/>
						<PeriodSummary
							title={t("dashboard.quick-stats.this-month", "This Month")}
							{...stats.thisMonth}
						/>
						<BalanceSummary stats={stats} />
					</div>
				) : null}
			</WidgetCard>
		</DashboardWidget>
	);
}

function BalanceSummary({
	stats,
}: {
	stats: DashboardWidgetData["quick-stats"];
}) {
	const { t } = useTranslate();
	return (
		<div className="min-w-0 space-y-3 p-5">
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
			<Link
				className="inline-flex min-h-9 items-center text-sm font-medium text-primary underline-offset-4 hover:underline dark:text-foreground dark:underline"
				href="/time-tracking"
			>
				{t("dashboard.refresh.openTimeTracking", "Go to time tracking")}
			</Link>
		</div>
	);
}
