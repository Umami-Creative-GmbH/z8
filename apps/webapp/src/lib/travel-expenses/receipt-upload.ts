import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	type TravelExpenseReceiptCleanupReason,
	travelExpenseAttachment,
	travelExpenseClaim,
	travelExpenseReceiptUpload,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER } from "./attachment-validation";

/**
 * Receipt upload coordination (#295). A private receipt object is staged
 * durably before it is stored, and attached only in a transaction that holds
 * the claim row lock while the claim is still a draft. Submission takes the
 * same lock, so an upload either attaches before submission reads the receipt
 * set or is rejected afterwards; a rejected, failed or abandoned object always
 * remains as recoverable cleanup work.
 */

type Database = typeof appDb;

/** Uploads still pending after this long are treated as abandoned. */
export const ABANDONED_RECEIPT_UPLOAD_AFTER_MS = 60 * 60 * 1000;
/** Cleanup lease that keeps two workers from deleting the same object. */
const CLEANUP_LEASE_MS = 10 * 60 * 1000;
const MAX_CLEANUP_RETRY_DELAY_MS = 12 * 60 * 60 * 1000;
const CLEANUP_RETRY_DELAYS_MS = [
	60 * 1000,
	5 * 60 * 1000,
	30 * 60 * 1000,
	2 * 60 * 60 * 1000,
	MAX_CLEANUP_RETRY_DELAY_MS,
];

/** Write-once object key: the attachment ID is never reused. */
export function travelExpenseReceiptStorageKey(input: {
	organizationId: string;
	claimId: string;
	attachmentId: string;
	fileName: string;
}): string {
	return `travel-expenses/${input.organizationId}/${input.claimId}/${input.attachmentId}-${input.fileName}`;
}

export interface StagedReceiptUpload {
	attachmentId: string;
	organizationId: string;
	claimId: string;
	uploadedBy: string;
	storageKey: string;
}

/** Committed before the object is stored, so a crash never leaks it silently. */
export async function stageTravelExpenseReceiptUpload(
	database: Database,
	input: StagedReceiptUpload,
	now: Instant = systemClock.nowInstant(),
): Promise<void> {
	const at = dateFromInstant(now);
	await database.insert(travelExpenseReceiptUpload).values({
		id: input.attachmentId,
		organizationId: input.organizationId,
		claimId: input.claimId,
		uploadedBy: input.uploadedBy,
		storageKey: input.storageKey,
		status: "pending",
		createdAt: at,
		updatedAt: at,
	});
}

export interface StoredReceiptObject {
	bucket: string;
	versionId: string | null;
}

export type FinalizeReceiptUploadResult =
	| {
			kind: "attached";
			attachment: {
				id: string;
				fileName: string;
				mimeType: string | null;
				sizeBytes: number | null;
				storageKey: string;
			};
	  }
	| { kind: "claim_not_draft" };

/**
 * Attaches a stored receipt under the claim row lock. When the claim is no
 * longer the uploader's draft, nothing is attached and the staged object is
 * marked for cleanup in the same transaction.
 */
export async function finalizeTravelExpenseReceiptUpload(
	database: Database,
	input: StagedReceiptUpload & {
		stored: StoredReceiptObject;
		fileName: string;
		mimeType: string;
		sizeBytes: number;
		checksumSha256: string;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<FinalizeReceiptUploadResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const [claim] = await tx
			.select({ status: travelExpenseClaim.status })
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.id, input.claimId),
					eq(travelExpenseClaim.organizationId, input.organizationId),
					eq(travelExpenseClaim.employeeId, input.uploadedBy),
				),
			)
			.for("update");

		if (claim?.status !== "draft") {
			await tx
				.update(travelExpenseReceiptUpload)
				.set({
					status: "cleanup_required",
					reason: "claim_not_draft",
					storageBucket: input.stored.bucket,
					storageVersionId: input.stored.versionId,
					nextAttemptAt: at,
					updatedAt: at,
				})
				.where(
					and(
						eq(travelExpenseReceiptUpload.id, input.attachmentId),
						eq(travelExpenseReceiptUpload.organizationId, input.organizationId),
						eq(travelExpenseReceiptUpload.status, "pending"),
					),
				);
			return { kind: "claim_not_draft" };
		}

		const released = await tx
			.delete(travelExpenseReceiptUpload)
			.where(
				and(
					eq(travelExpenseReceiptUpload.id, input.attachmentId),
					eq(travelExpenseReceiptUpload.organizationId, input.organizationId),
					eq(travelExpenseReceiptUpload.storageKey, input.storageKey),
					eq(travelExpenseReceiptUpload.status, "pending"),
				),
			)
			.returning({ id: travelExpenseReceiptUpload.id });
		if (released.length !== 1) {
			// Cleanup already claimed this object; attaching it would reference
			// content that is about to be deleted.
			throw new Error("Receipt upload is no longer pending");
		}

		const [attachment] = await tx
			.insert(travelExpenseAttachment)
			.values({
				id: input.attachmentId,
				organizationId: input.organizationId,
				claimId: input.claimId,
				storageProvider: TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER,
				storageBucket: input.stored.bucket,
				storageKey: input.storageKey,
				storageVersionId: input.stored.versionId,
				fileName: input.fileName,
				mimeType: input.mimeType,
				sizeBytes: input.sizeBytes,
				checksumSha256: input.checksumSha256,
				uploadedBy: input.uploadedBy,
				createdAt: at,
			})
			.returning({
				id: travelExpenseAttachment.id,
				fileName: travelExpenseAttachment.fileName,
				mimeType: travelExpenseAttachment.mimeType,
				sizeBytes: travelExpenseAttachment.sizeBytes,
				storageKey: travelExpenseAttachment.storageKey,
			});
		if (!attachment) {
			throw new Error("Failed to create attachment record");
		}
		return { kind: "attached", attachment };
	});
}

/**
 * Records that a staged object could not be attached. Idempotent. The row is
 * recreated when cleanup already swept it as abandoned before this upload
 * stored its object, so a slow upload can never leave an unrecorded object; a
 * row another worker holds keeps its lease and only learns the object version.
 */
export async function markTravelExpenseReceiptUploadFailed(
	database: Database,
	input: StagedReceiptUpload & {
		stored: StoredReceiptObject | null;
		reason: TravelExpenseReceiptCleanupReason;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<void> {
	const at = dateFromInstant(now);
	const table = travelExpenseReceiptUpload;
	const wasPending = sql`${table.status} = 'pending'`;
	await database
		.insert(table)
		.values({
			id: input.attachmentId,
			organizationId: input.organizationId,
			claimId: input.claimId,
			uploadedBy: input.uploadedBy,
			storageKey: input.storageKey,
			storageBucket: input.stored?.bucket ?? null,
			storageVersionId: input.stored?.versionId ?? null,
			status: "cleanup_required",
			reason: input.reason,
			nextAttemptAt: at,
			createdAt: at,
			updatedAt: at,
		})
		.onConflictDoUpdate({
			target: table.id,
			set: {
				status: "cleanup_required",
				reason: sql`case when ${wasPending} then excluded.reason else ${table.reason} end`,
				storageBucket: sql`coalesce(excluded.storage_bucket, ${table.storageBucket})`,
				storageVersionId: sql`coalesce(excluded.storage_version_id, ${table.storageVersionId})`,
				nextAttemptAt: sql`case when ${wasPending} then excluded.next_attempt_at else ${table.nextAttemptAt} end`,
				updatedAt: at,
			},
			where: and(
				eq(table.organizationId, input.organizationId),
				eq(table.storageKey, input.storageKey),
			),
		});
}

export type DeleteReceiptObject = (input: {
	organizationId: string;
	key: string;
	bucket: string | null;
	versionId: string | null;
}) => Promise<void>;

export interface ReceiptCleanupResult {
	claimed: number;
	deleted: number;
	/** Objects that turned out to be attached; only the stale claim was removed. */
	released: number;
	failed: number;
}

type CleanupRow = typeof travelExpenseReceiptUpload.$inferSelect;

async function claimCleanupWork(
	database: Database,
	input: { now: Instant; limit: number; attachmentId?: string; organizationId?: string },
): Promise<CleanupRow[]> {
	const at = dateFromInstant(input.now);
	const abandonedBefore = dateFromInstant(
		input.now.subtract({ milliseconds: ABANDONED_RECEIPT_UPLOAD_AFTER_MS }),
	);
	const leaseUntil = dateFromInstant(input.now.add({ milliseconds: CLEANUP_LEASE_MS }));
	return database.transaction(async (tx) => {
		const due = or(
			and(
				eq(travelExpenseReceiptUpload.status, "cleanup_required"),
				lte(travelExpenseReceiptUpload.nextAttemptAt, at),
			),
			and(
				eq(travelExpenseReceiptUpload.status, "pending"),
				lte(travelExpenseReceiptUpload.createdAt, abandonedBefore),
			),
		);
		const rows = await tx
			.select()
			.from(travelExpenseReceiptUpload)
			.where(
				input.attachmentId && input.organizationId
					? and(
							due,
							eq(travelExpenseReceiptUpload.id, input.attachmentId),
							eq(travelExpenseReceiptUpload.organizationId, input.organizationId),
						)
					: due,
			)
			.orderBy(asc(travelExpenseReceiptUpload.createdAt), asc(travelExpenseReceiptUpload.id))
			.limit(input.limit)
			.for("update", { skipLocked: true });
		const claimed: CleanupRow[] = [];
		for (const row of rows) {
			const [leased] = await tx
				.update(travelExpenseReceiptUpload)
				.set({
					status: "cleanup_required",
					reason: row.status === "pending" ? "abandoned" : row.reason,
					nextAttemptAt: leaseUntil,
					updatedAt: at,
				})
				.where(eq(travelExpenseReceiptUpload.id, row.id))
				.returning();
			if (leased) claimed.push(leased);
		}
		return claimed;
	});
}

/** Only the worker whose lease is current, for the object version it deleted, may settle a row. */
function heldLease(row: CleanupRow) {
	return and(
		eq(travelExpenseReceiptUpload.id, row.id),
		eq(travelExpenseReceiptUpload.status, "cleanup_required"),
		row.nextAttemptAt
			? eq(travelExpenseReceiptUpload.nextAttemptAt, row.nextAttemptAt)
			: sql`${travelExpenseReceiptUpload.nextAttemptAt} is null`,
		sql`${travelExpenseReceiptUpload.storageVersionId} is not distinct from ${row.storageVersionId}`,
	);
}

async function cleanupOne(
	database: Database,
	row: CleanupRow,
	deleteObject: DeleteReceiptObject,
	now: Instant,
): Promise<"deleted" | "released" | "failed"> {
	const attached = await database
		.select({ id: travelExpenseAttachment.id })
		.from(travelExpenseAttachment)
		.where(
			and(
				eq(travelExpenseAttachment.organizationId, row.organizationId),
				eq(travelExpenseAttachment.storageKey, row.storageKey),
			),
		)
		.limit(1);
	if (attached.length === 0) {
		try {
			await deleteObject({
				organizationId: row.organizationId,
				key: row.storageKey,
				bucket: row.storageBucket,
				versionId: row.storageVersionId,
			});
		} catch (error) {
			const attempts = row.attempts + 1;
			const delay = CLEANUP_RETRY_DELAYS_MS[attempts - 1] ?? MAX_CLEANUP_RETRY_DELAY_MS;
			await database
				.update(travelExpenseReceiptUpload)
				.set({
					attempts,
					lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
					// Retries back off but never stop; exhausted work stays visible.
					nextAttemptAt: dateFromInstant(now.add({ milliseconds: delay })),
					updatedAt: dateFromInstant(now),
				})
				.where(heldLease(row));
			return "failed";
		}
	}
	// A version learned meanwhile keeps the row, so the exact version is deleted later.
	await database.delete(travelExpenseReceiptUpload).where(heldLease(row));
	return attached.length === 0 ? "deleted" : "released";
}

/**
 * Deletes stored receipt objects that were never attached: rejected late
 * uploads, failed finalizations and uploads abandoned before finalization. An
 * object referenced by an attachment is never deleted. Failures keep the
 * work with backoff and the last error for inspection.
 */
export async function runTravelExpenseReceiptCleanup(
	database: Database,
	options: {
		deleteObject: DeleteReceiptObject;
		now?: Instant;
		limit?: number;
		/** Restricts the run to one staged upload (immediate cleanup after rejection). */
		only?: { attachmentId: string; organizationId: string };
	},
): Promise<ReceiptCleanupResult> {
	const now = options.now ?? systemClock.nowInstant();
	const rows = await claimCleanupWork(database, {
		now,
		limit: options.limit ?? 100,
		attachmentId: options.only?.attachmentId,
		organizationId: options.only?.organizationId,
	});
	const result: ReceiptCleanupResult = {
		claimed: rows.length,
		deleted: 0,
		released: 0,
		failed: 0,
	};
	for (const row of rows) {
		const outcome = await cleanupOne(database, row, options.deleteObject, now);
		result[outcome] += 1;
	}
	return result;
}

/** Outstanding cleanup work, for inspection. */
export async function countOutstandingTravelExpenseReceiptCleanup(
	database: Database,
): Promise<number> {
	const [row] = await database
		.select({ count: sql<number>`count(*)::int` })
		.from(travelExpenseReceiptUpload)
		.where(eq(travelExpenseReceiptUpload.status, "cleanup_required"));
	return row?.count ?? 0;
}
