import { type AnyColumn, and, eq, inArray, type SQL, sql } from "drizzle-orm";
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

/**
 * An open or submitted request of the organization renews a certificate that
 * names the employee skill (correlated on `employee_skill` rows): the skill
 * expiry job then leaves the employee out of its reminders and tells only the
 * managers (or owners and admins), like the certificate's own expiry
 * reminders (user decision 2026-10-19).
 */
export function employeeSkillHasActiveRenewalRequest(
	organizationId: string,
	employeeSkillId: AnyColumn,
): SQL<boolean> {
	return sql<boolean>`exists (select 1 from ${employeeDocumentRequest} inner join ${employeeDocument} on ${and(
		eq(employeeDocument.id, employeeDocumentRequest.renewedDocumentId),
		eq(employeeDocument.organizationId, employeeDocumentRequest.organizationId),
	)} where ${and(
		eq(employeeDocumentRequest.organizationId, organizationId),
		inArray(employeeDocumentRequest.status, [...ACTIVE_DOCUMENT_REQUEST_STATUSES]),
		eq(employeeDocument.employeeSkillId, employeeSkillId),
	)})`;
}
