"use server";

import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import type { EmployeeDocumentView } from "@/lib/personnel-file/document-store";
import {
	type LinkableSickLeave,
	linkSickNoteToAbsence,
	listLinkableSickLeave,
	type SickNoteLinkRefusal,
	unlinkSickNoteFromAbsence,
} from "@/lib/personnel-file/sick-note-link";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

/**
 * Officer actions on the sick notes of an employee's absences (#984): link an
 * existing sick note to a sick-leave absence, unlink it, and list the
 * absences to pick from. Only whoever manages the employee's sick notes may;
 * for everyone else the document or the employee is not found.
 */

const NOT_FOUND = "Not found";

const LINK_REFUSALS: Record<SickNoteLinkRefusal, string> = {
	not_sick_note: "Only sick notes can be linked to an absence.",
	already_linked: "This sick note is linked to another absence. Unlink it first.",
	other_employee: "The sick note and the absence belong to different employees.",
	not_sick: "Sick notes can be linked only to sick leave.",
	rejected: "Sick notes cannot be linked to a rejected absence.",
};

export type { LinkableSickLeave } from "@/lib/personnel-file/sick-note-link";

function failure(error: unknown, fallback: string): { success: false; error: string } {
	logger.error({ error }, fallback);
	return { success: false, error: fallback };
}

export async function linkSickNoteAction(input: {
	documentId: string;
	absenceId: string;
}): Promise<ServerActionResult<EmployeeDocumentView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (
			current.status !== "resolved" ||
			!isCanonicalUuid(input?.documentId) ||
			!isCanonicalUuid(input?.absenceId)
		) {
			return { success: false, error: NOT_FOUND };
		}
		const result = await linkSickNoteToAbsence(db, current.access, {
			documentId: input.documentId,
			absenceId: input.absenceId,
		});
		switch (result.kind) {
			case "not_found":
				return { success: false, error: NOT_FOUND };
			case "refused":
				return { success: false, error: LINK_REFUSALS[result.reason], code: result.reason };
			case "linked":
				return { success: true, data: result.document };
		}
	} catch (error) {
		return failure(error, "Failed to link the sick note");
	}
}

export async function unlinkSickNoteAction(input: {
	documentId: string;
}): Promise<ServerActionResult<EmployeeDocumentView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.documentId)) {
			return { success: false, error: NOT_FOUND };
		}
		const result = await unlinkSickNoteFromAbsence(db, current.access, {
			documentId: input.documentId,
		});
		switch (result.kind) {
			case "not_found":
				return { success: false, error: NOT_FOUND };
			case "refused":
				return {
					success: false,
					error: "This sick note is not linked to an absence.",
					code: result.reason,
				};
			case "unlinked":
				return { success: true, data: result.document };
		}
	} catch (error) {
		return failure(error, "Failed to unlink the sick note");
	}
}

/** The employee's pending and approved sick leave, to attach or link sick notes to. */
export async function listSickLeaveForLinkingAction(
	employeeId: string,
): Promise<ServerActionResult<LinkableSickLeave[]>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(employeeId)) {
			return { success: false, error: NOT_FOUND };
		}
		const absences = await listLinkableSickLeave(db, current.access, employeeId);
		if (!absences) return { success: false, error: NOT_FOUND };
		return { success: true, data: absences };
	} catch (error) {
		return failure(error, "Failed to load sick leave");
	}
}
