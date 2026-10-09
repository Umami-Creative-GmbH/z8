import { and, asc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employeeDocument, personnelFileUpload } from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import type { PersonnelFileCleanupReason } from "./document.types";

/**
 * Staging and cleanup of stored personnel file objects (#865), the same
 * protocol as travel expense receipts (#295): a ledger row is committed
 * before an object is stored and removed in the transaction that records the
 * employee document. Every object that was never recorded (failed or
 * abandoned uploads) or whose document was deleted (directly or by an
 * employee or organization cascade, through the AFTER DELETE trigger of
 * migration 0142) stays here until the cleanup worker deleted it. Failures
 * back off and retry forever.
 */

type Database = typeof appDb;

/** Uploads still pending after this long are treated as abandoned. */
export const ABANDONED_PERSONNEL_FILE_UPLOAD_AFTER_MS = 60 * 60 * 1000;
/** Staged payslip batch files wait for the officer's review and confirmation (#868). */
export const ABANDONED_PAYSLIP_BATCH_FILE_AFTER_MS = 24 * 60 * 60 * 1000;
const CLEANUP_LEASE_MS = 10 * 60 * 1000;
const MAX_CLEANUP_RETRY_DELAY_MS = 12 * 60 * 60 * 1000;
const CLEANUP_RETRY_DELAYS_MS = [
	60 * 1000,
	5 * 60 * 1000,
	30 * 60 * 1000,
	2 * 60 * 60 * 1000,
	MAX_CLEANUP_RETRY_DELAY_MS,
];

export interface StagedPersonnelFileUpload {
	documentId: string;
	organizationId: string;
	employeeId: string;
	/** User ID of the uploader. */
	uploadedBy: string;
	storageKey: string;
}

export interface StoredPersonnelFileObject {
	bucket: string;
	versionId: string | null;
}

/** Committed before the object is stored, so a crash never leaks it silently. */
export async function stagePersonnelFileUpload(
	database: Database,
	input: StagedPersonnelFileUpload,
	now: Instant = systemClock.nowInstant(),
): Promise<void> {
	const at = dateFromInstant(now);
	await database.insert(personnelFileUpload).values({
		id: input.documentId,
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		uploadedBy: input.uploadedBy,
		storageKey: input.storageKey,
		status: "pending",
		createdAt: at,
		updatedAt: at,
	});
}

/**
 * Records that a staged object could not become a document. Idempotent; the
 * row is recreated when cleanup already swept it as abandoned, and a row
 * another worker holds keeps its lease and only learns the object version.
 */
export async function markPersonnelFileUploadFailed(
	database: Database,
	input: Omit<StagedPersonnelFileUpload, "employeeId"> & {
		/** Null for a staged payslip batch file (#868). */
		employeeId: string | null;
		batchId?: string | null;
		stored: StoredPersonnelFileObject | null;
		reason: PersonnelFileCleanupReason;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<void> {
	const at = dateFromInstant(now);
	const table = personnelFileUpload;
	const wasPending = sql`${table.status} = 'pending'`;
	await database
		.insert(table)
		.values({
			id: input.documentId,
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			batchId: input.batchId ?? null,
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

export type DeletePersonnelFileObject = (input: {
	organizationId: string;
	key: string;
	bucket: string | null;
	versionId: string | null;
}) => Promise<void>;

export interface PersonnelFileCleanupResult {
	claimed: number;
	deleted: number;
	/** Objects that turned out to be recorded on a document; only the stale row was removed. */
	released: number;
	failed: number;
}

type CleanupRow = typeof personnelFileUpload.$inferSelect;

async function claimCleanupWork(
	database: Database,
	input: { now: Instant; limit: number; documentId?: string; organizationId?: string },
): Promise<CleanupRow[]> {
	const at = dateFromInstant(input.now);
	const abandonedBefore = dateFromInstant(
		input.now.subtract({ milliseconds: ABANDONED_PERSONNEL_FILE_UPLOAD_AFTER_MS }),
	);
	const batchFileAbandonedBefore = dateFromInstant(
		input.now.subtract({ milliseconds: ABANDONED_PAYSLIP_BATCH_FILE_AFTER_MS }),
	);
	const leaseUntil = dateFromInstant(input.now.add({ milliseconds: CLEANUP_LEASE_MS }));
	return database.transaction(async (tx) => {
		const due = or(
			and(
				eq(personnelFileUpload.status, "cleanup_required"),
				lte(personnelFileUpload.nextAttemptAt, at),
			),
			and(
				eq(personnelFileUpload.status, "pending"),
				isNull(personnelFileUpload.batchId),
				lte(personnelFileUpload.createdAt, abandonedBefore),
			),
			and(
				eq(personnelFileUpload.status, "pending"),
				isNotNull(personnelFileUpload.batchId),
				lte(personnelFileUpload.createdAt, batchFileAbandonedBefore),
			),
		);
		const rows = await tx
			.select()
			.from(personnelFileUpload)
			.where(
				input.documentId && input.organizationId
					? and(
							due,
							eq(personnelFileUpload.id, input.documentId),
							eq(personnelFileUpload.organizationId, input.organizationId),
						)
					: due,
			)
			.orderBy(asc(personnelFileUpload.createdAt), asc(personnelFileUpload.id))
			.limit(input.limit)
			.for("update", { skipLocked: true });
		const claimed: CleanupRow[] = [];
		for (const row of rows) {
			const [leased] = await tx
				.update(personnelFileUpload)
				.set({
					status: "cleanup_required",
					reason: row.status === "pending" ? "abandoned" : row.reason,
					nextAttemptAt: leaseUntil,
					updatedAt: at,
				})
				.where(eq(personnelFileUpload.id, row.id))
				.returning();
			if (leased) claimed.push(leased);
		}
		return claimed;
	});
}

/** Only the worker whose lease is current, for the object version it deleted, may settle a row. */
function heldLease(row: CleanupRow) {
	return and(
		eq(personnelFileUpload.id, row.id),
		eq(personnelFileUpload.status, "cleanup_required"),
		row.nextAttemptAt
			? eq(personnelFileUpload.nextAttemptAt, row.nextAttemptAt)
			: sql`${personnelFileUpload.nextAttemptAt} is null`,
		sql`${personnelFileUpload.storageVersionId} is not distinct from ${row.storageVersionId}`,
	);
}

async function cleanupOne(
	database: Database,
	row: CleanupRow,
	deleteObject: DeletePersonnelFileObject,
	now: Instant,
): Promise<"deleted" | "released" | "failed"> {
	const recorded = await database
		.select({ id: employeeDocument.id })
		.from(employeeDocument)
		.where(
			and(
				eq(employeeDocument.organizationId, row.organizationId),
				eq(employeeDocument.storageKey, row.storageKey),
			),
		)
		.limit(1);
	if (recorded.length === 0) {
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
				.update(personnelFileUpload)
				.set({
					attempts,
					lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
					nextAttemptAt: dateFromInstant(now.add({ milliseconds: delay })),
					updatedAt: dateFromInstant(now),
				})
				.where(heldLease(row));
			return "failed";
		}
	}
	await database.delete(personnelFileUpload).where(heldLease(row));
	return recorded.length === 0 ? "deleted" : "released";
}

/**
 * Deletes stored personnel file objects no document records any more. An
 * object a document still records is never deleted.
 */
export async function runPersonnelFileCleanup(
	database: Database,
	options: {
		deleteObject: DeletePersonnelFileObject;
		now?: Instant;
		limit?: number;
		/** Restricts the run to one document's object (immediate cleanup after deletion). */
		only?: { documentId: string; organizationId: string };
	},
): Promise<PersonnelFileCleanupResult> {
	const now = options.now ?? systemClock.nowInstant();
	const rows = await claimCleanupWork(database, {
		now,
		limit: options.limit ?? 100,
		documentId: options.only?.documentId,
		organizationId: options.only?.organizationId,
	});
	const result: PersonnelFileCleanupResult = {
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
export async function countOutstandingPersonnelFileCleanup(database: Database): Promise<number> {
	const [row] = await database
		.select({ count: sql<number>`count(*)::int` })
		.from(personnelFileUpload)
		.where(eq(personnelFileUpload.status, "cleanup_required"));
	return row?.count ?? 0;
}
