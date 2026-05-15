import { describe, expect, it, vi } from "vitest";
import {
	getAbsenceCategoryDisplayDescription,
	getAbsenceCategoryDisplayName,
} from "./category-display";

const t = vi.fn((key: string, fallback: string) => `${key}:${fallback}`);

describe("absence category display helpers", () => {
	it("uses app translations for built-in category names", () => {
		expect(
			getAbsenceCategoryDisplayName(
				{
					type: "vacation",
					name: "Vacation",
					nameTranslations: { de: "Urlaub custom" },
				},
				"de",
				t,
			),
		).toBe("settings.absenceCategories.defaults.vacation.name:Vacation");
	});

	it("uses custom category translations for the active locale", () => {
		expect(
			getAbsenceCategoryDisplayName(
				{
					type: "custom",
					name: "Training",
					nameTranslations: { de: "Schulung" },
				},
				"de",
				t,
			),
		).toBe("Schulung");
	});

	it("falls back to canonical custom category values", () => {
		expect(
			getAbsenceCategoryDisplayName(
				{ type: "custom", name: "Training", nameTranslations: { fr: "Formation" } },
				"de",
				t,
			),
		).toBe("Training");
	});

	it("uses app translations for built-in descriptions", () => {
		expect(
			getAbsenceCategoryDisplayDescription(
				{
					type: "sick",
					description: "Sick day",
					descriptionTranslations: { de: "Krankheit custom" },
				},
				"de",
				t,
			),
		).toBe("settings.absenceCategories.defaults.sick.description:Sick day");
	});

	it("uses custom category description translations without canonical descriptions", () => {
		expect(
			getAbsenceCategoryDisplayDescription(
				{
					type: "custom",
					description: null,
					descriptionTranslations: { de: "Weiterbildungstag" },
				},
				"de",
				t,
			),
		).toBe("Weiterbildungstag");
	});

	it("returns null when no description exists", () => {
		expect(
			getAbsenceCategoryDisplayDescription(
				{ type: "custom", description: null, descriptionTranslations: { de: "" } },
				"de",
				t,
			),
		).toBeNull();
	});
});
