import { describe, expect, it } from "vitest";
import {
	calculatePerDiem,
	type PerDiemCalculation,
	type PerDiemContext,
	type PerDiemItinerary,
	type PerDiemMealDay,
	type PerDiemPolicyVersion,
	parsePerDiemDraft,
	perDiemMissingRequirements,
	perDiemPolicyResolver,
	perDiemStampOf,
	perDiemStampResolver,
	samePerDiemItinerary,
	tripDays,
} from "../per-diem";
import { calculateStampedPerDiem } from "../per-diem-pricing";
import { GERMAN_DOMESTIC_PER_DIEM_DEFAULT } from "../statutory-per-diem-defaults";

/*
 * Fixtures follow the worked examples of the BMF letter of 25.11.2020
 * (BStBl I S. 1228) as reproduced in LStH 2026, Anhang 25 III, with the
 * German statutory amounts (28 / 14 euros, deductions 5.60 / 11.20 / 11.20).
 */

function version(
	overrides: Partial<PerDiemPolicyVersion> & Pick<PerDiemPolicyVersion, "id" | "effectiveFrom">,
): PerDiemPolicyVersion {
	return {
		policyId: "policy-1",
		currency: "EUR",
		source: {
			kind: "statutory_default",
			reference: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.reference,
			version: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.version,
			defaultKey: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.key,
		},
		withdrawnAt: null,
		rates: { DE: { ...GERMAN_DOMESTIC_PER_DIEM_DEFAULT.rates } },
		...overrides,
	};
}

const statutory = [version({ id: "v-2026", effectiveFrom: "2026-01-01" })];

const noMeal = { provided: false, employeePayment: null };

function mealsFor(
	startDate: string,
	endDate: string,
	provided: Record<string, Partial<Omit<PerDiemMealDay, "date">>> = {},
): PerDiemMealDay[] {
	return tripDays(startDate, endDate).map((date) => ({
		date,
		breakfast: noMeal,
		lunch: noMeal,
		dinner: noMeal,
		...provided[date],
	}));
}

function itinerary(
	start: string,
	end: string,
	overrides: Partial<PerDiemItinerary> = {},
): PerDiemItinerary {
	const [startDate = null, startTime = null] = start.split("T");
	const [endDate = null, endTime = null] = end.split("T");
	return {
		startDate,
		startTime,
		startTimeZone: "Europe/Berlin",
		endDate,
		endTime,
		endTimeZone: "Europe/Berlin",
		overnight: startDate === endDate ? null : "away",
		prolongedWorkplace: false,
		meals: startDate && endDate ? mealsFor(startDate, endDate) : [],
		...overrides,
	};
}

function context(overrides: Partial<PerDiemContext> = {}): PerDiemContext {
	return {
		trip: { destinations: [{ place: "Hamburg", countryCode: "DE" }] },
		reimbursementCurrency: "EUR",
		resolvePolicy: perDiemPolicyResolver(statutory),
		...overrides,
	};
}

function calculated(calculation: PerDiemCalculation) {
	if (calculation.status !== "calculated") {
		throw new Error(`expected a calculation, got ${JSON.stringify(calculation)}`);
	}
	return calculation;
}

describe("single-day trips (§ 9 Abs. 4a Satz 3 Nr. 3 EStG, Rz. 47)", () => {
	it("grants the partial-day allowance for more than eight hours away", () => {
		// Rz. 75 Beispiel 47: 9.00 to 18.00 at customers.
		const result = calculated(
			calculatePerDiem(itinerary("2026-05-04T09:00", "2026-05-04T18:00"), context()),
		);
		expect(result.amount).toBe("14.00");
		expect(result.days).toEqual([
			expect.objectContaining({
				date: "2026-05-04",
				dayType: "single_day",
				absenceMinutes: 540,
				allowance: "partial_day",
				basis: "absence_over_8h",
				rate: "14.00",
				deductions: "0.00",
				amount: "14.00",
				versionId: "v-2026",
			}),
		]);
	});

	it("grants nothing for exactly eight hours: the law requires more than eight", () => {
		const result = calculated(
			calculatePerDiem(itinerary("2026-05-04T09:00", "2026-05-04T17:00"), context()),
		);
		expect(result.amount).toBe("0.00");
		expect(result.days[0]).toMatchObject({
			allowance: "none",
			basis: "absence_8h_or_less",
			rate: "0.00",
			amount: "0.00",
			versionId: null,
		});
	});

	it("deducts a provided lunch from the partial-day allowance (Beispiel 47: 2.80 €)", () => {
		const trip = itinerary("2026-05-04T09:00", "2026-05-04T18:00", {
			meals: mealsFor("2026-05-04", "2026-05-04", {
				"2026-05-04": { lunch: { provided: true, employeePayment: null } },
			}),
		});
		const result = calculated(calculatePerDiem(trip, context()));
		expect(result.days[0]).toMatchObject({ rate: "14.00", deductions: "11.20", amount: "2.80" });
		expect(result.days[0]?.meals.lunch).toEqual({
			provided: true,
			employeePayment: null,
			deduction: "11.20",
		});
		expect(result.amount).toBe("2.80");
	});

	it("measures absence in real elapsed time across the spring clock change", () => {
		// 29 March 2026: Berlin clocks jump from 02:00 to 03:00, so 00:30-09:00 is 7.5 hours.
		const result = calculated(
			calculatePerDiem(itinerary("2026-03-29T00:30", "2026-03-29T09:00"), context()),
		);
		expect(result.days[0]).toMatchObject({ absenceMinutes: 450, allowance: "none" });
		expect(result.absence).toEqual({
			startAt: "2026-03-28T23:30:00Z",
			endAt: "2026-03-29T07:00:00Z",
			minutes: 450,
		});
	});
});

describe("over-night activity without an overnight stay (Rz. 47, Beispiele 32 and 49)", () => {
	it("assigns the allowance to the day with the larger part of the combined absence", () => {
		// Beispiel 32: away from 17.00 until 1.30 the next day; the first day holds 7 of 8.5 hours.
		const result = calculated(
			calculatePerDiem(
				itinerary("2026-05-04T17:00", "2026-05-05T01:30", { overnight: "none" }),
				context(),
			),
		);
		expect(result.amount).toBe("14.00");
		expect(result.days.map((day) => [day.date, day.basis, day.amount])).toEqual([
			["2026-05-04", "overnight_majority", "14.00"],
			["2026-05-05", "overnight_minority", "0.00"],
		]);
	});

	it("deducts a meal of the first day from the allowance of the second (Beispiel 49: 2.80 €)", () => {
		// 20.00 until 4.30: 4 hours on the first day, 4.5 on the second; dinner provided on day one.
		const trip = itinerary("2026-05-04T20:00", "2026-05-05T04:30", {
			overnight: "none",
			meals: mealsFor("2026-05-04", "2026-05-05", {
				"2026-05-04": { dinner: { provided: true, employeePayment: null } },
			}),
		});
		const result = calculated(calculatePerDiem(trip, context()));
		expect(result.days[0]).toMatchObject({
			basis: "overnight_minority",
			amount: "0.00",
			mealsCountToward: "2026-05-05",
		});
		expect(result.days[1]).toMatchObject({
			basis: "overnight_majority",
			rate: "14.00",
			deductions: "11.20",
			amount: "2.80",
			mealsCountToward: "2026-05-05",
		});
		expect(result.amount).toBe("2.80");
	});

	it("grants nothing when the combined absence is eight hours or less", () => {
		const result = calculated(
			calculatePerDiem(
				itinerary("2026-05-04T22:00", "2026-05-05T05:00", { overnight: "none" }),
				context(),
			),
		);
		expect(result.amount).toBe("0.00");
		expect(result.days.every((day) => day.allowance === "none")).toBe(true);
	});

	it("flags an exact tie of both days instead of choosing one", () => {
		const result = calculatePerDiem(
			itinerary("2026-05-04T19:00", "2026-05-05T05:00", { overnight: "none" }),
			context(),
		);
		expect(result).toEqual({
			status: "exceptional",
			reasons: ["majority_tie"],
			overlappingDays: [],
		});
	});
});

describe("multi-day trips with overnight stays (Nr. 1 and 2, Rz. 48-49)", () => {
	it("grants 14 € on the travel days and 28 € on full days (Beispiel 34: 84 €)", () => {
		// Monday 10.30 until Thursday 1.45.
		const result = calculated(
			calculatePerDiem(itinerary("2026-06-01T10:30", "2026-06-04T01:45"), context()),
		);
		expect(result.days.map((day) => [day.dayType, day.basis, day.rate])).toEqual([
			["arrival", "travel_day_with_overnight", "14.00"],
			["intermediate", "absence_24h", "28.00"],
			["intermediate", "absence_24h", "28.00"],
			["departure", "travel_day_with_overnight", "14.00"],
		]);
		expect(result.days.map((day) => day.absenceMinutes)).toEqual([810, 1440, 1440, 105]);
		expect(result.amount).toBe("84.00");
	});

	it("reduces each day at most to zero (Beispiel 48: 22.40 €)", () => {
		const trip = itinerary("2026-06-01T08:00", "2026-06-03T17:00", {
			meals: mealsFor("2026-06-01", "2026-06-03", {
				"2026-06-02": {
					breakfast: { provided: true, employeePayment: null },
					lunch: { provided: true, employeePayment: null },
					dinner: { provided: true, employeePayment: null },
				},
				"2026-06-03": { breakfast: { provided: true, employeePayment: null } },
			}),
		});
		const result = calculated(calculatePerDiem(trip, context()));
		expect(result.days.map((day) => [day.rate, day.deductions, day.amount])).toEqual([
			["14.00", "0.00", "14.00"],
			["28.00", "28.00", "0.00"],
			["14.00", "5.60", "8.40"],
		]);
		expect(result.amount).toBe("22.40");
	});

	it("never lets a day's deductions exceed its allowance", () => {
		const trip = itinerary("2026-06-01T08:00", "2026-06-02T17:00", {
			meals: mealsFor("2026-06-01", "2026-06-02", {
				"2026-06-01": {
					lunch: { provided: true, employeePayment: null },
					dinner: { provided: true, employeePayment: null },
				},
				"2026-06-02": {
					breakfast: { provided: true, employeePayment: null },
					lunch: { provided: true, employeePayment: null },
				},
			}),
		});
		const result = calculated(calculatePerDiem(trip, context()));
		expect(result.days.map((day) => [day.deductions, day.amount])).toEqual([
			["14.00", "0.00"],
			["14.00", "0.00"],
		]);
		// A legitimate zero allowance is still a calculated result.
		expect(result.amount).toBe("0.00");
	});

	it("reduces each meal's deduction by the employee's payment for it (Rz. 77, Beispiel 50)", () => {
		const paid = (amount: string) => ({ provided: true, employeePayment: amount });
		const trip = itinerary("2026-06-01T08:00", "2026-06-03T17:00", {
			meals: mealsFor("2026-06-01", "2026-06-03", {
				"2026-06-02": { breakfast: paid("1.80"), lunch: paid("3.40"), dinner: paid("3.40") },
				"2026-06-03": { breakfast: paid("1.80") },
			}),
		});
		const result = calculated(calculatePerDiem(trip, context()));
		expect(result.days[1]?.meals.breakfast.deduction).toBe("3.80");
		expect(result.days.map((day) => day.amount)).toEqual(["14.00", "8.60", "10.20"]);
		expect(result.amount).toBe("32.80");
	});

	it("never turns a payment above the deduction into extra allowance (Beispiel 57)", () => {
		const trip = itinerary("2026-06-01T06:00", "2026-06-02T20:00", {
			meals: mealsFor("2026-06-01", "2026-06-02", {
				"2026-06-01": { breakfast: { provided: true, employeePayment: "6.00" } },
			}),
		});
		const result = calculated(calculatePerDiem(trip, context()));
		expect(result.days[0]).toMatchObject({ deductions: "0.00", amount: "14.00" });
		expect(result.days[0]?.meals.breakfast.deduction).toBe("0.00");
	});

	it("prices each day with the policy version effective on it", () => {
		const resolvePolicy = perDiemPolicyResolver([
			...statutory,
			version({
				id: "v-july",
				effectiveFrom: "2026-07-01",
				source: { kind: "organization", reference: "Policy", version: null, defaultKey: null },
				rates: {
					DE: {
						fullDay: "30.00",
						partialDay: "15.00",
						breakfastDeduction: "6.00",
						lunchDeduction: "12.00",
						dinnerDeduction: "12.00",
					},
				},
			}),
		]);
		const result = calculated(
			calculatePerDiem(
				itinerary("2026-06-30T08:00", "2026-07-02T18:00"),
				context({ resolvePolicy }),
			),
		);
		expect(result.days.map((day) => [day.versionId, day.rate])).toEqual([
			["v-2026", "14.00"],
			["v-july", "30.00"],
			["v-july", "15.00"],
		]);
		expect(result.policies.map((policy) => policy.versionId)).toEqual(["v-2026", "v-july"]);
		expect(result.amount).toBe("59.00");
	});
});

describe("exceptional itineraries are flagged, never guessed", () => {
	// A destination abroad is priced per day since #611 (`per-diem-international.test.ts`).
	it.each([
		[
			"departure and return in different zones",
			itinerary("2026-06-01T08:00", "2026-06-02T18:00", { endTimeZone: "Europe/London" }),
			{},
			"mixed_time_zones",
		],
		[
			"a zone outside Germany",
			itinerary("2026-06-01T08:00", "2026-06-02T18:00", {
				startTimeZone: "America/New_York",
				endTimeZone: "America/New_York",
			}),
			{},
			"foreign_time_zone",
		],
		[
			"some nights spent at home",
			itinerary("2026-06-01T08:00", "2026-06-03T18:00", { overnight: "mixed" }),
			{},
			"nights_at_home",
		],
		[
			"several days without any overnight stay",
			itinerary("2026-06-01T08:00", "2026-06-03T18:00", { overnight: "none" }),
			{},
			"multi_day_without_overnight",
		],
		[
			"a declared longer activity at the same workplace",
			itinerary("2026-06-01T08:00", "2026-06-02T18:00", { prolongedWorkplace: true }),
			{},
			"prolonged_workplace",
		],
		[
			"days before the verified rule edition",
			itinerary("2025-12-31T08:00", "2026-01-01T18:00"),
			{},
			"rules_not_verified",
		],
	] as const)("%s", (_label, trip, overrides, reason) => {
		const result = calculatePerDiem(trip, context(overrides as Partial<PerDiemContext>));
		expect(result.status).toBe("exceptional");
		expect(result.status === "exceptional" && result.reasons).toContain(reason);
	});

	it("flags a trip longer than three months even without a declaration", () => {
		const result = calculatePerDiem(
			itinerary("2026-01-05T08:00", "2026-04-06T18:00", { meals: [] }),
			context(),
		);
		expect(result).toMatchObject({ status: "exceptional", reasons: ["prolonged_workplace"] });
	});

	it("names days another report pays among the reasons of an otherwise exceptional per diem", () => {
		const result = calculatePerDiem(
			itinerary("2026-06-01T08:00", "2026-06-03T18:00", { prolongedWorkplace: true }),
			context({ overlappingDays: ["2026-06-03", "2026-06-09"] }),
		);
		expect(result).toEqual({
			status: "exceptional",
			reasons: ["prolonged_workplace", "overlapping_days"],
			overlappingDays: ["2026-06-03"],
		});
	});
});

describe("days another report already pays (one allowance per calendar day)", () => {
	it("pays no allowance for that day only and calculates the rest of the trip", () => {
		const result = calculated(
			calculatePerDiem(
				itinerary("2026-06-01T08:00", "2026-06-03T18:00", {
					meals: mealsFor("2026-06-01", "2026-06-03", {
						"2026-06-03": { breakfast: { provided: true, employeePayment: null } },
					}),
				}),
				context({ overlappingDays: ["2026-06-03"] }),
			),
		);
		expect(result.days.map((day) => [day.date, day.allowance, day.basis, day.amount])).toEqual([
			["2026-06-01", "partial_day", "travel_day_with_overnight", "14.00"],
			["2026-06-02", "full_day", "absence_24h", "28.00"],
			["2026-06-03", "none", "claimed_in_other_report", "0.00"],
		]);
		// The claimed day's meals reduce nothing: it carries no allowance here.
		expect(result.days[2]).toMatchObject({
			rate: "0.00",
			deductions: "0.00",
			versionId: null,
			mealsCountToward: null,
		});
		expect(result.days[2]?.meals.breakfast.deduction).toBe("0.00");
		expect(result.amount).toBe("42.00");
	});

	it("leaves a day alone that carries no allowance here anyway", () => {
		const result = calculated(
			calculatePerDiem(
				itinerary("2026-06-03T09:00", "2026-06-03T12:00"),
				context({ overlappingDays: ["2026-06-03"] }),
			),
		);
		expect(result.days[0]).toMatchObject({ basis: "absence_8h_or_less", amount: "0.00" });
	});

	it("moves no over-night allowance to the other day when its majority day is paid elsewhere", () => {
		// Beispiel 32: the first day holds the majority; another report already pays it.
		const result = calculated(
			calculatePerDiem(
				itinerary("2026-05-04T17:00", "2026-05-05T01:30", {
					overnight: "none",
					meals: mealsFor("2026-05-04", "2026-05-05", {
						"2026-05-05": { breakfast: { provided: true, employeePayment: null } },
					}),
				}),
				context({ overlappingDays: ["2026-05-04"] }),
			),
		);
		expect(
			result.days.map((day) => [day.date, day.basis, day.mealsCountToward, day.amount]),
		).toEqual([
			["2026-05-04", "claimed_in_other_report", null, "0.00"],
			["2026-05-05", "overnight_minority", null, "0.00"],
		]);
		expect(result.amount).toBe("0.00");
	});

	it("stamps the claimed days so the submitted result reproduces after the other report changes", () => {
		const trip = itinerary("2026-06-01T08:00", "2026-06-03T18:00");
		const original = calculated(
			calculatePerDiem(trip, context({ overlappingDays: ["2026-06-01"] })),
		);
		const stamp = perDiemStampOf(original);
		expect(stamp.claimedDays).toEqual(["2026-06-01"]);
		expect(stamp.days).toEqual({ "2026-06-02": "v-2026", "2026-06-03": "v-2026" });
		const destinations = [{ place: "Hamburg", countryCode: "DE" }];
		expect(
			calculateStampedPerDiem(
				{ reimbursementCurrency: "EUR", tripDestinations: destinations },
				trip,
				stamp,
			),
		).toEqual(original);
		// A stamp without claimed days (older submissions) prices every day as before.
		expect(perDiemStampOf(calculated(calculatePerDiem(trip, context())))).not.toHaveProperty(
			"claimedDays",
		);
	});
});

describe("missing facts and policy", () => {
	it("is incomplete without a return time or an overnight answer", () => {
		expect(
			calculatePerDiem(itinerary("2026-06-01T08:00", "2026-06-02", {}), context()).status,
		).toBe("incomplete");
		expect(
			calculatePerDiem(
				itinerary("2026-06-01T08:00", "2026-06-02T18:00", { overnight: null }),
				context(),
			).status,
		).toBe("incomplete");
	});

	it("is incomplete until the meal facts cover exactly the travel days", () => {
		const trip = itinerary("2026-06-01T08:00", "2026-06-03T18:00", {
			meals: mealsFor("2026-06-01", "2026-06-02"),
		});
		expect(calculatePerDiem(trip, context()).status).toBe("incomplete");
		expect(perDiemMissingRequirements(trip, calculatePerDiem(trip, context()), {})).toContain(
			"per_diem_meals",
		);
	});

	it("names the days no policy version covers", () => {
		const resolvePolicy = perDiemPolicyResolver([
			version({ id: "late", effectiveFrom: "2026-06-03" }),
		]);
		expect(
			calculatePerDiem(
				itinerary("2026-06-01T08:00", "2026-06-03T18:00"),
				context({ resolvePolicy }),
			),
		).toEqual({ status: "policy_missing", dates: ["2026-06-01", "2026-06-02"] });
	});

	it("does not need a policy for days without an allowance", () => {
		const result = calculatePerDiem(
			itinerary("2026-06-01T09:00", "2026-06-01T12:00"),
			context({ resolvePolicy: perDiemPolicyResolver([]) }),
		);
		expect(calculated(result).amount).toBe("0.00");
	});

	it("never converts a policy in another currency", () => {
		const resolvePolicy = perDiemPolicyResolver([
			version({ id: "chf", effectiveFrom: "2026-01-01", currency: "CHF" }),
		]);
		expect(
			calculatePerDiem(
				itinerary("2026-06-01T08:00", "2026-06-01T18:00"),
				context({ resolvePolicy }),
			),
		).toEqual({ status: "currency_mismatch", policyCurrency: "CHF" });
	});

	it("lists requirements in form order", () => {
		const trip = itinerary("2026-06-01T08:00", "2026-06-02", { overnight: null });
		const calculation = calculatePerDiem(trip, context());
		expect(
			perDiemMissingRequirements(trip, calculation, {
				startDate: "2026-06-01",
				endDate: "2026-06-03",
			}),
		).toEqual(["per_diem_end", "per_diem_overnight", "per_diem_trip_dates"]);
	});

	it("asks for an exceptional calculation and for policy setup", () => {
		const exceptional = itinerary("2026-06-01T08:00", "2026-06-02T18:00", {
			prolongedWorkplace: true,
		});
		expect(
			perDiemMissingRequirements(exceptional, calculatePerDiem(exceptional, context()), {}),
		).toEqual(["per_diem_exceptional"]);
		const uncovered = itinerary("2026-06-01T08:00", "2026-06-01T18:00");
		expect(
			perDiemMissingRequirements(
				uncovered,
				calculatePerDiem(uncovered, context({ resolvePolicy: perDiemPolicyResolver([]) })),
				{},
			),
		).toEqual(["per_diem_policy_missing"]);
	});
});

describe("stamp", () => {
	it("reproduces the calculation from the stamp alone, whatever the current policy", () => {
		const trip = itinerary("2026-06-30T08:00", "2026-07-01T18:00");
		const original = calculated(calculatePerDiem(trip, context()));
		const stamp = perDiemStampOf(original);
		const again = calculatePerDiem(
			trip,
			context({ resolvePolicy: perDiemStampResolver(stamp), rulesKey: stamp.rulesKey }),
		);
		expect(again).toEqual(original);
	});

	it("does not price days the stamp was not resolved for", () => {
		const original = calculated(
			calculatePerDiem(itinerary("2026-06-30T08:00", "2026-07-01T18:00"), context()),
		);
		const stamp = perDiemStampOf(original);
		const moved = calculatePerDiem(
			itinerary("2026-07-01T08:00", "2026-07-02T18:00"),
			context({ resolvePolicy: perDiemStampResolver(stamp), rulesKey: stamp.rulesKey }),
		);
		expect(moved.status).toBe("policy_missing");
	});
});

describe("samePerDiemItinerary", () => {
	it("ignores meal order and stored key order but not a changed fact", () => {
		const trip = itinerary("2026-06-01T08:00", "2026-06-02T18:00");
		const stored: PerDiemItinerary = structuredClone({ ...trip, meals: [...trip.meals].reverse() });
		expect(samePerDiemItinerary(trip, stored)).toBe(true);
		expect(samePerDiemItinerary(trip, { ...trip, endTime: "18:01" })).toBe(false);
		const changedMeal = structuredClone(trip);
		if (changedMeal.meals[1])
			changedMeal.meals[1].lunch = { provided: true, employeePayment: null };
		expect(samePerDiemItinerary(trip, changedMeal)).toBe(false);
	});
});

describe("parsePerDiemDraft", () => {
	const base = {
		startDate: "2026-06-01",
		startTime: "08:00",
		startTimeZone: "Europe/Berlin",
		endDate: "2026-06-02",
		endTime: "18:30",
		endTimeZone: "Europe/Berlin",
		overnight: "away",
		prolongedWorkplace: false,
		meals: [
			{
				date: "2026-06-02",
				breakfast: { provided: true, employeePayment: "1,8" },
				lunch: { provided: false, employeePayment: "3.00" },
				dinner: { provided: false, employeePayment: null },
			},
		],
	};

	it("normalizes times, payments and drops payments for meals not provided", () => {
		const parsed = parsePerDiemDraft(base);
		expect(parsed.ok && parsed.itinerary.meals[0]).toEqual({
			date: "2026-06-02",
			breakfast: { provided: true, employeePayment: "1.80" },
			lunch: { provided: false, employeePayment: null },
			dinner: { provided: false, employeePayment: null },
		});
	});

	it("refuses a return before the departure", () => {
		const parsed = parsePerDiemDraft({ ...base, endDate: "2026-06-01", endTime: "07:00" });
		expect(parsed).toEqual({ ok: false, errors: { endTime: "end_before_start" } });
	});

	it("refuses a local time skipped by the clock change", () => {
		const parsed = parsePerDiemDraft({
			...base,
			startDate: "2026-03-29",
			startTime: "02:30",
			meals: [],
		});
		expect(parsed).toEqual({ ok: false, errors: { startTime: "nonexistent_local_time" } });
	});

	it("refuses a local time repeated by the autumn clock change with its own error", () => {
		// 25 October 2026: Berlin clocks go back from 03:00 to 02:00, so 02:30 happens twice.
		const parsed = parsePerDiemDraft({
			...base,
			startDate: "2026-10-24",
			startTime: "08:00",
			endDate: "2026-10-25",
			endTime: "02:30",
			meals: [],
		});
		expect(parsed).toEqual({ ok: false, errors: { endTime: "ambiguous_local_time" } });
		// The hour after the change is unambiguous again.
		expect(
			parsePerDiemDraft({ ...base, endDate: "2026-10-25", endTime: "03:30", meals: [] }),
		).toEqual(expect.objectContaining({ ok: true }));
	});

	it("refuses malformed values and meals outside the travel days", () => {
		expect(parsePerDiemDraft({ ...base, startTime: "8 Uhr" })).toEqual({
			ok: false,
			errors: { startTime: "invalid_time" },
		});
		expect(parsePerDiemDraft({ ...base, endTimeZone: "Mars/Base" })).toEqual({
			ok: false,
			errors: { endTimeZone: "invalid_time_zone" },
		});
		expect(parsePerDiemDraft({ ...base, overnight: "sometimes" })).toEqual({
			ok: false,
			errors: { overnight: "invalid_overnight" },
		});
		const outside = parsePerDiemDraft({
			...base,
			meals: [{ ...base.meals[0], date: "2026-06-05" }],
		});
		expect(outside).toEqual({ ok: false, errors: { meals: "invalid_meals" } });
		const negative = parsePerDiemDraft({
			...base,
			meals: [{ ...base.meals[0], breakfast: { provided: true, employeePayment: "-1" } }],
		});
		expect(negative).toEqual({ ok: false, errors: { meals: "invalid_payment" } });
	});

	it("keeps a partly entered itinerary", () => {
		const parsed = parsePerDiemDraft({
			...base,
			startTime: null,
			endDate: null,
			endTime: null,
			overnight: null,
			meals: [],
		});
		expect(parsed.ok && parsed.itinerary).toMatchObject({
			startDate: "2026-06-01",
			startTime: null,
			endDate: null,
		});
	});
});
