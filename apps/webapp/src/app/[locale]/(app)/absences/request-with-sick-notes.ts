import "server-only";
import { db } from "@/db";
import type { AbsenceRequest } from "@/lib/absences/types";
import { getRequestSession } from "@/lib/auth/request-session";
import type { ServerActionResult } from "@/lib/effect/result";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import {
	type AbsenceWithSickNotes,
	createAbsenceWithStagedSickNotes,
} from "@/lib/personnel-file/sick-note-upload";
import { requestAbsenceEffect } from "./request-absence-effect";

/**
 * Requests an absence with sick notes staged in the request dialog (#983,
 * Personnel File ADR 0002): the absence is requested exactly as without notes,
 * then each staged upload is attached on the employee's own authority, with
 * the same rules as attaching one later (see `createAbsenceWithStagedSickNotes`).
 */
export async function requestAbsenceWithSickNotes(
	data: AbsenceRequest,
	stagedSickNotes: unknown,
): Promise<ServerActionResult<AbsenceWithSickNotes>> {
	const session = await getRequestSession();
	return createAbsenceWithStagedSickNotes(db, {
		userId: session?.user?.id ?? null,
		stagedSickNotes,
		create: () => requestAbsenceEffect(data),
		attacher: async () => {
			const current = await loadCurrentPersonnelFileAccess();
			return current.status === "resolved"
				? { authority: "employee", access: current.access }
				: null;
		},
	});
}
