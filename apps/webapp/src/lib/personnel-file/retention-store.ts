import { randomUUID } from "node:crypto";
import { and, asc, eq, exists, inArray, notExists, or, type SQL } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	auditLog,
	employee,
	employeeDocument,
	personnelFileRetentionPeriod,
	personnelFileUpload,
} from "@/db/schema";
import { employeeEmploymentPeriod } from "@/db/schema/employee-lifecycle";
import { AuditAction } from "@/lib/audit-logger";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import type { PersonnelFileAccess } from "./access";
import { managedDocumentsCondition } from "./access-store";
import {
	minimisePurgedDocumentAudits,
	type UnprocessableAuditRecord,
	writeDocumentAudit,
} from "./audit";
import { DOCUMENT_CATEGORIES, type DocumentCategory, type PayPeriod } from "./document.types";
import {
	lockDocumentRequestsOfDocuments,
	purgeDocumentRequestsOfDocuments,
} from "./document-request-purge";
import { loadOrganizationDay } from "./organization-day";
import { isValidRetentionYears, retentionDueDate, retentionStart } from "./retention";
import { loadRetentionEmployment } from "./retention-employment";
import { recomputeCertificateSkillExpiry } from "./skill-certificate-expiry";

/**
 * Retention periods, the due-for-deletion list and confirmed purges (#870).
 * Whether a document is due is decided by the pure rules in `retention.ts`;
 * the queries here only narrow the candidates (categories with a period,
 * employees whose employment ended, `retention-employment.ts`). Nothing is deleted except by
 * `purgeDueDocuments`, which an officer's confirmation calls.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

export type RetentionPeriods = Partial<Record<DocumentCategory, number>>;
export type RetentionPeriodsInput = Partial<Record<DocumentCategory, number | null>>;

export const RETENTION_AUDIT_ENTITY_TYPE = "personnel_file_retention_period";

export async function loadRetentionPeriods(
	database: Reader,
	organizationId: string,
): Promise<RetentionPeriods> {
	const rows = await database
		.select({
			category: personnelFileRetentionPeriod.category,
			retentionYears: personnelFileRetentionPeriod.retentionYears,
		})
		.from(personnelFileRetentionPeriod)
		.where(eq(personnelFileRetentionPeriod.organizationId, organizationId));
	const periods: RetentionPeriods = {};
	for (const row of rows) periods[row.category] = row.retentionYears;
	return periods;
}

export type SaveRetentionPeriodsResult =
	| { kind: "saved"; changed: DocumentCategory[] }
	| { kind: "invalid"; category: DocumentCategory };

/**
 * Sets the periods of the categories named in `periods` (null removes one;
 * omitted categories stay). Each change is audited. Shortening a period can
 * make documents due, but deletes nothing.
 */
export async function saveRetentionPeriods(
	database: Database,
	input: { organizationId: string; actorUserId: string; periods: RetentionPeriodsInput },
	now: Instant = systemClock.nowInstant(),
): Promise<SaveRetentionPeriodsResult> {
	for (const category of DOCUMENT_CATEGORIES) {
		const value = input.periods[category];
		if (value !== undefined && value !== null && !isValidRetentionYears(value)) {
			return { kind: "invalid", category };
		}
	}
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const current = await tx
			.select()
			.from(personnelFileRetentionPeriod)
			.where(eq(personnelFileRetentionPeriod.organizationId, input.organizationId))
			.for("update");
		const currentByCategory = new Map(current.map((row) => [row.category, row]));
		const changed: DocumentCategory[] = [];
		for (const category of DOCUMENT_CATEGORIES) {
			const next = input.periods[category];
			if (next === undefined) continue;
			const row = currentByCategory.get(category);
			const from = row?.retentionYears ?? null;
			if (from === next) continue;
			let entityId = row?.id ?? randomUUID();
			if (next === null) {
				await tx
					.delete(personnelFileRetentionPeriod)
					.where(
						and(
							eq(personnelFileRetentionPeriod.id, entityId),
							eq(personnelFileRetentionPeriod.organizationId, input.organizationId),
						),
					);
			} else if (row) {
				await tx
					.update(personnelFileRetentionPeriod)
					.set({ retentionYears: next, updatedBy: input.actorUserId, updatedAt: at })
					.where(
						and(
							eq(personnelFileRetentionPeriod.id, row.id),
							eq(personnelFileRetentionPeriod.organizationId, input.organizationId),
						),
					);
			} else {
				const [inserted] = await tx
					.insert(personnelFileRetentionPeriod)
					.values({
						id: entityId,
						organizationId: input.organizationId,
						category,
						retentionYears: next,
						updatedBy: input.actorUserId,
						createdAt: at,
						updatedAt: at,
					})
					.returning({ id: personnelFileRetentionPeriod.id });
				entityId = inserted?.id ?? entityId;
			}
			await tx.insert(auditLog).values({
				id: randomUUID(),
				organizationId: input.organizationId,
				entityType: RETENTION_AUDIT_ENTITY_TYPE,
				entityId,
				action: AuditAction.PERSONNEL_FILE_RETENTION_CHANGED,
				performedBy: input.actorUserId,
				changes: JSON.stringify({ category, from, to: next }),
				metadata: JSON.stringify({ category }),
			});
			changed.push(category);
		}
		return { kind: "saved", changed };
	});
}

/** An employee document whose retention start cannot be computed (decision B). */
export interface RetentionUnknownDocument {
	id: string;
	employeeId: string;
	employeeName: string;
	employeeNumber: string | null;
	category: DocumentCategory;
	title: string;
	documentDate: string;
	payPeriod: PayPeriod | null;
	retentionYears: number;
}

/** An employee document that is due for deletion. */
export interface DueDocument extends RetentionUnknownDocument {
	/** YYYY-MM-DD */
	retentionStart: string;
	/** YYYY-MM-DD: the day it became due. */
	dueOn: string;
}

export interface DueDocumentsResult {
	/** The organization's calendar day the list was evaluated for. */
	today: string;
	documents: DueDocument[];
	/**
	 * Documents of former employees whose employment end is unknown (no
	 * employment period, or a legacy period without an end): their retention
	 * start cannot be computed, so they are never due on their own. An officer
	 * reviews them and may purge them by hand (decision B); the daily reminder
	 * never counts them.
	 */
	unknownStart: RetentionUnknownDocument[];
}

/**
 * The due documents of one organization matching `condition` (a condition on
 * `employee_document`), evaluated for the organization's current day, and
 * the documents whose retention start is unknown. Only categories with a
 * retention period count.
 */
export async function findDueDocuments(
	database: Reader,
	input: { organizationId: string; condition?: SQL; now?: Instant },
): Promise<DueDocumentsResult> {
	const now = input.now ?? systemClock.nowInstant();
	const [{ timezone, today }, periods] = await Promise.all([
		loadOrganizationDay(database, { organizationId: input.organizationId, now }),
		loadRetentionPeriods(database, input.organizationId),
	]);
	const empty: DueDocumentsResult = { today: today.toString(), documents: [], unknownStart: [] };
	const categories = DOCUMENT_CATEGORIES.filter((category) => periods[category] !== undefined);
	if (categories.length === 0) return empty;

	const periodOf = (status: "open" | "legacy_unknown" | "closed") =>
		database
			.select({ id: employeeEmploymentPeriod.id })
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, input.organizationId),
					eq(employeeEmploymentPeriod.employeeId, employeeDocument.employeeId),
					eq(employeeEmploymentPeriod.status, status),
				),
			);
	const rows = await database
		.select({
			id: employeeDocument.id,
			employeeId: employeeDocument.employeeId,
			category: employeeDocument.category,
			title: employeeDocument.title,
			documentDate: employeeDocument.documentDate,
			payPeriodYear: employeeDocument.payPeriodYear,
			payPeriodMonth: employeeDocument.payPeriodMonth,
			userName: user.name,
			employeeNumber: employee.employeeNumber,
			employeeIsActive: employee.isActive,
			deactivatedAt: employee.deactivatedAt,
		})
		.from(employeeDocument)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeDocument.employeeId),
				eq(employee.organizationId, employeeDocument.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employeeDocument.organizationId, input.organizationId),
				inArray(employeeDocument.category, categories),
				input.condition,
				// Candidates only: a known end (an ended employment and no open or
				// unknown one) or a former employee, also one deactivated without a
				// departure, whose open period ends at the deactivation (#1440).
				or(
					and(
						notExists(periodOf("open")),
						exists(periodOf("closed")),
						notExists(periodOf("legacy_unknown")),
					),
					eq(employee.isActive, false),
				),
			),
		)
		.orderBy(asc(user.name), asc(employeeDocument.documentDate), asc(employeeDocument.id));
	if (rows.length === 0) return empty;

	const periodsByEmployee = await loadRetentionEmployment(database, {
		organizationId: input.organizationId,
		employeeIds: [...new Set(rows.map((row) => row.employeeId))],
	});

	const result = empty;
	for (const row of rows) {
		const retentionYears = periods[row.category];
		if (retentionYears === undefined) continue;
		const employmentPeriods = periodsByEmployee.get(row.employeeId) ?? [];
		const document: RetentionUnknownDocument = {
			id: row.id,
			employeeId: row.employeeId,
			employeeName: row.userName?.trim() || row.employeeNumber || row.employeeId,
			employeeNumber: row.employeeNumber,
			category: row.category,
			title: row.title,
			documentDate: row.documentDate,
			payPeriod:
				row.payPeriodYear !== null && row.payPeriodMonth !== null
					? { year: row.payPeriodYear, month: row.payPeriodMonth }
					: null,
			retentionYears,
		};
		const retention = {
			periods: employmentPeriods,
			documentDate: row.documentDate,
			timezone,
			retentionYears,
		};
		const start = retentionStart(retention);
		const dueOn = retentionDueDate(retention);
		if (start && dueOn) {
			if (Temporal.PlainDate.compare(today, dueOn) < 0) continue;
			result.documents.push({
				...document,
				retentionStart: start.toString(),
				dueOn: dueOn.toString(),
			});
		} else if (
			!row.employeeIsActive &&
			// An open period still running after the recorded deactivation is a
			// later employment; without a recorded instant (deactivated before
			// migration 0283) the end of the open period is unknown (#1440).
			(row.deactivatedAt === null || !employmentPeriods.some((period) => period.status === "open"))
		) {
			result.unknownStart.push(document);
		}
	}
	return result;
}

/** The due-for-deletion list of the actor's scope and categories. */
export async function listDueDocuments(
	database: Reader,
	access: PersonnelFileAccess,
	now: Instant = systemClock.nowInstant(),
): Promise<DueDocument[]> {
	return (await listDueDocumentsWithDay(database, access, now)).documents;
}

export async function listDueDocumentsWithDay(
	database: Reader,
	access: PersonnelFileAccess,
	now: Instant = systemClock.nowInstant(),
): Promise<DueDocumentsResult> {
	return findDueDocuments(database, {
		organizationId: access.organizationId,
		condition: managedDocumentsCondition(access),
		now,
	});
}

export interface PurgeResult {
	/** Purged documents, in the order requested. */
	purged: string[];
	/** Requested documents that were not purged: not due (any more), not managed or gone. */
	skipped: string[];
}

/** A purge was refused because audit records about a purged document cannot be minimised. */
export class PurgeAuditMinimisationError extends Error {
	constructor(readonly unprocessable: UnprocessableAuditRecord[]) {
		super(
			`Cannot remove the purged documents' descriptions from audit records ${unprocessable
				.map((record) => record.auditId)
				.join(", ")}`,
		);
		this.name = "PurgeAuditMinimisationError";
	}
}

/**
 * Purges the confirmed documents that are still due for deletion, or whose
 * retention start is unknown (decision B: reviewed by hand), and in the
 * actor's scope and categories, each with an audit record that survives it
 * (actor, employee, category, document date, pay period, retention facts; no
 * title, file or reason). The purged documents' descriptions are removed from
 * the earlier audit records about them in the same transaction (#923); when a
 * record cannot be minimised, the whole purge fails. The document requests
 * the purged documents were uploaded from lose their free text, and a closed
 * request left without documents is deleted with them (#1408; an accepted
 * renewal only once its renewed document is gone too, see
 * `purgeDocumentRequestsOfDocuments`). The deletion trigger
 * hands each stored object to the cleanup ledger in the same transaction.
 * Everything else requested is skipped.
 */
export async function purgeDueDocuments(
	database: Database,
	access: PersonnelFileAccess,
	input: { documentIds: readonly string[] },
	now: Instant = systemClock.nowInstant(),
): Promise<PurgeResult> {
	const requested = [...new Set(input.documentIds)];
	if (requested.length === 0) return { purged: [], skipped: [] };
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		// The documents' requests first (#1408), then the documents: the lock order of an accept.
		// Read before the deletion: a purged document's request links go with it.
		const requestsOf = await lockDocumentRequestsOfDocuments(tx, {
			organizationId: access.organizationId,
			documentIds: requested,
		});
		const locked = await tx
			.select({ id: employeeDocument.id, employeeId: employeeDocument.employeeId })
			.from(employeeDocument)
			.where(
				and(
					eq(employeeDocument.organizationId, access.organizationId),
					inArray(employeeDocument.id, requested),
				),
			)
			.orderBy(asc(employeeDocument.id))
			.for("update");
		if (locked.length === 0) return { purged: [], skipped: requested };
		// A rehire reactivates the employee row: hold it until the purge commits.
		await tx
			.select({ id: employee.id })
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, access.organizationId),
					inArray(employee.id, [...new Set(locked.map((row) => row.employeeId))]),
				),
			)
			.orderBy(asc(employee.id))
			.for("share");
		const { documents, unknownStart } = await findDueDocuments(tx, {
			organizationId: access.organizationId,
			condition: and(
				managedDocumentsCondition(access),
				inArray(
					employeeDocument.id,
					locked.map((row) => row.id),
				),
			),
			now,
		});
		const due = new Map<string, DueDocument | RetentionUnknownDocument>(
			[...documents, ...unknownStart].map((document) => [document.id, document]),
		);
		const purged: string[] = [];
		const purgedRows: Array<{ id: string; employeeId: string }> = [];
		const unlinkedSkillIds: string[] = [];
		for (const documentId of requested) {
			const document = due.get(documentId);
			if (!document) continue;
			const [row] = await tx
				.delete(employeeDocument)
				.where(
					and(
						eq(employeeDocument.id, documentId),
						eq(employeeDocument.organizationId, access.organizationId),
					),
				)
				.returning();
			if (!row) continue;
			// The trigger stamps database time; align it with the clock the worker uses.
			await tx
				.update(personnelFileUpload)
				.set({ nextAttemptAt: at, createdAt: at, updatedAt: at })
				.where(
					and(
						eq(personnelFileUpload.id, documentId),
						eq(personnelFileUpload.organizationId, access.organizationId),
						eq(personnelFileUpload.status, "cleanup_required"),
					),
				);
			await writeDocumentAudit(tx, {
				action: AuditAction.PERSONNEL_FILE_DOCUMENT_PURGED,
				actorUserId: access.userId,
				document: row,
				snapshot: {
					category: row.category,
					documentDate: row.documentDate,
					payPeriod: document.payPeriod,
				},
				metadata:
					"dueOn" in document
						? {
								retentionStart: document.retentionStart,
								dueOn: document.dueOn,
								retentionYears: document.retentionYears,
							}
						: {
								retentionStartUnknown: true,
								retentionStart: null,
								dueOn: null,
								retentionYears: document.retentionYears,
							},
			});
			purged.push(documentId);
			purgedRows.push({ id: row.id, employeeId: row.employeeId });
			if (row.employeeSkillId) unlinkedSkillIds.push(row.employeeSkillId);
		}
		const minimisation = await minimisePurgedDocumentAudits(tx, {
			organizationId: access.organizationId,
			documents: purgedRows,
		});
		// The purged documents' requests lose their free text; emptied ones go (#1408).
		const requests = await purgeDocumentRequestsOfDocuments(tx, {
			organizationId: access.organizationId,
			requestIds: purged.flatMap((id) => requestsOf.uploadedFrom.get(id) ?? []),
			renewalRequestIds: purged.flatMap((id) => requestsOf.renewedBy.get(id) ?? []),
			actorUserId: access.userId,
			at,
		});
		const unprocessable = [...minimisation.unprocessable, ...requests.unprocessable];
		if (unprocessable.length > 0) {
			throw new PurgeAuditMinimisationError(unprocessable);
		}
		// Purged skill certificates no longer set the skill expiry date (#1145).
		await recomputeCertificateSkillExpiry(tx, {
			organizationId: access.organizationId,
			employeeSkillIds: unlinkedSkillIds,
		});
		const purgedSet = new Set(purged);
		return { purged, skipped: requested.filter((id) => !purgedSet.has(id)) };
	});
}
