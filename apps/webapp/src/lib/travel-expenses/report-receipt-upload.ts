import { and, eq, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	type TravelExpenseReceiptCleanupReason,
	travelExpenseReceiptUpload,
	travelExpenseReportItem,
	travelExpenseReportReceipt,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER } from "./attachment-validation";
import type { StoredReceiptObject } from "./receipt-upload";
import {
	lockOwnDraftReport,
	type ReportOwner,
	type ReportReceiptView,
	receiptViewColumns,
	toReceiptView,
	touchReport,
} from "./report-store";

/**
 * Receipt files of report items (#600), coordinated exactly like legacy claim
 * receipts (#295): the object is staged durably before it is stored, attached
 * only under the report row lock while the report is the uploader's draft, and
 * every rejected, failed, abandoned or removed object is left to the shared
 * receipt cleanup worker.
 */

type Database = typeof appDb;

export interface StagedReportReceiptUpload {
	receiptId: string;
	organizationId: string;
	reportId: string;
	itemId: string;
	/** Employee ID of the uploading report owner. */
	uploadedBy: string;
	/** User ID of the uploading report owner. */
	userId: string;
	storageKey: string;
}

/** Write-once object key: the receipt ID is never reused. */
export function travelExpenseReportReceiptStorageKey(input: {
	organizationId: string;
	reportId: string;
	itemId: string;
	receiptId: string;
	fileName: string;
}): string {
	return `travel-expenses/${input.organizationId}/reports/${input.reportId}/${input.itemId}/${input.receiptId}-${input.fileName}`;
}

/** Committed before the object is stored, so a crash never leaks it silently. */
export async function stageReportReceiptUpload(
	database: Database,
	input: StagedReportReceiptUpload,
	now: Instant = systemClock.nowInstant(),
): Promise<void> {
	const at = dateFromInstant(now);
	await database.insert(travelExpenseReceiptUpload).values({
		id: input.receiptId,
		organizationId: input.organizationId,
		reportId: input.reportId,
		itemId: input.itemId,
		uploadedBy: input.uploadedBy,
		storageKey: input.storageKey,
		status: "pending",
		createdAt: at,
		updatedAt: at,
	});
}

export type FinalizeReportReceiptResult =
	| { kind: "attached"; receipt: ReportReceiptView }
	| { kind: "report_not_draft" };

/**
 * Attaches a stored receipt to its item under the report row lock. When the
 * report is no longer the uploader's draft (or the item is gone), nothing is
 * attached and the object is marked for cleanup in the same transaction.
 */
export async function finalizeReportReceiptUpload(
	database: Database,
	input: StagedReportReceiptUpload & {
		stored: StoredReceiptObject;
		fileName: string;
		mimeType: string;
		sizeBytes: number;
		checksumSha256: string;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<FinalizeReportReceiptResult> {
	const at = dateFromInstant(now);
	const owner = { organizationId: input.organizationId, employeeId: input.uploadedBy };
	return database.transaction(async (tx) => {
		const report = await lockOwnDraftReport(tx, owner, input.reportId);
		const [item] =
			report.status === "draft"
				? await tx
						.select({ id: travelExpenseReportItem.id })
						.from(travelExpenseReportItem)
						.where(
							and(
								eq(travelExpenseReportItem.id, input.itemId),
								eq(travelExpenseReportItem.reportId, input.reportId),
								eq(travelExpenseReportItem.organizationId, input.organizationId),
							),
						)
				: [];
		if (!item) {
			await tx
				.update(travelExpenseReceiptUpload)
				.set({
					status: "cleanup_required",
					reason: "report_not_draft",
					storageBucket: input.stored.bucket,
					storageVersionId: input.stored.versionId,
					nextAttemptAt: at,
					updatedAt: at,
				})
				.where(
					and(
						eq(travelExpenseReceiptUpload.id, input.receiptId),
						eq(travelExpenseReceiptUpload.organizationId, input.organizationId),
						eq(travelExpenseReceiptUpload.status, "pending"),
					),
				);
			return { kind: "report_not_draft" };
		}

		const released = await tx
			.delete(travelExpenseReceiptUpload)
			.where(
				and(
					eq(travelExpenseReceiptUpload.id, input.receiptId),
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

		const [receipt] = await tx
			.insert(travelExpenseReportReceipt)
			.values({
				id: input.receiptId,
				organizationId: input.organizationId,
				reportId: input.reportId,
				itemId: input.itemId,
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
			.returning(receiptViewColumns);
		if (!receipt) throw new Error("Failed to create report receipt record");
		await touchReport(tx, { ...owner, userId: input.userId }, input.reportId, at);
		return { kind: "attached", receipt: toReceiptView(receipt) };
	});
}

/**
 * Records that a staged object could not be attached. Idempotent; recreates
 * the row when cleanup already swept it as abandoned, so a slow upload never
 * leaves an unrecorded object, and keeps another worker's lease.
 */
export async function markReportReceiptUploadFailed(
	database: Database,
	input: StagedReportReceiptUpload & {
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
			id: input.receiptId,
			organizationId: input.organizationId,
			reportId: input.reportId,
			itemId: input.itemId,
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

export type RemoveReportReceiptResult =
	| { kind: "removed"; receiptId: string }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Detaches a receipt from a draft item. The deletion trigger of
 * `travel_expense_report_receipt` (migration 0113) hands the stored object to
 * the cleanup worker in the same transaction, as it does for every cascade,
 * so it is deleted durably even when the immediate deletion attempt fails.
 */
export async function removeReportReceipt(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string; itemId: string; receiptId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<RemoveReportReceiptResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const report = await lockOwnDraftReport(tx, owner, input.reportId);
		if (report.status !== "draft") return { kind: report.status };
		const [removed] = await tx
			.delete(travelExpenseReportReceipt)
			.where(
				and(
					eq(travelExpenseReportReceipt.id, input.receiptId),
					eq(travelExpenseReportReceipt.itemId, input.itemId),
					eq(travelExpenseReportReceipt.reportId, input.reportId),
					eq(travelExpenseReportReceipt.organizationId, owner.organizationId),
				),
			)
			.returning({ id: travelExpenseReportReceipt.id });
		if (!removed) return { kind: "not_found" };
		// The trigger stamps database time; align it with the clock the worker uses.
		await tx
			.update(travelExpenseReceiptUpload)
			.set({ nextAttemptAt: at, createdAt: at, updatedAt: at })
			.where(
				and(
					eq(travelExpenseReceiptUpload.id, removed.id),
					eq(travelExpenseReceiptUpload.organizationId, owner.organizationId),
					eq(travelExpenseReceiptUpload.status, "cleanup_required"),
				),
			);
		await touchReport(tx, owner, input.reportId, at);
		return { kind: "removed", receiptId: removed.id };
	});
}
