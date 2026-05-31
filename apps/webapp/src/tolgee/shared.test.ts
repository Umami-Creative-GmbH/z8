import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGE_CONFIG } from "@/lib/language-config";
import {
	ALL_LANGUAGES,
	ALL_NAMESPACES,
	loadRouteTranslations,
	mergeTreeTranslations,
} from "./shared";

function collectStringValues(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (!value || typeof value !== "object") return [];
	if (Array.isArray(value)) return value.flatMap(collectStringValues);
	return Object.values(value).flatMap(collectStringValues);
}

describe("Tolgee route translations", () => {
	it("lists every language supported by Tolgee and the language switchers", () => {
		expect(ALL_LANGUAGES).toEqual(["en", "de", "fr", "es", "it", "pt", "el", "pl", "tr", "gsw"]);
		expect(Object.keys(LANGUAGE_CONFIG)).toEqual(expect.arrayContaining(ALL_LANGUAGES));
	});

	it("does not keep unnamespaced root locale files", () => {
		for (const locale of ALL_LANGUAGES) {
			expect(existsSync(join(process.cwd(), `messages/${locale}.json`))).toBe(false);
		}
	});

	it("keeps a namespace file for every supported locale", () => {
		for (const namespace of ALL_NAMESPACES) {
			for (const locale of ALL_LANGUAGES) {
				expect(existsSync(join(process.cwd(), `messages/${namespace}/${locale}.json`))).toBe(true);
			}
		}
	});

	it("uses Tolgee argument syntax in approval sprint progress translations", () => {
		for (const locale of ALL_LANGUAGES) {
			const rawMessages = readFileSync(
				join(process.cwd(), `messages/approvals/${locale}.json`),
				"utf8",
			);
			const messages = JSON.parse(rawMessages) as { sprint?: { progress?: string } };

			expect(messages.sprint?.progress).toContain("{current}");
			expect(messages.sprint?.progress).toContain("{total}");
			expect(collectStringValues(messages)).toEqual(
				expect.not.arrayContaining([expect.stringContaining("${")]),
			);
		}
	});

	it("loads app search strings from the common namespace", async () => {
		const translations = await loadRouteTranslations("de", "/");

		expect(translations.de).toMatchObject({
			appSearch: {
				searchOrRunCommand: "Suchen oder Befehl ausführen",
			},
		});
	});

	it("keeps German translations available after navigating from settings to dashboard", async () => {
		const translations = await loadRouteTranslations("de", "/settings");

		expect(translations.de).toMatchObject({
			dashboard: {
				"managed-employees": {
					title: "Ihr Team",
				},
			},
		});
	});

	it("loads dedicated analytics route translations", async () => {
		const translations = await loadRouteTranslations("en", "/analytics/work-hours");

		expect(translations.en).toMatchObject({
			analytics: {
				layout: {
					title: "Analytics",
				},
			},
		});
	});

	it("loads dedicated today route translations", async () => {
		const translations = await loadRouteTranslations("en", "/today");

		expect(translations.en).toMatchObject({
			today: {
				briefing: {
					title: "Manager Daily Briefing",
				},
			},
		});
	});
});

describe("translation namespace merging", () => {
	it("deep merges split settings namespaces without overwriting sibling groups", () => {
		const merged = mergeTreeTranslations([
			{
				settings: {
					enterprise: {
						email: {
							title: "Email Configuration",
						},
					},
				},
			},
			{
				settings: {
					holidays: {
						title: "Holidays",
					},
				},
			},
		]);

		expect(merged).toEqual({
			settings: {
				enterprise: {
					email: {
						title: "Email Configuration",
					},
				},
				holidays: {
					title: "Holidays",
				},
			},
		});
	});
});
