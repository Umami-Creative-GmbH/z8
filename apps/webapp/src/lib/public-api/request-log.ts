import "server-only";

import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { publicApiRequestLog } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";

/** How long the key request log keeps a request (#763). */
export const KEY_REQUEST_LOG_RETENTION_DAYS = 90;
/** Rows deleted per statement, so one run never holds a long, wide delete. */
export const KEY_REQUEST_LOG_RETENTION_BATCH_SIZE = 5_000;
/** Requests the key detail page shows. */
export const RECENT_KEY_REQUESTS = 100;

export interface KeyRequestView {
	id: string;
	method: string;
	route: string;
	status: number;
	rowCount: number | null;
	ipAddress: string | null;
	requestedAt: Date;
}

/** One key's most recent requests, newest first. */
export async function listRecentKeyRequests(
	reader: Pick<typeof rootDatabase, "select">,
	input: { organizationId: string; apiKeyId: string; limit?: number },
): Promise<KeyRequestView[]> {
	return reader
		.select({
			id: publicApiRequestLog.id,
			method: publicApiRequestLog.method,
			route: publicApiRequestLog.route,
			status: publicApiRequestLog.status,
			rowCount: publicApiRequestLog.rowCount,
			ipAddress: publicApiRequestLog.ipAddress,
			requestedAt: publicApiRequestLog.requestedAt,
		})
		.from(publicApiRequestLog)
		.where(
			and(
				eq(publicApiRequestLog.organizationId, input.organizationId),
				eq(publicApiRequestLog.apiKeyId, input.apiKeyId),
			),
		)
		.orderBy(desc(publicApiRequestLog.requestedAt), desc(publicApiRequestLog.id))
		.limit(input.limit ?? RECENT_KEY_REQUESTS);
}

/**
 * Deletes key request log entries older than the retention, in every
 * organization. Returns the number of rows deleted.
 */
export async function deleteExpiredKeyRequests(
	db: Pick<typeof rootDatabase, "select" | "delete">,
	input: { now: Instant; retentionDays?: number; batchSize?: number },
): Promise<number> {
	const retentionDays = input.retentionDays ?? KEY_REQUEST_LOG_RETENTION_DAYS;
	const batchSize = input.batchSize ?? KEY_REQUEST_LOG_RETENTION_BATCH_SIZE;
	const cutoff = dateFromInstant(input.now.subtract({ hours: retentionDays * 24 }));
	const expired = lt(publicApiRequestLog.requestedAt, cutoff);
	let deletedCount = 0;
	for (;;) {
		const batch = db
			.select({ id: publicApiRequestLog.id })
			.from(publicApiRequestLog)
			.where(expired)
			.limit(batchSize);
		const deleted = await db
			.delete(publicApiRequestLog)
			.where(and(expired, inArray(publicApiRequestLog.id, batch)))
			.returning({ id: publicApiRequestLog.id });
		deletedCount += deleted.length;
		if (deleted.length < batchSize) return deletedCount;
	}
}
