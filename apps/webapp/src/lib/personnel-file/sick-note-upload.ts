import "server-only";
import { z } from "zod";
import type { db as appDb } from "@/db";
import { createLogger } from "@/lib/logger";
import { sanitizeTusFileKey } from "@/lib/upload/tus-ownership";
import type { PersonnelFileAccess, SickNoteAttachRefusal, SickNoteAuthority } from "./access";
import { MAX_STAGED_SICK_NOTES } from "./document.types";
import { validateDocumentMetadata } from "./document-rules";
import type { EmployeeDocumentView } from "./document-store";
import { recordUploadedPersonnelDocument } from "./document-upload";
import { notifyEmployeeUpload } from "./notifications";
import { loadSickNoteAttachTarget } from "./sick-note-attach";
import { deleteTusUpload } from "./storage";

/**
 * Sick notes staged with an absence that does not exist yet (#983, ADR 0002):
 * the client uploads each file over TUS first and sends the finished upload
 * keys with the absence request (or the on-behalf recording). Once the
 * absence exists, `attachStagedSickNotes` records each file as a sick note
 * linked to it; when it is never created, `discardStagedSickNotes` removes the
 * uploads. A staged file therefore ends recorded, discarded, or in the upload
 * ledger cleanup.
 */

type Database = typeof appDb;

const logger = createLogger("StagedSickNotes");

export interface StagedSickNoteInput {
	/** The finished TUS upload of the actor. */
	tusFileKey: string;
	/** The file's name on the device, shown when it fails. */
	fileName?: string;
	title: string;
	/** YYYY-MM-DD */
	documentDate: string;
}

const stagedSickNotesSchema = z
	.array(
		z.object({
			tusFileKey: z.string().min(1).max(512),
			fileName: z.string().max(255).optional(),
			// Checked per note by the document rules; the bound only keeps payloads small.
			title: z.string().max(1000),
			documentDate: z.string().max(32),
		}),
	)
	.max(MAX_STAGED_SICK_NOTES);

/** The staged sick notes of a request, or null when the payload is malformed. */
export function parseStagedSickNotes(value: unknown): StagedSickNoteInput[] | null {
	const parsed = stagedSickNotesSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export interface SickNoteAttachFailure {
	fileName: string;
	error: string;
}

export interface AttachStagedSickNotesResult {
	attached: EmployeeDocumentView[];
	failed: SickNoteAttachFailure[];
}

const REFUSALS: Record<SickNoteAttachRefusal, string> = {
	setting_off: "Your organization does not let employees attach sick notes.",
	not_own: "Absence not found",
	not_managed: "Absence not found",
	not_sick: "Sick notes can be attached only to sick leave.",
	rejected: "Sick notes cannot be attached to a rejected absence.",
};

function displayName(note: StagedSickNoteInput): string {
	return note.fileName?.trim() || "file";
}

/**
 * Deletes the staged uploads of a request that created no absence, or whose
 * sick notes are not allowed. Only the actor's own uploads are touched.
 */
export async function discardStagedSickNotes(
	userId: string,
	notes: readonly Pick<StagedSickNoteInput, "tusFileKey">[],
): Promise<void> {
	await Promise.all(
		notes.map(async (note) => {
			const key = sanitizeTusFileKey(note.tusFileKey, userId);
			if (key) await deleteTusUpload(key);
		}),
	);
}

/**
 * Records each staged upload as a sick note linked to the absence, one after
 * another, with the same rules, sick-detail switch, audit and notification as
 * attaching one later (#982). A note that fails is reported with its file name
 * and never undoes the absence or the notes before it. The authority decides
 * who may attach: the employee, or whoever records the absence on their
 * behalf (#984, only from inside the recording). Either way the notes are
 * shared, so the employee sees them, and the covering officers are notified;
 * a recorder is named in the notification.
 */
export async function attachStagedSickNotes(
	database: Database,
	input: {
		access: PersonnelFileAccess;
		absenceId: string;
		/** The absence's employee: the personnel file the notes go into. */
		employeeId: string;
		notes: readonly StagedSickNoteInput[];
		authority: Extract<SickNoteAuthority, "employee" | "recorder">;
		/** The recorder's name for the officers' notification (with "recorder"). */
		uploaderName?: string;
	},
): Promise<AttachStagedSickNotesResult> {
	const { access } = input;
	const result: AttachStagedSickNotesResult = { attached: [], failed: [] };
	if (input.notes.length === 0) return result;

	const target = await loadSickNoteAttachTarget(database, access, input.absenceId, input.authority);
	if (target.kind !== "ok" || target.absence.employeeId !== input.employeeId) {
		await discardStagedSickNotes(access.userId, input.notes);
		const error = target.kind === "refused" ? REFUSALS[target.reason] : REFUSALS.not_own;
		result.failed = input.notes.map((note) => ({ fileName: displayName(note), error }));
		return result;
	}

	for (const note of input.notes) {
		const failure = (error: string) => {
			result.failed.push({ fileName: displayName(note), error });
		};
		const validated = validateDocumentMetadata({
			category: "sick_note",
			title: note.title,
			documentDate: note.documentDate,
			payPeriod: null,
			// The employee sees notes attached by them or for them; sick notes have no expiry date.
			visibility: "shared",
			expiryDate: null,
		});
		if (!validated.ok) {
			await discardStagedSickNotes(access.userId, [note]);
			failure(validated.message);
			continue;
		}
		try {
			const recorded = await recordUploadedPersonnelDocument(database, {
				access,
				employeeId: input.employeeId,
				tusFileKey: note.tusFileKey,
				fileName: note.fileName,
				metadata: validated.value,
				source: input.authority,
				sickNote: { absenceId: input.absenceId, authority: input.authority },
			});
			if (recorded.kind !== "recorded") {
				await discardStagedSickNotes(access.userId, [note]);
				failure(
					recorded.kind === "unreadable"
						? recorded.error
						: recorded.kind === "invalid_file_key"
							? "Invalid file key"
							: recorded.kind === "absence_unavailable"
								? "This absence can no longer take a sick note."
								: "The upload took too long. Please upload the file again.",
				);
				continue;
			}
			result.attached.push(recorded.document);
			await notifyEmployeeUpload(database, {
				organizationId: access.organizationId,
				document: recorded.document,
				...(input.authority === "recorder"
					? { uploader: { userId: access.userId, name: input.uploaderName ?? "" } }
					: {}),
			});
		} catch (error) {
			logger.error({ error, absenceId: input.absenceId }, "Failed to attach a staged sick note");
			await discardStagedSickNotes(access.userId, [note]).catch(() => undefined);
			failure("Processing failed");
		}
	}
	return result;
}
