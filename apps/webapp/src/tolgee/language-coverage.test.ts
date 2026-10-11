import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DAY_PICKER_LOCALES } from "@/components/ui/calendar-locale";
import { SCHEDULE_X_LOCALES } from "@/lib/calendar/schedule-x-locale";
import { LANGUAGE_CONFIG } from "@/lib/language-config";
import { TELEGRAM_LANGUAGE_BUTTONS } from "@/lib/telegram/language-buttons";
import { ALL_LANGUAGES } from "./shared";

// Adding a UI language means editing ALL_LANGUAGES, LANGUAGE_CONFIG, the calendar maps
// and the Tolgee push list; this guard names whichever one was missed.
const tolgeeConfig = createRequire(import.meta.url)(join(process.cwd(), "tolgee.config.cjs")) as {
	push: { language: string[] };
};

describe("UI language coverage", () => {
	it("supports exactly the agreed UI languages", () => {
		expect(ALL_LANGUAGES).toEqual([
			"en",
			"de",
			"fr",
			"es",
			"it",
			"pt",
			"el",
			"pl",
			"tr",
			"gsw",
			"no",
			"sv",
		]);
	});

	it("pushes every UI language to Tolgee", () => {
		expect(tolgeeConfig.push.language).toEqual(ALL_LANGUAGES);
	});

	it.each(ALL_LANGUAGES)("names %s and offers it on the Telegram keyboard", (language) => {
		expect(LANGUAGE_CONFIG[language]?.name, language).toEqual(expect.any(String));
		expect(TELEGRAM_LANGUAGE_BUTTONS.map((button) => button.code)).toContain(language);
	});

	it.each(ALL_LANGUAGES)("maps %s to a DayPicker and a Schedule-X locale", (language) => {
		expect(Object.hasOwn(DAY_PICKER_LOCALES, language), `DayPicker: ${language}`).toBe(true);
		expect(Object.hasOwn(SCHEDULE_X_LOCALES, language), `Schedule-X: ${language}`).toBe(true);
	});
});
