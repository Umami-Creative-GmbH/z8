import "server-only";
import { db } from "@/db";
import type { AbsenceRequest } from "@/lib/absences/types";
import { getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import {
	attachStagedSickNotes,
	discardStagedSickNotes,
	parseStagedSickNotes,
	type SickNoteAttachFailure,
} from "@/lib/personnel-file/sick-note-upload";
import { requestAbsenceEffect } from "./request-absence-effect";

export interface RequestedAbsence {
	absenceId: string;
	/** What became of the staged sick notes (#983); absent when none came along. */
	sickNotes?: { attached: number; failed: SickNoteAttachFailure[] };
}

const NOT_ALLOWED = "Sick notes cannot be attached here.";

/**
 * Requests an absence with sick notes staged in the request dialog (#983,
 * Personnel File ADR 0002). The absence is created first, exactly as without
 * notes; only then is each staged upload attached as a sick note, with the
 * same rules as attaching one later. A failed request stores nothing and
 * discards the uploads. A note that fails afterwards keeps the absence and is
 * reported by its file name, and notes that may not be attached at all (the
 * setting is off, personnel files are off, not sick leave) are discarded and
 * reported the same way.
 */
export async function requestAbsenceWithSickNotes(
	data: AbsenceRequest,
	stagedSickNotes: unknown,
): Promise<ServerActionResult<RequestedAbsence>> {
	const notes = parseStagedSickNotes(stagedSickNotes);
	if (!notes) return { success: false, error: "Invalid sick notes" };
	if (notes.length === 0) return requestAbsenceEffect(data);

	const authContext = await getAuthContext();
	if (!authContext) return { success: false, error: "Unauthorized" };
	const userId = authContext.user.id;

	const result = await requestAbsenceEffect(data);
	if (!result.success) {
		await discardStagedSickNotes(userId, notes);
		return result;
	}

	const current = await loadCurrentPersonnelFileAccess();
	const access = current.status === "resolved" ? current.access : null;
	if (!access?.selfEmployeeId) {
		await discardStagedSickNotes(userId, notes);
		return {
			success: true,
			data: {
				absenceId: result.data.absenceId,
				sickNotes: {
					attached: 0,
					failed: notes.map((note) => ({
						fileName: note.fileName?.trim() || "file",
						error: NOT_ALLOWED,
					})),
				},
			},
		};
	}

	const attached = await attachStagedSickNotes(db, {
		access,
		absenceId: result.data.absenceId,
		employeeId: access.selfEmployeeId,
		notes,
		authority: "employee",
	});
	return {
		success: true,
		data: {
			absenceId: result.data.absenceId,
			sickNotes: { attached: attached.attached.length, failed: attached.failed },
		},
	};
}
