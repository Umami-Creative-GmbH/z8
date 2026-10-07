import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { perDiemSituation } from "../allowance-override";
import {
	calculatePerDiem,
	type PerDiemCalculation,
	type PerDiemContext,
	type PerDiemItinerary,
	type PerDiemMealDay,
	type PerDiemPolicyVersion,
	perDiemMissingRequirements,
	perDiemPolicyResolver,
	perDiemStampOf,
	perDiemStampResolver,
	samePerDiemItinerary,
	tripDays,
} from "../per-diem";
import type { PerDiemLocation } from "../per-diem-location";
import { BMF_FOREIGN_PER_DIEM_2026, foreignTableRates } from "../statutory-foreign-per-diem";
import {
	GERMAN_DOMESTIC_PER_DIEM_DEFAULT,
	GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT,
} from "../statutory-per-diem-defaults";

/*
 * International per diem (#611) with the BMF amounts for 2026 (LStH 2026,
 * Anhang 25 I) and the daily location rules of § 9 Abs. 4a Satz 5 EStG, Rz. 52
 * of the BMF letter of 25.11.2020 and R 9.6 Abs. 3 LStR. Expected amounts are
 * read from the official table, not recomputed.
 */

const DE: PerDiemLocation = { country: "DE", place: null };
const at = (country: string, place: string | null = null): PerDiemLocation => ({ country, place });

const international: PerDiemPolicyVersion = {
	id: "v-intl",
	policyId: "policy-1",
	effectiveFrom: "2026-01-01",
	currency: "EUR",
	source: {
		kind: "statutory_default",
		reference: GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT.reference,
		version: GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT.version,
		defaultKey: GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT.key,
	},
	withdrawnAt: null,
	rates: {
		DE: { ...GERMAN_DOMESTIC_PER_DIEM_DEFAULT.rates },
		...foreignTableRates(BMF_FOREIGN_PER_DIEM_2026),
	},
};

const noMeal = { provided: false, employeePayment: null };

type DayFacts = Partial<Omit<PerDiemMealDay, "date">>;

function trip(
	start: string,
	end: string,
	days: DayFacts[],
	overrides: Partial<PerDiemItinerary> = {},
): PerDiemItinerary {
	const [startDate = "", startTime = ""] = start.split("T");
	const [endDate = "", endTime = ""] = end.split("T");
	return {
		startDate,
		startTime,
		startTimeZone: "Europe/Berlin",
		endDate,
		endTime,
		endTimeZone: "Europe/Berlin",
		overnight: startDate === endDate ? null : "away",
		prolongedWorkplace: false,
		meals: tripDays(startDate, endDate).map((date, index) => ({
			date,
			breakfast: noMeal,
			lunch: noMeal,
			dinner: noMeal,
			...days[index],
		})),
		...overrides,
	};
}

function context(countries: string[], overrides: Partial<PerDiemContext> = {}): PerDiemContext {
	return {
		trip: { destinations: countries.map((countryCode) => ({ place: null, countryCode })) },
		reimbursementCurrency: "EUR",
		resolvePolicy: perDiemPolicyResolver([international]),
		...overrides,
	};
}

function calculated(calculation: PerDiemCalculation) {
	if (calculation.status !== "calculated") {
		throw new Error(`expected a calculation, got ${JSON.stringify(calculation)}`);
	}
	return calculation;
}

describe("daily locations across countries (Rz. 52, Beispiel 37)", () => {
	// Berlin Monday 20:00 → Belgium at 2:00, Tuesday Brussels, Wednesday 14:00 Amsterdam,
	// Thursday work in Amsterdam until 13:00, home at 22:30.
	const itinerary = trip("2026-03-02T20:00", "2026-03-05T22:30", [
		{ night: DE, activityAbroad: DE },
		{ night: at("BE") },
		{ night: at("NL") },
		{ activityAbroad: at("NL") },
	]);

	it("prices each day with the location the rules select, not one trip-level country", () => {
		const result = calculated(calculatePerDiem(itinerary, context(["BE", "NL"])));
		expect(
			result.days.map((day) => [day.date, day.location?.area, day.location?.basis, day.rate]),
		).toEqual([
			["2026-03-02", "DE", "domestic", "14.00"],
			["2026-03-03", "BE", "night", "59.00"],
			["2026-03-04", "NL", "night", "58.00"],
			["2026-03-05", "NL", "last_activity_abroad", "39.00"],
		]);
		expect(result.amount).toBe("170.00");
		expect(result.rules.foreignTable).toEqual({
			key: BMF_FOREIGN_PER_DIEM_2026.key,
			reference: BMF_FOREIGN_PER_DIEM_2026.reference,
			version: BMF_FOREIGN_PER_DIEM_2026.version,
		});
		expect(result.policies.map((policy) => policy.area).toSorted()).toEqual(["BE", "DE", "NL"]);
		expect(perDiemSituation(result)).toEqual({ kind: "calculated", reasons: [] });
	});

	it("keeps the entered dates and locations through the stamp, whatever zone views them", () => {
		const result = calculated(calculatePerDiem(itinerary, context(["BE", "NL"])));
		const stamp = perDiemStampOf(result);
		expect(stamp.foreignTableKey).toBe(BMF_FOREIGN_PER_DIEM_2026.key);
		const frozen = calculatePerDiem(itinerary, {
			...context(["BE", "NL"]),
			resolvePolicy: perDiemStampResolver(stamp),
			rulesKey: stamp.rulesKey,
			foreignTableKey: stamp.foreignTableKey,
		});
		expect(frozen).toEqual(result);
	});
});

describe("supported international days", () => {
	it("deducts provided meals with the day's full-day amount abroad (Satz 8)", () => {
		// Copenhagen: 75 € full day; the hotel breakfast reduces the departure day by 15 € (20 %).
		const result = calculated(
			calculatePerDiem(
				trip("2026-05-11T09:00", "2026-05-12T19:00", [
					{ night: at("DK") },
					{ activityAbroad: at("DK"), breakfast: { provided: true, employeePayment: null } },
				]),
				context(["DK"]),
			),
		);
		expect(result.days.map((day) => [day.rate, day.deductions, day.amount])).toEqual([
			["50.00", "0.00", "50.00"],
			["50.00", "15.00", "35.00"],
		]);
		expect(result.amount).toBe("85.00");
	});

	it("uses city amounts and the last activity abroad on a single day", () => {
		const result = calculated(
			calculatePerDiem(
				trip("2026-06-15T05:30", "2026-06-15T21:00", [{ activityAbroad: at("FR", "paris") }]),
				context(["FR"]),
			),
		);
		expect(result.days[0]).toMatchObject({
			allowance: "partial_day",
			rate: "39.00",
			location: { area: "FR:paris", rule: "listed", basis: "activity_abroad" },
		});
	});

	it("applies the foreign amount to a day with activity abroad and a night in Germany", () => {
		// R 9.6 Abs. 3 Satz 3 LStR: Basel during the day, hotel in Freiburg at night.
		const result = calculated(
			calculatePerDiem(
				trip("2026-07-06T07:00", "2026-07-07T17:00", [
					{ night: DE, activityAbroad: at("CH") },
					{ activityAbroad: DE },
				]),
				context(["CH", "DE"]),
			),
		);
		expect(result.days.map((day) => [day.location?.area, day.rate])).toEqual([
			["CH", "47.00"],
			["DE", "14.00"],
		]);
	});

	it("crosses time zones on the entered calendar days (acceptance scenario 3)", () => {
		// Frankfurt → New York City; back on an overnight flight landing Friday morning.
		const result = calculated(
			calculatePerDiem(
				trip("2026-04-13T08:00", "2026-04-17T09:00", [
					{ night: at("US", "new-york-city") },
					{ night: at("US", "new-york-city") },
					{ night: at("US", "new-york-city") },
					{ night: at("US", "new-york-city") },
					{ activityAbroad: at("US", "new-york-city") },
				]),
				context(["US"]),
			),
		);
		expect(result.days.map((day) => [day.date, day.allowance, day.rate])).toEqual([
			["2026-04-13", "partial_day", "44.00"],
			["2026-04-14", "full_day", "66.00"],
			["2026-04-15", "full_day", "66.00"],
			["2026-04-16", "full_day", "66.00"],
			["2026-04-17", "partial_day", "44.00"],
		]);
		expect(result.amount).toBe("286.00");
	});
});

describe("official destination fallbacks are calculated and shown as such", () => {
	it("prices an unlisted state with the Luxembourg amounts", () => {
		const result = calculated(
			calculatePerDiem(
				trip("2026-09-07T06:00", "2026-09-08T22:00", [
					{ night: at("IQ") },
					{ activityAbroad: at("IQ") },
				]),
				context(["IQ"]),
			),
		);
		expect(result.days.map((day) => [day.location?.rule, day.location?.area, day.rate])).toEqual([
			["luxembourg", "LU", "42.00"],
			["luxembourg", "LU", "42.00"],
		]);
		expect(perDiemSituation(result)).toEqual({
			kind: "official_fallback",
			reasons: ["luxembourg"],
		});
	});

	it("prices a whole day in flight with the Austrian amounts", () => {
		const result = calculated(
			calculatePerDiem(
				trip("2026-10-05T08:00", "2026-10-08T18:00", [
					{ night: at("SG") },
					{ night: { special: "in_flight" } },
					{ night: at("NZ") },
					{ activityAbroad: at("NZ") },
				]),
				context(["SG", "NZ"]),
			),
		);
		expect(result.days[1]).toMatchObject({
			rate: "50.00",
			location: { rule: "flight_austria", area: "AT" },
		});
		expect(perDiemSituation(result).kind).toBe("official_fallback");
	});
});

describe("unsupported or incomplete international facts are never guessed", () => {
	it("asks for the daily locations of a trip abroad", () => {
		const itinerary = trip("2026-03-02T08:00", "2026-03-03T18:00", []);
		const calculation = calculatePerDiem(itinerary, context(["FR"]));
		expect(calculation).toEqual({
			status: "incomplete",
			missingLocations: ["2026-03-02", "2026-03-03"],
		});
		expect(
			perDiemMissingRequirements(itinerary, calculation, {}, parseInstant("2026-10-07T12:00:00Z")),
		).toEqual(["per_diem_locations"]);
		expect(perDiemSituation(calculation).kind).toBe("missing_facts");
	});

	it.each([
		[
			"a place the rules do not resolve",
			[{ night: at("PS") }, { activityAbroad: at("PS") }],
			"destination_not_listed",
		],
		[
			"a situation none of the answers describes",
			[{ night: { special: "other" as const } }, { activityAbroad: DE }],
			"special_location",
		],
		[
			"a flight day that is not between take-off and landing",
			[{ night: { special: "in_flight" as const } }, { activityAbroad: at("US") }],
			"special_location",
		],
	])("flags %s for a manual calculation", (_label, days, reason) => {
		const calculation = calculatePerDiem(
			trip("2026-03-02T08:00", "2026-03-03T18:00", days),
			context(["US"]),
		);
		expect(calculation).toMatchObject({ status: "exceptional", reasons: [reason] });
		expect(perDiemSituation(calculation).kind).toBe("unsupported_case");
	});

	it("flags an over-night activity abroad without an overnight stay", () => {
		const calculation = calculatePerDiem(
			trip(
				"2026-03-02T16:00",
				"2026-03-03T06:00",
				[{ night: at("AT") }, { activityAbroad: at("AT") }],
				{ overnight: "none" },
			),
			context(["AT"]),
		);
		expect(calculation).toMatchObject({
			status: "exceptional",
			reasons: ["foreign_without_overnight"],
		});
	});

	it("flags foreign days outside the verified 2026 notice", () => {
		const calculation = calculatePerDiem(
			trip("2026-12-31T08:00", "2027-01-01T18:00", [
				{ night: at("AT") },
				{ activityAbroad: at("AT") },
			]),
			context(["AT"]),
		);
		expect(calculation).toMatchObject({ status: "exceptional", reasons: ["rules_not_verified"] });
	});

	it("reports missing coverage when the organization adopted domestic rates only", () => {
		const domesticOnly: PerDiemPolicyVersion = {
			...international,
			id: "v-domestic",
			source: {
				kind: "statutory_default",
				reference: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.reference,
				version: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.version,
				defaultKey: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.key,
			},
			rates: { DE: { ...GERMAN_DOMESTIC_PER_DIEM_DEFAULT.rates } },
		};
		const calculation = calculatePerDiem(
			trip("2026-03-02T08:00", "2026-03-03T18:00", [
				{ night: at("AT") },
				{ activityAbroad: at("AT") },
			]),
			context(["AT"], { resolvePolicy: perDiemPolicyResolver([domesticOnly]) }),
		);
		expect(calculation).toEqual({ status: "policy_missing", dates: ["2026-03-02", "2026-03-03"] });
	});

	it("never applies foreign rates of a version without a verified table", () => {
		const custom: PerDiemPolicyVersion = {
			...international,
			id: "v-custom",
			source: { kind: "organization", reference: "Policy", version: null, defaultKey: null },
		};
		const calculation = calculatePerDiem(
			trip("2026-03-02T08:00", "2026-03-03T18:00", [
				{ night: at("AT") },
				{ activityAbroad: at("AT") },
			]),
			context(["AT"], { resolvePolicy: perDiemPolicyResolver([custom]) }),
		);
		expect(calculation.status).toBe("policy_missing");
	});
});

describe("domestic trips keep the #609 calculation", () => {
	it("needs no locations when every destination is in Germany", () => {
		const result = calculated(
			calculatePerDiem(trip("2026-03-02T08:00", "2026-03-03T18:00", []), context(["DE"])),
		);
		expect(result.days.map((day) => [day.rate, day.location])).toEqual([
			["14.00", undefined],
			["14.00", undefined],
		]);
		expect(result.rules.foreignTable).toBeUndefined();
		expect(perDiemStampOf(result).foreignTableKey).toBeUndefined();
	});

	it("treats changed daily locations as changed facts", () => {
		const base = trip("2026-03-02T08:00", "2026-03-03T18:00", [
			{ night: at("AT") },
			{ activityAbroad: at("AT") },
		]);
		const moved = trip("2026-03-02T08:00", "2026-03-03T18:00", [
			{ night: at("CH") },
			{ activityAbroad: at("AT") },
		]);
		expect(samePerDiemItinerary(base, structuredClone(base))).toBe(true);
		expect(samePerDiemItinerary(base, moved)).toBe(false);
		// A row without location keys equals one with explicit nulls.
		const plain = trip("2026-03-02T08:00", "2026-03-03T18:00", []);
		const nulls = trip("2026-03-02T08:00", "2026-03-03T18:00", [
			{ night: null, activityAbroad: null },
			{ night: null, activityAbroad: null },
		]);
		expect(samePerDiemItinerary(plain, nulls)).toBe(true);
	});
});
