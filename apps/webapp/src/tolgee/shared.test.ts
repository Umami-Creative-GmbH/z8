import { describe, expect, it } from "vitest";
import { loadRouteTranslations } from "./shared";

describe("Tolgee route translations", () => {
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
