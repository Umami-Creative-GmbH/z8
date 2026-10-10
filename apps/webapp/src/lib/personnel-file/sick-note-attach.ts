import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { absenceCategory, absenceEntry, auditLog } from "@/db/schema";
import { loadAbsenceSettings } from "@/lib/absences/absence-settings";
import type { SickDetail } from "@/lib/absences/types";
import { AuditAction } from "@/lib/audit-logger";
import {
	type PersonnelFileAccess,
	type SickNoteAttachRefusal,
	type SickNoteAuthority,
	sickNoteAttachRefusal,
} from "./access";

/**
 * Attaching a sick note to a sick-leave absence (#982, Personnel File ADR
 * 0002): the employee uploads it as a shared `sick_note` employee document
 * linked to their own absence. The upload route checks the target before it
 * stores the file; document finalization locks and checks it again.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

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
	input: { absenceId: string; authority: SickNoteAuthority; lock: boolean },
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
	const [[row], settings] = await Promise.all([
		input.lock ? query.for("update", { of: absenceEntry }) : query.limit(1),
		loadAbsenceSettings(database, access.organizationId),
	]);
	if (!row) return { kind: "not_found" };
	const reason = attachRefusalUnder(input.authority, access, {
		employeeSickNoteUpload: settings.employeeSickNoteUpload,
		absence: row,
	});
	return reason ? { kind: "refused", reason } : { kind: "ok", absence: absenceOf(row) };
}

function attachRefusalUnder(
	authority: SickNoteAuthority,
	access: PersonnelFileAccess,
	input: Parameters<typeof sickNoteAttachRefusal>[1],
): SickNoteAttachRefusal | null {
	switch (authority) {
		case "employee":
			return sickNoteAttachRefusal(access, input);
	}
}

/**
 * Whether the actor may attach a sick note to the absence now, on the given
 * authority (the employee's own by default). Absences of other organizations
 * are not found; everything else is decided by `sickNoteAttachRefusal`.
 */
export function loadSickNoteAttachTarget(
	database: Reader,
	access: PersonnelFileAccess,
	absenceId: string,
	authority: SickNoteAuthority = "employee",
): Promise<SickNoteAttachTarget> {
	return decideSickNoteTarget(database, access, { absenceId, authority, lock: false });
}

/**
 * Locks the absence for the transaction that records the sick note and checks
 * again that it may still take one (the employee's own, still sick leave, not
 * rejected, the setting still on). Null when not: the upload is not recorded.
 */
export async function lockSickNoteAbsence(
	tx: Transaction,
	access: PersonnelFileAccess,
	input: { absenceId: string; employeeId: string; authority: SickNoteAuthority },
): Promise<SickNoteAbsence | null> {
	const target = await decideSickNoteTarget(tx, access, {
		absenceId: input.absenceId,
		authority: input.authority,
		lock: true,
	});
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
