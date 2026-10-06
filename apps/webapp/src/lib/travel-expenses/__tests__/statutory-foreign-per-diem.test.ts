import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	BMF_FOREIGN_PER_DIEM_2026,
	findForeignCountry,
	foreignPerDiemTableCovering,
	foreignRatesOf,
	foreignTableRates,
} from "../statutory-foreign-per-diem";

/*
 * The 2026 table is checked against the published rows of the BMF letter of
 * 05.12.2025 (LStH 2026, Anhang 25 I), kept verbatim in the fixture, and
 * spot-checked against values read from the official page.
 */

interface SourceRow {
	label: string;
	fullDay: number;
	partialDay: number;
	places: { label: string; fullDay: number; partialDay: number }[];
}

function sourceRows(): SourceRow[] {
	const text = readFileSync(join(__dirname, "fixtures", "bmf-2026-foreign-per-diem.txt"), "utf8");
	const rows: SourceRow[] = [];
	for (const line of text.split(/\r?\n/)) {
		if (line.trim() === "" || line.startsWith("#")) continue;
		const [label = "", full, partial] = line.split("|").map((part) => part.trim());
		if (line.startsWith("  ")) {
			const country = rows.at(-1);
			if (!country) throw new Error(`place without country: ${line}`);
			if (label === "im Übrigen") {
				country.fullDay = Number(full);
				country.partialDay = Number(partial);
			} else country.places.push({ label, fullDay: Number(full), partialDay: Number(partial) });
			continue;
		}
		rows.push({ label, fullDay: Number(full), partialDay: Number(partial), places: [] });
	}
	return rows;
}

const euros = (value: number) => `${value}.00`;

describe("BMF foreign per diem table 2026", () => {
	it("contains every published country and place with its published amounts", () => {
		const rows = sourceRows();
		expect(rows).toHaveLength(166);
		expect(BMF_FOREIGN_PER_DIEM_2026.countries).toHaveLength(rows.length);
		BMF_FOREIGN_PER_DIEM_2026.countries.forEach((country, index) => {
			const row = rows[index];
			expect(country.label).toBe(row?.label);
			expect([country.fullDay, country.partialDay]).toEqual([
				euros(row?.fullDay ?? Number.NaN),
				euros(row?.partialDay ?? Number.NaN),
			]);
			expect(country.places.map((place) => [place.label, place.fullDay, place.partialDay])).toEqual(
				(row?.places ?? []).map((place) => [
					place.label,
					euros(place.fullDay),
					euros(place.partialDay),
				]),
			);
		});
		expect(
			BMF_FOREIGN_PER_DIEM_2026.countries.reduce((sum, country) => sum + country.places.length, 0),
		).toBe(48);
	});

	it.each([
		// [ISO code, place, 24 hours, arrival/departure or more than 8 hours] as read on the BMF page
		["EG", null, "50.00", "33.00"],
		["DK", null, "75.00", "50.00"],
		["FR", null, "53.00", "36.00"],
		["FR", "paris", "58.00", "39.00"],
		["US", "new-york-city", "66.00", "44.00"],
		["US", "washington-dc", "66.00", "44.00"],
		["US", null, "59.00", "40.00"],
		["CH", "bern", "82.00", "55.00"],
		["CN", "hongkong", "83.00", "56.00"],
		["IN", null, "22.00", "15.00"],
		["GB", "london", "66.00", "44.00"],
		["LU", null, "63.00", "42.00"],
		["AT", null, "50.00", "33.00"],
		["XK", null, "24.00", "16.00"],
		["BY", null, "21.00", "14.00"],
		["ES", "kanarische-inseln", "36.00", "24.00"],
	])("lists %s %s at %s / %s EUR", (code, place, fullDay, partialDay) => {
		const country = findForeignCountry(BMF_FOREIGN_PER_DIEM_2026, code);
		const entry = place ? country?.places.find((candidate) => candidate.key === place) : country;
		expect(entry).toMatchObject({ fullDay, partialDay });
	});

	it("is dated to the 2026 edition with its official sources", () => {
		expect(BMF_FOREIGN_PER_DIEM_2026).toMatchObject({
			currency: "EUR",
			validFrom: "2026-01-01",
			validThrough: "2026-12-31",
			version: "LStH 2026, Anhang 25 I",
		});
		expect(BMF_FOREIGN_PER_DIEM_2026.sources.map((source) => source.url)).toContain(
			"https://lsth.bundesfinanzministerium.de/lsth/2026/B-Anhaenge/Anhang-25/I/inhalt.html",
		);
		expect(foreignPerDiemTableCovering(["2026-01-01", "2026-12-31"])).toBe(
			BMF_FOREIGN_PER_DIEM_2026,
		);
		expect(foreignPerDiemTableCovering(["2026-12-31", "2027-01-01"])).toBeNull();
		expect(foreignPerDiemTableCovering(["2025-12-31"])).toBeNull();
	});

	it("deducts 20 / 40 percent of the full-day amount for provided meals (Satz 8)", () => {
		// BMF example (Anhang 25 I): breakfast reduces the Copenhagen allowance by 15 € (20 % of 75 €).
		expect(foreignRatesOf({ fullDay: "75.00", partialDay: "50.00" })).toEqual({
			fullDay: "75.00",
			partialDay: "50.00",
			breakfastDeduction: "15.00",
			lunchDeduction: "30.00",
			dinnerDeduction: "30.00",
		});
		const rates = foreignTableRates(BMF_FOREIGN_PER_DIEM_2026);
		expect(rates["FR:paris"]).toEqual({
			fullDay: "58.00",
			partialDay: "39.00",
			breakfastDeduction: "11.60",
			lunchDeduction: "23.20",
			dinnerDeduction: "23.20",
		});
		expect(Object.keys(rates)).toHaveLength(166 + 48);
	});

	it("keeps the official destination rules apart from the listed amounts", () => {
		const { assignedCountries, luxembourgFallback, motherCountries, countries } =
			BMF_FOREIGN_PER_DIEM_2026;
		const listed = new Set(countries.map((country) => country.country));
		expect(assignedCountries.FM).toBe("PH");
		expect(assignedCountries.SR).toBe("TT");
		for (const code of [
			...Object.keys(assignedCountries),
			...luxembourgFallback,
			...Object.keys(motherCountries),
		]) {
			expect(listed.has(code)).toBe(false);
		}
		expect(listed.has("LU")).toBe(true);
		expect(listed.has("DE")).toBe(false);
	});
});
