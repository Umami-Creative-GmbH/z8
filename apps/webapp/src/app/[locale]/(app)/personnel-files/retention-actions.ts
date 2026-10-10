"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { mapConcurrently } from "@/lib/async/map-concurrently";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { managesAnyDocuments } from "@/lib/personnel-file/access";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import {
	type DueDocumentsResult,
	listDueDocumentsWithDay,
	type PurgeResult,
	purgeDueDocuments,
} from "@/lib/personnel-file/retention-store";
import { deletePersonnelDocumentObject } from "@/lib/personnel-file/storage";
import { runPersonnelFileCleanup } from "@/lib/personnel-file/upload-ledger";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

/**
 * The due-for-deletion list and confirmed purges (#870). Both resolve the
 * actor's personnel file access first and are limited to the employees and
 * categories it manages; without access everything reads as not found.
 */

export type {
	DueDocument,
	DueDocumentsResult,
	PurgeResult,
	RetentionUnknownDocument,
} from "@/lib/personnel-file/retention-store";

const NOT_FOUND = "Personnel files not found";
const MAX_PURGE_BATCH = 500;

function failure(error: unknown, fallback: string): { success: false; error: string } {
	logger.error({ error }, fallback);
	return { success: false, error: fallback };
}

export async function getDueForDeletionAction(): Promise<ServerActionResult<DueDocumentsResult>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !managesAnyDocuments(current.access)) {
			return { success: false, error: NOT_FOUND };
		}
		return { success: true, data: await listDueDocumentsWithDay(db, current.access) };
	} catch (error) {
		return failure(error, "Failed to load the documents due for deletion");
	}
}

/**
 * Purges the confirmed documents that are still due and managed by the actor;
 * the rest is reported as skipped. Objects are queued durably and deleted
 * right away when storage answers.
 */
export async function purgeDueDocumentsAction(input: {
	documentIds: string[];
	reason?: string | null;
}): Promise<ServerActionResult<PurgeResult>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !managesAnyDocuments(current.access)) {
			return { success: false, error: NOT_FOUND };
		}
		const documentIds = Array.isArray(input?.documentIds)
			? input.documentIds.filter((id) => isCanonicalUuid(id))
			: [];
		if (documentIds.length === 0) {
			return { success: false, error: "Select the documents to purge." };
		}
		if (documentIds.length > MAX_PURGE_BATCH) {
			return {
				success: false,
				error: `Purge at most ${MAX_PURGE_BATCH} documents at once.`,
			};
		}
		const reason = typeof input.reason === "string" ? input.reason : null;
		const result = await purgeDueDocuments(db, current.access, { documentIds, reason });
		await mapConcurrently(result.purged, 4, (documentId) =>
			runPersonnelFileCleanup(db, {
				deleteObject: deletePersonnelDocumentObject,
				only: { documentId, organizationId: current.access.organizationId },
			}).catch((error) => logger.error({ error }, "Deferred personnel file object cleanup")),
		);
		revalidatePath("/personnel-files");
		return { success: true, data: result };
	} catch (error) {
		return failure(error, "Failed to purge the documents");
	}
}
