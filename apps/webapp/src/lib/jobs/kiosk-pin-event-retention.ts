import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { pruneKioskPinEvents } from "@/lib/time-tracking/kiosk/pin-store";

/**
 * Deletes kiosk PIN events that can no longer affect any lockout check (older
 * than the 7-day delayed admission window plus the 15-minute lock, #1288) in
 * every organization. Each attempt also prunes its own employee's events; this
 * catches employees who stopped using kiosks. Runs with the notification
 * cleanup; returns the number of rows deleted.
 */
export async function runKioskPinEventRetention(): Promise<number> {
	return pruneKioskPinEvents(db, systemClock.nowInstant());
}
