import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { purgeExpiredPositionStamps } from "@/lib/time-tracking/position-capture/purge";

export interface PositionStampPurgeResult {
	success: true;
	deletedCount: number;
}

/** Daily retention purge of position stamps in every organization (#829). */
export async function runPositionStampPurge(): Promise<PositionStampPurgeResult> {
	const { deletedCount } = await purgeExpiredPositionStamps(db, {
		now: systemClock.nowInstant(),
	});
	return { success: true, deletedCount };
}
