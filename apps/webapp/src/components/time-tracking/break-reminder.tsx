"use client";

import { IconAlertTriangle, IconCoffee, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { getBreakReminderStatus } from "@/app/[locale]/(app)/time-tracking/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { queryKeys } from "@/lib/query";

interface BreakReminderProps {
	/** Whether the user is currently clocked in */
	isClockedIn: boolean;
	/** Callback when user dismisses the reminder */
	onDismiss?: () => void;
}

/**
 * Break Reminder Component
 *
 * Displays a reminder when:
 * - User is approaching maximum uninterrupted work time
 * - User has outstanding break requirements
 *
 * The reminder is shown as an alert within the time tracking widget.
 */
export function BreakReminder({ isClockedIn, onDismiss }: BreakReminderProps) {
	const { t } = useTranslate();
	const [dismissed, setDismissed] = useState(false);

	// Reset dismissed state when user clocks in again
	useEffect(() => {
		if (isClockedIn) {
			setDismissed(false);
		}
	}, [isClockedIn]);

	// Query break status every minute while clocked in
	const { data: breakStatus } = useQuery({
		queryKey: queryKeys.timeClock.breakStatus(),
		queryFn: async () => {
			const result = await getBreakReminderStatus();
			if (!result.success) {
				return null;
			}
			return result.data;
		},
		enabled: isClockedIn && !dismissed,
		refetchInterval: 60 * 1000, // Refresh every minute
		staleTime: 30 * 1000, // Consider stale after 30 seconds
	});

	// Don't show if not clocked in, dismissed, or no break needed
	if (!isClockedIn || dismissed || !breakStatus?.needsBreakSoon) {
		return null;
	}

	const handleDismiss = () => {
		setDismissed(true);
		onDismiss?.();
	};

	// Calculate progress for uninterrupted time
	const uninterruptedProgress = breakStatus.maxUninterrupted
		? Math.min(100, (breakStatus.uninterruptedMinutes / breakStatus.maxUninterrupted) * 100)
		: 0;

	const isOverLimit = breakStatus.minutesUntilBreakRequired !== null && breakStatus.minutesUntilBreakRequired <= 0;
	const minutesRemaining = breakStatus.minutesUntilBreakRequired ?? 0;

	return (
		<Alert
			variant={isOverLimit ? "destructive" : "default"}
			className="relative animate-in fade-in slide-in-from-top-2 duration-300"
		>
			<div className="flex items-start gap-3">
				{isOverLimit ? (
					<IconAlertTriangle className="size-5 shrink-0 text-destructive" />
				) : (
					<IconCoffee className="size-5 shrink-0 text-orange-500" />
				)}
				<div className="flex-1 space-y-2">
					<AlertTitle className="mb-1">
						{isOverLimit
							? t("timeTracking.breakReminder.overLimitTitle", "Break Required")
							: t("timeTracking.breakReminder.title", "Break Reminder")}
					</AlertTitle>
					<AlertDescription>
						{isOverLimit ? (
							t(
								"timeTracking.breakReminder.overLimitMessage",
								"You've exceeded the maximum uninterrupted working time. Please take a break soon.",
							)
						) : (
							t(
								"timeTracking.breakReminder.warningMessage",
								"You have {minutes} minutes until a break is required.",
								{ minutes: minutesRemaining },
							)
						)}
					</AlertDescription>

					{/* Progress bar for uninterrupted time */}
					{breakStatus.maxUninterrupted && (
						<div className="space-y-1 pt-1">
							<div className="flex justify-between text-xs text-muted-foreground">
								<span>
									{t("timeTracking.breakReminder.uninterrupted", "Uninterrupted work")}
								</span>
								<span>
									{formatMinutes(breakStatus.uninterruptedMinutes)} /{" "}
									{formatMinutes(breakStatus.maxUninterrupted)}
								</span>
							</div>
							<Progress
								value={uninterruptedProgress}
								className={isOverLimit ? "[&>div]:bg-destructive" : "[&>div]:bg-orange-500"}
							/>
						</div>
					)}

					{/* Break requirement info */}
					{breakStatus.breakRequirement && breakStatus.breakRequirement.remaining > 0 && (
						<div className="text-xs text-muted-foreground pt-1">
							{t(
								"timeTracking.breakReminder.breakNeeded",
								"Break required: {remaining} minutes remaining of {total} total",
								{
									remaining: breakStatus.breakRequirement.remaining,
									total: breakStatus.breakRequirement.totalNeeded,
								},
							)}
						</div>
					)}
				</div>

				{/* Dismiss button */}
				<Button
					variant="ghost"
					size="icon"
					className="size-6 shrink-0"
					onClick={handleDismiss}
				>
					<IconX className="size-4" />
					<span className="sr-only">{t("common.dismiss", "Dismiss")}</span>
				</Button>
			</div>
		</Alert>
	);
}

/**
 * Format minutes into a human-readable string
 */
function formatMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (hours === 0) return `${mins}m`;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}
