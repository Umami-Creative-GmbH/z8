import { createHash } from "node:crypto";
import type { db as appDb } from "@/db";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { addJob } from "@/lib/queue";
import {
	deletePrivateObject,
	readPrivateObject,
	uploadPrivateObject,
} from "@/lib/storage/export-s3-client";
import { assembleTravelExpenseExportZip } from "./export-bundle";
import { TravelExpenseExportContentError } from "./export-csv";
import { travelExpenseExportFileName, travelExpenseExportManifestDigest } from "./export-manifest";
import {
	claimTravelExpenseExportAttempt,
	completeTravelExpenseExportAttempt,
	failTravelExpenseExportAttempt,
} from "./export-store";

/**
 * Runs one attempt of a travel expense export batch (#613) in the worker:
 * claim the queued attempt, build the ZIP from the stored manifest, store it
 * privately under an attempt-specific key, then complete the attempt only if
 * it is still the batch's running attempt. Failures are recorded on the batch
 * (and never retried automatically); finance retries the same batch.
 */

const logger = createLogger("TravelExpenseExport");

type Database = typeof appDb;

export interface TravelExpenseExportJobInput {
	organizationId: string;
	batchId: string;
	attempt: number;
}

export type TravelExpenseExportRunResult =
	| { status: "completed" }
	| { status: "failed"; errorCode: string }
	/** Not the queued attempt any more (cancelled, retried or already run). */
	| { status: "skipped" }
	/** Cancelled or superseded while running; the stored file was removed. */
	| { status: "discarded" };

export function travelExpenseExportStorageKey(
	input: TravelExpenseExportJobInput,
	fileName: string,
): string {
	return `travel-expense-exports/${input.organizationId}/${input.batchId}/attempt-${input.attempt}/${fileName}`;
}

export async function processTravelExpenseExportBatch(
	database: Database,
	input: TravelExpenseExportJobInput,
	now: () => Instant = () => systemClock.nowInstant(),
): Promise<TravelExpenseExportRunResult> {
	const claimed = await claimTravelExpenseExportAttempt(database, input, now());
	if (claimed.status === "skipped") return { status: "skipped" };
	let stored: { bucket: string | null; key: string; versionId: string | null } | null = null;
	try {
		const { manifest } = claimed;
		if (
			manifest.batchId !== input.batchId ||
			manifest.organizationId !== input.organizationId ||
			travelExpenseExportManifestDigest(manifest) !== claimed.manifestDigest
		) {
			throw new TravelExpenseExportContentError("manifest_invalid", "Manifest digest mismatch");
		}
		const zip = await assembleTravelExpenseExportZip(manifest, (object) =>
			readPrivateObject({ organizationId: input.organizationId, ...object }),
		);
		const fileName = travelExpenseExportFileName(manifest);
		const key = travelExpenseExportStorageKey(input, fileName);
		let upload: { bucket: string; versionId: string | null };
		try {
			upload = await uploadPrivateObject(input.organizationId, key, zip, "application/zip");
		} catch {
			throw new TravelExpenseExportContentError("storage_failed", "Export upload failed");
		}
		stored = { bucket: upload.bucket, key, versionId: upload.versionId };
		const completed = await completeTravelExpenseExportAttempt(
			database,
			{
				...input,
				file: {
					fileName,
					...stored,
					sizeBytes: zip.byteLength,
					checksumSha256: createHash("sha256").update(zip).digest("hex"),
				},
			},
			now(),
		);
		if (completed) {
			logger.info({ ...input, sizeBytes: zip.byteLength }, "Travel expense export completed");
			return { status: "completed" };
		}
		await removeStored(input.organizationId, stored);
		return { status: "discarded" };
	} catch (error) {
		const errorCode = error instanceof TravelExpenseExportContentError ? error.code : "unexpected";
		const errorMessage =
			error instanceof TravelExpenseExportContentError
				? error.message
				: "Unexpected export failure";
		logger.error({ ...input, errorCode, error }, "Travel expense export failed");
		const recorded = await failTravelExpenseExportAttempt(
			database,
			{ ...input, errorCode, errorMessage },
			now(),
		);
		if (stored) await removeStored(input.organizationId, stored);
		return recorded ? { status: "failed", errorCode } : { status: "discarded" };
	}
}

async function removeStored(
	organizationId: string,
	stored: { bucket: string | null; key: string; versionId: string | null },
): Promise<void> {
	try {
		await deletePrivateObject({ organizationId, ...stored });
	} catch (error) {
		logger.warn({ organizationId, key: stored.key, error }, "Could not remove a discarded export");
	}
}

/**
 * Queues an attempt for the worker. One BullMQ job per attempt, without
 * automatic retries: a failure is recorded on the batch and retried
 * explicitly. A queue failure marks the attempt failed so it can be retried.
 */
export async function enqueueTravelExpenseExportBatch(
	database: Database,
	input: TravelExpenseExportJobInput,
): Promise<void> {
	try {
		await addJob(
			"process-travel-expense-export",
			{ type: "travel-expense-export", ...input },
			{
				priority: 4,
				attempts: 1,
				jobId: `travel-expense-export-${input.batchId}-${input.attempt}`,
			},
		);
	} catch (error) {
		logger.error({ ...input, error }, "Failed to queue a travel expense export");
		await failTravelExpenseExportAttempt(database, {
			...input,
			errorCode: "enqueue_failed",
			errorMessage: "The export could not be queued",
		});
	}
}
