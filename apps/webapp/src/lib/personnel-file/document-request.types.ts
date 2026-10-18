/**
 * Dependency-free vocabulary of document requests (#1307, CONTEXT.md
 * "Document request", "Deadline", "Submission", "Renewed document"; ADR 0003).
 * The schema, server code and client components all import it.
 */

/**
 * The categories a document request may ask for: a subset of the document
 * categories. This module imports nothing (the schema reaches it), so the
 * subset is checked where the access code passes these to `DocumentCategory`.
 */
export const DOCUMENT_REQUEST_CATEGORIES = ["certificate", "other"] as const;
export type DocumentRequestCategory = (typeof DOCUMENT_REQUEST_CATEGORIES)[number];

export function isDocumentRequestCategory(value: unknown): value is DocumentRequestCategory {
	return (
		typeof value === "string" && (DOCUMENT_REQUEST_CATEGORIES as readonly string[]).includes(value)
	);
}

/**
 * `open` until the employee submits, `submitted` until an officer accepts it or
 * returns it (back to `open`); `cancelled` from open or submitted. Overdue is
 * derived (`isDocumentRequestOverdue`), never stored.
 */
export const DOCUMENT_REQUEST_STATUSES = ["open", "submitted", "accepted", "cancelled"] as const;
export type DocumentRequestStatus = (typeof DOCUMENT_REQUEST_STATUSES)[number];

/** Open and submitted requests: the ones still waiting for the employee or an officer. */
export const ACTIVE_DOCUMENT_REQUEST_STATUSES = [
	"open",
	"submitted",
] as const satisfies readonly DocumentRequestStatus[];

export function isActiveDocumentRequestStatus(status: DocumentRequestStatus): boolean {
	return (ACTIVE_DOCUMENT_REQUEST_STATUSES as readonly string[]).includes(status);
}

/** What the request history records: every transition and edit, with actor and time. */
export const DOCUMENT_REQUEST_EVENT_KINDS = [
	"created",
	"edited",
	"submitted",
	"returned",
	"accepted",
	"cancelled",
] as const;
export type DocumentRequestEventKind = (typeof DOCUMENT_REQUEST_EVENT_KINDS)[number];

/** The events that follow creation; each is applied with `applyDocumentRequestEvent`. */
export type DocumentRequestFollowUpEventKind = Exclude<DocumentRequestEventKind, "created">;

/** System reasons, shown translated instead of a typed reason (#1408: departure). */
export const DOCUMENT_REQUEST_REASON_CODES = ["employment_ended"] as const;
export type DocumentRequestReasonCode = (typeof DOCUMENT_REQUEST_REASON_CODES)[number];

export const DOCUMENT_REQUEST_TITLE_MAX_LENGTH = 200;
/** Notes, reasons and submission notes. */
export const DOCUMENT_REQUEST_TEXT_MAX_LENGTH = 2000;

/** Why a document request write was refused (an action's `code`). */
export type DocumentRequestRefusal =
	/** Payslip, contract and sick note cannot be requested. */
	| "category_not_requestable"
	| "invalid_title"
	| "invalid_note"
	| "invalid_deadline"
	/** The deadline is before today in the organization's timezone. */
	| "deadline_in_past"
	/** A reason is required (cancel, return). */
	| "reason_required"
	| "invalid_reason"
	/** Nobody creates, edits or decides a request on their own personnel file. */
	| "own_file"
	/** The employee's employment ended. */
	| "former_employee"
	/** The renewed document is not a document of the same employee and category. */
	| "renewed_document_mismatch"
	/** Another open or submitted request already names the renewed document. */
	| "renewal_already_requested"
	/** A submission needs at least one document uploaded from the request since the last one. */
	| "no_documents";

/** One entry of a request's history. */
export interface DocumentRequestEventView {
	id: string;
	kind: DocumentRequestEventKind;
	/** ISO instant. */
	occurredAt: string;
	actorName: string | null;
	/** The typed reason of a return or cancel (a document description). */
	reason: string | null;
	reasonCode: DocumentRequestReasonCode | null;
	/** The submission a `submitted` event handed in. */
	submissionId: string | null;
	/** An edit's changes: the deadline's old and new day, and whether the note changed. */
	changes: DocumentRequestEventChanges | null;
}

export interface DocumentRequestEventChanges {
	deadline?: { from: string; to: string };
	noteChanged?: true;
}

/** A document of a submission, as the viewer may see it. */
export interface DocumentRequestDocumentView {
	id: string;
	title: string;
	fileName: string;
	mimeType: string;
}

/** The employee documents an employee handed in together for a request. */
export interface DocumentRequestSubmissionView {
	id: string;
	/** ISO instant. */
	submittedAt: string;
	note: string | null;
	/** Only the documents the viewer may see (an employee: only shared ones). */
	documents: DocumentRequestDocumentView[];
}

export interface DocumentRequestView {
	id: string;
	employeeId: string;
	category: DocumentRequestCategory;
	title: string;
	note: string | null;
	/** The plain calendar day (`YYYY-MM-DD`). */
	deadline: string;
	status: DocumentRequestStatus;
	/** Open and past its deadline in the organization's timezone. */
	overdue: boolean;
	/** Bumped by every event; pass it back as `expectedVersion` so a stale view conflicts. */
	version: number;
	/**
	 * The document the request replaces, when the viewer may see it. An
	 * employee never sees an HR-only renewed document: then it is null.
	 */
	renewedDocument: { id: string; title: string } | null;
	createdByName: string | null;
	/** ISO instant. */
	createdAt: string;
	/** Oldest first. */
	history: DocumentRequestEventView[];
	/** Oldest first. */
	submissions: DocumentRequestSubmissionView[];
	/**
	 * Documents uploaded from the request and not handed in yet (#1402): the
	 * next submission. They are in the file already (ADR 0003). Oldest first.
	 */
	pendingDocuments: DocumentRequestDocumentView[];
}
