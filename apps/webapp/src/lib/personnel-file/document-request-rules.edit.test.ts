import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { validateDocumentRequestEdit } from "./document-request-rules";

const today = Temporal.PlainDate.from("2026-10-18");
const current = { deadline: "2026-10-10", note: "Old note" };

describe("validateDocumentRequestEdit", () => {
	it("returns only what changes: a new deadline and a trimmed note", () => {
		expect(
			validateDocumentRequestEdit(current, { deadline: "2026-10-31", note: "  New note " }, today),
		).toEqual({ ok: true, value: { deadline: "2026-10-31", note: "New note" } });
		expect(validateDocumentRequestEdit(current, { note: "" }, today)).toEqual({
			ok: true,
			value: { note: null },
		});
	});

	it("leaves out what stays the same, even an overdue deadline", () => {
		expect(
			validateDocumentRequestEdit(current, { deadline: "2026-10-10", note: "Old note " }, today),
		).toEqual({ ok: true, value: {} });
		expect(validateDocumentRequestEdit(current, {}, today)).toEqual({ ok: true, value: {} });
	});

	it("accepts today, refuses a new deadline before it and anything that is not a day", () => {
		expect(validateDocumentRequestEdit(current, { deadline: "2026-10-18" }, today)).toEqual({
			ok: true,
			value: { deadline: "2026-10-18" },
		});
		expect(validateDocumentRequestEdit(current, { deadline: "2026-10-17" }, today)).toEqual({
			ok: false,
			reason: "deadline_in_past",
		});
		for (const deadline of ["", "31.10.2026", 20261031, null]) {
			expect(validateDocumentRequestEdit(current, { deadline }, today)).toEqual({
				ok: false,
				reason: "invalid_deadline",
			});
		}
	});

	it("refuses a note that is too long or not text", () => {
		for (const note of ["x".repeat(2001), 42]) {
			expect(validateDocumentRequestEdit(current, { note }, today)).toEqual({
				ok: false,
				reason: "invalid_note",
			});
		}
	});
});
