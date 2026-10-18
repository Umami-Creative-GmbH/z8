import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { employeeDocument, employeeDocumentRequest } from "@/db/schema";
import {
	ACTIVE_DOCUMENT_REQUEST_STATUSES,
	type DocumentRequestStatus,
} from "./document-request.types";

/**
 * Renewed documents (#1404, glossary "Renewed document"): SQL conditions on
 * `employee_document` rows, for the two "expiring" readers only (the
 * Expiring documents list and the expiry reminder job). The skill expiry date
 * still reads every linked certificate.
 */

function namedByRequest(statuses: readonly DocumentRequestStatus[]): SQL {
	return sql`exists (select 1 from ${employeeDocumentRequest} where ${and(
		eq(employeeDocumentRequest.organizationId, employeeDocument.organizationId),
		eq(employeeDocumentRequest.renewedDocumentId, employeeDocument.id),
		inArray(employeeDocumentRequest.status, [...statuses]),
	)})`;
}

/** An accepted request names the document: it is renewed and no longer expiring. */
export function isRenewedDocument(): SQL {
	return namedByRequest(["accepted"]);
}

/**
 * An open or submitted request names the document: its renewal is requested,
 * so its expiry reminders go to the officers only (and the Expiring documents
 * card offers no second request).
 */
export function hasActiveRenewalRequest(): SQL<boolean> {
	return namedByRequest(ACTIVE_DOCUMENT_REQUEST_STATUSES) as SQL<boolean>;
}
