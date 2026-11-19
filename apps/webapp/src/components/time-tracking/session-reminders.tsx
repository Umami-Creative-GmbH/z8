"use client";

import { SessionReminderPanel } from "@/components/time-tracking/session-reminder-panel";
import { useTimeClock } from "@/lib/query/use-time-clock";

/**
 * Break and hydration reminders for the running session, beside the record rather than inside
 * the clock card. Reads the shared clock query, so it follows the same session as the clock.
 */
export function SessionReminders() {
	const clock = useTimeClock();
	return (
		<SessionReminderPanel
			isClockedIn={clock.isClockedIn}
			sessionStartTime={clock.activeWorkPeriod?.startTime ?? null}
		/>
	);
}
