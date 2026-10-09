import { randomUUID } from "node:crypto";
import type { db as appDb } from "@/db";
import { auditLog } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";

/**
 * Audit records of the personnel file (#865). Writes are recorded in the
 * transaction that makes them; views and downloads by anyone but the employee
 * are recorded before the file is served. Records keep the document's
 * category, title and dates in metadata, so they still explain themselves
 * after the document was deleted or purged.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Writer = Database | Pick<Transaction, "insert">;

export const PERSONNEL_FILE_AUDIT_ENTITY_TYPE = "employee_document";

export type PersonnelFileAuditAction =
	| AuditAction.PERSONNEL_FILE_DOCUMENT_UPLOADED
	| AuditAction.PERSONNEL_FILE_DOCUMENT_UPDATED
	| AuditAction.PERSONNEL_FILE_VISIBILITY_CHANGED
	| AuditAction.PERSONNEL_FILE_DOCUMENT_DELETED
	| AuditAction.PERSONNEL_FILE_DOCUMENT_VIEWED
	| AuditAction.PERSONNEL_FILE_DOCUMENT_DOWNLOADED;

export interface AuditedDocument {
	id: string;
	organizationId: string;
	employeeId: string;
	category: string;
	title: string;
	documentDate: string;
	payPeriodYear: number | null;
	payPeriodMonth: number | null;
	visibility: string;
	expiryDate: string | null;
}

export function documentAuditSnapshot(document: AuditedDocument): Record<string, unknown> {
	return {
		category: document.category,
		title: document.title,
		documentDate: document.documentDate,
		payPeriod:
			document.payPeriodYear !== null && document.payPeriodMonth !== null
				? { year: document.payPeriodYear, month: document.payPeriodMonth }
				: null,
		visibility: document.visibility,
		expiryDate: document.expiryDate,
	};
}

/** Writes one audit record and returns its id (a stable key for follow-up work). */
export async function writeDocumentAudit(
	database: Writer,
	input: {
		action: PersonnelFileAuditAction;
		actorUserId: string;
		document: AuditedDocument;
		changes?: Record<string, unknown> | null;
		metadata?: Record<string, unknown> | null;
		ipAddress?: string | null;
		userAgent?: string | null;
	},
): Promise<string> {
	const id = randomUUID();
	await database.insert(auditLog).values({
		id,
		organizationId: input.document.organizationId,
		entityType: PERSONNEL_FILE_AUDIT_ENTITY_TYPE,
		entityId: input.document.id,
		action: input.action,
		performedBy: input.actorUserId,
		employeeId: input.document.employeeId,
		changes: input.changes ? JSON.stringify(input.changes) : null,
		metadata: JSON.stringify({
			document: documentAuditSnapshot(input.document),
			...input.metadata,
		}),
		ipAddress: input.ipAddress ?? null,
		userAgent: input.userAgent ?? null,
	});
	return id;
}

export const PAYSLIP_BATCH_AUDIT_ENTITY_TYPE = "payslip_batch";

/** The one summary record of a payslip batch confirmation (#868), next to each document's upload record. */
export async function writePayslipBatchAudit(
	database: Writer,
	input: {
		organizationId: string;
		batchId: string;
		actorUserId: string;
		metadata: Record<string, unknown>;
	},
): Promise<string> {
	const id = randomUUID();
	await database.insert(auditLog).values({
		id,
		organizationId: input.organizationId,
		entityType: PAYSLIP_BATCH_AUDIT_ENTITY_TYPE,
		entityId: input.batchId,
		action: AuditAction.PERSONNEL_FILE_PAYSLIP_BATCH_CONFIRMED,
		performedBy: input.actorUserId,
		employeeId: null,
		changes: null,
		metadata: JSON.stringify(input.metadata),
	});
	return id;
}
