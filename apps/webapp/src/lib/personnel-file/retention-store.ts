import { randomUUID } from "node:crypto";
import { and, asc, eq, exists, inArray, notExists, type SQL } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db as appDb } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	auditLog,
	employee,
	employeeDocument,
	personnelFileRetentionPeriod,
	personnelFileUpload,
} from "@/db/schema";
import { employeeEmploymentPeriod } from "@/db/schema/employee-lifecycle";
import { AuditAction } from "@/lib/audit-logger";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import type { PersonnelFileAccess } from "./access";
import { visibleDocumentsCondition } from "./access-store";
import { writeDocumentAudit } from "./audit";
import { DOCUMENT_CATEGORIES, type DocumentCategory, type PayPeriod } from "./document.types";
import {
	type EmploymentPeriodForRetention,
	isValidRetentionYears,
	retentionDueDate,
	retentionStart,
} from "./retention";

/**
 * Retention periods, the due-for-deletion list and confirmed purges (#870).
 * Whether a document is due is decided by the pure rules in `retention.ts`;
 * the queries here only narrow the candidates (categories with a period,
 * employees without an open employment period). Nothing is deleted except by
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
		const changed: DocumentCategory[] = [];
		for (const category of DOCUMENT_CATEGORIES) {
			const next = input.periods[category];
			if (next === undefined) continue;
			const row = current.find((candidate) => candidate.category === category);
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

export async function loadOrganizationTimezone(
	database: Reader,
	organizationId: string,
): Promise<string> {
	const [row] = await database
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);
	return resolveOrganizationTimezone(row?.timezone).timezone;
}

/** An employee document that is due for deletion. */
export interface DueDocument {
	id: string;
	employeeId: string;
	employeeName: string;
	employeeNumber: string | null;
	category: DocumentCategory;
	title: string;
	documentDate: string;
	payPeriod: PayPeriod | null;
	/** YYYY-MM-DD */
	retentionStart: string;
	/** YYYY-MM-DD: the day it became due. */
	dueOn: string;
	retentionYears: number;
}

export interface DueDocumentsResult {
	/** The organization's calendar day the list was evaluated for. */
	today: string;
	documents: DueDocument[];
}

/**
 * The due documents of one organization matching `condition` (a condition on
 * `employee_document`), evaluated for the organization's current day.
 */
export async function findDueDocuments(
	database: Reader,
	input: { organizationId: string; condition?: SQL; now?: Instant },
): Promise<DueDocumentsResult> {
	const now = input.now ?? systemClock.nowInstant();
	const [timezone, periods] = await Promise.all([
		loadOrganizationTimezone(database, input.organizationId),
		loadRetentionPeriods(database, input.organizationId),
	]);
	const today = now.toZonedDateTimeISO(timezone).toPlainDate();
	const categories = DOCUMENT_CATEGORIES.filter((category) => periods[category] !== undefined);
	if (categories.length === 0) return { today: today.toString(), documents: [] };

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
				// Candidates only: an ended employment and no open (or unknown) one.
				exists(periodOf("closed")),
				notExists(periodOf("open")),
				notExists(periodOf("legacy_unknown")),
			),
		)
		.orderBy(asc(user.name), asc(employeeDocument.documentDate), asc(employeeDocument.id));
	if (rows.length === 0) return { today: today.toString(), documents: [] };

	const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
	const periodRows = await database
		.select({
			employeeId: employeeEmploymentPeriod.employeeId,
			status: employeeEmploymentPeriod.status,
			endedAt: employeeEmploymentPeriod.endedAt,
		})
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, input.organizationId),
				inArray(employeeEmploymentPeriod.employeeId, employeeIds),
			),
		);
	const periodsByEmployee = new Map<string, EmploymentPeriodForRetention[]>();
	for (const row of periodRows) {
		const list = periodsByEmployee.get(row.employeeId) ?? [];
		list.push({ status: row.status, endedAt: row.endedAt ? instantFromDate(row.endedAt) : null });
		periodsByEmployee.set(row.employeeId, list);
	}

	const documents: DueDocument[] = [];
	for (const row of rows) {
		const retentionYears = periods[row.category];
		if (retentionYears === undefined) continue;
		const input = {
			periods: periodsByEmployee.get(row.employeeId) ?? [],
			documentDate: row.documentDate,
			timezone,
			retentionYears,
		};
		const dueOn = retentionDueDate(input);
		const start = retentionStart(input);
		if (!dueOn || !start || Temporal.PlainDate.compare(today, dueOn) < 0) continue;
		documents.push({
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
			retentionStart: start.toString(),
			dueOn: dueOn.toString(),
			retentionYears,
		});
	}
	return { today: today.toString(), documents };
}

/** Documents the actor manages through a grant; their own shared documents do not count. */
function managedDocumentsCondition(access: PersonnelFileAccess): SQL {
	return visibleDocumentsCondition({ ...access, selfEmployeeId: null });
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

export const PURGE_REASON_MAX_LENGTH = 1000;

/**
 * Purges the confirmed documents that are still due for deletion and in the
 * actor's scope and categories, each with an audit record that survives it
 * (actor, employee, category, document date, pay period, reason; no title or
 * file). The deletion trigger hands each stored object to the cleanup ledger
 * in the same transaction. Everything else requested is skipped.
 */
export async function purgeDueDocuments(
	database: Database,
	access: PersonnelFileAccess,
	input: { documentIds: readonly string[]; reason: string | null },
	now: Instant = systemClock.nowInstant(),
): Promise<PurgeResult> {
	const requested = [...new Set(input.documentIds)];
	if (requested.length === 0) return { purged: [], skipped: [] };
	const at = dateFromInstant(now);
	const reason = input.reason?.trim().slice(0, PURGE_REASON_MAX_LENGTH) || null;
	return database.transaction(async (tx) => {
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
		const { documents } = await findDueDocuments(tx, {
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
		const due = new Map(documents.map((document) => [document.id, document]));
		const purged: string[] = [];
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
				metadata: {
					reason,
					retentionStart: document.retentionStart,
					dueOn: document.dueOn,
					retentionYears: document.retentionYears,
				},
			});
			purged.push(documentId);
		}
		const purgedSet = new Set(purged);
		return { purged, skipped: requested.filter((id) => !purgedSet.has(id)) };
	});
}
