import { describe, expect, it } from "vitest";

import { toScheduleXLocale } from "./schedule-x-locale";

describe("toScheduleXLocale", () => {
	it("maps app language codes to Schedule-X supported locale identifiers", () => {
		expect(toScheduleXLocale("de")).toBe("de-DE");
		expect(toScheduleXLocale("en")).toBe("en-US");
		expect(toScheduleXLocale("es")).toBe("es-ES");
		expect(toScheduleXLocale("fr")).toBe("fr-FR");
		expect(toScheduleXLocale("it")).toBe("it-IT");
		expect(toScheduleXLocale("pt")).toBe("pt-BR");
	});

	it("falls back to en-US for unsupported or missing languages", () => {
		expect(toScheduleXLocale(undefined)).toBe("en-US");
		expect(toScheduleXLocale("ab")).toBe("en-US");
	});
});
