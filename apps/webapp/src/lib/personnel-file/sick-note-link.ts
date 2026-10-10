import { and, desc, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { absenceCategory, absenceEntry, employeeDocument } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { SickDetail } from "@/lib/absences/types";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { canManageDocument, type PersonnelFileAccess, type SickNoteAttachRefusal } from "./access";
import { loadEmployeeRef } from "./access-store";
import { writeDocumentAudit } from "./audit";
import { type EmployeeDocumentView, lockDocument, toDocumentView } from "./document-store";
import { lockSickNoteAttachTarget, markAbsenceWithCertificate } from "./sick-note-attach";
import { countSickNotesForAbsences } from "./sick-note-store";

/**
 * Linking a `sick_note` document that is already in the personnel file to
 * one of the employee's sick-leave absences, and unlinking it again (#984,
 * Personnel File ADR 0002). Only whoever manages the employee's sick notes
 * may: an officer covering `sick_note` for the employee, an owner or an
 * admin, never on their own file. Each link and unlink is audited with the
 * actor and the absence; linking makes a "without certificate" absence "with
 * certificate", and unlinking never changes it back.
 */

type Database = typeof appDb;

export type SickNoteLinkRefusal =
	| Exclude<SickNoteAttachRefusal, "setting_off" | "not_own" | "not_managed">
	/** The document is no sick note. */
	| "not_sick_note"
	/** The document is linked to another absence; unlink it first. */
	| "already_linked"
	/** The absence belongs to another employee than the document. */
	| "other_employee";

export type LinkSickNoteResult =
	| { kind: "linked"; document: EmployeeDocumentView }
	/** The document or the absence is not there for the actor. */
	| { kind: "not_found" }
	| { kind: "refused"; reason: SickNoteLinkRefusal };

/** Links an unlinked sick note of the employee to their pending or approved sick leave. */
export async function linkSickNoteToAbsence(
	database: Database,
	access: PersonnelFileAccess,
	input: { documentId: string; absenceId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<LinkSickNoteResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const current = await lockDocument(tx, access.organizationId, input.documentId);
		if (!current) return { kind: "not_found" };
		const employee = await loadEmployeeRef(tx, {
			organizationId: access.organizationId,
			employeeId: current.employeeId,
		});
		if (!employee || !canManageDocument(access, employee, current.category)) {
			return { kind: "not_found" };
		}
		if (current.category !== "sick_note") return { kind: "refused", reason: "not_sick_note" };

		const target = await lockSickNoteAttachTarget(tx, access, {
			absenceId: input.absenceId,
			authority: "officer",
		});
		if (target.kind === "not_found") return { kind: "not_found" };
		if (target.kind === "refused") {
			// An absence of an employee the actor does not cover reads as not found.
			if (target.reason === "not_sick" || target.reason === "rejected") {
				return { kind: "refused", reason: target.reason };
			}
			return { kind: "not_found" };
		}
		const { absence } = target;
		if (absence.employeeId !== current.employeeId) {
			return { kind: "refused", reason: "other_employee" };
		}
		const days = new Map([
			[absence.id, { startDate: absence.startDate, endDate: absence.endDate }],
		]);
		if (current.absenceEntryId === absence.id) {
			return { kind: "linked", document: toDocumentView(current, days) };
		}
		if (current.absenceEntryId !== null) return { kind: "refused", reason: "already_linked" };

		const [row] = await tx
			.update(employeeDocument)
			.set({ absenceEntryId: absence.id, updatedBy: access.userId, updatedAt: at })
			.where(
				and(
					eq(employeeDocument.id, current.id),
					eq(employeeDocument.organizationId, access.organizationId),
				),
			)
			.returning();
		if (!row) return { kind: "not_found" };
		await writeDocumentAudit(tx, {
			action: AuditAction.PERSONNEL_FILE_SICK_NOTE_LINKED,
			actorUserId: access.userId,
			document: row,
			changes: { absenceEntryId: { from: null, to: absence.id } },
			metadata: { absenceId: absence.id },
		});
		await markAbsenceWithCertificate(tx, {
			organizationId: access.organizationId,
			absence,
			documentId: row.id,
			actorUserId: access.userId,
		});
		return { kind: "linked", document: toDocumentView(row, days) };
	});
}

export type UnlinkSickNoteResult =
	| { kind: "unlinked"; document: EmployeeDocumentView; absenceId: string }
	| { kind: "not_found" }
	/** The document is linked to no absence. */
	| { kind: "refused"; reason: "not_linked" };

/**
 * Unlinks a sick note from its absence. The note stays in the personnel file
 * and the absence keeps its sick detail.
 */
export async function unlinkSickNoteFromAbsence(
	database: Database,
	access: PersonnelFileAccess,
	input: { documentId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<UnlinkSickNoteResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const current = await lockDocument(tx, access.organizationId, input.documentId);
		if (!current) return { kind: "not_found" };
		const employee = await loadEmployeeRef(tx, {
			organizationId: access.organizationId,
			employeeId: current.employeeId,
		});
		if (!employee || !canManageDocument(access, employee, "sick_note")) {
			return { kind: "not_found" };
		}
		const absenceId = current.absenceEntryId;
		if (current.category !== "sick_note" || absenceId === null) {
			return { kind: "refused", reason: "not_linked" };
		}
		const [row] = await tx
			.update(employeeDocument)
			.set({ absenceEntryId: null, updatedBy: access.userId, updatedAt: at })
			.where(
				and(
					eq(employeeDocument.id, current.id),
					eq(employeeDocument.organizationId, access.organizationId),
				),
			)
			.returning();
		if (!row) return { kind: "not_found" };
		await writeDocumentAudit(tx, {
			action: AuditAction.PERSONNEL_FILE_SICK_NOTE_UNLINKED,
			actorUserId: access.userId,
			document: row,
			changes: { absenceEntryId: { from: absenceId, to: null } },
			metadata: { absenceId },
		});
		return { kind: "unlinked", document: toDocumentView(row), absenceId };
	});
}

/** A sick-leave absence a sick note can be attached or linked to. */
export interface LinkableSickLeave {
	id: string;
	/** YYYY-MM-DD */
	startDate: string;
	/** YYYY-MM-DD */
	endDate: string;
	status: "pending" | "approved";
	sickDetail: SickDetail | null;
	/** Sick notes linked to it, whoever may open them. */
	sickNoteCount: number;
}

const LINKABLE_SICK_LEAVE_LIMIT = 100;

/**
 * The employee's pending and approved sick leave, newest first, for whoever
 * manages the employee's sick notes. Null when the actor does not (or it is
 * their own file).
 */
export async function listLinkableSickLeave(
	database: Database,
	access: PersonnelFileAccess,
	employeeId: string,
): Promise<LinkableSickLeave[] | null> {
	const employee = await loadEmployeeRef(database, {
		organizationId: access.organizationId,
		employeeId,
	});
	if (!employee || !canManageDocument(access, employee, "sick_note")) return null;
	const rows = await database
		.select({
			id: absenceEntry.id,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
			status: absenceEntry.status,
			sickDetail: absenceEntry.sickDetail,
		})
		.from(absenceEntry)
		.innerJoin(
			absenceCategory,
			and(
				eq(absenceCategory.id, absenceEntry.categoryId),
				eq(absenceCategory.organizationId, access.organizationId),
			),
		)
		.where(
			and(
				eq(absenceEntry.organizationId, access.organizationId),
				eq(absenceEntry.employeeId, employee.id),
				eq(absenceCategory.type, "sick"),
				inArray(absenceEntry.status, ["pending", "approved"]),
			),
		)
		.orderBy(desc(absenceEntry.startDate), desc(absenceEntry.id))
		.limit(LINKABLE_SICK_LEAVE_LIMIT);
	const counts = await countSickNotesForAbsences(database, {
		organizationId: access.organizationId,
		absenceIds: rows.map((row) => row.id),
		access,
		employeeId: employee.id,
	});
	return rows.map((row) => ({
		id: row.id,
		startDate: row.startDate,
		endDate: row.endDate,
		status: row.status === "pending" ? "pending" : "approved",
		sickDetail: row.sickDetail,
		sickNoteCount: counts.get(row.id)?.count ?? 0,
	}));
}
