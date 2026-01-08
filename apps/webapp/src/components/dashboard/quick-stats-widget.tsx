"use client";

import { IconClock, IconLoader2, IconTrendingUp, IconTrendingDown } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getQuickStats } from "./actions";

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
	const [stats, setStats] = useState<QuickStats | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function loadData() {
			try {
				const result = await getQuickStats();
				if (result.success && result.data) {
					setStats(result.data);
				}
			} catch (error) {
				toast.error("Failed to load quick stats");
			} finally {
				setLoading(false);
			}
		}
		loadData();
	}, []);

	if (loading) {
		return (
			<Card className="overflow-hidden gap-0 py-0">
				<CardHeader className="bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-sky-500/10 py-4">
					<CardTitle className="flex items-center gap-2">
						<div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 text-white">
							<IconClock className="size-4" />
						</div>
						Quick Stats
					</CardTitle>
					<CardDescription className="mt-1.5">
						Your weekly and monthly hours
					</CardDescription>
				</CardHeader>
				<CardContent className="py-4">
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!stats) {
		return null;
	}

	const weekPercentage = stats.thisWeek.expected > 0
		? (stats.thisWeek.actual / stats.thisWeek.expected) * 100
		: 0;
	const monthPercentage = stats.thisMonth.expected > 0
		? (stats.thisMonth.actual / stats.thisMonth.expected) * 100
		: 0;

	const weekStatus = weekPercentage >= 90 ? "on-track" : weekPercentage >= 75 ? "under" : "low";
	const monthStatus = monthPercentage >= 90 ? "on-track" : monthPercentage >= 75 ? "under" : "low";

	return (
		<Card className="overflow-hidden gap-0 py-0">
			<CardHeader className="bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-sky-500/10 py-4">
				<CardTitle className="flex items-center gap-2">
					<div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 text-white">
						<IconClock className="size-4" />
					</div>
					Quick Stats
				</CardTitle>
				<CardDescription className="mt-1.5">
					Your weekly and monthly hours
				</CardDescription>
			</CardHeader>
			<CardContent className="py-4">
				<div className="space-y-6">
					{/* This Week */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">This Week</span>
							<div className="flex items-center gap-2">
								<span className="text-2xl font-bold">{stats.thisWeek.actual.toFixed(1)}h</span>
								{weekPercentage >= 100 ? (
									<IconTrendingUp className="size-4 text-green-500" />
								) : weekPercentage < 75 ? (
									<IconTrendingDown className="size-4 text-orange-500" />
								) : null}
							</div>
						</div>
						<Progress
							value={Math.min(weekPercentage, 100)}
							className="h-2"
						/>
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">
								{stats.thisWeek.actual.toFixed(1)}h / {stats.thisWeek.expected.toFixed(1)}h
							</span>
							<span
								className={
									weekStatus === "on-track"
										? "text-green-500"
										: weekStatus === "under"
											? "text-yellow-500"
											: "text-orange-500"
								}
							>
								{weekPercentage.toFixed(0)}%
							</span>
						</div>
					</div>

					{/* This Month */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">This Month</span>
							<div className="flex items-center gap-2">
								<span className="text-2xl font-bold">{stats.thisMonth.actual.toFixed(1)}h</span>
								{monthPercentage >= 100 ? (
									<IconTrendingUp className="size-4 text-green-500" />
								) : monthPercentage < 75 ? (
									<IconTrendingDown className="size-4 text-orange-500" />
								) : null}
							</div>
						</div>
						<Progress
							value={Math.min(monthPercentage, 100)}
							className="h-2"
						/>
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">
								{stats.thisMonth.actual.toFixed(1)}h / {stats.thisMonth.expected.toFixed(1)}h
							</span>
							<span
								className={
									monthStatus === "on-track"
										? "text-green-500"
										: monthStatus === "under"
											? "text-yellow-500"
											: "text-orange-500"
								}
							>
								{monthPercentage.toFixed(0)}%
							</span>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
