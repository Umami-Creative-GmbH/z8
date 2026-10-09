"use server";

import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { type DocumentCategory, isDocumentCategory } from "@/lib/personnel-file/document.types";
import {
	deleteDocument,
	type EmployeeDocumentView,
	listEmployeeDocuments,
	listOwnSharedDocuments,
	updateDocumentMetadata,
} from "@/lib/personnel-file/document-store";
import { notifyDocumentShared } from "@/lib/personnel-file/notifications";
import {
	type PersonnelFilePanelCapability,
	personnelFilePanelCapabilityFor,
} from "@/lib/personnel-file/panel";
import { deletePersonnelDocumentObject } from "@/lib/personnel-file/storage";
import { runPersonnelFileCleanup } from "@/lib/personnel-file/upload-ledger";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

/**
 * Personnel file actions (#865). Each one resolves the actor's personnel file
 * access first; without it (or with personnel files turned off) everything
 * reads as not found.
 */

const NOT_FOUND = "Personnel file not found";
const DOCUMENT_NOT_FOUND = "Document not found";
const DELETE_REASON_MAX_LENGTH = 1000;

export type { EmployeeDocumentView } from "@/lib/personnel-file/document-store";

export interface PersonnelFileData {
	capability: PersonnelFilePanelCapability;
	documents: EmployeeDocumentView[];
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
	logger.error({ error }, fallback);
	return { success: false, error: fallback };
}

export async function getPersonnelFileAction(input: {
	employeeId: string;
	category?: DocumentCategory | null;
}): Promise<ServerActionResult<PersonnelFileData>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.employeeId)) {
			return { success: false, error: NOT_FOUND };
		}
		const capability = await personnelFilePanelCapabilityFor(current.access, input.employeeId);
		if (!capability) return { success: false, error: NOT_FOUND };
		const category = isDocumentCategory(input.category) ? input.category : null;
		const documents = await listEmployeeDocuments(db, current.access, {
			employeeId: capability.employeeId,
			category,
		});
		return { success: true, data: { capability, documents } };
	} catch (error) {
		return failure(error, "Failed to load the personnel file");
	}
}

export interface UpdateEmployeeDocumentInput {
	documentId: string;
	metadata: {
		category: DocumentCategory;
		title: string;
		documentDate: string;
		payPeriod: { year: number; month: number } | null;
		visibility: "shared" | "hr_only";
		expiryDate: string | null;
	};
}

export async function updateEmployeeDocumentAction(
	input: UpdateEmployeeDocumentInput,
): Promise<ServerActionResult<EmployeeDocumentView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.documentId)) {
			return { success: false, error: DOCUMENT_NOT_FOUND };
		}
		const result = await updateDocumentMetadata(db, current.access, {
			documentId: input.documentId,
			metadata: {
				category: input.metadata?.category,
				title: input.metadata?.title,
				documentDate: input.metadata?.documentDate,
				payPeriod: input.metadata?.payPeriod ?? null,
				visibility: input.metadata?.visibility,
				expiryDate: input.metadata?.expiryDate ?? null,
			},
		});
		switch (result.kind) {
			case "not_found":
				return { success: false, error: DOCUMENT_NOT_FOUND };
			case "invalid":
				return { success: false, error: result.message, code: `invalid_${result.field}` };
			case "unchanged":
				return { success: true, data: result.document };
			case "updated":
				if (result.shareEventId) {
					await notifyDocumentShared(db, {
						organizationId: current.access.organizationId,
						shareEventId: result.shareEventId,
						document: result.document,
					});
				}
				return { success: true, data: result.document };
		}
	} catch (error) {
		return failure(error, "Failed to update the document");
	}
}

export async function deleteEmployeeDocumentAction(input: {
	documentId: string;
	reason?: string | null;
}): Promise<ServerActionResult<{ documentId: string }>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.documentId)) {
			return { success: false, error: DOCUMENT_NOT_FOUND };
		}
		const reason =
			typeof input.reason === "string" && input.reason.trim()
				? input.reason.trim().slice(0, DELETE_REASON_MAX_LENGTH)
				: null;
		const result = await deleteDocument(db, current.access, {
			documentId: input.documentId,
			reason,
		});
		if (result.kind === "not_found") return { success: false, error: DOCUMENT_NOT_FOUND };
		// The object is queued durably; try to delete it right away.
		await runPersonnelFileCleanup(db, {
			deleteObject: deletePersonnelDocumentObject,
			only: { documentId: result.documentId, organizationId: current.access.organizationId },
		}).catch((error) => logger.error({ error }, "Deferred personnel file object cleanup"));
		return { success: true, data: { documentId: result.documentId } };
	} catch (error) {
		return failure(error, "Failed to delete the document");
	}
}

/** The signed-in employee's shared documents ("My documents"). */
export async function getMyDocumentsAction(): Promise<ServerActionResult<EmployeeDocumentView[]>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !current.access.selfEmployeeId) {
			return { success: false, error: NOT_FOUND };
		}
		return { success: true, data: await listOwnSharedDocuments(db, current.access) };
	} catch (error) {
		return failure(error, "Failed to load your documents");
	}
}
