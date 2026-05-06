"use client";

import {
	IconAlertTriangle,
	IconCoffee,
	IconDroplet,
	IconLoader2,
	IconMoonStars,
	IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getBreakReminderStatus } from "@/app/[locale]/(app)/time-tracking/actions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useHydrationStats } from "@/hooks/use-hydration-stats";
import { useWaterReminder } from "@/hooks/use-water-reminder";
import { queryKeys, useElapsedTimer } from "@/lib/query";
import { cn } from "@/lib/utils";

const WARNING_THRESHOLD_MINUTES = 15;

interface SessionReminderPanelProps {
	isClockedIn: boolean;
	sessionStartTime: Date | null;
	onDismiss?: () => void;
}

export function SessionReminderPanel({
	isClockedIn,
	sessionStartTime,
	onDismiss,
}: SessionReminderPanelProps) {
	const { t } = useTranslate();
	const sessionKey = sessionStartTime?.getTime() ?? null;
	const previousWaterSessionKeyRef = useRef<number | null>(null);
	const [dismissedBreakSessionKeys, setDismissedBreakSessionKeys] = useState<Set<number>>(
		() => new Set(),
	);
	const [dismissedWaterSessionKeys, setDismissedWaterSessionKeys] = useState<Set<number>>(
		() => new Set(),
	);
	const [breakDismissedWithoutSession, setBreakDismissedWithoutSession] = useState(false);
	const [waterDismissedWithoutSession, setWaterDismissedWithoutSession] = useState(false);

	const breakDismissed =
		sessionKey === null ? breakDismissedWithoutSession : dismissedBreakSessionKeys.has(sessionKey);
	const waterDismissed =
		sessionKey === null ? waterDismissedWithoutSession : dismissedWaterSessionKeys.has(sessionKey);

	const elapsedSeconds = useElapsedTimer(isClockedIn ? sessionStartTime : null);
	const elapsedMinutes = Math.floor(elapsedSeconds / 60);

	const { data: breakServerData } = useQuery({
		queryKey: [...queryKeys.timeClock.breakStatus(), sessionKey],
		queryFn: async () => {
			const result = await getBreakReminderStatus();
			if (!result.success) {
				return null;
			}
			return result.data;
		},
		enabled: isClockedIn && !breakDismissed,
		staleTime: Infinity,
		gcTime: 5 * 60 * 1000,
	});

	const breakStatus = useMemo(() => {
		if (!breakServerData) return null;

		const maxUninterrupted = breakServerData.maxUninterrupted;
		const minutesUntilBreakRequired = maxUninterrupted ? maxUninterrupted - elapsedMinutes : null;
		const requirementRemaining = breakServerData.breakRequirement?.remaining ?? 0;
		const shouldShowForLimit =
			minutesUntilBreakRequired !== null && minutesUntilBreakRequired <= WARNING_THRESHOLD_MINUTES;
		const shouldShowForRequirement = requirementRemaining > 0;

		return {
			maxUninterrupted,
			minutesUntilBreakRequired,
			breakRequirement: breakServerData.breakRequirement,
			show: shouldShowForLimit || shouldShowForRequirement,
		};
	}, [breakServerData, elapsedMinutes]);

	const {
		enabled: waterEnabled,
		showReminder: showWaterReminder,
		isSnoozed,
		handleReminderAction,
		dismiss: dismissWaterReminder,
		resetDismissed,
	} = useWaterReminder({
		enabled: isClockedIn,
		workSessionStart: sessionStartTime,
	});

	useEffect(() => {
		if (sessionKey === null) return;

		if (
			previousWaterSessionKeyRef.current !== null &&
			previousWaterSessionKeyRef.current !== sessionKey
		) {
			resetDismissed?.();
		}

		previousWaterSessionKeyRef.current = sessionKey;
	}, [sessionKey, resetDismissed]);

	const { todayIntake, dailyGoal, goalProgress, logIntake, snooze, isLogging, isSnoozing } =
		useHydrationStats({ enabled: isClockedIn && waterEnabled });

	if (!isClockedIn) {
		return null;
	}

	const showBreakRow = !breakDismissed && (breakStatus?.show ?? false);
	const showWaterRow = waterEnabled && showWaterReminder && !isSnoozed && !waterDismissed;

	if (!showBreakRow && !showWaterRow) {
		return null;
	}

	const handleBreakDismiss = () => {
		if (sessionKey === null) {
			setBreakDismissedWithoutSession(true);
		} else {
			setDismissedBreakSessionKeys((prev) => new Set(prev).add(sessionKey));
		}
		onDismiss?.();
	};

	const handleWaterDismiss = () => {
		if (sessionKey === null) {
			setWaterDismissedWithoutSession(true);
		} else {
			setDismissedWaterSessionKeys((prev) => new Set(prev).add(sessionKey));
		}
		dismissWaterReminder();
		onDismiss?.();
	};

	const handleLogWater = async (amount: number) => {
		try {
			const result = await logIntake({ amount, source: "reminder_action" });

			if (result.goalJustMet) {
				toast.success(t("wellness.water.goalMet", "Daily goal reached! Keep up the great work!"));
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

	const isMutatingWater = isLogging || isSnoozing;
	const minutesUntilBreak = breakStatus?.minutesUntilBreakRequired ?? null;
	const breakRequirementRemaining = breakStatus?.breakRequirement?.remaining ?? 0;
	const isBreakRequiredNow =
		breakRequirementRemaining > 0 || (minutesUntilBreak !== null && minutesUntilBreak <= 0);
	const breakProgress = breakStatus?.maxUninterrupted
		? Math.min(100, (elapsedMinutes / breakStatus.maxUninterrupted) * 100)
		: 0;

	return (
		<section className="rounded-xl border bg-card p-3 text-card-foreground shadow-sm">
			<div className="mb-3 flex items-center justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold leading-none">
						{t("timeTracking.sessionReminders.title", "Session reminders")}
					</h2>
					<p className="mt-1 text-xs text-muted-foreground">
						{t("timeTracking.sessionReminders.subtitle", "During this shift")}
					</p>
				</div>
			</div>

			<div className="space-y-2">
				{showBreakRow && (
					<div className="rounded-lg border bg-background/60 p-3">
						<div className="flex items-start gap-3">
							<div
								className={cn(
									"mt-0.5 rounded-full p-1.5",
									isBreakRequiredNow
										? "bg-destructive/10 text-destructive"
										: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
								)}
							>
								{isBreakRequiredNow ? (
									<IconAlertTriangle className="size-4" aria-hidden="true" />
								) : (
									<IconCoffee className="size-4" aria-hidden="true" />
								)}
							</div>

							<div className="min-w-0 flex-1 space-y-2">
								<div>
									<h3 className="text-sm font-medium">
										{isBreakRequiredNow
											? t("timeTracking.sessionReminders.breakRequired", "Break required now")
											: t("timeTracking.sessionReminders.breakSoon", "Break soon")}
									</h3>
									<p className="text-xs text-muted-foreground">
										{isBreakRequiredNow
											? t(
													"timeTracking.sessionReminders.breakRequiredMessage",
													"Take a break before continuing your session.",
												)
											: t(
													"timeTracking.sessionReminders.minutesUntilBreak",
													"{minutes} min until break",
													{
														minutes: minutesUntilBreak ?? 0,
													},
												)}
									</p>
								</div>

								{breakStatus?.maxUninterrupted && (
									<Progress
										value={breakProgress}
										className={cn(isBreakRequiredNow && "[&>div]:bg-destructive")}
									/>
								)}

								{breakRequirementRemaining > 0 && (
									<p className="text-xs text-muted-foreground">
										{t(
											"timeTracking.sessionReminders.breakOpen",
											"{remaining} min break remaining",
											{
												remaining: breakRequirementRemaining,
											},
										)}
									</p>
								)}
							</div>

							<Button
								variant="ghost"
								size="icon"
								className="size-7 shrink-0"
								onClick={handleBreakDismiss}
							>
								<IconX className="size-4" aria-hidden="true" />
								<span className="sr-only">
									{t("timeTracking.sessionReminders.dismissBreak", "Dismiss break reminder")}
								</span>
							</Button>
						</div>
					</div>
				)}

				{showWaterRow && (
					<div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900 dark:bg-blue-950/30">
						<div className="flex items-start gap-3">
							<div className="mt-0.5 rounded-full bg-blue-500/10 p-1.5 text-blue-600 dark:text-blue-400">
								<IconDroplet className="size-4" aria-hidden="true" />
							</div>

							<div className="min-w-0 flex-1 space-y-2">
								<div>
									<h3 className="text-sm font-medium">
										{t("timeTracking.sessionReminders.hydration", "Hydration")}
									</h3>
									<p className="text-xs text-muted-foreground">
										{t(
											"timeTracking.sessionReminders.hydrationProgress",
											"{intake}/{goal} glasses today",
											{
												intake: todayIntake,
												goal: dailyGoal,
											},
										)}
									</p>
								</div>

								<Progress value={goalProgress} className="[&>div]:bg-blue-500" />

								<div className="flex flex-wrap gap-2">
									<Button size="sm" onClick={() => handleLogWater(1)} disabled={isMutatingWater}>
										{isLogging ? (
											<IconLoader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
										) : (
											<IconDroplet className="mr-1 size-3" aria-hidden="true" />
										)}
										{t("timeTracking.sessionReminders.logOneGlass", "+1 glass")}
									</Button>
									<Button
										size="sm"
										variant="secondary"
										onClick={() => handleLogWater(2)}
										disabled={isMutatingWater}
									>
										{isLogging && (
											<IconLoader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
										)}
										{t("timeTracking.sessionReminders.logTwoGlasses", "+2")}
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={handleSnoozeToday}
										disabled={isMutatingWater}
									>
										{isSnoozing ? (
											<IconLoader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
										) : (
											<IconMoonStars className="mr-1 size-3" aria-hidden="true" />
										)}
										{t("timeTracking.sessionReminders.snoozeToday", "Snooze today")}
									</Button>
								</div>
							</div>

							<Button
								variant="ghost"
								size="icon"
								className="size-7 shrink-0"
								onClick={handleWaterDismiss}
								disabled={isMutatingWater}
							>
								<IconX className="size-4" aria-hidden="true" />
								<span className="sr-only">
									{t(
										"timeTracking.sessionReminders.dismissHydration",
										"Dismiss hydration reminder",
									)}
								</span>
							</Button>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
