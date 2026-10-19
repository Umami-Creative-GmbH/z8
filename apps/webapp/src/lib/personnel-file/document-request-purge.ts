import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	auditLog,
	employeeDocumentRequest,
	employeeDocumentRequestDocument,
	employeeDocumentRequestEvent,
	employeeDocumentRequestSubmission,
	notification,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { UnprocessableAuditRecord } from "./audit";
import { minimiseDocumentRequestAudit } from "./audit-minimisation";
import {
	DOCUMENT_REQUEST_ENTITY_TYPE,
	isActiveDocumentRequestStatus,
} from "./document-request.types";
import { redactDocumentRequestNotification } from "./document-request-notifications";

/**
 * Document requests at purge time (#1408, spec #1307). A request's note, its
 * return and cancel reasons and its submission notes are document
 * descriptions: purging any document of a request removes that free text from
 * the request, its history, its submissions, its audit records and its stored
 * notifications, as a purge does for the document's own descriptions (#923).
 * A closed request whose documents are all gone after a purge is deleted with
 * them, except an accepted renewal whose renewed document is still there (that
 * request is what keeps the document renewed); it goes with the renewed
 * document. An open or submitted request is never deleted here. Only the
 * officer-confirmed purge calls this; a plain document deletion keeps the
 * request as it is.
 *
 * Lock order: the requests first, then the documents (as accepting a request
 * does), so a purge and an accept wait for each other instead of deadlocking.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ReadWriteTransaction = Pick<Transaction, "select" | "update" | "delete" | "insert">;

export interface DocumentRequestsOfDocuments {
	/** The request each document was uploaded from. */
	uploadedFrom: Map<string, string>;
	/** The requests naming each document as their renewed document. */
	renewedBy: Map<string, string[]>;
}

/**
 * The requests the given documents of the organization were uploaded from or
 * are renewed by, each locked for the rest of the transaction (in id order).
 * Call it before locking and deleting the documents: their upload links go
 * with them, and their renewal links are cleared.
 */
export async function lockDocumentRequestsOfDocuments(
	tx: Pick<Transaction, "select">,
	input: { organizationId: string; documentIds: readonly string[] },
): Promise<DocumentRequestsOfDocuments> {
	const result: DocumentRequestsOfDocuments = { uploadedFrom: new Map(), renewedBy: new Map() };
	if (input.documentIds.length === 0) return result;
	const documentIds = [...input.documentIds];
	const [uploads, renewals] = await Promise.all([
		tx
			.select({
				documentId: employeeDocumentRequestDocument.documentId,
				requestId: employeeDocumentRequestDocument.requestId,
			})
			.from(employeeDocumentRequestDocument)
			.where(
				and(
					eq(employeeDocumentRequestDocument.organizationId, input.organizationId),
					inArray(employeeDocumentRequestDocument.documentId, documentIds),
				),
			),
		tx
			.select({
				documentId: employeeDocumentRequest.renewedDocumentId,
				requestId: employeeDocumentRequest.id,
			})
			.from(employeeDocumentRequest)
			.where(
				and(
					eq(employeeDocumentRequest.organizationId, input.organizationId),
					inArray(employeeDocumentRequest.renewedDocumentId, documentIds),
				),
			),
	]);
	for (const row of uploads) result.uploadedFrom.set(row.documentId, row.requestId);
	for (const row of renewals) {
		if (!row.documentId) continue;
		result.renewedBy.set(row.documentId, [
			...(result.renewedBy.get(row.documentId) ?? []),
			row.requestId,
		]);
	}
	const requestIds = [
		...new Set([...result.uploadedFrom.values(), ...[...result.renewedBy.values()].flat()]),
	];
	if (requestIds.length > 0) {
		await tx
			.select({ id: employeeDocumentRequest.id })
			.from(employeeDocumentRequest)
			.where(
				and(
					eq(employeeDocumentRequest.organizationId, input.organizationId),
					inArray(employeeDocumentRequest.id, requestIds),
				),
			)
			.orderBy(asc(employeeDocumentRequest.id))
			.for("update");
	}
	return result;
}

/**
 * Removes the free text of the given requests from their audit records, in
 * the caller's transaction. Records that cannot be read are reported, not
 * changed (the caller then refuses the purge or the deletion).
 */
export async function minimiseDocumentRequestAudits(
	tx: Pick<Transaction, "select" | "update">,
	input: { organizationId: string; requestIds: readonly string[] },
): Promise<UnprocessableAuditRecord[]> {
	if (input.requestIds.length === 0) return [];
	const records = await tx
		.select({
			id: auditLog.id,
			entityId: auditLog.entityId,
			changes: auditLog.changes,
			metadata: auditLog.metadata,
		})
		.from(auditLog)
		.where(
			and(
				eq(auditLog.organizationId, input.organizationId),
				eq(auditLog.entityType, DOCUMENT_REQUEST_ENTITY_TYPE),
				inArray(auditLog.entityId, [...input.requestIds]),
			),
		)
		.orderBy(asc(auditLog.id))
		.for("update");
	const unprocessable: UnprocessableAuditRecord[] = [];
	// Each record is rewritten on its own, under the locks taken above.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const record of records) {
		const minimised = minimiseDocumentRequestAudit(record);
		if (minimised.kind === "unchanged") continue;
		if (minimised.kind === "unprocessable") {
			unprocessable.push({
				auditId: record.id,
				entityType: DOCUMENT_REQUEST_ENTITY_TYPE,
				entityId: record.entityId,
				reason: minimised.reason,
			});
			continue;
		}
		await tx
			.update(auditLog)
			.set({ changes: minimised.changes, metadata: minimised.metadata })
			.where(and(eq(auditLog.id, record.id), eq(auditLog.organizationId, input.organizationId)));
	}
	return unprocessable;
}

/**
 * Removes the typed cancel and return reasons of the given requests from
 * their stored notifications (message and translation params), in the
 * caller's transaction and the organization only (user decision 2026-10-19).
 * Copies already sent by email or push are beyond reach.
 */
export async function redactDocumentRequestNotifications(
	tx: Pick<Transaction, "select" | "update">,
	input: { organizationId: string; requestIds: readonly string[] },
): Promise<void> {
	if (input.requestIds.length === 0) return;
	const rows = await tx
		.select({
			id: notification.id,
			title: notification.title,
			message: notification.message,
			metadata: notification.metadata,
		})
		.from(notification)
		.where(
			and(
				eq(notification.organizationId, input.organizationId),
				eq(notification.entityType, DOCUMENT_REQUEST_ENTITY_TYPE),
				inArray(notification.entityId, [...input.requestIds]),
				eq(notification.type, "personnel_file_document_request_decided"),
			),
		)
		.orderBy(asc(notification.id));
	// One row at a time; a request has a handful of decision notifications.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const row of rows) {
		const redacted = redactDocumentRequestNotification(row);
		if (redacted.kind === "unchanged") continue;
		await tx
			.update(notification)
			.set({ message: redacted.message, metadata: redacted.metadata })
			.where(
				and(eq(notification.id, row.id), eq(notification.organizationId, input.organizationId)),
			);
	}
}

/** Clears the note, the event reasons and the submission notes of the given (locked) requests. */
async function clearDocumentRequestFreeText(
	tx: Pick<Transaction, "update">,
	input: { organizationId: string; requestIds: readonly string[] },
): Promise<void> {
	const requestIds = [...input.requestIds];
	await tx
		.update(employeeDocumentRequest)
		// Not an event: the request's version and last change stay.
		.set({ note: null, updatedAt: sql`${employeeDocumentRequest.updatedAt}` })
		.where(
			and(
				eq(employeeDocumentRequest.organizationId, input.organizationId),
				inArray(employeeDocumentRequest.id, requestIds),
			),
		);
	await tx
		.update(employeeDocumentRequestEvent)
		.set({ reason: null })
		.where(
			and(
				eq(employeeDocumentRequestEvent.organizationId, input.organizationId),
				inArray(employeeDocumentRequestEvent.requestId, requestIds),
			),
		);
	await tx
		.update(employeeDocumentRequestSubmission)
		.set({ note: null })
		.where(
			and(
				eq(employeeDocumentRequestSubmission.organizationId, input.organizationId),
				inArray(employeeDocumentRequestSubmission.requestId, requestIds),
			),
		);
}

/**
 * Deletes one request with its history, submissions, document links and
 * reminder markers (all cascade). Its audit records stay.
 */
export async function deleteDocumentRequestRow(
	tx: Pick<Transaction, "delete">,
	input: { organizationId: string; requestId: string },
): Promise<boolean> {
	const deleted = await tx
		.delete(employeeDocumentRequest)
		.where(
			and(
				eq(employeeDocumentRequest.organizationId, input.organizationId),
				eq(employeeDocumentRequest.id, input.requestId),
			),
		)
		.returning({ id: employeeDocumentRequest.id });
	return deleted.length > 0;
}

export interface PurgedDocumentRequests {
	/** Requests whose free text was removed (each request a purged document was uploaded from). */
	minimised: string[];
	/** Requests deleted because none of their documents is left. */
	deleted: string[];
	/** Audit records of those requests that could not be minimised. */
	unprocessable: UnprocessableAuditRecord[];
}

/**
 * The request side of a confirmed purge, in its transaction and after the
 * documents were deleted. `requestIds` are the requests the purged documents
 * were uploaded from, `renewalRequestIds` those renewing a purged document
 * (`lockDocumentRequestsOfDocuments`, called before). The first lose their
 * free text. A closed request with no document left is deleted, recorded
 * under the purging officer, unless it is an accepted renewal whose renewed
 * document is still there; an accepted renewal reached only through its
 * purged renewed document goes once none of its documents is left either.
 * Open and submitted requests stay (a legacy inactive employee whose requests
 * no departure cancelled): an officer cancels them.
 */
export async function purgeDocumentRequestsOfDocuments(
	tx: ReadWriteTransaction,
	input: {
		organizationId: string;
		requestIds: readonly string[];
		renewalRequestIds?: readonly string[];
		actorUserId: string;
		at: Date;
	},
): Promise<PurgedDocumentRequests> {
	const uploadedFrom = new Set(input.requestIds);
	const requestIds = [...new Set([...uploadedFrom, ...(input.renewalRequestIds ?? [])])].toSorted();
	const result: PurgedDocumentRequests = { minimised: [], deleted: [], unprocessable: [] };
	if (requestIds.length === 0) return result;
	const { organizationId } = input;
	// Locked before the documents; read again now that a purged renewed document's link is cleared.
	const requests = await tx
		.select()
		.from(employeeDocumentRequest)
		.where(
			and(
				eq(employeeDocumentRequest.organizationId, organizationId),
				inArray(employeeDocumentRequest.id, requestIds),
			),
		)
		.orderBy(asc(employeeDocumentRequest.id))
		.for("update");
	if (requests.length === 0) return result;
	const stripped = requests.filter((request) => uploadedFrom.has(request.id)).map((r) => r.id);
	if (stripped.length > 0) {
		await clearDocumentRequestFreeText(tx, { organizationId, requestIds: stripped });
		result.unprocessable.push(
			...(await minimiseDocumentRequestAudits(tx, { organizationId, requestIds: stripped })),
		);
		await redactDocumentRequestNotifications(tx, { organizationId, requestIds: stripped });
		result.minimised = stripped;
	}

	const remaining = await tx
		.select({ requestId: employeeDocumentRequestDocument.requestId })
		.from(employeeDocumentRequestDocument)
		.where(
			and(
				eq(employeeDocumentRequestDocument.organizationId, organizationId),
				inArray(
					employeeDocumentRequestDocument.requestId,
					requests.map((request) => request.id),
				),
			),
		);
	const withDocuments = new Set(remaining.map((row) => row.requestId));
	const deletable = requests.filter(
		(request) =>
			!withDocuments.has(request.id) &&
			!isActiveDocumentRequestStatus(request.status) &&
			// An accepted renewal keeps its renewed document renewed while that document exists.
			!(request.status === "accepted" && request.renewedDocumentId !== null) &&
			// Reached only as a renewal: it goes with its renewed document once accepted.
			(uploadedFrom.has(request.id) || request.status === "accepted"),
	);
	const notStripped = deletable.map((request) => request.id).filter((id) => !uploadedFrom.has(id));
	if (notStripped.length > 0) {
		result.unprocessable.push(
			...(await minimiseDocumentRequestAudits(tx, { organizationId, requestIds: notStripped })),
		);
		await redactDocumentRequestNotifications(tx, { organizationId, requestIds: notStripped });
	}
	// One deletion and record per request, under the locks taken above.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const request of deletable) {
		if (!(await deleteDocumentRequestRow(tx, { organizationId, requestId: request.id }))) continue;
		await tx.insert(auditLog).values({
			organizationId,
			entityType: DOCUMENT_REQUEST_ENTITY_TYPE,
			entityId: request.id,
			action: AuditAction.PERSONNEL_FILE_DOCUMENT_REQUEST_DELETED,
			performedBy: input.actorUserId,
			employeeId: request.employeeId,
			// Like the purge record of a document: structured facts, no title or free text.
			metadata: JSON.stringify({
				request: {
					category: request.category,
					deadline: request.deadline,
					status: request.status,
					renewedDocumentId: request.renewedDocumentId,
				},
				deletion: "documents_purged",
			}),
			timestamp: input.at,
		});
		result.deleted.push(request.id);
	}
	return result;
}
