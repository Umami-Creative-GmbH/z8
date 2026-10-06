import { describe, expect, it } from "vitest";
import {
	type AllowanceOverride,
	allowanceOverrideView,
	isOverridableSituation,
	mileageOverrideScope,
	mileageSituation,
	overriddenMileageView,
	overriddenPerDiemView,
	parseAllowanceOverrideDraft,
	perDiemOverrideScope,
	perDiemSituation,
	withoutOverriddenRequirements,
} from "../allowance-override";
import { itemReimbursementAmount } from "../item-amount";
import { reportItemMissingRequirements } from "../item-requirements";
import type { MileageItemView } from "../mileage";
import {
	emptyPerDiemItinerary,
	type PerDiemItinerary,
	perDiemItemView,
	perDiemMissingRequirements,
	tripDays,
} from "../per-diem";

const DRAFT = {
	expenseDate: null,
	category: null,
	description: null,
	amount: null,
	currency: null,
	paidBy: "employee" as const,
	accountingReference: null,
};

const itinerary: PerDiemItinerary = {
	...emptyPerDiemItinerary("Europe/Paris"),
	startDate: "2026-09-14",
	startTime: "07:00",
	endDate: "2026-09-16",
	endTime: "19:00",
	overnight: "away",
	meals: tripDays("2026-09-14", "2026-09-16").map((date) => ({
		date,
		breakfast: { provided: true, employeePayment: null },
		lunch: { provided: false, employeePayment: null },
		dinner: { provided: false, employeePayment: null },
	})),
};
const destinations = [{ place: "Paris", countryCode: "FR" }];

function override(overrides: Partial<AllowanceOverride> = {}): AllowanceOverride {
	return {
		id: "override-1",
		kind: "per_diem",
		amount: "159.00",
		currency: "EUR",
		reason: "Trip to Paris; international rates are not supported yet",
		evidence: "BMF table 2026, France/Paris",
		calculationBasis: "2 partial days × 39 EUR + 1 full day × 58 EUR + 23 EUR",
		scope: perDiemOverrideScope(itinerary, destinations),
		situation: { kind: "unsupported_case", reasons: ["international", "foreign_time_zone"] },
		authorizedBy: { employeeId: "admin-1", name: "Ada Admin" },
		authorizedAt: "2026-09-20T08:00:00Z",
		...overrides,
	};
}

const mileageView: MileageItemView = {
	route: "Berlin – Potsdam",
	distanceKm: "61.50",
	vehicle: "car",
	calculation: { status: "policy_missing", expenseDate: "2026-09-14", vehicle: "car" },
	amount: null,
	currency: null,
};

describe("allowance situations (#610)", () => {
	it("distinguishes missing facts, missing coverage and unsupported cases", () => {
		expect(mileageSituation({ status: "incomplete" })).toEqual({
			kind: "missing_facts",
			reasons: [],
		});
		expect(
			mileageSituation({ status: "policy_missing", expenseDate: "2026-09-14", vehicle: "car" }),
		).toEqual({ kind: "missing_coverage", reasons: ["policy_missing"] });
		expect(perDiemSituation({ status: "currency_mismatch", policyCurrency: "USD" })).toEqual({
			kind: "missing_coverage",
			reasons: ["policy_currency"],
		});
		expect(
			perDiemSituation({
				status: "exceptional",
				reasons: ["international", "overlapping_days"],
				overlappingDays: ["2026-09-15"],
			}),
		).toEqual({ kind: "unsupported_case", reasons: ["international", "overlapping_days"] });
		expect(perDiemSituation({ status: "policy_missing", dates: ["2026-09-14"] })).toEqual({
			kind: "missing_coverage",
			reasons: ["policy_missing"],
		});
	});

	it("allows an override only for missing coverage, fallbacks and unsupported cases", () => {
		expect(isOverridableSituation({ kind: "missing_coverage", reasons: [] })).toBe(true);
		expect(isOverridableSituation({ kind: "unsupported_case", reasons: [] })).toBe(true);
		expect(isOverridableSituation({ kind: "official_fallback", reasons: [] })).toBe(true);
		expect(isOverridableSituation({ kind: "missing_facts", reasons: [] })).toBe(false);
		expect(isOverridableSituation({ kind: "calculated", reasons: [] })).toBe(false);
	});
});

describe("parseAllowanceOverrideDraft", () => {
	const valid = {
		amount: "159",
		reason: " Trip to Paris ",
		evidence: "BMF table 2026",
		calculationBasis: "2 × 39 + 58 + 23",
	};

	it("normalizes the amount and trims the texts", () => {
		expect(parseAllowanceOverrideDraft(valid, { kind: "per_diem", currency: "EUR" })).toEqual({
			ok: true,
			draft: {
				amount: "159.00",
				reason: "Trip to Paris",
				evidence: "BMF table 2026",
				calculationBasis: "2 × 39 + 58 + 23",
			},
		});
		expect(
			parseAllowanceOverrideDraft({ ...valid, amount: "18,45" }, { kind: "mileage", currency: "EUR" }),
		).toMatchObject({ ok: true, draft: { amount: "18.45" } });
	});

	it("requires reason, evidence and calculation basis", () => {
		expect(
			parseAllowanceOverrideDraft(
				{ amount: "1", reason: " ", evidence: "", calculationBasis: "" },
				{ kind: "per_diem", currency: "EUR" },
			),
		).toEqual({ ok: false, errors: ["reason", "evidence", "calculation_basis"] });
	});

	it("allows a zero per diem but never a zero mileage, negative or over-precise amount", () => {
		expect(
			parseAllowanceOverrideDraft({ ...valid, amount: "0" }, { kind: "per_diem", currency: "EUR" }),
		).toMatchObject({ ok: true, draft: { amount: "0.00" } });
		for (const amount of ["0", "-1", "1.234", "abc", "", "1000000.01"]) {
			expect(
				parseAllowanceOverrideDraft({ ...valid, amount }, { kind: "mileage", currency: "EUR" }),
			).toEqual({ ok: false, errors: ["amount"] });
		}
		expect(
			parseAllowanceOverrideDraft({ ...valid, amount: "10.50" }, { kind: "per_diem", currency: "JPY" }),
		).toEqual({ ok: false, errors: ["amount"] });
	});
});

describe("override applicability", () => {
	it("applies only to exactly the facts it was authorized for, in the report currency", () => {
		const scope = perDiemOverrideScope(itinerary, destinations);
		expect(allowanceOverrideView(override(), scope, "EUR").applies).toBe(true);
		// Meal order and JSON key order are not facts.
		expect(
			allowanceOverrideView(override(), perDiemOverrideScope({ ...itinerary }, destinations), "EUR")
				.applies,
		).toBe(true);
		expect(
			allowanceOverrideView(
				override(),
				perDiemOverrideScope({ ...itinerary, endTime: "20:00" }, destinations),
				"EUR",
			).applies,
		).toBe(false);
		expect(
			allowanceOverrideView(
				override(),
				perDiemOverrideScope(itinerary, [{ place: "Lyon", countryCode: "FR" }]),
				"EUR",
			).applies,
		).toBe(false);
		expect(allowanceOverrideView(override(), scope, "CHF").applies).toBe(false);
		expect(
			allowanceOverrideView(
				override(),
				mileageOverrideScope({
					expenseDate: "2026-09-14",
					route: "x",
					distanceKm: "1.00",
					vehicle: "car",
				}),
				"EUR",
			).applies,
		).toBe(false);
	});

	it("counts an applying per diem override instead of the unsupported calculation", () => {
		const view = overriddenPerDiemView(
			perDiemItemView(itinerary, {
				status: "exceptional",
				reasons: ["international"],
				overlappingDays: [],
			}),
			destinations,
			override(),
			"EUR",
		);
		expect(view.amount).toBe("159.00");
		expect(view.currency).toBe("EUR");
		expect(view.override?.applies).toBe(true);
		expect(
			itemReimbursementAmount(
				{ type: "per_diem", amount: null, currency: null, paidBy: "employee", perDiem: view },
				"EUR",
			),
		).toMatchObject({ counted: true, amount: "159.00" });
		expect(
			reportItemMissingRequirements(
				{ type: "per_diem", draft: DRAFT, receiptCount: 0, perDiem: view },
				{
					reimbursementCurrency: "EUR",
					trip: { startDate: "2026-09-14", endDate: "2026-09-16" },
				},
			),
		).toEqual([]);
	});

	it("keeps missing facts actionable: an override never satisfies the trip dates", () => {
		const view = overriddenPerDiemView(
			perDiemItemView(itinerary, {
				status: "exceptional",
				reasons: ["international"],
				overlappingDays: [],
			}),
			destinations,
			override(),
			"EUR",
		);
		expect(
			reportItemMissingRequirements(
				{ type: "per_diem", draft: DRAFT, receiptCount: 0, perDiem: view },
				{
					reimbursementCurrency: "EUR",
					trip: { startDate: "2026-09-13", endDate: "2026-09-16" },
				},
			),
		).toEqual(["per_diem_trip_dates"]);
	});

	it("still asks for the daily meals of an exceptional itinerary", () => {
		expect(
			perDiemMissingRequirements(
				{ ...itinerary, meals: [] },
				{ status: "exceptional", reasons: ["international"], overlappingDays: [] },
				{ startDate: "2026-09-14", endDate: "2026-09-16" },
			),
		).toEqual(["per_diem_meals", "per_diem_exceptional"]);
	});

	it("leaves a stale override visible but uncounted", () => {
		const view = overriddenMileageView(
			mileageView,
			"2026-09-14",
			override({
				kind: "mileage",
				amount: "18.45",
				scope: mileageOverrideScope({
					expenseDate: "2026-09-14",
					route: "Berlin – Potsdam",
					distanceKm: "60.00",
					vehicle: "car",
				}),
			}),
			"EUR",
		);
		expect(view?.override?.applies).toBe(false);
		expect(view?.amount).toBeNull();
		expect(
			reportItemMissingRequirements(
				{
					type: "mileage",
					draft: { ...DRAFT, expenseDate: "2026-09-14" },
					receiptCount: 0,
					mileage: view,
				},
				{ reimbursementCurrency: "EUR" },
			),
		).toEqual(["mileage_policy_missing"]);
	});

	it("resolves only coverage and calculation requirements", () => {
		expect(
			withoutOverriddenRequirements(
				["route", "mileage_policy_missing", "per_diem_exceptional", "per_diem_trip_dates"],
				{ applies: true },
			),
		).toEqual(["route", "per_diem_trip_dates"]);
		expect(withoutOverriddenRequirements(["mileage_policy_missing"], { applies: false })).toEqual([
			"mileage_policy_missing",
		]);
		expect(withoutOverriddenRequirements(["mileage_currency"], null)).toEqual(["mileage_currency"]);
	});
});
