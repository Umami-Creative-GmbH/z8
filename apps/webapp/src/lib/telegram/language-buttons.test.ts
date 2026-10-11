import { describe, expect, it } from "vitest";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import { TELEGRAM_LANGUAGE_BUTTONS, telegramLanguageLabel } from "./language-buttons";

describe("Telegram /language keyboard", () => {
	it("offers every app language in the shared order", () => {
		expect(TELEGRAM_LANGUAGE_BUTTONS.map((button) => button.code)).toEqual(ALL_LANGUAGES);
	});

	it.each([
		["de", "🇩🇪 Deutsch"],
		["en", "🇬🇧 English"],
		["gsw", "🇨🇭 Schweizerdeutsch"],
		["no", "🇳🇴 Norsk"],
		["sv", "🇸🇪 Svenska"],
		["ro", "🇷🇴 Română"],
		["hr", "🇭🇷 Hrvatski"],
		["bs", "🇧🇦 Bosanski"],
		["sq", "🇦🇱 Shqip"],
		["uk", "🇺🇦 Українська"],
	])("labels %s with its flag and native name", (code, label) => {
		expect(telegramLanguageLabel(code)).toBe(label);
	});

	it("labels Russian without a country flag", () => {
		expect(telegramLanguageLabel("ru")).toBe("🌐 Русский");
	});

	it("falls back to the code for an unknown language", () => {
		expect(telegramLanguageLabel("xx")).toBe("xx");
	});
});
