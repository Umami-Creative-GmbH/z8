import { describe, expect, it } from "vitest";
import {
	type AppliedMileagePolicy,
	calculateMileage,
	calculateMileageItem,
	type MileagePolicyVersion,
	mileageItemMissingRequirements,
	parseMileageItemDraft,
	parseMileageRate,
	resolveMileagePolicy,
} from "../mileage";

const policy: AppliedMileagePolicy = {
	policyId: "policy-1",
	versionId: "version-1",
	effectiveFrom: "2026-01-01",
	vehicle: "car",
	ratePerKm: "0.3000",
	currency: "EUR",
	source: {
		kind: "organization",
		reference: "Travel policy 2026",
		version: null,
		defaultKey: null,
	},
};

function version(
	overrides: Partial<MileagePolicyVersion> & Pick<MileagePolicyVersion, "id" | "effectiveFrom">,
): MileagePolicyVersion {
	return {
		policyId: "policy-1",
		currency: "EUR",
		source: { kind: "organization", reference: null, version: null, defaultKey: null },
		withdrawnAt: null,
		ratesPerKm: { car: "0.3000" },
		...overrides,
	};
}

describe("calculateMileage", () => {
	it("multiplies distance by the rate exactly and rounds once, half up, to cents", () => {
		// 123.45 km × 0.30 EUR = 37.035 EUR exactly; commercial rounding gives 37.04.
		expect(calculateMileage({ distanceKm: "123.45", ratePerKm: "0.3000" })).toEqual({
			exactAmount: "37.035000",
			amount: "37.04",
		});
	});

	it("never drifts like floating point does", () => {
		// 0.3 × 0.3 is 0.09 exactly, not 0.08999999999999999 as with floats.
		expect(calculateMileage({ distanceKm: "0.30", ratePerKm: "0.3000" }).amount).toBe("0.09");
		expect(calculateMileage({ distanceKm: "1000.00", ratePerKm: "0.2000" }).amount).toBe("200.00");
		expect(calculateMileage({ distanceKm: "0.01", ratePerKm: "0.3000" })).toEqual({
			exactAmount: "0.003000",
			amount: "0.00",
		});
	});
});

describe("parseMileageItemDraft", () => {
	it("normalizes route, distance and vehicle and keeps blanks as null", () => {
		expect(
			parseMileageItemDraft({
				expenseDate: "2026-03-04",
				route: "  Berlin office – Potsdam customer – back ",
				distanceKm: "61,5",
				vehicle: "car",
				accountingReference: "",
			}),
		).toEqual({
			ok: true,
			draft: {
				expenseDate: "2026-03-04",
				route: "Berlin office – Potsdam customer – back",
				distanceKm: "61.50",
				vehicle: "car",
				accountingReference: null,
			},
		});
	});

	it("refuses a zero, negative, over-precise or implausible distance and an unknown vehicle", () => {
		const base = {
			expenseDate: null,
			route: null,
			vehicle: null,
			accountingReference: null,
		};
		for (const distanceKm of ["0", "-5", "12.345", "100000.01", "1e3", "abc"]) {
			expect(parseMileageItemDraft({ ...base, distanceKm })).toEqual({
				ok: false,
				errors: { distanceKm: "invalid_distance" },
			});
		}
		expect(parseMileageItemDraft({ ...base, distanceKm: null, vehicle: "plane" })).toEqual({
			ok: false,
			errors: { vehicle: "invalid_vehicle" },
		});
	});
});

describe("parseMileageRate", () => {
	it("accepts a positive rate with at most four decimals, normalized to four", () => {
		expect(parseMileageRate("0.3")).toBe("0.3000");
		expect(parseMileageRate("0,42")).toBe("0.4200");
		expect(parseMileageRate("0.12345")).toBeNull();
		expect(parseMileageRate("0")).toBeNull();
		expect(parseMileageRate("100.0001")).toBeNull();
	});
});

describe("resolveMileagePolicy", () => {
	const versions = [
		version({ id: "v2026", effectiveFrom: "2026-01-01", ratesPerKm: { car: "0.3000" } }),
		version({
			id: "v2026-07",
			effectiveFrom: "2026-07-01",
			ratesPerKm: { car: "0.3500", other_motor_vehicle: "0.2000" },
		}),
		version({ id: "withdrawn", effectiveFrom: "2026-09-01", withdrawnAt: "2026-09-02T08:00:00Z" }),
	];

	it("applies the latest active version that started on or before the expense date", () => {
		expect(resolveMileagePolicy(versions, "2026-06-30", "car")).toMatchObject({
			status: "found",
			policy: { versionId: "v2026", ratePerKm: "0.3000", effectiveFrom: "2026-01-01" },
		});
		expect(resolveMileagePolicy(versions, "2026-07-01", "car")).toMatchObject({
			status: "found",
			policy: { versionId: "v2026-07", ratePerKm: "0.3500" },
		});
	});

	it("ignores withdrawn versions", () => {
		expect(resolveMileagePolicy(versions, "2026-10-01", "car")).toMatchObject({
			status: "found",
			policy: { versionId: "v2026-07" },
		});
	});

	it("reports missing coverage before the first version and a vehicle without a rate", () => {
		expect(resolveMileagePolicy(versions, "2025-12-31", "car")).toEqual({ status: "no_version" });
		expect(resolveMileagePolicy(versions, "2026-03-01", "other_motor_vehicle")).toEqual({
			status: "no_rate",
			versionId: "v2026",
		});
	});
});

describe("calculateMileageItem", () => {
	const draft = {
		expenseDate: "2026-03-04",
		route: "Berlin – Potsdam",
		distanceKm: "61.50",
		vehicle: "car" as const,
		accountingReference: null,
	};

	it("calculates with the applied policy and keeps the breakdown", () => {
		expect(calculateMileageItem(draft, { status: "found", policy }, "EUR")).toEqual({
			status: "calculated",
			distanceKm: "61.50",
			ratePerKm: "0.3000",
			currency: "EUR",
			exactAmount: "18.450000",
			amount: "18.45",
			rounding: "half_up",
			policy,
		});
	});

	it("never substitutes a rate for missing coverage or another currency", () => {
		expect(calculateMileageItem(draft, { status: "no_version" }, "EUR")).toEqual({
			status: "policy_missing",
			expenseDate: "2026-03-04",
			vehicle: "car",
		});
		expect(
			calculateMileageItem(
				draft,
				{ status: "found", policy: { ...policy, currency: "CHF" } },
				"EUR",
			),
		).toEqual({ status: "currency_mismatch", policyCurrency: "CHF" });
		expect(
			calculateMileageItem({ ...draft, distanceKm: null }, { status: "found", policy }, "EUR"),
		).toEqual({ status: "incomplete" });
	});
});

describe("mileageItemMissingRequirements", () => {
	it("lists missing inputs, then the policy problem, in form order", () => {
		const empty = {
			expenseDate: null,
			route: null,
			distanceKm: null,
			vehicle: null,
			accountingReference: null,
		};
		expect(mileageItemMissingRequirements(empty, { status: "incomplete" })).toEqual([
			"expense_date",
			"route",
			"distance",
			"vehicle",
		]);
		const complete = { ...empty, expenseDate: "2026-03-04", route: "A – B", distanceKm: "10.00" };
		const withCar = { ...complete, vehicle: "car" as const };
		expect(
			mileageItemMissingRequirements(withCar, {
				status: "policy_missing",
				expenseDate: "2026-03-04",
				vehicle: "car",
			}),
		).toEqual(["mileage_policy_missing"]);
		expect(
			mileageItemMissingRequirements(withCar, {
				status: "currency_mismatch",
				policyCurrency: "CHF",
			}),
		).toEqual(["mileage_currency"]);
		expect(
			mileageItemMissingRequirements(
				withCar,
				calculateMileageItem(withCar, { status: "found", policy }, "EUR"),
			),
		).toEqual([]);
	});
});
