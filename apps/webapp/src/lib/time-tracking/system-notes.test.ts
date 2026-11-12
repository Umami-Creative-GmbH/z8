import { describe, expect, it } from "vitest";
import { BREAK_ENFORCEMENT_NOTE, displayEntryNotes, systemNoteOf } from "./system-notes";

const german = (key: string, fallback: string) =>
	key === "timeTracking.systemNote.breakEnforcement"
		? "Automatisch angepasst: Pausendurchsetzung"
		: fallback;

describe("system notes", () => {
	it("recognizes the break enforcement token and the English text stored before it", () => {
		expect(systemNoteOf(BREAK_ENFORCEMENT_NOTE)).toBe("break_enforcement");
		expect(systemNoteOf("Auto-adjusted: break enforcement")).toBe("break_enforcement");
		expect(systemNoteOf("Client meeting")).toBeNull();
		expect(systemNoteOf(null)).toBeNull();
	});

	it("shows a system note in the viewer's language and a person's notes as written", () => {
		expect(displayEntryNotes(BREAK_ENFORCEMENT_NOTE, german)).toBe(
			"Automatisch angepasst: Pausendurchsetzung",
		);
		expect(displayEntryNotes("Auto-adjusted: break enforcement", german)).toBe(
			"Automatisch angepasst: Pausendurchsetzung",
		);
		expect(displayEntryNotes("Client meeting", german)).toBe("Client meeting");
		expect(displayEntryNotes(null, german)).toBeNull();
	});
});
