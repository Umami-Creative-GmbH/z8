import { describe, expect, it } from "vitest";
import {
	decodePerDiemLocation,
	encodePerDiemLocation,
	isOfficialFallbackRule,
	parsePerDiemLocation,
	resolvePerDiemDestination,
} from "../per-diem-location";
import { BMF_FOREIGN_PER_DIEM_2026 as TABLE } from "../statutory-foreign-per-diem";

describe("official destination rules (BMF 05.12.2025, R 9.6 Abs. 3 LStR)", () => {
	it("prices Germany with the domestic rates", () => {
		expect(resolvePerDiemDestination(TABLE, { country: "DE", place: null })).toMatchObject({
			status: "resolved",
			area: "DE",
			rule: "domestic",
		});
	});

	it("uses a listed place, and the country's other amounts elsewhere", () => {
		expect(resolvePerDiemDestination(TABLE, { country: "FR", place: "paris" })).toMatchObject({
			status: "resolved",
			area: "FR:paris",
			country: "FR",
			place: "paris",
			rule: "listed",
			label: "Frankreich – Paris sowie die Departments 77, 78, 91 bis 95",
		});
		expect(resolvePerDiemDestination(TABLE, { country: "FR", place: null })).toMatchObject({
			area: "FR",
			rule: "listed",
			label: "Frankreich – im Übrigen",
		});
		expect(resolvePerDiemDestination(TABLE, { country: "BE", place: null })).toMatchObject({
			area: "BE",
			label: "Belgien",
		});
	});

	it("maps Hong Kong and the Canary Islands to the places the table lists them as", () => {
		expect(resolvePerDiemDestination(TABLE, { country: "HK", place: null })).toMatchObject({
			area: "CN:hongkong",
			rule: "listed",
		});
		expect(resolvePerDiemDestination(TABLE, { country: "IC", place: null })).toMatchObject({
			area: "ES:kanarische-inseln",
			rule: "listed",
		});
	});

	it("applies the amounts the notice assigns to Micronesia and the Caribbean states", () => {
		expect(resolvePerDiemDestination(TABLE, { country: "FM", place: null })).toMatchObject({
			area: "PH",
			country: "PH",
			rule: "assigned",
		});
		expect(resolvePerDiemDestination(TABLE, { country: "GD", place: null })).toMatchObject({
			area: "TT",
			rule: "assigned",
		});
	});

	it("falls back to Luxembourg for unlisted states and to the mother country for territories", () => {
		const iraq = resolvePerDiemDestination(TABLE, { country: "IQ", place: null });
		expect(iraq).toMatchObject({ area: "LU", country: "LU", rule: "luxembourg" });
		const reunion = resolvePerDiemDestination(TABLE, { country: "RE", place: null });
		expect(reunion).toMatchObject({ area: "FR", country: "FR", rule: "mother_country" });
		expect(isOfficialFallbackRule("luxembourg")).toBe(true);
		expect(isOfficialFallbackRule("mother_country")).toBe(true);
		expect(isOfficialFallbackRule("assigned")).toBe(false);
		expect(isOfficialFallbackRule("listed")).toBe(false);
	});

	it("applies the Austrian amounts to whole days in flight and Luxembourg's at sea", () => {
		expect(resolvePerDiemDestination(TABLE, { special: "in_flight" })).toMatchObject({
			area: "AT",
			rule: "flight_austria",
		});
		expect(resolvePerDiemDestination(TABLE, { special: "at_sea" })).toMatchObject({
			area: "LU",
			rule: "ship_luxembourg",
		});
	});

	it("never guesses a destination the rules do not resolve", () => {
		expect(resolvePerDiemDestination(TABLE, { country: "PS", place: null })).toEqual({
			status: "unsupported",
			reason: "destination_not_listed",
		});
		expect(resolvePerDiemDestination(TABLE, { country: "JE", place: null })).toEqual({
			status: "unsupported",
			reason: "destination_not_listed",
		});
		expect(resolvePerDiemDestination(TABLE, { special: "other" })).toEqual({
			status: "unsupported",
			reason: "special_location",
		});
	});
});

describe("entered locations", () => {
	it("round-trips the select encoding", () => {
		for (const location of [
			{ country: "FR", place: "paris" },
			{ country: "DE", place: null },
			{ special: "in_flight" as const },
		]) {
			expect(decodePerDiemLocation(encodePerDiemLocation(location))).toEqual(location);
		}
		expect(decodePerDiemLocation("")).toBeNull();
	});

	it("accepts known countries and listed places only", () => {
		expect(parsePerDiemLocation({ country: "US", place: "boston" })).toEqual({
			country: "US",
			place: "boston",
		});
		expect(parsePerDiemLocation(null)).toBeNull();
		expect(parsePerDiemLocation({ country: "QQ", place: null })).toBe("invalid");
		expect(parsePerDiemLocation({ country: "US", place: "gotham" })).toBe("invalid");
		expect(parsePerDiemLocation({ special: "teleport" })).toBe("invalid");
	});
});
