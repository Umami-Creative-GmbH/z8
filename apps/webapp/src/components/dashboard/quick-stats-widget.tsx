"use client";

import {
	IconCalendarWeek,
	IconClock,
	IconFlame,
	IconTrendingDown,
	IconTrendingUp,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { cn } from "@/lib/utils";
import { getQuickStats } from "./actions";
import { DashboardWidget } from "./dashboard-widget";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

function HoursLabel() {
	const { t } = useTranslate();
	return <span className="text-[10px] text-muted-foreground">{t("dashboard.quick-stats.hours", "hours")}</span>;
}

type QuickStats = {
	thisWeek: {
		actual: number;
		expected: number;
	};
	thisMonth: {
		actual: number;
		expected: number;
	};
};

function CircularProgress({
	progress,
	size = 80,
	strokeWidth = 6,
	children,
	color = "blue",
}: {
	progress: number;
	size?: number;
	strokeWidth?: number;
	children: React.ReactNode;
	color?: "blue" | "purple" | "green" | "orange";
}) {
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const strokeDashoffset = circumference - (Math.min(progress, 100) / 100) * circumference;

	const colorClasses = {
		blue: "stroke-blue-500",
		purple: "stroke-purple-500",
		green: "stroke-emerald-500",
		orange: "stroke-orange-500",
	};

	const glowClasses = {
		blue: "stroke-blue-400/50",
		purple: "stroke-purple-400/50",
		green: "stroke-emerald-400/50",
		orange: "stroke-orange-400/50",
	};

	return (
		<div className="relative inline-flex items-center justify-center">
			<svg className="-rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				{/* Background circle */}
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					strokeWidth={strokeWidth}
					className="stroke-muted"
				/>
				{/* Progress circle */}
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					className={cn("transition-all duration-500 ease-out", colorClasses[color])}
					style={{
						strokeDasharray: circumference,
						strokeDashoffset,
					}}
				/>
				{/* Glow effect when near/over target */}
				{progress >= 90 && (
					<circle
						cx={size / 2}
						cy={size / 2}
						r={radius}
						fill="none"
						strokeWidth={strokeWidth}
						strokeLinecap="round"
						className={cn("blur-sm", glowClasses[color])}
						style={{
							strokeDasharray: circumference,
							strokeDashoffset,
						}}
					/>
				)}
			</svg>
			<div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
		</div>
	);
}

function StatCard({
	title,
	icon: Icon,
	actual,
	expected,
	color,
}: {
	title: string;
	icon: React.ElementType;
	actual: number;
	expected: number;
	color: "blue" | "purple";
}) {
	const { t } = useTranslate();
	const percentage = expected > 0 ? (actual / expected) * 100 : 0;
	const isOnTrack = percentage >= 90;
	const isBehind = percentage < 75;

	return (
		<div className="flex items-center gap-4 rounded-xl border bg-card p-4">
			<CircularProgress
				progress={percentage}
				color={isOnTrack ? "green" : isBehind ? "orange" : color}
			>
				<div className="flex flex-col items-center">
					<span className="text-lg font-bold tabular-nums">{actual.toFixed(1)}</span>
					<HoursLabel />
				</div>
			</CircularProgress>

			<div className="flex-1 space-y-1">
				<div className="flex items-center gap-2">
					<Icon className="size-4 text-muted-foreground" />
					<span className="text-sm font-medium">{title}</span>
				</div>

				<div className="flex items-center gap-2">
					<div
						className={cn(
							"flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
							isOnTrack
								? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
								: isBehind
									? "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
									: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
						)}
					>
						{isOnTrack ? (
							<>
								<IconTrendingUp className="size-3" />
								{t("dashboard.quick-stats.on-track", "On track")}
							</>
						) : isBehind ? (
							<>
								<IconTrendingDown className="size-3" />
								{t("dashboard.quick-stats.behind", "Behind")}
							</>
						) : (
							<>
								<IconFlame className="size-3" />
								{t("dashboard.quick-stats.good-pace", "Good pace")}
							</>
						)}
					</div>
				</div>

				<p className="text-xs text-muted-foreground">
					{t("dashboard.quick-stats.progress", "{actual}h of {expected}h ({percent}%)", { actual: actual.toFixed(1), expected: expected.toFixed(1), percent: percentage.toFixed(0) })}
				</p>
			</div>
		</div>
	);
}

export function QuickStatsWidget() {
	const { t } = useTranslate();
	const {
		data: stats,
		loading,
		refreshing,
		refetch,
	} = useWidgetData<QuickStats>(getQuickStats, {
		errorMessage: t("dashboard.quick-stats.error", "Failed to load quick stats"),
	});

	if (!stats && !loading) return null;

	return (
		<DashboardWidget id="quick-stats">
			<WidgetCard
				title={t("dashboard.quick-stats.title", "Time Tracking")}
				description={t("dashboard.quick-stats.description", "Your weekly and monthly progress")}
				icon={<IconClock className="size-4 text-blue-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				{stats && (
					<div className="space-y-3">
						<StatCard
							title={t("dashboard.quick-stats.this-week", "This Week")}
							icon={IconCalendarWeek}
							actual={stats.thisWeek.actual}
							expected={stats.thisWeek.expected}
							color="blue"
						/>
						<StatCard
							title={t("dashboard.quick-stats.this-month", "This Month")}
							icon={IconClock}
							actual={stats.thisMonth.actual}
							expected={stats.thisMonth.expected}
							color="purple"
						/>
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
