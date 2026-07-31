"use client";

import { useQuery } from "@tanstack/react-query";
import {
	startTransition,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { getWaterReminderStatus } from "@/app/[locale]/(app)/wellness/actions";
import { queryKeys } from "@/lib/query/keys";
import { useHydrationStats } from "./use-hydration-stats";

async function sendWaterReminderNotification(): Promise<void> {
	try {
		await fetch("/api/wellness/water-reminder", {
			method: "POST",
			credentials: "include",
		});
	} catch {
		console.debug("Water reminder push notification failed");
	}
}

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
	const [reminderState, setReminderState] = useState({
		showReminder: false,
		minutesUntilReminder: null as number | null,
	});
	const { showReminder, minutesUntilReminder } = reminderState;
	const lastReminderRef = useRef({
		sessionStart: workSessionStart?.getTime() ?? null,
		time: 0,
	});

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
	const triggerReminder = useEffectEvent(() => {
		onReminder?.();
		if (
			typeof document !== "undefined" &&
			document.visibilityState === "hidden"
		) {
			void sendWaterReminderNotification();
		}
	});

	// Check if currently snoozed
	const isSnoozed = (() => {
		if (!snoozedUntil) return false;
		return new Date(snoozedUntil) > new Date();
	})();

	// Timer effect
	useEffect(() => {
		if (!reminderEnabled || isSnoozed || dismissed || !enabled) {
			startTransition(() => {
				setReminderState((current) => ({
					...current,
					showReminder: false,
					minutesUntilReminder: null,
				}));
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
					referenceTime = workSessionStart.getTime();
				} else {
					return null;
				}

				const sessionStart = workSessionStart?.getTime() ?? null;
				if (lastReminderRef.current.sessionStart !== sessionStart) {
					lastReminderRef.current = { sessionStart, time: 0 };
				}
				if (lastReminderRef.current.time > referenceTime) {
					referenceTime = lastReminderRef.current.time;
				}

				const elapsedMinutes = (now - referenceTime) / 1000 / 60;
				return intervalMinutes - elapsedMinutes;
			})();

			if (minutesUntil !== null && minutesUntil <= 0) {
				const nextLastReminderTime = Date.now();
				lastReminderRef.current = {
					sessionStart: workSessionStart?.getTime() ?? null,
					time: nextLastReminderTime,
				};
				setReminderState({
					showReminder: true,
					minutesUntilReminder: minutesUntil,
				});
				triggerReminder();
			} else {
				setReminderState((current) => ({
					...current,
					minutesUntilReminder: minutesUntil,
				}));
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
		workSessionStart,
		dismissed,
		enabled,
	]);

	// Reset reminder when water is logged
	useEffect(() => {
		if (todayIntake > 0) {
			startTransition(() =>
				setReminderState((current) => ({ ...current, showReminder: false })),
			);
		}
	}, [todayIntake]);

	// Dismiss reminder
	const dismiss = () => {
		setDismissed(true);
		setReminderState((current) => ({ ...current, showReminder: false }));
	};

	// Reset dismissed state (e.g., on new clock-in)
	const resetDismissed = () => {
		setDismissed(false);
		lastReminderRef.current = {
			sessionStart: workSessionStart?.getTime() ?? null,
			time: 0,
		};
	};

	// Mark reminder as handled (after logging water)
	const handleReminderAction = () => {
		lastReminderRef.current = {
			sessionStart: workSessionStart?.getTime() ?? null,
			time: Date.now(),
		};
		setReminderState((current) => ({
			...current,
			showReminder: false,
		}));
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
