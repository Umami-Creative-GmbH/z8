import { describe, expect, it } from "vitest";
import { formatAbsenceDateRange as formatRange } from "./sick-note-labels";

// ICU separates range parts with thin or narrow spaces; compare plain spaces.
const formatAbsenceDateRange = (start: string, end: string, locale: string) =>
	formatRange(start, end, locale).replace(/\s/gu, " ");

describe("formatAbsenceDateRange", () => {
	it("formats a range in the locale", () => {
		// ICU versions differ on spaces around the dash.
		expect(formatAbsenceDateRange("2026-10-12", "2026-10-14", "en-GB")).toMatch(
			/^12\s?–\s?14 Oct 2026$/,
		);
		expect(formatAbsenceDateRange("2026-10-12", "2026-10-14", "de")).toMatch(
			/^12\.\s?–\s?14\. Okt\. 2026$/,
		);
	});

	it("formats a single day once", () => {
		expect(formatAbsenceDateRange("2026-10-12", "2026-10-12", "en-GB")).toBe("12 Oct 2026");
	});

	it("keeps the plain days whatever the host timezone", () => {
		expect(formatAbsenceDateRange("2026-12-31", "2027-01-01", "en-GB")).toBe(
			"31 Dec 2026 – 1 Jan 2027",
		);
	});
});
