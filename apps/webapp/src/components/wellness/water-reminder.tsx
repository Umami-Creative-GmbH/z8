"use client";

import { IconDroplet, IconLoader2, IconMoonStars, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useHydrationStats } from "@/hooks/use-hydration-stats";
import { useWaterReminder } from "@/hooks/use-water-reminder";

interface WaterReminderProps {
	/** Whether the user is currently clocked in */
	isClockedIn: boolean;
	/** Start time of current work session (for calculating intervals) */
	sessionStartTime: Date | null;
	/** Callback when user dismisses the reminder */
	onDismiss?: () => void;
}

/**
 * Water Reminder Component
 *
 * Displays a reminder when the user's hydration interval has elapsed while clocked in.
 * Provides actions to log water intake or snooze for the day.
 *
 * Optimization: Uses client-side timer like BreakReminder, fetches settings once.
 */
export function WaterReminder({ isClockedIn, sessionStartTime, onDismiss }: WaterReminderProps) {
	const { t } = useTranslate();
	const [localDismissed, setLocalDismissed] = useState(false);

	// Get water reminder state
	const {
		enabled,
		showReminder,
		isSnoozed,
		handleReminderAction,
		dismiss: dismissReminder,
		resetDismissed,
	} = useWaterReminder({
		enabled: isClockedIn,
		workSessionStart: sessionStartTime,
	});

	// Get hydration stats for intake logging
	const {
		todayIntake,
		dailyGoal,
		goalProgress,
		currentStreak,
		logIntake,
		snooze,
		isLogging,
		isSnoozing,
		goalMet,
	} = useHydrationStats({ enabled: isClockedIn && enabled });

	// Reset dismissed state when user clocks in again
	const sessionKey = sessionStartTime?.getTime() ?? 0;
	useEffect(() => {
		if (isClockedIn && sessionKey > 0) {
			setLocalDismissed(false);
			resetDismissed();
		}
	}, [isClockedIn, sessionKey, resetDismissed]);

	// Don't show if not enabled, not clocked in, dismissed, snoozed, or no reminder needed
	if (!enabled || !isClockedIn || localDismissed || isSnoozed || !showReminder) {
		return null;
	}

	const handleLogWater = async (amount: number = 1) => {
		try {
			const result = await logIntake({
				amount,
				source: "reminder_action",
			});

			if (result.goalJustMet) {
				toast.success(
					t("wellness.water.goalMet", "Daily goal reached! Keep up the great work!"),
				);
			} else {
				toast.success(
					t("wellness.water.logged", "Water logged! {progress}% of daily goal", {
						progress: result.goalProgress,
					}),
				);
			}

			handleReminderAction();
		} catch {
			toast.error(t("wellness.water.logError", "Failed to log water intake"));
		}
	};

	const handleSnoozeToday = async () => {
		try {
			await snooze();
			toast.info(t("wellness.water.snoozed", "Water reminders snoozed for today"));
			handleReminderAction();
		} catch {
			toast.error(t("wellness.water.snoozeError", "Failed to snooze reminders"));
		}
	};

	const handleDismiss = () => {
		setLocalDismissed(true);
		dismissReminder();
		onDismiss?.();
	};

	const isMutating = isLogging || isSnoozing;

	return (
		<Alert className="relative animate-in fade-in slide-in-from-top-2 duration-300 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20">
			<div className="flex items-start gap-3">
				<IconDroplet className="size-5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
				<div className="flex-1 space-y-2">
					<AlertTitle className="mb-1 text-blue-900 dark:text-blue-100">
						{t("wellness.water.reminderTitle", "Time to hydrate!")}
					</AlertTitle>
					<AlertDescription className="text-blue-800 dark:text-blue-200">
						{t(
							"wellness.water.reminderMessage",
							"Stay healthy - drink some water. You've had {intake} of {goal} glasses today.",
							{ intake: todayIntake, goal: dailyGoal },
						)}
					</AlertDescription>

					{/* Progress bar for daily goal */}
					<div className="space-y-1 pt-1">
						<div className="flex justify-between text-xs text-blue-700 dark:text-blue-300">
							<span>{t("wellness.water.todayProgress", "Today's progress")}</span>
							<span>
								{todayIntake} / {dailyGoal}
							</span>
						</div>
						<Progress
							value={goalProgress}
							className="[&>div]:bg-blue-500 dark:[&>div]:bg-blue-400"
						/>
					</div>

					{/* Streak info */}
					{currentStreak > 0 && (
						<div className="text-xs text-blue-700 dark:text-blue-300 pt-1">
							{t("wellness.water.streak", "Current streak: {days} days", { days: currentStreak })}
						</div>
					)}

					{/* Action buttons */}
					<div className="flex flex-wrap gap-2 pt-2">
						<Button
							size="sm"
							variant="secondary"
							onClick={() => handleLogWater(1)}
							disabled={isMutating}
							className="bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-800 dark:hover:bg-blue-700 dark:text-blue-100"
						>
							{isLogging && <IconLoader2 className="mr-1 size-3 animate-spin" />}
							<IconDroplet className="mr-1 size-3" />
							{t("wellness.water.logOne", "+1 Glass")}
						</Button>
						<Button
							size="sm"
							variant="secondary"
							onClick={() => handleLogWater(2)}
							disabled={isMutating}
							className="bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-800 dark:hover:bg-blue-700 dark:text-blue-100"
						>
							{isLogging && <IconLoader2 className="mr-1 size-3 animate-spin" />}
							{t("wellness.water.logTwo", "+2 Glasses")}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={handleSnoozeToday}
							disabled={isMutating}
							className="text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
						>
							{isSnoozing && <IconLoader2 className="mr-1 size-3 animate-spin" />}
							<IconMoonStars className="mr-1 size-3" />
							{t("wellness.water.snoozeToday", "Snooze today")}
						</Button>
					</div>
				</div>

				{/* Dismiss button */}
				<Button
					variant="ghost"
					size="icon"
					className="size-6 shrink-0 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-100"
					onClick={handleDismiss}
					disabled={isMutating}
				>
					<IconX className="size-4" />
					<span className="sr-only">{t("common.dismiss", "Dismiss")}</span>
				</Button>
			</div>
		</Alert>
	);
}
