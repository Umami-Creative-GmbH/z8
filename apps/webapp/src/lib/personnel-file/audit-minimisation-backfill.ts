import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { auditLog, employeeDocument } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import {
	minimisePurgedDocumentAudits,
	PERSONNEL_FILE_AUDIT_ENTITY_TYPE,
	type UnprocessableAuditRecord,
} from "./audit";

/**
 * The one-time backfill of #923: documents purged before purges minimised
 * their audit records get the same minimisation now. Only a purge record is
 * evidence of a purge; a document that is merely gone (deleted by hand) is
 * left alone, and a purge record whose document still exists is reported and
 * not trusted. Purge records are processed in batches of their organization,
 * each batch in its own transaction, so an interrupted run keeps its progress;
 * minimising is idempotent, so a second run changes nothing and finishes what
 * the first left. Records expired by the audit-log lifetime are gone and are
 * not reconstructed.
 */

type Database = typeof appDb;

export interface PurgedDocumentAuditBackfillReport {
	organizationId: string;
	/** Purge records read as evidence. */
	purgeRecords: number;
	/** Audit records whose descriptions were removed by this run. */
	minimised: number;
	/** Records about a purged document whose JSON cannot be read: left unchanged. */
	unprocessable: UnprocessableAuditRecord[];
	/** Purge records whose document still exists: not trusted, nothing changed. */
	documentStillPresent: Array<{ auditId: string; documentId: string }>;
	/**
	 * Purged documents whose purge record names no employee: their own records
	 * were minimised, but personnel file ZIP records (filed under the employee)
	 * could not be matched.
	 */
	employeeUnknown: Array<{ auditId: string; documentId: string }>;
}

const DEFAULT_BATCH_SIZE = 100;

const purgeEvidence = and(
	eq(auditLog.entityType, PERSONNEL_FILE_AUDIT_ENTITY_TYPE),
	eq(auditLog.action, AuditAction.PERSONNEL_FILE_DOCUMENT_PURGED),
);

async function backfillOrganization(
	database: Database,
	organizationId: string,
	batchSize: number,
): Promise<PurgedDocumentAuditBackfillReport> {
	const report: PurgedDocumentAuditBackfillReport = {
		organizationId,
		purgeRecords: 0,
		minimised: 0,
		unprocessable: [],
		documentStillPresent: [],
		employeeUnknown: [],
	};
	let after: string | null = null;
	for (;;) {
		const cursor: string | null = after;
		const done: boolean = await database.transaction(async (tx) => {
			const evidence = await tx
				.select({
					auditId: auditLog.id,
					documentId: auditLog.entityId,
					employeeId: auditLog.employeeId,
				})
				.from(auditLog)
				.where(
					and(
						eq(auditLog.organizationId, organizationId),
						purgeEvidence,
						cursor ? gt(auditLog.id, cursor) : undefined,
					),
				)
				.orderBy(asc(auditLog.id))
				.limit(batchSize);
			if (evidence.length === 0) return true;
			after = evidence[evidence.length - 1]?.auditId ?? null;
			report.purgeRecords += evidence.length;
			const present = await tx
				.select({ id: employeeDocument.id })
				.from(employeeDocument)
				.where(
					and(
						eq(employeeDocument.organizationId, organizationId),
						inArray(
							employeeDocument.id,
							evidence.map((row) => row.documentId),
						),
					),
				);
			const presentIds = new Set(present.map((row) => row.id));
			const documents: Array<{ id: string; employeeId: string | null }> = [];
			for (const row of evidence) {
				if (presentIds.has(row.documentId)) {
					report.documentStillPresent.push({ auditId: row.auditId, documentId: row.documentId });
					continue;
				}
				if (!row.employeeId) {
					report.employeeUnknown.push({ auditId: row.auditId, documentId: row.documentId });
				}
				documents.push({ id: row.documentId, employeeId: row.employeeId });
			}
			const minimisation = await minimisePurgedDocumentAudits(tx, { organizationId, documents });
			report.minimised += minimisation.minimised;
			report.unprocessable.push(...minimisation.unprocessable);
			return evidence.length < batchSize;
		});
		if (done) return report;
	}
}

/**
 * Runs the backfill for the named organizations, or for every organization
 * with a purge record, one organization at a time.
 */
export async function backfillPurgedDocumentAudits(
	database: Database,
	options: { organizationIds?: readonly string[]; batchSize?: number } = {},
): Promise<PurgedDocumentAuditBackfillReport[]> {
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	const organizationIds =
		options.organizationIds ??
		(
			await database
				.selectDistinct({ organizationId: auditLog.organizationId })
				.from(auditLog)
				.where(purgeEvidence)
				.orderBy(asc(auditLog.organizationId))
		).map((row) => row.organizationId);
	const reports: PurgedDocumentAuditBackfillReport[] = [];
	for (const organizationId of organizationIds) {
		reports.push(await backfillOrganization(database, organizationId, batchSize));
	}
	return reports;
}
