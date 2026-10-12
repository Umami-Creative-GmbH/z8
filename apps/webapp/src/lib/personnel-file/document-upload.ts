import "server-only";
import { randomUUID } from "node:crypto";
import type { db as appDb } from "@/db";
import { createLogger } from "@/lib/logger";
import { uploadPrivateObject } from "@/lib/storage/export-s3-client";
import { sanitizeTusFileKey } from "@/lib/upload/tus-ownership";
import type { PersonnelFileAccess } from "./access";
import type { DocumentMetadata } from "./document-rules";
import {
	type FinalizePersonnelDocumentResult,
	finalizePersonnelDocumentUpload,
	type PersonnelDocumentUploadSource,
	personnelDocumentStorageKey,
} from "./document-store";
import type { SickNoteAttachAuthority } from "./sick-note-attach";
import {
	deletePersonnelDocumentObject,
	deleteTusUpload,
	readUploadedPersonnelDocument,
} from "./storage";
import {
	markPersonnelFileUploadFailed,
	runPersonnelFileCleanup,
	type StoredPersonnelFileObject,
	stagePersonnelFileUpload,
} from "./upload-ledger";

/**
 * Turns one finished TUS upload into an employee document (#865): the one copy
 * of the staging protocol the upload route and the sick-note helpers share.
 * The file is read and sniffed by its bytes, staged in the upload ledger
 * before the private object exists, stored, and finalized with its staging
 * row released in one transaction. Whatever fails after staging is left to
 * the ledger cleanup, so a stored object is never orphaned.
 *
 * The caller decided access and validated the metadata before.
 */

type Database = typeof appDb;

const logger = createLogger("PersonnelFileDocumentUpload");

export type RecordUploadedDocumentResult =
	| Extract<FinalizePersonnelDocumentResult, { kind: "recorded" }>
	/** The file key is not a finished upload of the actor. */
	| { kind: "invalid_file_key" }
	/** The file is too large or of a type personnel files do not take (HEIC, …). */
	| { kind: "unreadable"; status: number; error: string }
	/** The sick note's absence can no longer take it; the stored object is cleaned up. */
	| { kind: "absence_unavailable" }
	/** The ledger cleanup claimed the staged object meanwhile (a very slow upload). */
	| { kind: "not_pending" };

/**
 * Why a finished upload was not recorded, as the HTTP status and the message
 * the upload route answers with and the staged sick notes report per file.
 */
export function uploadNotRecorded(
	result: Exclude<RecordUploadedDocumentResult, { kind: "recorded" }>,
): { status: number; error: string } {
	switch (result.kind) {
		case "invalid_file_key":
			return { status: 400, error: "Invalid file key" };
		case "unreadable":
			return { status: result.status, error: result.error };
		case "absence_unavailable":
			return { status: 409, error: "This absence can no longer take a sick note." };
		case "not_pending":
			return { status: 409, error: "The upload took too long. Please upload the file again." };
	}
}

export async function recordUploadedPersonnelDocument(
	database: Database,
	input: {
		access: PersonnelFileAccess;
		employeeId: string;
		/** As the client sent it; only the actor's own finished uploads are read. */
		tusFileKey: string;
		fileName: string | undefined;
		metadata: DocumentMetadata;
		/** "employee" or "recorder" (#867, #984), see `finalizePersonnelDocumentUpload`. */
		source?: PersonnelDocumentUploadSource;
		/** Attaches the document as a sick note to the absence (#982). */
		sickNote?: { absenceId: string; authority: SickNoteAttachAuthority };
	},
): Promise<RecordUploadedDocumentResult> {
	const { access } = input;
	const tusFileKey = sanitizeTusFileKey(input.tusFileKey, access.userId);
	if (!tusFileKey) return { kind: "invalid_file_key" };

	const upload = await readUploadedPersonnelDocument({ tusFileKey, fileName: input.fileName });
	if (!upload.ok) return { kind: "unreadable", status: upload.status, error: upload.error };

	const documentId = randomUUID();
	const staged = {
		documentId,
		organizationId: access.organizationId,
		employeeId: input.employeeId,
		uploadedBy: access.userId,
		storageKey: personnelDocumentStorageKey({
			organizationId: access.organizationId,
			employeeId: input.employeeId,
			documentId,
			fileName: upload.fileName,
		}),
	};

	// Durable before the object exists, so any later failure leaves cleanup work.
	await stagePersonnelFileUpload(database, staged);

	let stored: StoredPersonnelFileObject | null = null;
	let finalized: FinalizePersonnelDocumentResult;
	try {
		stored = await uploadPrivateObject(
			access.organizationId,
			staged.storageKey,
			upload.buffer,
			upload.mimeType,
			{
				"uploaded-by": access.userId,
				"original-key": tusFileKey,
				"upload-timestamp": new Date().toISOString(),
				"content-sha256": upload.checksumSha256,
			},
		);
		finalized = await finalizePersonnelDocumentUpload(database, {
			...staged,
			metadata: input.metadata,
			stored,
			fileName: upload.fileName,
			mimeType: upload.mimeType,
			sizeBytes: upload.buffer.length,
			checksumSha256: upload.checksumSha256,
			...(input.source ? { source: input.source } : {}),
			...(input.sickNote ? { sickNote: { ...input.sickNote, access } } : {}),
		});
	} catch (error) {
		await markPersonnelFileUploadFailed(database, {
			...staged,
			stored,
			reason: "finalization_failed",
		}).catch((markError) =>
			logger.error({ error: markError }, "Failed to record personnel file upload cleanup"),
		);
		throw error;
	}

	await deleteTusUpload(tusFileKey);

	if (finalized.kind === "recorded") return finalized;

	if (finalized.kind === "absence_unavailable") {
		// Cancelled, rejected or no longer allowed while the file was stored.
		await markPersonnelFileUploadFailed(database, {
			...staged,
			stored,
			reason: "finalization_failed",
		});
	}
	await runPersonnelFileCleanup(database, {
		deleteObject: deletePersonnelDocumentObject,
		only: { documentId, organizationId: access.organizationId },
	}).catch((error) => logger.error({ error }, "Deferred personnel file upload cleanup"));
	return finalized;
}
