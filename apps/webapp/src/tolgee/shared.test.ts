import { describe, expect, it } from "vitest";
import { mergeTreeTranslations, loadRouteTranslations } from "./shared";

describe("Tolgee route translations", () => {
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
