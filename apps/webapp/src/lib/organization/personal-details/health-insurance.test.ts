import { describe, expect, it } from "vitest";
import {
	INSURER_NAME_MAX_LENGTH,
	parseHealthInsurance,
	pickableStatutoryInsurers,
	type StatutoryInsurerList,
} from "./health-insurance";
import { STATUTORY_HEALTH_INSURERS } from "./statutory-health-insurers";

const LIST: StatutoryInsurerList = {
	source: "test",
	asOf: "2026-11-01",
	insurers: [
		{ name: "Kasse Nord", betriebsnummer: "10000001" },
		{ name: "Kasse Süd", betriebsnummer: "20000002" },
		// Merged into Kasse Nord: stays on the records that picked it, no longer offered.
		{ name: "Kasse West", betriebsnummer: "30000003", removedOn: "2026-01-01" },
	],
};

describe("parseHealthInsurance", () => {
	it("copies the picked statutory insurer's name and Betriebsnummer from the list", () => {
		expect(parseHealthInsurance({ kind: "statutory", betriebsnummer: " 20000002 " }, LIST)).toEqual(
			{
				ok: true,
				value: { kind: "statutory", insurerName: "Kasse Süd", betriebsnummer: "20000002" },
			},
		);
	});

	it("takes the list's name for a picked insurer, whatever name came with the pick", () => {
		expect(
			parseHealthInsurance(
				{ kind: "statutory", betriebsnummer: "10000001", insurerName: "Something else" },
				LIST,
			),
		).toEqual({
			ok: true,
			value: { kind: "statutory", insurerName: "Kasse Nord", betriebsnummer: "10000001" },
		});
	});

	it("refuses an insurer that has left the list for a new pick", () => {
		expect(parseHealthInsurance({ kind: "statutory", betriebsnummer: "30000003" }, LIST)).toEqual({
			ok: false,
			errors: { betriebsnummer: "insurer_removed" },
		});
	});

	it("refuses a Betriebsnummer that is not on the list", () => {
		expect(parseHealthInsurance({ kind: "statutory", betriebsnummer: "99999999" }, LIST)).toEqual({
			ok: false,
			errors: { betriebsnummer: "insurer_unknown" },
		});
	});

	it("records a statutory insurer missing from the list by its typed name, without a Betriebsnummer", () => {
		expect(
			parseHealthInsurance(
				{ kind: "statutory", betriebsnummer: "  ", insurerName: "  Neue BKK  " },
				LIST,
			),
		).toEqual({
			ok: true,
			value: { kind: "statutory", insurerName: "Neue BKK", betriebsnummer: null },
		});
	});

	it("records a private insurer by its typed name, never with a Betriebsnummer", () => {
		expect(
			parseHealthInsurance(
				{ kind: "private", insurerName: " Allianz Private ", betriebsnummer: "10000001" },
				LIST,
			),
		).toEqual({
			ok: true,
			value: { kind: "private", insurerName: "Allianz Private", betriebsnummer: null },
		});
	});

	it.each([
		["statutory", { kind: "statutory" as const, insurerName: "  " }],
		["private", { kind: "private" as const, insurerName: "" }],
		["private", { kind: "private" as const }],
	])("requires a typed name for a %s insurer that was not picked", (_kind, input) => {
		expect(parseHealthInsurance(input, LIST)).toEqual({
			ok: false,
			errors: { insurerName: "insurer_name_required" },
		});
	});

	it("refuses a typed name longer than the limit", () => {
		expect(
			parseHealthInsurance(
				{ kind: "private", insurerName: "x".repeat(INSURER_NAME_MAX_LENGTH + 1) },
				LIST,
			),
		).toEqual({ ok: false, errors: { insurerName: "insurer_name_too_long" } });
		expect(
			parseHealthInsurance(
				{ kind: "private", insurerName: "x".repeat(INSURER_NAME_MAX_LENGTH) },
				LIST,
			).ok,
		).toBe(true);
	});

	it("refuses a kind other than statutory or private", () => {
		expect(
			parseHealthInsurance({ kind: "voluntary" as "private", insurerName: "Kasse" }, LIST),
		).toEqual({ ok: false, errors: { kind: "kind_invalid" } });
	});
});

describe("pickableStatutoryInsurers", () => {
	it("offers only the insurers still on the list, by name", () => {
		expect(pickableStatutoryInsurers(LIST)).toEqual([
			{ name: "Kasse Nord", betriebsnummer: "10000001" },
			{ name: "Kasse Süd", betriebsnummer: "20000002" },
		]);
	});
});

describe("the bundled statutory insurer list", () => {
	it("names its source and the day it was taken from it", () => {
		expect(STATUTORY_HEALTH_INSURERS.source).toMatch(/^https:\/\//);
		expect(STATUTORY_HEALTH_INSURERS.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("holds every insurer once, each with a name and an eight-digit Betriebsnummer", () => {
		const numbers = STATUTORY_HEALTH_INSURERS.insurers.map((insurer) => insurer.betriebsnummer);
		expect(new Set(numbers).size).toBe(numbers.length);
		for (const insurer of STATUTORY_HEALTH_INSURERS.insurers) {
			expect(insurer.betriebsnummer).toMatch(/^\d{8}$/);
			expect(insurer.name.trim()).toBe(insurer.name);
			expect(insurer.name.length).toBeGreaterThan(0);
			expect(insurer.name.length).toBeLessThanOrEqual(INSURER_NAME_MAX_LENGTH);
			if (insurer.removedOn !== undefined) expect(insurer.removedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});

	it("is what the form offers and the module accepts by default", () => {
		const first = pickableStatutoryInsurers()[0];
		if (!first) return;
		expect(
			parseHealthInsurance({ kind: "statutory", betriebsnummer: first.betriebsnummer }),
		).toEqual({
			ok: true,
			value: {
				kind: "statutory",
				insurerName: first.name,
				betriebsnummer: first.betriebsnummer,
			},
		});
	});
});
