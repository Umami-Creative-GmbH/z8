"use client";

import { IconClock, IconTrendingUp, IconTrendingDown } from "@tabler/icons-react";
import { Progress } from "@/components/ui/progress";
import { getQuickStats } from "./actions";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

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

export function QuickStatsWidget() {
	const { data: stats, loading } = useWidgetData<QuickStats>(getQuickStats, {
		errorMessage: "Failed to load quick stats",
	});

	if (!stats && !loading) return null;

	const weekPercentage = stats?.thisWeek.expected
		? (stats.thisWeek.actual / stats.thisWeek.expected) * 100
		: 0;
	const monthPercentage = stats?.thisMonth.expected
		? (stats.thisMonth.actual / stats.thisMonth.expected) * 100
		: 0;

	const getStatusColor = (percentage: number) => {
		if (percentage >= 90) return "text-green-500";
		if (percentage >= 75) return "text-yellow-500";
		return "text-orange-500";
	};

	return (
		<WidgetCard
			title="Quick Stats"
			description="Your weekly and monthly hours"
			icon={<IconClock className="size-4 text-muted-foreground" />}
			loading={loading}
		>
			{stats && (
				<div className="space-y-6">
					{/* This Week */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">This Week</span>
							<div className="flex items-center gap-2">
								<span className="text-2xl font-bold">
									{stats.thisWeek.actual.toFixed(1)}h
								</span>
								{weekPercentage >= 100 ? (
									<IconTrendingUp className="size-4 text-green-500" />
								) : weekPercentage < 75 ? (
									<IconTrendingDown className="size-4 text-orange-500" />
								) : null}
							</div>
						</div>
						<Progress value={Math.min(weekPercentage, 100)} className="h-2" />
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">
								{stats.thisWeek.actual.toFixed(1)}h /{" "}
								{stats.thisWeek.expected.toFixed(1)}h
							</span>
							<span className={getStatusColor(weekPercentage)}>
								{weekPercentage.toFixed(0)}%
							</span>
						</div>
					</div>

					{/* This Month */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">This Month</span>
							<div className="flex items-center gap-2">
								<span className="text-2xl font-bold">
									{stats.thisMonth.actual.toFixed(1)}h
								</span>
								{monthPercentage >= 100 ? (
									<IconTrendingUp className="size-4 text-green-500" />
								) : monthPercentage < 75 ? (
									<IconTrendingDown className="size-4 text-orange-500" />
								) : null}
							</div>
						</div>
						<Progress value={Math.min(monthPercentage, 100)} className="h-2" />
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">
								{stats.thisMonth.actual.toFixed(1)}h /{" "}
								{stats.thisMonth.expected.toFixed(1)}h
							</span>
							<span className={getStatusColor(monthPercentage)}>
								{monthPercentage.toFixed(0)}%
							</span>
						</div>
					</div>
				</div>
			)}
		</WidgetCard>
	);
}
