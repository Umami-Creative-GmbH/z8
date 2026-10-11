import { describe, expect, it } from "vitest";

import { dayPickerLocaleFor } from "./calendar-locale";

describe("dayPickerLocaleFor", () => {
	it.each([
		["en", "en-US"],
		["de", "de"],
		["el", "el"],
		["no", "nb"],
		["sv", "sv"],
		["ro", "ro"],
		["hr", "hr"],
		["bs", "bs"],
		["sq", "sq"],
		["uk", "uk"],
		["ru", "ru"],
	])("maps %s to the %s DayPicker locale", (language, code) => {
		expect(dayPickerLocaleFor(language).code).toBe(code);
	});

	it("writes Swiss German dates in Standard German", () => {
		expect(dayPickerLocaleFor("gsw").code).toBe("de");
	});

	it("falls back to US English for unknown languages", () => {
		expect(dayPickerLocaleFor("ab").code).toBe("en-US");
	});
});
