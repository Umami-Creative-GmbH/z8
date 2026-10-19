import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employeeDocumentRequest, employeeDocumentRequestDocument } from "@/db/schema";
import { isOwnDocument, type PersonnelFileAccess } from "./access";
import type { DocumentCategory } from "./document.types";

/**
 * Uploads from a document request (#1402, ADR 0003). The upload's finalize
 * transaction locks the request, checks that it is the uploader's own open
 * request of the document's category, and links the new employee document to
 * it. The link has no submission until the employee submits, so a submission
 * contains only documents uploaded from that request since the last one.
 *
 * Kept apart from the request store, which reads `document-store`, so the
 * document store can call it without an import cycle.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Locks the request an upload is for: `locked` when it is the actor's own open
 * request for the upload's employee and category; `category_mismatch` when it
 * is, but asks for another category; `unavailable` otherwise (not theirs, not
 * there, or no longer open).
 */
export async function lockDocumentRequestForUpload(
	tx: Transaction,
	access: PersonnelFileAccess,
	input: { requestId: string; employeeId: string; category: DocumentCategory },
): Promise<
	{ kind: "locked"; id: string } | { kind: "unavailable" } | { kind: "category_mismatch" }
> {
	const [request] = await tx
		.select({
			id: employeeDocumentRequest.id,
			employeeId: employeeDocumentRequest.employeeId,
			category: employeeDocumentRequest.category,
			status: employeeDocumentRequest.status,
		})
		.from(employeeDocumentRequest)
		.where(
			and(
				eq(employeeDocumentRequest.id, input.requestId),
				eq(employeeDocumentRequest.organizationId, access.organizationId),
			),
		)
		.for("update");
	if (
		!request ||
		request.employeeId !== input.employeeId ||
		!isOwnDocument(access, request.employeeId) ||
		request.status !== "open"
	) {
		return { kind: "unavailable" };
	}
	if (request.category !== input.category) return { kind: "category_mismatch" };
	return { kind: "locked", id: request.id };
}

/** Links a document uploaded from a request to it, not handed in yet. */
export async function linkDocumentRequestUpload(
	tx: Pick<Transaction, "insert">,
	input: { organizationId: string; requestId: string; documentId: string; at: Date },
): Promise<void> {
	await tx.insert(employeeDocumentRequestDocument).values({
		documentId: input.documentId,
		organizationId: input.organizationId,
		requestId: input.requestId,
		submissionId: null,
		createdAt: input.at,
	});
}
