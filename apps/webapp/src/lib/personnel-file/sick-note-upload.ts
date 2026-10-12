import "server-only";
import { z } from "zod";
import type { db as appDb } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { createLogger } from "@/lib/logger";
import { sanitizeTusFileKey } from "@/lib/upload/tus-ownership";
import type { PersonnelFileAccess } from "./access";
import { MAX_STAGED_SICK_NOTES } from "./document.types";
import { validateDocumentMetadata } from "./document-rules";
import type { EmployeeDocumentView } from "./document-store";
import { recordUploadedPersonnelDocument, uploadNotRecorded } from "./document-upload";
import { notifyEmployeeUpload } from "./notifications";
import { loadSickNoteAttachTarget, type RecorderSickNoteGrant } from "./sick-note-attach";
import { SICK_NOTE_REFUSAL_MESSAGES } from "./sick-note-refusals";
import { deleteTusUpload } from "./storage";

/**
 * Sick notes staged with an absence that does not exist yet (#983, #984, ADR
 * 0002): the client uploads each file over TUS first and sends the finished
 * upload keys with the absence request or the on-behalf recording.
 * `createAbsenceWithStagedSickNotes` creates the absence and then records each
 * file as a sick note linked to it; whatever is not recorded is discarded. A
 * staged file therefore ends recorded, discarded, or in the upload ledger
 * cleanup.
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

/** An absence created with staged sick notes, and what became of them. */
export interface AbsenceWithSickNotes {
	absenceId: string;
	/** What became of the staged sick notes; absent when none came along. */
	sickNotes?: { attached: number; failed: SickNoteAttachFailure[] };
}

const NOT_ALLOWED = "Sick notes cannot be attached here.";
const PROCESSING_FAILED = "Processing failed";

function displayName(note: Pick<StagedSickNoteInput, "fileName">): string {
	return note.fileName?.trim() || "file";
}

/** Every staged note failed with the same error. */
function allFailed(
	notes: readonly StagedSickNoteInput[],
	error: string,
): NonNullable<AbsenceWithSickNotes["sickNotes"]> {
	return { attached: 0, failed: notes.map((note) => ({ fileName: displayName(note), error })) };
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

/** Bounds the deletes a refused payload can cause; a real dialog sends at most 10. */
const MAX_DISCARDED_FROM_REFUSED_PAYLOAD = 5 * MAX_STAGED_SICK_NOTES;

/**
 * Deletes what can be told apart as the user's own staged uploads in a payload
 * that was refused as malformed (too many notes, a bad field): every entry's
 * `tusFileKey` that names a finished upload of theirs. Anyone else's key, and
 * anything that is no key, is left alone.
 */
async function discardRefusedStagedSickNotes(userId: string, payload: unknown): Promise<void> {
	if (!Array.isArray(payload)) return;
	const notes = payload
		.slice(0, MAX_DISCARDED_FROM_REFUSED_PAYLOAD)
		.flatMap((entry: unknown) =>
			typeof entry === "object" &&
			entry !== null &&
			"tusFileKey" in entry &&
			typeof entry.tusFileKey === "string"
				? [{ tusFileKey: entry.tusFileKey }]
				: [],
		);
	await discardStagedSickNotes(userId, notes);
}

/**
 * On whose authority the staged notes are attached to the absence just
 * created, by whom (`access`), into whose personnel file.
 */
export type StagedSickNotesAttacher =
	/** The employee to their own sick leave (#983), into their own file. */
	| { authority: "employee"; access: PersonnelFileAccess }
	/** Whoever recorded the sick leave for the employee (#984), named to the officers. */
	| {
			authority: "recorder";
			access: PersonnelFileAccess;
			employeeId: string;
			uploaderName: string;
	  };

/**
 * Creates an absence with the sick notes staged for it (#983 request, #984
 * recording). The absence is created exactly as without notes; only then is
 * each staged upload attached as a sick note, with the same rules as
 * attaching one later. Whatever happens, no staged upload of the signed-in
 * user is left behind:
 * - a malformed payload creates nothing and deletes their uploads in it;
 * - a failed create stores nothing and deletes the uploads;
 * - notes that may not be attached at all (`attacher` is null: personnel
 *   files off, no own employee profile) or fail unexpectedly keep the absence
 *   and are deleted and reported by file name.
 *
 * The recorder's authority exists only here: it is granted for the absence
 * `create` has just returned, and for no other.
 */
export async function createAbsenceWithStagedSickNotes(
	database: Database,
	input: {
		/** The signed-in user: the staged uploads are theirs. Null when nobody is. */
		userId: string | null;
		/** As the client sent it. */
		stagedSickNotes: unknown;
		/** Creates the absence, exactly as without sick notes. */
		create: () => Promise<ServerActionResult<{ absenceId: string }>>;
		/** Who attaches the notes, once the absence exists; null when nobody may. */
		attacher: () => Promise<StagedSickNotesAttacher | null>;
	},
): Promise<ServerActionResult<AbsenceWithSickNotes>> {
	const { userId } = input;
	const notes = parseStagedSickNotes(input.stagedSickNotes);
	if (!notes) {
		if (userId) await discardRefusedStagedSickNotes(userId, input.stagedSickNotes);
		return { success: false, error: "Invalid sick notes", code: "ValidationError" };
	}
	if (notes.length === 0) return input.create();
	if (!userId) {
		return { success: false, error: "Authentication required", code: "AuthenticationError" };
	}

	const created = await input.create();
	if (!created.success) {
		await discardStagedSickNotes(userId, notes);
		return created;
	}
	const { absenceId } = created.data;

	try {
		const attacher = await input.attacher();
		if (!attacher || attacher.access.userId !== userId) {
			await discardStagedSickNotes(userId, notes);
			return { success: true, data: { absenceId, sickNotes: allFailed(notes, NOT_ALLOWED) } };
		}
		const result =
			attacher.authority === "recorder"
				? await attachStagedSickNotes(database, {
						access: attacher.access,
						absenceId,
						employeeId: attacher.employeeId,
						notes,
						authority: recorderGrantFor(absenceId),
						uploaderName: attacher.uploaderName,
					})
				: attacher.access.selfEmployeeId
					? await attachStagedSickNotes(database, {
							access: attacher.access,
							absenceId,
							employeeId: attacher.access.selfEmployeeId,
							notes,
							authority: "employee",
						})
					: null;
		if (!result) {
			await discardStagedSickNotes(userId, notes);
			return { success: true, data: { absenceId, sickNotes: allFailed(notes, NOT_ALLOWED) } };
		}
		return {
			success: true,
			data: { absenceId, sickNotes: { attached: result.attached.length, failed: result.failed } },
		};
	} catch (error) {
		// The absence exists either way; the notes can be attached later.
		logger.error({ error, absenceId }, "Failed to attach staged sick notes");
		await discardStagedSickNotes(userId, notes).catch(() => undefined);
		return { success: true, data: { absenceId, sickNotes: allFailed(notes, PROCESSING_FAILED) } };
	}
}

/** The recorder's grant for the absence just recorded; see `RecorderSickNoteGrant`. */
function recorderGrantFor(absenceId: string): RecorderSickNoteGrant {
	return { kind: "recorder", absenceId } as RecorderSickNoteGrant;
}

interface AttachStagedSickNotesResult {
	attached: EmployeeDocumentView[];
	failed: SickNoteAttachFailure[];
}

/**
 * Records each staged upload as a sick note linked to the absence, one after
 * another, with the same rules, sick-detail switch, audit and notification as
 * attaching one later (#982). A note that fails is reported with its file name
 * and never undoes the absence or the notes before it. Either way the notes
 * are shared, so the employee sees them, and the covering officers are
 * notified; a recorder is named in the notification.
 */
async function attachStagedSickNotes(
	database: Database,
	input: {
		access: PersonnelFileAccess;
		absenceId: string;
		/** The absence's employee: the personnel file the notes go into. */
		employeeId: string;
		notes: readonly StagedSickNoteInput[];
		authority: "employee" | RecorderSickNoteGrant;
		/** The recorder's name for the officers' notification. */
		uploaderName?: string;
	},
): Promise<AttachStagedSickNotesResult> {
	const { access } = input;
	const recorder = input.authority !== "employee";
	const result: AttachStagedSickNotesResult = { attached: [], failed: [] };

	const target = await loadSickNoteAttachTarget(database, access, input.absenceId, input.authority);
	if (target.kind !== "ok" || target.absence.employeeId !== input.employeeId) {
		await discardStagedSickNotes(access.userId, input.notes);
		const error = SICK_NOTE_REFUSAL_MESSAGES[target.kind === "refused" ? target.reason : "not_own"];
		result.failed = allFailed(input.notes, error).failed;
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
				source: recorder ? "recorder" : "employee",
				sickNote: { absenceId: input.absenceId, authority: input.authority },
			});
			if (recorded.kind !== "recorded") {
				await discardStagedSickNotes(access.userId, [note]);
				failure(uploadNotRecorded(recorded).error);
				continue;
			}
			result.attached.push(recorded.document);
			await notifyEmployeeUpload(database, {
				organizationId: access.organizationId,
				document: recorded.document,
				...(recorder
					? { uploader: { userId: access.userId, name: input.uploaderName ?? "" } }
					: {}),
			});
		} catch (error) {
			logger.error({ error, absenceId: input.absenceId }, "Failed to attach a staged sick note");
			await discardStagedSickNotes(access.userId, [note]).catch(() => undefined);
			failure(PROCESSING_FAILED);
		}
	}
	return result;
}
