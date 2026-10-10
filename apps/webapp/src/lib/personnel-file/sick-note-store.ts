import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employeeDocument, personnelFileUpload } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { canDeleteOwnSickNote, canManageDocument, type PersonnelFileAccess } from "./access";
import { loadEmployeeRef, visibleDocumentsCondition } from "./access-store";
import { writeDocumentAudit } from "./audit";
import { type EmployeeDocumentView, loadLinkedAbsenceDays, toDocumentView } from "./document-store";

/**
 * Reads and cancellation of sick notes attached to absences (#982, Personnel
 * File ADR 0002). A sick note is a `sick_note` employee document linked to the
 * sick-leave absence it covers; the absence only learns how many there are,
 * and personnel file access decides who opens them. Attaching is in
 * sick-note-attach.ts.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

/** What an absence shows about its sick notes: how many, and whether the viewer may open them. */
export interface SickNoteMarker {
	count: number;
	/** The viewer may open at least one of them through personnel file access. */
	viewable: boolean;
}

/**
 * The number of sick notes linked to each absence, without loading their
 * metadata, for the "Sick note attached (n)" marker. `viewable` comes from
 * personnel file access: the employee themselves, officers covering sick
 * notes for the employee, owners and admins. Absences without notes are left out.
 */
export async function countSickNotesForAbsences(
	database: Reader,
	input: {
		organizationId: string;
		absenceIds: readonly string[];
		/** The viewer's personnel file access; null while they have none. */
		access: PersonnelFileAccess | null;
	},
): Promise<Map<string, SickNoteMarker>> {
	const markers = new Map<string, SickNoteMarker>();
	const absenceIds = [...new Set(input.absenceIds)];
	if (absenceIds.length === 0) return markers;
	const visible: SQL =
		input.access && input.access.organizationId === input.organizationId
			? visibleDocumentsCondition(input.access)
			: sql`false`;
	const rows = await database
		.select({
			absenceId: employeeDocument.absenceEntryId,
			count: sql<number>`count(*)::int`,
			visibleCount: sql<number>`(count(*) filter (where ${visible}))::int`,
		})
		.from(employeeDocument)
		.where(
			and(
				eq(employeeDocument.organizationId, input.organizationId),
				inArray(employeeDocument.absenceEntryId, absenceIds),
			),
		)
		.groupBy(employeeDocument.absenceEntryId);
	for (const row of rows) {
		if (!row.absenceId) continue;
		markers.set(row.absenceId, { count: row.count, viewable: row.visibleCount > 0 });
	}
	return markers;
}

export interface AbsenceSickNoteView extends EmployeeDocumentView {
	/** The viewer may delete it: their own upload within 24 hours, or they manage it. */
	canDelete: boolean;
}

/** The sick notes of one absence the actor may open, oldest first. */
export async function listAbsenceSickNotes(
	database: Reader,
	access: PersonnelFileAccess,
	absenceId: string,
	now: Instant = systemClock.nowInstant(),
): Promise<AbsenceSickNoteView[]> {
	const rows = await database
		.select()
		.from(employeeDocument)
		.where(and(visibleDocumentsCondition(access), eq(employeeDocument.absenceEntryId, absenceId)))
		.orderBy(employeeDocument.createdAt, employeeDocument.id);
	const [first] = rows;
	if (!first) return [];
	const [employee, absences] = await Promise.all([
		loadEmployeeRef(database, {
			organizationId: access.organizationId,
			employeeId: first.employeeId,
		}),
		loadLinkedAbsenceDays(database, { organizationId: access.organizationId, rows }),
	]);
	return rows.map((row) => ({
		...toDocumentView(row, absences),
		canDelete:
			(employee !== null && canManageDocument(access, employee, row.category)) ||
			canDeleteOwnSickNote(access, { ...row, createdAt: instantFromDate(row.createdAt) }, now),
	}));
}

/**
 * Deletes every sick note of an absence that is being cancelled, inside the
 * cancellation's transaction and before the absence row goes (ADR 0002:
 * cancelling deletes them, rejecting keeps them). Each deletion is audited
 * with the cancelling actor; the deletion trigger hands every stored object to
 * cleanup. Returns the deleted document ids for an immediate cleanup attempt
 * after commit.
 */
export async function deleteSickNotesOfCancelledAbsence(
	tx: Database | Transaction,
	input: {
		organizationId: string;
		absenceId: string;
		actorUserId: string;
		now?: Instant;
	},
): Promise<string[]> {
	const at = dateFromInstant(input.now ?? systemClock.nowInstant());
	const notes = await tx
		.select()
		.from(employeeDocument)
		.where(
			and(
				eq(employeeDocument.organizationId, input.organizationId),
				eq(employeeDocument.absenceEntryId, input.absenceId),
			),
		)
		.for("update");
	if (notes.length === 0) return [];
	const ids = notes.map((note) => note.id);
	await tx
		.delete(employeeDocument)
		.where(
			and(
				eq(employeeDocument.organizationId, input.organizationId),
				inArray(employeeDocument.id, ids),
			),
		);
	// The trigger stamps database time; align it with the clock the worker uses.
	await tx
		.update(personnelFileUpload)
		.set({ nextAttemptAt: at, createdAt: at, updatedAt: at })
		.where(
			and(
				eq(personnelFileUpload.organizationId, input.organizationId),
				inArray(personnelFileUpload.id, ids),
				eq(personnelFileUpload.status, "cleanup_required"),
			),
		);
	for (const note of notes) {
		await writeDocumentAudit(tx, {
			action: AuditAction.PERSONNEL_FILE_DOCUMENT_DELETED,
			actorUserId: input.actorUserId,
			document: note,
			metadata: {
				reason: null,
				fileName: note.fileName,
				absenceId: input.absenceId,
				cause: "absence_cancelled",
			},
		});
	}
	return ids;
}
