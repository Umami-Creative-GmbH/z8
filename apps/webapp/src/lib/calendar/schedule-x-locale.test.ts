import { describe, expect, it } from "vitest";

import { toScheduleXLocale } from "./schedule-x-locale";

describe("toScheduleXLocale", () => {
	it.each([
		["en", "en-US"],
		["de", "de-DE"],
		["fr", "fr-FR"],
		["es", "es-ES"],
		["it", "it-IT"],
		["pt", "pt-BR"],
		["pl", "pl-PL"],
		["tr", "tr-TR"],
		["no", "nb-NO"],
		["sv", "sv-SE"],
		["ro", "ro-RO"],
		["hr", "hr-HR"],
		["uk", "uk-UA"],
		["ru", "ru-RU"],
	])("maps %s to its Schedule-X locale %s", (language, locale) => {
		expect(toScheduleXLocale(language)).toBe(locale);
	});

	it.each([
		// Swiss German writes dates in Standard German.
		["gsw", "de-DE"],
		// Bosnian readers share Croatian's Latin script and ijekavian forms.
		["bs", "hr-HR"],
		// Schedule-X has no Greek or Albanian; British English keeps day-month order.
		["el", "en-GB"],
		["sq", "en-GB"],
	])("uses the documented fallback for %s: %s", (language, locale) => {
		expect(toScheduleXLocale(language)).toBe(locale);
	});

	it("falls back to en-US for unsupported or missing languages", () => {
		expect(toScheduleXLocale(undefined)).toBe("en-US");
		expect(toScheduleXLocale("ab")).toBe("en-US");
	});
});
