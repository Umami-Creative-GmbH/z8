import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { deleteExpiredKeyRequests } from "@/lib/public-api/request-log";

/**
 * Deletes key request log entries older than 90 days in every organization
 * (#763). Runs with the notification cleanup; returns the number of rows deleted.
 */
export async function runKeyRequestLogRetention(): Promise<number> {
	return deleteExpiredKeyRequests(db, { now: systemClock.nowInstant() });
}
