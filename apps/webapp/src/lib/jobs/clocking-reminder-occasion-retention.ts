import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { deleteExpiredClockingReminderOccasions } from "@/lib/time-tracking/clocking-reminders/occasion-retention";

/**
 * Deletes clocking reminder occasions past retention in every organization (#919). Runs with the
 * notification cleanup; returns the number of rows deleted.
 */
export async function runClockingReminderOccasionRetention(retentionDays: number): Promise<number> {
	return deleteExpiredClockingReminderOccasions(db, {
		now: systemClock.nowInstant(),
		retentionDays,
	});
}
