import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	auditLog,
	employeeDocumentRequest,
	employeeDocumentRequestDocument,
	employeeDocumentRequestEvent,
	employeeDocumentRequestSubmission,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { UnprocessableAuditRecord } from "./audit";
import { minimiseDocumentRequestAudit } from "./audit-minimisation";
import { DOCUMENT_REQUEST_ENTITY_TYPE } from "./document-request.types";

/**
 * Document requests at purge time (#1408, spec #1307). A request's note, its
 * return and cancel reasons and its submission notes are document
 * descriptions: purging any document of a request removes that free text from
 * the request, its history, its submissions and its audit records, as a purge
 * does for the document's own descriptions (#923). A request whose documents
 * are all gone after a purge is deleted with it. Only the officer-confirmed
 * purge calls this; a plain document deletion keeps the request as it is.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ReadWriteTransaction = Pick<Transaction, "select" | "update" | "delete" | "insert">;


/**
 * The request of each given document of the organization that was uploaded
 * from one. Read before the documents are deleted: their links go with them.
 */
export async function documentRequestsOfDocuments(
	tx: Pick<Transaction, "select">,
	input: { organizationId: string; documentIds: readonly string[] },
): Promise<Map<string, string>> {
	if (input.documentIds.length === 0) return new Map();
	const rows = await tx
		.select({
			documentId: employeeDocumentRequestDocument.documentId,
			requestId: employeeDocumentRequestDocument.requestId,
		})
		.from(employeeDocumentRequestDocument)
		.where(
			and(
				eq(employeeDocumentRequestDocument.organizationId, input.organizationId),
				inArray(employeeDocumentRequestDocument.documentId, [...input.documentIds]),
			),
		);
	return new Map(rows.map((row) => [row.documentId, row.requestId]));
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
	/** Requests whose free text was removed (each request of a purged document). */
	minimised: string[];
	/** Requests deleted because none of their documents is left. */
	deleted: string[];
	/** Audit records of those requests that could not be minimised. */
	unprocessable: UnprocessableAuditRecord[];
}

/**
 * The request side of a confirmed purge, in its transaction and after the
 * documents were deleted: `requestIds` are the requests of the purged
 * documents (`documentRequestsOfDocuments`, read before the deletion). Their
 * free text goes; a request with no document left is deleted, recorded under
 * the purging officer.
 */
export async function purgeDocumentRequestsOfDocuments(
	tx: ReadWriteTransaction,
	input: { organizationId: string; requestIds: readonly string[]; actorUserId: string; at: Date },
): Promise<PurgedDocumentRequests> {
	const requestIds = [...new Set(input.requestIds)].toSorted();
	const result: PurgedDocumentRequests = { minimised: [], deleted: [], unprocessable: [] };
	if (requestIds.length === 0) return result;
	const { organizationId } = input;
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
	const lockedIds = requests.map((request) => request.id);
	await clearDocumentRequestFreeText(tx, { organizationId, requestIds: lockedIds });
	result.unprocessable = await minimiseDocumentRequestAudits(tx, {
		organizationId,
		requestIds: lockedIds,
	});
	result.minimised = lockedIds;

	const remaining = await tx
		.select({ requestId: employeeDocumentRequestDocument.requestId })
		.from(employeeDocumentRequestDocument)
		.where(
			and(
				eq(employeeDocumentRequestDocument.organizationId, organizationId),
				inArray(employeeDocumentRequestDocument.requestId, lockedIds),
			),
		);
	const withDocuments = new Set(remaining.map((row) => row.requestId));
	// One deletion and record per request, under the locks taken above.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const request of requests) {
		if (withDocuments.has(request.id)) continue;
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
