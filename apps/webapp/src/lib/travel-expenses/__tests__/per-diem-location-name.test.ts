import { describe, expect, it } from "vitest";
import { perDiemLocationName, perDiemPlaceName } from "../per-diem-location-name";
import { FOREIGN_PER_DIEM_TABLES } from "../statutory-foreign-per-diem";

/** Tolgee without a catalog: the English default with its placeholders filled. */
function english(_key: string, fallback: string, params?: Record<string, string | number>) {
	return fallback.replace(/\{(\w+)\}/g, (match, name: string) =>
		params && name in params ? String(params[name]) : match,
	);
}

const paris = {
	country: "FR",
	place: "paris",
	label: "Frankreich – Paris sowie die Departments 77, 78, 91 bis 95",
};

describe("perDiemLocationName (#681)", () => {
	it("names a listed place in the reader's language", () => {
		expect(perDiemLocationName(paris, "en-US", english)).toBe(
			"France – Paris and departments 77, 78, 91–95",
		);
	});

	it("names the rest of a country with listed places, and countries without places", () => {
		expect(
			perDiemLocationName(
				{ country: "FR", place: null, label: "Frankreich – im Übrigen" },
				"en",
				english,
			),
		).toBe("France – elsewhere");
		expect(
			perDiemLocationName({ country: "DE", place: null, label: "Deutschland" }, "en", english),
		).toBe("Germany");
		expect(
			perDiemLocationName(
				{ country: "CZ", place: null, label: "Tschechische Republik" },
				"en",
				english,
			),
		).toBe("Czechia");
	});

	it("names the country in the reader's locale and the place through its translation key", () => {
		const french: typeof english = (key, fallback, params) =>
			key === "travelExpenses.perDiemPlaces.FR.paris"
				? "Paris et départements 77, 78, 91 à 95"
				: english(key, fallback, params);
		expect(perDiemLocationName(paris, "fr", french)).toBe(
			"France – Paris et départements 77, 78, 91 à 95",
		);
		expect(
			perDiemLocationName({ country: "BE", place: null, label: "Belgien" }, "fr", french),
		).toBe("Belgique");
	});

	it("keeps the official names of the notice for German readers", () => {
		for (const locale of ["de", "de-CH", "gsw"]) {
			expect(perDiemLocationName(paris, locale, english)).toBe(paris.label);
			expect(
				perDiemLocationName(
					{ country: "CZ", place: null, label: "Tschechische Republik" },
					locale,
					english,
				),
			).toBe("Tschechische Republik");
		}
	});
});

describe("perDiemPlaceName (#681)", () => {
	it("translates every place any notice lists", () => {
		for (const table of FOREIGN_PER_DIEM_TABLES) {
			for (const country of table.countries) {
				for (const place of country.places) {
					const keys: string[] = [];
					perDiemPlaceName(country.country, place, "en", (key, fallback) => {
						keys.push(key);
						return fallback;
					});
					expect(keys, `${country.country}:${place.key}`).toEqual([
						`travelExpenses.perDiemPlaces.${country.country}.${place.key}`,
					]);
				}
			}
		}
	});

	it("offers the official place name to German readers", () => {
		const place = { key: "mailand", label: "Mailand" };
		expect(perDiemPlaceName("IT", place, "de", english)).toBe("Mailand");
		expect(perDiemPlaceName("IT", place, "en", english)).toBe("Milan");
	});
});
