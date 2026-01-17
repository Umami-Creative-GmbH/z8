"use client";

import { IconDroplet, IconFlame, IconPlus } from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { logWaterIntake } from "@/app/[locale]/(app)/wellness/actions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getHydrationWidgetData } from "./actions";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

type HydrationWidgetData = {
	enabled: boolean;
	currentStreak: number;
	longestStreak: number;
	todayIntake: number;
	dailyGoal: number;
	goalProgress: number;
};

export function HydrationWidget() {
	const [isLogging, setIsLogging] = useState(false);
	const {
		data: stats,
		loading,
		refreshing,
		refetch,
	} = useWidgetData<HydrationWidgetData>(getHydrationWidgetData, {
		errorMessage: "Failed to load hydration stats",
	});

	const handleLogWater = useCallback(
		async (amount: number) => {
			setIsLogging(true);
			try {
				const result = await logWaterIntake({ amount, source: "widget" });
				if (result.success) {
					if (result.data?.goalJustMet) {
						toast.success("Daily goal reached! Great job staying hydrated!");
					} else {
						toast.success(`Logged ${amount} glass${amount > 1 ? "es" : ""} of water`);
					}
					refetch();
				} else {
					toast.error(result.error ?? "Failed to log water intake");
				}
			} catch {
				toast.error("Failed to log water intake");
			} finally {
				setIsLogging(false);
			}
		},
		[refetch],
	);

	// Don't render if feature is disabled or no data
	if (!stats?.enabled && !loading) return null;
	if (!stats && !loading) return null;

	const progressPercentage = stats?.goalProgress ?? 0;
	const isGoalMet = progressPercentage >= 100;

	return (
		<WidgetCard
			title="Hydration Tracker"
			description="Stay hydrated throughout your workday"
			icon={<IconDroplet className="size-4 text-blue-500" />}
			loading={loading}
			refreshing={refreshing}
			onRefresh={refetch}
		>
			{stats && (
				<div className="space-y-4">
					{/* Streak Display */}
					{stats.currentStreak > 0 && (
						<div className="flex items-center gap-2 rounded-lg bg-orange-50 p-3 dark:bg-orange-900/20">
							<IconFlame className="size-5 text-orange-500" aria-hidden="true" />
							<span className="font-medium text-orange-700 dark:text-orange-300">
								{stats.currentStreak} day streak!
							</span>
							{stats.currentStreak === stats.longestStreak && stats.currentStreak > 1 && (
								<span className="ml-auto text-xs text-orange-600 dark:text-orange-400">
									Personal best!
								</span>
							)}
						</div>
					)}

					{/* Today's Progress */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">Today's Progress</span>
							<span className="text-2xl font-bold">
								{stats.todayIntake}/{stats.dailyGoal}
								<span className="ml-1 text-sm font-normal text-muted-foreground">glasses</span>
							</span>
						</div>
						<Progress
							value={Math.min(progressPercentage, 100)}
							className="h-3"
							aria-label={`${progressPercentage}% of daily goal`}
						/>
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">
								{stats.dailyGoal - stats.todayIntake > 0
									? `${stats.dailyGoal - stats.todayIntake} more to go`
									: "Goal reached!"}
							</span>
							<span className={isGoalMet ? "font-medium text-green-500" : "text-muted-foreground"}>
								{progressPercentage}%
							</span>
						</div>
					</div>

					{/* Quick Log Buttons */}
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							className="flex-1"
							onClick={() => handleLogWater(1)}
							disabled={isLogging}
						>
							<IconPlus className="mr-1 size-3" />
							1 Glass
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="flex-1"
							onClick={() => handleLogWater(2)}
							disabled={isLogging}
						>
							<IconPlus className="mr-1 size-3" />
							2 Glasses
						</Button>
					</div>
				</div>
			)}
		</WidgetCard>
	);
}
