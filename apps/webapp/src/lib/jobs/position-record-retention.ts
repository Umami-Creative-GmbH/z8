import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	deletePositionRecordsPastAuditLifetime,
	type PositionRecordRetentionResult,
} from "@/lib/time-tracking/position-capture/record-retention";

/**
 * Deletes position access-log entries, consents and declines past the
 * audit-log lifetime in every organization (spec #766). Runs with the audit-log
 * cleanup, so these records live exactly as long as audit logs do.
 */
export async function runPositionRecordRetention(
	lifetimeDays: number,
): Promise<PositionRecordRetentionResult> {
	return deletePositionRecordsPastAuditLifetime(db, {
		now: systemClock.nowInstant(),
		lifetimeDays,
	});
}
