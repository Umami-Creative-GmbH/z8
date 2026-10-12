import type { SickNoteAttachRefusal } from "./access";
import type { SickNoteLinkRefusal } from "./sick-note-link";

/**
 * Why a sick note may not be attached to, or linked to, an absence (#982,
 * #984), in the words the upload route, the staged sick notes and the link
 * actions answer with. An absence the actor may not act on reads as not found.
 */
export const SICK_NOTE_REFUSAL_MESSAGES: Readonly<
	Record<SickNoteAttachRefusal | SickNoteLinkRefusal, string>
> = {
	setting_off: "Your organization does not let employees attach sick notes.",
	not_own: "Absence not found",
	not_managed: "Absence not found",
	not_sick: "Sick notes can be attached only to sick leave.",
	rejected: "Sick notes cannot be attached to a rejected absence.",
	not_sick_note: "Only sick notes can be linked to an absence.",
	already_linked: "This sick note is linked to another absence. Unlink it first.",
	other_employee: "The sick note and the absence belong to different employees.",
};
