"use server";

import { db } from "@/db";
import { loadAbsenceSettings } from "@/lib/absences/absence-settings";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import {
	type AbsenceSickNoteView,
	countSickNotesForAbsences,
	listAbsenceSickNotes,
	type SickNoteMarker,
} from "@/lib/personnel-file/sick-note-store";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

/**
 * Sick notes on the employee's own absences (#982, Personnel File ADR 0002).
 * Everything goes through personnel file access: without it (personnel files
 * off, a former employee) there is nothing to attach or open.
 */

const MAX_ABSENCES = 500;

export interface OwnAbsenceSickNotes {
	/**
	 * The employee may attach sick notes to their pending or approved sick
	 * leave: the organization allows it and personnel files are on.
	 */
	canAttach: boolean;
	markers: Record<string, SickNoteMarker>;
}

export async function getOwnAbsenceSickNotesAction(
	absenceIds: readonly string[],
): Promise<ServerActionResult<OwnAbsenceSickNotes>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !current.access.selfEmployeeId) {
			return { success: true, data: { canAttach: false, markers: {} } };
		}
		const { access } = current;
		const ids = (Array.isArray(absenceIds) ? absenceIds : [])
			.filter(isCanonicalUuid)
			.slice(0, MAX_ABSENCES);
		const [settings, markers] = await Promise.all([
			loadAbsenceSettings(db, access.organizationId),
			countSickNotesForAbsences(db, {
				organizationId: access.organizationId,
				absenceIds: ids,
				access,
			}),
		]);
		return {
			success: true,
			data: {
				canAttach: settings.employeeSickNoteUpload,
				markers: Object.fromEntries(markers),
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to load sick notes of own absences");
		return { success: false, error: "Failed to load sick notes" };
	}
}

/** The sick notes of one absence the signed-in user may open. */
export async function listAbsenceSickNotesAction(
	absenceId: string,
): Promise<ServerActionResult<AbsenceSickNoteView[]>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(absenceId)) {
			return { success: true, data: [] };
		}
		return { success: true, data: await listAbsenceSickNotes(db, current.access, absenceId) };
	} catch (error) {
		logger.error({ error }, "Failed to load the sick notes of an absence");
		return { success: false, error: "Failed to load sick notes" };
	}
}
