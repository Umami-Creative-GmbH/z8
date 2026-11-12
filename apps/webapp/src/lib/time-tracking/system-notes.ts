/**
 * Notes the system writes on time entries it creates. They are stored as a
 * language-neutral token and translated where they are shown, so a stored note never
 * fixes the viewer's language.
 */

/** The note on the break entries automatic break enforcement inserts. */
export const BREAK_ENFORCEMENT_NOTE = "z8:system-note:break-enforcement";

/** What break enforcement stored before the token; existing entries still carry it. */
const LEGACY_BREAK_ENFORCEMENT_NOTE = "Auto-adjusted: break enforcement";

export type SystemNote = "break_enforcement";

/** The system note an entry's notes hold, or null for notes a person wrote. */
export function systemNoteOf(notes: string | null | undefined): SystemNote | null {
	const trimmed = notes?.trim();
	if (trimmed === BREAK_ENFORCEMENT_NOTE || trimmed === LEGACY_BREAK_ENFORCEMENT_NOTE) {
		return "break_enforcement";
	}
	return null;
}

type Translate = (key: string, defaultValue: string) => string;

/** Entry notes for display: a system note translated, a person's notes as written. */
export function displayEntryNotes(notes: string | null | undefined, t: Translate): string | null {
	if (!notes) return null;
	switch (systemNoteOf(notes)) {
		case "break_enforcement":
			return t("timeTracking.systemNote.breakEnforcement", "Auto-adjusted: break enforcement");
		default:
			return notes;
	}
}
