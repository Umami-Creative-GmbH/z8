"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
	const lastReminderTime = useRef<number>(0);

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
	const isSnoozed = useMemo(() => {
		if (!snoozedUntil) return false;
		return new Date(snoozedUntil) > new Date();
	}, [snoozedUntil]);

	// Calculate minutes until next reminder
	const calculateMinutesUntilReminder = useCallback(() => {
		if (!reminderEnabled || isSnoozed || dismissed) {
			return null;
		}

		const now = Date.now();

		// Use the most recent of: session start, last intake, or last reminder
		let referenceTime: number;

		if (lastIntakeTime) {
			referenceTime = new Date(lastIntakeTime).getTime();
		} else if (workSessionStart) {
			referenceTime = new Date(workSessionStart).getTime();
		} else {
			// No reference point, don't show reminder
			return null;
		}

		// If we've shown a reminder, use that as reference
		if (lastReminderTime.current > referenceTime) {
			referenceTime = lastReminderTime.current;
		}

		const elapsedMinutes = (now - referenceTime) / 1000 / 60;
		const minutesUntil = intervalMinutes - elapsedMinutes;

		return minutesUntil;
	}, [reminderEnabled, isSnoozed, dismissed, lastIntakeTime, workSessionStart, intervalMinutes]);

	// Trigger push notification
	const triggerPushNotification = useCallback(async () => {
		try {
			// Check if push is supported and the page is not visible
			if (typeof document !== "undefined" && document.visibilityState === "hidden") {
				await fetch("/api/wellness/water-reminder", {
					method: "POST",
					credentials: "include",
				});
			}
		} catch {
			// Silently fail if push notification fails
			console.debug("Water reminder push notification failed");
		}
	}, []);

	// Timer effect
	useEffect(() => {
		if (!reminderEnabled || isSnoozed || dismissed || !enabled) {
			setShowReminder(false);
			return;
		}

		const checkReminder = () => {
			const minutesUntil = calculateMinutesUntilReminder();

			if (minutesUntil !== null && minutesUntil <= 0) {
				setShowReminder(true);
				onReminder?.();
				lastReminderTime.current = Date.now();
				// Trigger push notification if page is not visible
				triggerPushNotification();
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
		dismissed,
		enabled,
		calculateMinutesUntilReminder,
		onReminder,
		triggerPushNotification,
	]);

	// Reset reminder when water is logged
	useEffect(() => {
		if (todayIntake > 0) {
			setShowReminder(false);
		}
	}, [todayIntake]);

	// Dismiss reminder
	const dismiss = useCallback(() => {
		setDismissed(true);
		setShowReminder(false);
	}, []);

	// Reset dismissed state (e.g., on new clock-in)
	const resetDismissed = useCallback(() => {
		setDismissed(false);
		lastReminderTime.current = 0;
	}, []);

	// Mark reminder as handled (after logging water)
	const handleReminderAction = useCallback(() => {
		setShowReminder(false);
		lastReminderTime.current = Date.now();
	}, []);

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
		minutesUntilReminder: calculateMinutesUntilReminder(),

		// Actions
		dismiss,
		resetDismissed,
		handleReminderAction,
	};
}
