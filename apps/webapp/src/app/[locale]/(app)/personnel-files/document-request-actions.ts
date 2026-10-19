"use server";

import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import {
	DOCUMENT_REQUEST_BULK_MAX_RECIPIENTS,
	DOCUMENT_REQUEST_TEXT_MAX_LENGTH,
	DOCUMENT_REQUEST_TITLE_MAX_LENGTH,
	type DocumentRequestBulkSummary,
	type DocumentRequestCategory,
	type DocumentRequestRefusal,
	type DocumentRequestView,
} from "@/lib/personnel-file/document-request.types";
import {
	notifyDocumentRequestDecided,
	notifyDocumentRequested,
	notifyDocumentRequestSubmitted,
} from "@/lib/personnel-file/document-request-notifications";
import {
	acceptDocumentRequest,
	cancelDocumentRequest,
	createDocumentRequest,
	createDocumentRequestsInBulk,
	editDocumentRequest,
	listEmployeeDocumentRequests,
	listOwnDocumentRequests,
	returnDocumentRequest,
	submitDocumentRequest,
} from "@/lib/personnel-file/document-request-store";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

/**
 * Document request actions (#1307, #1401). Each one resolves the actor's
 * personnel file access first and the store re-checks coverage of the
 * employee and category under the request's lock; without access everything
 * reads as not found. Refusals come back with their reason as `code`; a
 * write on a request that moved on, or one that names no `expectedVersion`,
 * comes back with code `conflict`.
 */

const NOT_FOUND = "Document request not found";
const CONFLICT_MESSAGE =
	"Someone else changed this request in the meantime. Reload it and try again.";

export type { DocumentRequestView } from "@/lib/personnel-file/document-request.types";

/** English fallbacks; the client shows translated text by `code`. */
const REFUSAL_MESSAGES: Readonly<Record<DocumentRequestRefusal, string>> = {
	category_not_requestable: "Only certificates and other documents can be requested.",
	invalid_title: `Enter a title of at most ${DOCUMENT_REQUEST_TITLE_MAX_LENGTH} characters.`,
	invalid_note: `The note can be at most ${DOCUMENT_REQUEST_TEXT_MAX_LENGTH} characters.`,
	invalid_deadline: "Choose a deadline.",
	deadline_in_past: "The deadline cannot be in the past.",
	reason_required: "Enter a reason.",
	invalid_reason: `The reason can be at most ${DOCUMENT_REQUEST_TEXT_MAX_LENGTH} characters.`,
	own_file: "You cannot request documents on your own personnel file.",
	former_employee: "This employee's employment has ended.",
	renewed_document_mismatch:
		"The renewed document must be a document of the same employee and category.",
	renewal_already_requested: "This document already has an open request for its renewal.",
	no_documents: "Upload at least one document before you submit.",
	not_editable:
		"Only the deadline and note can be changed. Cancel the request and create a new one instead.",
	no_recipients: "Choose at least one employee or team.",
	too_many_recipients: `Request documents from at most ${DOCUMENT_REQUEST_BULK_MAX_RECIPIENTS} employees at once.`,
	renewal_not_in_bulk: "Requests for several employees cannot name a renewed document.",
	renewal_expiry_date_required:
		"The renewed skill requires an expiry date. Add the expiry date to a submitted certificate, then accept.",
};

function refused(reason: DocumentRequestRefusal): { success: false; error: string; code: string } {
	return { success: false, error: REFUSAL_MESSAGES[reason], code: reason };
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
	logger.error({ error }, fallback);
	return { success: false, error: fallback };
}

/** The store results every write shares besides its success. */
type Unsuccessful =
	| { kind: "not_found" }
	| { kind: "conflict" }
	| { kind: "refused"; reason: DocumentRequestRefusal };

function unsuccessful(result: Unsuccessful): { success: false; error: string; code?: string } {
	switch (result.kind) {
		case "not_found":
			return { success: false, error: NOT_FOUND };
		case "conflict":
			return { success: false, error: CONFLICT_MESSAGE, code: "conflict" };
		case "refused":
			return refused(result.reason);
	}
}

/** The `version` a person saw, or null (none, or not a whole number): the store then conflicts. */
function safeVersion(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

export interface CreateDocumentRequestInput {
	employeeId: string;
	category: DocumentRequestCategory;
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
		if (result.kind !== "created") return unsuccessful(result);
		await notifyDocumentRequested(db, {
			organizationId: current.access.organizationId,
			eventId: result.eventId,
			request: result.request,
		});
		return { success: true, data: result.request };
	} catch (error) {
		return failure(error, "Failed to create the document request");
	}
}

export interface CreateDocumentRequestsInBulkInput {
	/** Employees named one by one. */
	employeeIds: string[];
	/** Teams whose current members (primary team or membership) are included. */
	teamIds: string[];
	category: DocumentRequestCategory;
	title: string;
	note?: string | null;
	/** `YYYY-MM-DD` */
	deadline: string;
}

/** Notifications sent at once while a bulk create notifies its employees. */
const BULK_NOTIFY_CONCURRENCY = 10;

/**
 * Creates the same request for several employees and teams at once (#1407)
 * and notifies each employee as for a single request. The store re-checks
 * coverage for every employee; whom it skips comes back as counts. Bulk
 * requests never name a renewed document (`renewal_not_in_bulk`).
 */
export async function createDocumentRequestsInBulkAction(
	input: CreateDocumentRequestsInBulkInput,
): Promise<ServerActionResult<DocumentRequestBulkSummary>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !input || typeof input !== "object") {
			return { success: false, error: NOT_FOUND };
		}
		if ("renewedDocumentId" in input) return refused("renewal_not_in_bulk");
		const employeeIds = Array.isArray(input.employeeIds) ? input.employeeIds : null;
		const teamIds = Array.isArray(input.teamIds) ? input.teamIds : null;
		if (
			!employeeIds ||
			!teamIds ||
			!employeeIds.every(isCanonicalUuid) ||
			!teamIds.every(isCanonicalUuid)
		) {
			return { success: false, error: NOT_FOUND };
		}
		const result = await createDocumentRequestsInBulk(db, current.access, {
			employeeIds,
			teamIds,
			category: input.category,
			title: input.title,
			note: input.note ?? null,
			deadline: input.deadline,
		});
		if (result.kind !== "created") return unsuccessful(result);
		const { organizationId } = current.access;
		for (let start = 0; start < result.created.length; start += BULK_NOTIFY_CONCURRENCY) {
			await Promise.all(
				result.created
					.slice(start, start + BULK_NOTIFY_CONCURRENCY)
					.map(({ request, eventId }) =>
						notifyDocumentRequested(db, { organizationId, eventId, request }),
					),
			);
		}
		const skipped = Object.values(result.skippedBy).reduce((sum, count) => sum + count, 0);
		return {
			success: true,
			data: { created: result.created.length, skipped, skippedBy: result.skippedBy },
		};
	} catch (error) {
		return failure(error, "Failed to create the document requests");
	}
}

/** Cancels an open or submitted request with a reason and notifies the employee. */
export async function cancelDocumentRequestAction(input: {
	requestId: string;
	reason: string;
	/** The `version` the officer saw; a changed request, or none, conflicts. */
	expectedVersion: number;
}): Promise<ServerActionResult<DocumentRequestView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.requestId)) {
			return { success: false, error: NOT_FOUND };
		}
		const result = await cancelDocumentRequest(db, current.access, {
			requestId: input.requestId,
			reason: input.reason,
			expectedVersion: safeVersion(input.expectedVersion),
		});
		if (result.kind !== "cancelled") return unsuccessful(result);
		await notifyDocumentRequestDecided(db, {
			organizationId: current.access.organizationId,
			eventId: result.eventId,
			request: result.request,
			decision: "cancelled",
			reason: result.reason,
		});
		return { success: true, data: result.request };
	} catch (error) {
		return failure(error, "Failed to cancel the document request");
	}
}

/**
 * The employee submits what they uploaded from their open request since the
 * last submission, with an optional note (#1402); the covering officers are
 * notified. Nobody else submits.
 */
export async function submitDocumentRequestAction(input: {
	requestId: string;
	note?: string | null;
	/** The `version` the employee saw; a changed request, or none, conflicts. */
	expectedVersion: number;
}): Promise<ServerActionResult<DocumentRequestView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.requestId)) {
			return { success: false, error: NOT_FOUND };
		}
		const result = await submitDocumentRequest(db, current.access, {
			requestId: input.requestId,
			note: input.note ?? null,
			expectedVersion: safeVersion(input.expectedVersion),
		});
		if (result.kind !== "submitted") return unsuccessful(result);
		await notifyDocumentRequestSubmitted(db, {
			organizationId: current.access.organizationId,
			eventId: result.eventId,
			request: result.request,
		});
		return { success: true, data: result.request };
	} catch (error) {
		return failure(error, "Failed to submit the documents");
	}
}

/**
 * Returns a submitted request to the employee with a required reason
 * (#1402): open again, documents kept; the employee is notified.
 */
export async function returnDocumentRequestAction(input: {
	requestId: string;
	reason: string;
	/** The `version` the officer saw; a changed request, or none, conflicts. */
	expectedVersion: number;
}): Promise<ServerActionResult<DocumentRequestView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.requestId)) {
			return { success: false, error: NOT_FOUND };
		}
		const result = await returnDocumentRequest(db, current.access, {
			requestId: input.requestId,
			reason: input.reason,
			expectedVersion: safeVersion(input.expectedVersion),
		});
		if (result.kind !== "returned") return unsuccessful(result);
		await notifyDocumentRequestDecided(db, {
			organizationId: current.access.organizationId,
			eventId: result.eventId,
			request: result.request,
			decision: "returned",
			reason: result.reason,
		});
		return { success: true, data: result.request };
	} catch (error) {
		return failure(error, "Failed to return the document request");
	}
}

/** Accepts a submitted request (#1402) and notifies the employee. */
export async function acceptDocumentRequestAction(input: {
	requestId: string;
	/** The `version` the officer saw; a changed request, or none, conflicts. */
	expectedVersion: number;
}): Promise<ServerActionResult<DocumentRequestView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.requestId)) {
			return { success: false, error: NOT_FOUND };
		}
		const result = await acceptDocumentRequest(db, current.access, {
			requestId: input.requestId,
			expectedVersion: safeVersion(input.expectedVersion),
		});
		if (result.kind !== "accepted") return unsuccessful(result);
		await notifyDocumentRequestDecided(db, {
			organizationId: current.access.organizationId,
			eventId: result.eventId,
			request: result.request,
			decision: "accepted",
			reason: null,
		});
		return { success: true, data: result.request };
	} catch (error) {
		return failure(error, "Failed to accept the document request");
	}
}

export interface EditDocumentRequestInput {
	requestId: string;
	/** The new deadline (`YYYY-MM-DD`); left out, it stays. */
	deadline?: string;
	/** The new note; empty clears it; left out, it stays. */
	note?: string | null;
	/** The `version` the officer saw; a changed request, or none, conflicts. */
	expectedVersion: number;
}

const EDITABLE_FIELDS: ReadonlySet<string> = new Set<keyof EditDocumentRequestInput>([
	"requestId",
	"deadline",
	"note",
	"expectedVersion",
]);

/**
 * Changes the deadline and note of an open or submitted request (#1403).
 * Anything else (employee, category, title, renewed document, status) is
 * refused with `not_editable`: cancel and create a new request instead.
 */
export async function editDocumentRequestAction(
	input: EditDocumentRequestInput,
): Promise<ServerActionResult<DocumentRequestView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.requestId)) {
			return { success: false, error: NOT_FOUND };
		}
		if (Object.keys(input).some((field) => !EDITABLE_FIELDS.has(field))) {
			return refused("not_editable");
		}
		const result = await editDocumentRequest(db, current.access, {
			requestId: input.requestId,
			deadline: input.deadline,
			note: input.note,
			expectedVersion: safeVersion(input.expectedVersion),
		});
		if (result.kind !== "edited") return unsuccessful(result);
		return { success: true, data: result.request };
	} catch (error) {
		return failure(error, "Failed to change the document request");
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
