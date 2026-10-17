import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { auditLog, employeeDocument } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import {
	type AuditMinimisation,
	documentAuditWithoutDescriptions,
	minimiseDocumentAudit,
	minimiseZipAudit,
} from "./audit-minimisation";

/**
 * Audit records of the personnel file (#865). Writes are recorded in the
 * transaction that makes them; views and downloads by anyone but the employee
 * are recorded before the file is served. Records keep the document's
 * category, title and dates in metadata, so they still explain themselves
 * after the document was deleted. A confirmed purge removes the document's
 * descriptions (title, file name, ZIP entry name, reason) from every record
 * about it (#923, `audit-minimisation.ts`), and records written after the
 * purge never bring them back.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Writer = Database | Pick<Transaction, "insert">;
type Locker = Pick<Transaction, "select" | "update">;

export const PERSONNEL_FILE_AUDIT_ENTITY_TYPE = "employee_document";
/** ZIP downloads of a personnel file (#871): one record per download, about the employee. */
export const PERSONNEL_FILE_ZIP_AUDIT_ENTITY_TYPE = "employee_personnel_file";

export type PersonnelFileAuditAction =
	| AuditAction.PERSONNEL_FILE_DOCUMENT_UPLOADED
	| AuditAction.PERSONNEL_FILE_DOCUMENT_UPDATED
	| AuditAction.PERSONNEL_FILE_VISIBILITY_CHANGED
	| AuditAction.PERSONNEL_FILE_DOCUMENT_DELETED
	| AuditAction.PERSONNEL_FILE_DOCUMENT_VIEWED
	| AuditAction.PERSONNEL_FILE_DOCUMENT_DOWNLOADED
	| AuditAction.PERSONNEL_FILE_DOCUMENT_PURGED
	| AuditAction.PERSONNEL_FILE_SICK_NOTE_LINKED
	| AuditAction.PERSONNEL_FILE_SICK_NOTE_UNLINKED
	| AuditAction.PERSONNEL_FILE_SKILL_CERTIFICATE_LINKED
	| AuditAction.PERSONNEL_FILE_SKILL_CERTIFICATE_UNLINKED;

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

type DocumentAuditInput = {
	action: PersonnelFileAuditAction;
	actorUserId: string;
	document: AuditedDocument;
	/** Replaces the default document snapshot (a purge keeps no title). */
	snapshot?: Record<string, unknown>;
	changes?: Record<string, unknown> | null;
	metadata?: Record<string, unknown> | null;
	ipAddress?: string | null;
	userAgent?: string | null;
};

async function insertDocumentAudit(
	database: Writer,
	input: DocumentAuditInput,
	documentPurged: boolean,
): Promise<string> {
	const id = randomUUID();
	let changes = input.changes ?? null;
	let metadata: Record<string, unknown> | null = {
		document: input.snapshot ?? documentAuditSnapshot(input.document),
		...input.metadata,
	};
	if (documentPurged)
		({ changes, metadata } = documentAuditWithoutDescriptions({ changes, metadata }));
	await database.insert(auditLog).values({
		id,
		organizationId: input.document.organizationId,
		entityType: PERSONNEL_FILE_AUDIT_ENTITY_TYPE,
		entityId: input.document.id,
		action: input.action,
		performedBy: input.actorUserId,
		employeeId: input.document.employeeId,
		changes: changes ? JSON.stringify(changes) : null,
		metadata: metadata ? JSON.stringify(metadata) : null,
		ipAddress: input.ipAddress ?? null,
		userAgent: input.userAgent ?? null,
	});
	return id;
}

/**
 * Writes one audit record and returns its id (a stable key for follow-up work).
 * For writes in the transaction that holds the document's row lock (or that
 * creates or deletes the document); a view or download outside such a
 * transaction goes through `writeDocumentReadAudit`.
 */
export async function writeDocumentAudit(
	database: Writer,
	input: DocumentAuditInput,
): Promise<string> {
	return insertDocumentAudit(database, input, false);
}

/**
 * The audit record of a view or download, written after the document was read
 * without a lock (#923). The document row is held until the record commits,
 * so a purge either runs after it and minimises it, or ran before and the
 * record is written without the descriptions of the stale snapshot.
 */
export async function writeDocumentReadAudit(
	database: Database,
	input: DocumentAuditInput,
): Promise<string> {
	return database.transaction(async (tx) => {
		const purged = await lockPurgedDocumentIds(tx, {
			organizationId: input.document.organizationId,
			documentIds: [input.document.id],
		});
		return insertDocumentAudit(tx, input, purged.has(input.document.id));
	});
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

/**
 * Of the given documents of the organization, those a confirmed purge removed:
 * gone, with a purge record as explicit evidence (a document that is merely
 * gone was deleted, not purged). The documents still there are locked
 * (`FOR KEY SHARE`) until the transaction ends, so no purge can commit between
 * this check and the caller's audit insert.
 */
export async function lockPurgedDocumentIds(
	tx: Pick<Transaction, "select">,
	input: { organizationId: string; documentIds: readonly string[] },
): Promise<Set<string>> {
	const requested = [...new Set(input.documentIds)];
	if (requested.length === 0) return new Set();
	const present = await tx
		.select({ id: employeeDocument.id })
		.from(employeeDocument)
		.where(
			and(
				eq(employeeDocument.organizationId, input.organizationId),
				inArray(employeeDocument.id, requested),
			),
		)
		.orderBy(asc(employeeDocument.id))
		.for("key share");
	const presentIds = new Set(present.map((row) => row.id));
	const missing = requested.filter((id) => !presentIds.has(id));
	if (missing.length === 0) return new Set();
	const evidence = await tx
		.select({ documentId: auditLog.entityId })
		.from(auditLog)
		.where(
			and(
				eq(auditLog.organizationId, input.organizationId),
				eq(auditLog.entityType, PERSONNEL_FILE_AUDIT_ENTITY_TYPE),
				eq(auditLog.action, AuditAction.PERSONNEL_FILE_DOCUMENT_PURGED),
				inArray(auditLog.entityId, missing),
			),
		);
	return new Set(evidence.map((row) => row.documentId));
}

export interface UnprocessableAuditRecord {
	auditId: string;
	entityType: string;
	entityId: string;
	reason: "invalid_json";
}

export interface PurgedDocumentAuditMinimisation {
	/** Records whose descriptions were removed now. */
	minimised: number;
	/** Records naming a purged document that could not be minimised. */
	unprocessable: UnprocessableAuditRecord[];
}

/**
 * Removes the descriptions of purged documents from every audit record of the
 * organization about them: the documents' own records and the personnel file
 * ZIP records of their employees (only the purged documents' entries). Rows,
 * ids and timestamps stay. The records are locked and updated in the caller's
 * transaction; records that cannot be read are reported, not changed.
 */
export async function minimisePurgedDocumentAudits(
	tx: Locker,
	input: {
		organizationId: string;
		documents: ReadonlyArray<{ id: string; employeeId: string | null }>;
	},
): Promise<PurgedDocumentAuditMinimisation> {
	const result: PurgedDocumentAuditMinimisation = { minimised: 0, unprocessable: [] };
	const documentIds = [...new Set(input.documents.map((document) => document.id))];
	if (documentIds.length === 0) return result;
	const employeeIds = [
		...new Set(
			input.documents.flatMap((document) => (document.employeeId ? [document.employeeId] : [])),
		),
	];
	const purged = new Set(documentIds);
	const columns = {
		id: auditLog.id,
		entityId: auditLog.entityId,
		changes: auditLog.changes,
		metadata: auditLog.metadata,
	};
	const documentRecords = await tx
		.select(columns)
		.from(auditLog)
		.where(
			and(
				eq(auditLog.organizationId, input.organizationId),
				eq(auditLog.entityType, PERSONNEL_FILE_AUDIT_ENTITY_TYPE),
				inArray(auditLog.entityId, documentIds),
			),
		)
		.orderBy(asc(auditLog.id))
		.for("update");
	const zipRecords =
		employeeIds.length === 0
			? []
			: await tx
					.select(columns)
					.from(auditLog)
					.where(
						and(
							eq(auditLog.organizationId, input.organizationId),
							eq(auditLog.entityType, PERSONNEL_FILE_ZIP_AUDIT_ENTITY_TYPE),
							inArray(auditLog.entityId, employeeIds),
							inArray(auditLog.action, [
								AuditAction.PERSONNEL_FILE_ZIP_DOWNLOADED,
								AuditAction.PERSONNEL_FILE_ZIP_DOWNLOAD_ABORTED,
							]),
						),
					)
					.orderBy(asc(auditLog.id))
					.for("update");

	const apply = async (
		record: (typeof documentRecords)[number],
		entityType: string,
		minimised: AuditMinimisation,
	) => {
		if (minimised.kind === "unchanged") return;
		if (minimised.kind === "unprocessable") {
			result.unprocessable.push({
				auditId: record.id,
				entityType,
				entityId: record.entityId,
				reason: minimised.reason,
			});
			return;
		}
		await tx
			.update(auditLog)
			.set({ changes: minimised.changes, metadata: minimised.metadata })
			.where(and(eq(auditLog.id, record.id), eq(auditLog.organizationId, input.organizationId)));
		result.minimised += 1;
	};
	for (const record of documentRecords) {
		await apply(record, PERSONNEL_FILE_AUDIT_ENTITY_TYPE, minimiseDocumentAudit(record));
	}
	for (const record of zipRecords) {
		await apply(record, PERSONNEL_FILE_ZIP_AUDIT_ENTITY_TYPE, minimiseZipAudit(record, purged));
	}
	return result;
}
