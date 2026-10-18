"use server";

import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import type {
	DocumentRequestRefusal,
	DocumentRequestView,
} from "@/lib/personnel-file/document-request.types";
import {
	notifyDocumentRequestDecided,
	notifyDocumentRequested,
} from "@/lib/personnel-file/document-request-notifications";
import {
	cancelDocumentRequest,
	createDocumentRequest,
	listEmployeeDocumentRequests,
	listOwnDocumentRequests,
} from "@/lib/personnel-file/document-request-store";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

/**
 * Document request actions (#1307, #1401). Each one resolves the actor's
 * personnel file access first and the store re-checks coverage of the
 * employee and category under the request's lock; without access everything
 * reads as not found. Refusals come back with their reason as `code`; a
 * decision on a request that moved on comes back with code `conflict`.
 */

const NOT_FOUND = "Document request not found";
const CONFLICT_MESSAGE =
	"Someone else changed this request in the meantime. Reload it and try again.";

export type { DocumentRequestView } from "@/lib/personnel-file/document-request.types";

/** English fallbacks; the client shows translated text by `code`. */
const REFUSAL_MESSAGES: Readonly<Record<DocumentRequestRefusal, string>> = {
	category_not_requestable: "Only certificates and other documents can be requested.",
	invalid_title: "Enter a title of at most 200 characters.",
	invalid_note: "The note can be at most 2000 characters.",
	invalid_deadline: "Choose a deadline.",
	deadline_in_past: "The deadline cannot be in the past.",
	reason_required: "Enter a reason.",
	invalid_reason: "The reason can be at most 2000 characters.",
	own_file: "You cannot request documents on your own personnel file.",
	former_employee: "This employee's employment has ended.",
	renewed_document_mismatch:
		"The renewed document must be a document of the same employee and category.",
	renewal_already_requested: "This document already has an open request for its renewal.",
};

function refused(reason: DocumentRequestRefusal): { success: false; error: string; code: string } {
	return { success: false, error: REFUSAL_MESSAGES[reason], code: reason };
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
	logger.error({ error }, fallback);
	return { success: false, error: fallback };
}

export interface CreateDocumentRequestInput {
	employeeId: string;
	category: "certificate" | "other";
	title: string;
	note?: string | null;
	/** `YYYY-MM-DD` */
	deadline: string;
	/** The expiring document the request replaces (#1404). */
	renewedDocumentId?: string | null;
}

/** Creates a request for one employee and notifies them. */
export async function createDocumentRequestAction(
	input: CreateDocumentRequestInput,
): Promise<ServerActionResult<DocumentRequestView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		const renewedDocumentId = input?.renewedDocumentId ?? null;
		if (
			current.status !== "resolved" ||
			!isCanonicalUuid(input?.employeeId) ||
			(renewedDocumentId !== null && !isCanonicalUuid(renewedDocumentId))
		) {
			return { success: false, error: NOT_FOUND };
		}
		const result = await createDocumentRequest(db, current.access, {
			employeeId: input.employeeId,
			category: input.category,
			title: input.title,
			note: input.note ?? null,
			deadline: input.deadline,
			renewedDocumentId,
		});
		switch (result.kind) {
			case "not_found":
				return { success: false, error: NOT_FOUND };
			case "refused":
				return refused(result.reason);
			case "created":
				await notifyDocumentRequested(db, {
					organizationId: current.access.organizationId,
					eventId: result.eventId,
					request: result.request,
				});
				return { success: true, data: result.request };
		}
	} catch (error) {
		return failure(error, "Failed to create the document request");
	}
}

/** Cancels an open or submitted request with a reason and notifies the employee. */
export async function cancelDocumentRequestAction(input: {
	requestId: string;
	reason: string;
	/** The `version` the officer saw; a changed request conflicts. */
	expectedVersion?: number | null;
}): Promise<ServerActionResult<DocumentRequestView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.requestId)) {
			return { success: false, error: NOT_FOUND };
		}
		const expectedVersion =
			typeof input.expectedVersion === "number" && Number.isSafeInteger(input.expectedVersion)
				? input.expectedVersion
				: null;
		const result = await cancelDocumentRequest(db, current.access, {
			requestId: input.requestId,
			reason: input.reason,
			expectedVersion,
		});
		switch (result.kind) {
			case "not_found":
				return { success: false, error: NOT_FOUND };
			case "refused":
				return refused(result.reason);
			case "conflict":
				return { success: false, error: CONFLICT_MESSAGE, code: "conflict" };
			case "cancelled":
				await notifyDocumentRequestDecided(db, {
					organizationId: current.access.organizationId,
					eventId: result.eventId,
					request: result.request,
					decision: "cancelled",
					reason: result.request.history.at(-1)?.reason ?? null,
				});
				return { success: true, data: result.request };
		}
	} catch (error) {
		return failure(error, "Failed to cancel the document request");
	}
}

/** One employee's requests the actor covers (the requests section of their file). */
export async function listEmployeeDocumentRequestsAction(input: {
	employeeId: string;
}): Promise<ServerActionResult<DocumentRequestView[]>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.employeeId)) {
			return { success: false, error: NOT_FOUND };
		}
		const requests = await listEmployeeDocumentRequests(db, current.access, input.employeeId);
		if (!requests) return { success: false, error: NOT_FOUND };
		return { success: true, data: requests };
	} catch (error) {
		return failure(error, "Failed to load the document requests");
	}
}

/** The signed-in employee's own requests ("Requested documents"). */
export async function getMyDocumentRequestsAction(): Promise<
	ServerActionResult<DocumentRequestView[]>
> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !current.access.selfEmployeeId) {
			return { success: false, error: NOT_FOUND };
		}
		return { success: true, data: await listOwnDocumentRequests(db, current.access) };
	} catch (error) {
		return failure(error, "Failed to load your requested documents");
	}
}
