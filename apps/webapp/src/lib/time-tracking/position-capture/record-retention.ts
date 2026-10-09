import "server-only";

import { lt } from "drizzle-orm";
import { positionStampAccessLog } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { PositionCaptureClient } from "./store";

export type PositionRecordRetentionResult = {
	accessLogEntries: number;
};

/**
 * Deletes the position records that follow the audit-log lifetime (spec #766,
 * "Retention"): they hold no position, so the stamp purge (#829) never touches
 * them. A maintenance job across all tenants, like the audit-log cleanup it
 * runs with; it reads nothing and returns only counts.
 *
 * - Access-log entries older than the lifetime, with their subjects.
 */
export async function deletePositionRecordsPastAuditLifetime(
	db: Pick<PositionCaptureClient, "delete">,
	input: { now: Instant; lifetimeDays: number },
): Promise<PositionRecordRetentionResult> {
	const cutoff = dateFromInstant(input.now.subtract({ hours: input.lifetimeDays * 24 }));

	const accessLogEntries = await db
		.delete(positionStampAccessLog)
		.where(lt(positionStampAccessLog.accessedAt, cutoff))
		.returning({ id: positionStampAccessLog.id });

	return { accessLogEntries: accessLogEntries.length };
}
