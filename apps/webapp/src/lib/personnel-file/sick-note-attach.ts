import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { absenceCategory, absenceEntry, auditLog } from "@/db/schema";
import { loadAbsenceSettings } from "@/lib/absences/absence-settings";
import type { SickDetail } from "@/lib/absences/types";
import { AuditAction } from "@/lib/audit-logger";
import {
	officerSickNoteAttachRefusal,
	type PersonnelFileAccess,
	type SickNoteAttachRefusal,
	type SickNoteAuthority,
	sickLeaveAttachRefusal,
	sickNoteAttachRefusal,
} from "./access";
import { loadEmployeeRef } from "./access-store";

/**
 * Attaching a sick note to a sick-leave absence (#982, Personnel File ADR
 * 0002): a `sick_note` employee document linked to the absence, uploaded by
 * the employee, by whoever records the absence on their behalf, or by whoever
 * manages their sick notes (#984). The upload route checks the target before
 * it stores the file; document finalization locks and checks it again.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

declare const recordedAbsence: unique symbol;

/**
 * The authority of whoever records an absence on the employee's behalf
 * (#984): to attach sick notes to that one absence, from inside the
 * recording. It is bound to the absence it was granted for and opens no
 * other; only `createAbsenceWithStagedSickNotes` (sick-note-upload.ts) grants
 * one, for the absence it has just created.
 */
export interface RecorderSickNoteGrant {
	readonly kind: "recorder";
	readonly absenceId: string;
	readonly [recordedAbsence]: true;
}

/** A standing authority, or the recorder's grant for the absence just recorded. */
export type SickNoteAttachAuthority = SickNoteAuthority | RecorderSickNoteGrant;

/** The absence a sick note is attached to, as attaching needs it. */
export interface SickNoteAbsence {
	id: string;
	employeeId: string;
	/** YYYY-MM-DD */
	startDate: string;
	/** YYYY-MM-DD */
	endDate: string;
	status: "pending" | "approved" | "rejected";
	sickDetail: SickDetail | null;
}

function absenceColumns() {
	return {
		id: absenceEntry.id,
		employeeId: absenceEntry.employeeId,
		startDate: absenceEntry.startDate,
		endDate: absenceEntry.endDate,
		status: absenceEntry.status,
		sickDetail: absenceEntry.sickDetail,
		categoryType: absenceCategory.type,
	};
}

function absenceOf(row: SickNoteAbsence & { categoryType: string }): SickNoteAbsence {
	return {
		id: row.id,
		employeeId: row.employeeId,
		startDate: row.startDate,
		endDate: row.endDate,
		status: row.status,
		sickDetail: row.sickDetail,
	};
}

export type SickNoteAttachTarget =
	| { kind: "ok"; absence: SickNoteAbsence }
	| { kind: "not_found" }
	| { kind: "refused"; reason: SickNoteAttachRefusal };

/**
 * Reads the absence (of the actor's organization only) with the absence
 * settings and decides with `sickNoteAttachRefusal`. `lock` holds the
 * absence row for the rest of the transaction.
 */
async function decideSickNoteTarget(
	database: Reader,
	access: PersonnelFileAccess,
	input: { absenceId: string; authority: SickNoteAttachAuthority; lock: boolean },
): Promise<SickNoteAttachTarget> {
	const query = database
		.select(absenceColumns())
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
				eq(absenceEntry.id, input.absenceId),
				eq(absenceEntry.organizationId, access.organizationId),
			),
		);
	const [row] = await (input.lock ? query.for("update", { of: absenceEntry }) : query.limit(1));
	if (!row) return { kind: "not_found" };
	const reason = await attachRefusalUnder(database, input.authority, access, row);
	return reason ? { kind: "refused", reason } : { kind: "ok", absence: absenceOf(row) };
}

async function attachRefusalUnder(
	database: Reader,
	authority: SickNoteAttachAuthority,
	access: PersonnelFileAccess,
	absence: {
		id: string;
		employeeId: string;
		categoryType: string;
		status: SickNoteAbsence["status"];
	},
): Promise<SickNoteAttachRefusal | null> {
	if (typeof authority === "object") {
		// The recorder's grant opens only the absence it was granted for.
		return authority.absenceId === absence.id ? sickLeaveAttachRefusal(absence) : "not_managed";
	}
	switch (authority) {
		case "employee": {
			const settings = await loadAbsenceSettings(database, access.organizationId);
			return sickNoteAttachRefusal(access, {
				employeeSickNoteUpload: settings.employeeSickNoteUpload,
				absence,
			});
		}
		case "officer": {
			const employee = await loadEmployeeRef(database, {
				organizationId: access.organizationId,
				employeeId: absence.employeeId,
			});
			return employee ? officerSickNoteAttachRefusal(access, { employee, absence }) : "not_managed";
		}
	}
}

/**
 * Whether the actor may attach a sick note to the absence now, on the given
 * authority (the employee's own by default). Absences of other organizations
 * are not found; everything else is decided by the authority's rule in
 * access.ts.
 */
export function loadSickNoteAttachTarget(
	database: Reader,
	access: PersonnelFileAccess,
	absenceId: string,
	authority: SickNoteAttachAuthority = "employee",
): Promise<SickNoteAttachTarget> {
	return decideSickNoteTarget(database, access, { absenceId, authority, lock: false });
}

/**
 * `loadSickNoteAttachTarget` with the absence row locked for the rest of the
 * transaction, for writes that link a sick note to it.
 */
export function lockSickNoteAttachTarget(
	tx: Transaction,
	access: PersonnelFileAccess,
	input: { absenceId: string; authority: SickNoteAttachAuthority },
): Promise<SickNoteAttachTarget> {
	return decideSickNoteTarget(tx, access, { ...input, lock: true });
}

/**
 * Locks the absence for the transaction that records the sick note and checks
 * again that it may still take one on the authority (for the employee: their
 * own, still sick leave, not rejected, the setting still on), and that it is
 * the absence of the document's employee. Null when not: the upload is not
 * recorded.
 */
export async function lockSickNoteAbsence(
	tx: Transaction,
	access: PersonnelFileAccess,
	input: { absenceId: string; employeeId: string; authority: SickNoteAttachAuthority },
): Promise<SickNoteAbsence | null> {
	const target = await lockSickNoteAttachTarget(tx, access, input);
	return target.kind === "ok" && target.absence.employeeId === input.employeeId
		? target.absence
		: null;
}

/**
 * A sick note is the certificate: an absence recorded "without certificate"
 * becomes "with certificate" when one is attached, audited. Every other sick
 * detail stays, and removing notes never changes it back.
 */
export async function markAbsenceWithCertificate(
	tx: Transaction,
	input: {
		organizationId: string;
		absence: SickNoteAbsence;
		documentId: string;
		actorUserId: string;
	},
): Promise<void> {
	if (input.absence.sickDetail !== "without_certificate") return;
	await tx
		.update(absenceEntry)
		.set({ sickDetail: "with_certificate" })
		.where(
			and(
				eq(absenceEntry.id, input.absence.id),
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.sickDetail, "without_certificate"),
			),
		);
	await tx.insert(auditLog).values({
		id: randomUUID(),
		organizationId: input.organizationId,
		entityType: "absence_entry",
		entityId: input.absence.id,
		action: AuditAction.ABSENCE_SICK_DETAIL_CHANGED,
		performedBy: input.actorUserId,
		employeeId: input.absence.employeeId,
		changes: JSON.stringify({
			sickDetail: { from: "without_certificate", to: "with_certificate" },
		}),
		metadata: JSON.stringify({ documentId: input.documentId, absenceId: input.absence.id }),
	});
}
