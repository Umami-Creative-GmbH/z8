"use client";

import { useQuery } from "@tanstack/react-query";
import { startTransition, useEffect, useState } from "react";
import { getWaterReminderStatus } from "@/app/[locale]/(app)/wellness/actions";
import { queryKeys } from "@/lib/query/keys";
import { useHydrationStats } from "./use-hydration-stats";

export interface WaterReminderStatus {
	enabled: boolean;
	intervalMinutes: number;
	dailyGoal: number;
	snoozedUntil: Date | null;
	lastIntakeTime: Date | null;
}

export interface UseWaterReminderOptions {
	/**
	 * Whether to enable the reminder (e.g., only when clocked in)
	 * @default true
	 */
	enabled?: boolean;
	/**
	 * Start time of the current work session (for calculating intervals)
	 */
	workSessionStart?: Date | null;
	/**
	 * Callback when reminder should be shown
	 */
	onReminder?: () => void;
}

/**
 * Hook for water reminder timing logic
 *
 * This hook:
 * - Fetches reminder settings once
 * - Calculates time until next reminder client-side
 * - Triggers reminder callback when interval elapses
 * - Respects snooze state
 *
 * Optimized to avoid polling - uses client-side timer like break reminders
 */
export function useWaterReminder(options: UseWaterReminderOptions = {}) {
	const { enabled = true, workSessionStart, onReminder } = options;
	const [dismissed, setDismissed] = useState(false);
	const [showReminder, setShowReminder] = useState(false);
	const [lastReminderTime, setLastReminderTime] = useState(0);
	const [minutesUntilReminder, setMinutesUntilReminder] = useState<number | null>(null);

	// Get hydration stats for snooze state and intake
	const { snoozedUntil, todayIntake } = useHydrationStats({ enabled });

	// Query for water reminder status (fetch once)
	const statusQuery = useQuery({
		queryKey: queryKeys.hydration.reminderStatus(),
		queryFn: async () => {
			const result = await getWaterReminderStatus();
			if (!result.success) {
				throw new Error(result.error ?? "Failed to fetch reminder status");
			}
			return result.data;
		},
		enabled: enabled && !dismissed,
		staleTime: Infinity, // Never refetch during session (like break reminders)
	});

	const status = statusQuery.data;
	const reminderEnabled = status?.enabled ?? false;
	const intervalMinutes = status?.intervalMinutes ?? 45;
	const lastIntakeTime = status?.lastIntakeTime ?? null;

	// Check if currently snoozed
	const isSnoozed = (() => {
		if (!snoozedUntil) return false;
		return new Date(snoozedUntil) > new Date();
	})();

	// Timer effect
	useEffect(() => {
		if (!reminderEnabled || isSnoozed || dismissed || !enabled) {
			startTransition(() => {
				setShowReminder(false);
				setMinutesUntilReminder(null);
			});
			return;
		}

		const checkReminder = () => {
			const minutesUntil = (() => {
				if (!reminderEnabled || isSnoozed || dismissed) {
					return null;
				}

				const now = Date.now();
				let referenceTime: number;

				if (lastIntakeTime) {
					referenceTime = new Date(lastIntakeTime).getTime();
				} else if (workSessionStart) {
					referenceTime = new Date(workSessionStart).getTime();
				} else {
					return null;
				}

				if (lastReminderTime > referenceTime) {
					referenceTime = lastReminderTime;
				}

				const elapsedMinutes = (now - referenceTime) / 1000 / 60;
				return intervalMinutes - elapsedMinutes;
			})();

			setMinutesUntilReminder(minutesUntil);

			if (minutesUntil !== null && minutesUntil <= 0) {
				setShowReminder(true);
				onReminder?.();
				setLastReminderTime(Date.now());
				// Trigger push notification if page is not visible
				if (typeof document !== "undefined" && document.visibilityState === "hidden") {
					fetch("/api/wellness/water-reminder", {
						method: "POST",
						credentials: "include",
					}).catch(() => {
						console.debug("Water reminder push notification failed");
					});
				}
			}
		};

		// Initial check
		checkReminder();

		// Check every 30 seconds
		const interval = setInterval(checkReminder, 30 * 1000);

		return () => clearInterval(interval);
	}, [
		reminderEnabled,
		isSnoozed,
		intervalMinutes,
		lastIntakeTime,
		lastReminderTime,
		workSessionStart,
		dismissed,
		enabled,
		onReminder,
	]);

	// Reset reminder when water is logged
	useEffect(() => {
		if (todayIntake > 0) {
			startTransition(() => setShowReminder(false));
		}
	}, [todayIntake]);

	// Dismiss reminder
	const dismiss = () => {
		setDismissed(true);
		setShowReminder(false);
	};

	// Reset dismissed state (e.g., on new clock-in)
	const resetDismissed = () => {
		setDismissed(false);
		setLastReminderTime(0);
	};

	// Mark reminder as handled (after logging water)
	const handleReminderAction = () => {
		setShowReminder(false);
		setLastReminderTime(Date.now());
	};

	return {
		// Status
		isLoading: statusQuery.isLoading,
		isError: statusQuery.isError,

		// Reminder state
		enabled: reminderEnabled,
		intervalMinutes,
		showReminder,
		isSnoozed,
		isDismissed: dismissed,

		// Calculated values
		minutesUntilReminder,

		// Actions
		dismiss,
		resetDismissed,
		handleReminderAction,
	};
}
