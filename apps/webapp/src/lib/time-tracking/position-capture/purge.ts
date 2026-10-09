import "server-only";

import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { positionStamp } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { PositionCaptureClient } from "./store";

/** Stamps deleted per statement, so one run never holds a long, wide delete. */
export const POSITION_STAMP_PURGE_BATCH_SIZE = 5_000;

/**
 * Deletes every position stamp whose purge date has passed, in every
 * organization (#829, Time Tracking ADR 0004). Only the stamps go: clock
 * events, consent records and access-log entries are never touched, and the
 * time entry hash chain does not cover stamps, so it still verifies.
 *
 * Idempotent: a stamp past its purge date is deleted by whichever run sees it
 * first, and a repeated run finds nothing more. A maintenance job across all
 * tenants, so it is deliberately not scoped to one organization; it reads no
 * stamp and returns only a count.
 */
export async function purgeExpiredPositionStamps(
	db: Pick<PositionCaptureClient, "select" | "delete">,
	input: { now: Instant; batchSize?: number },
): Promise<{ deletedCount: number }> {
	const batchSize = input.batchSize ?? POSITION_STAMP_PURGE_BATCH_SIZE;
	const due = lte(positionStamp.purgeAt, dateFromInstant(input.now));
	let deletedCount = 0;
	for (;;) {
		const batch = db
			.select({ id: positionStamp.id })
			.from(positionStamp)
			.where(due)
			.orderBy(positionStamp.purgeAt)
			.limit(batchSize);
		const deleted = await db
			.delete(positionStamp)
			.where(inArray(positionStamp.id, batch))
			.returning({ id: positionStamp.id });
		deletedCount += deleted.length;
		if (deleted.length < batchSize) return { deletedCount };
	}
}

/**
 * Brings the organization's existing purge dates forward to capture time plus
 * the new, shorter retention. A purge date already earlier stays, so a stamp
 * is never kept longer than any retention it was held under; lengthening
 * retention therefore moves nothing. The `position_stamp_immutable` trigger
 * allows exactly this change, and retention of at least seven days keeps every
 * purge date after its capture time.
 */
export async function bringPositionStampPurgeDatesForward(
	tx: Pick<PositionCaptureClient, "update">,
	input: { organizationId: string; retentionDays: number },
): Promise<{ movedCount: number }> {
	const shortened = sql`${positionStamp.capturedAt} + make_interval(days => ${input.retentionDays}::int)`;
	const moved = await tx
		.update(positionStamp)
		.set({ purgeAt: shortened })
		.where(
			and(
				eq(positionStamp.organizationId, input.organizationId),
				sql`${shortened} < ${positionStamp.purgeAt}`,
			),
		)
		.returning({ id: positionStamp.id });
	return { movedCount: moved.length };
}
