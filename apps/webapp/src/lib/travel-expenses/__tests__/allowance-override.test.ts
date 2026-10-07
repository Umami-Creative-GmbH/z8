import { describe, expect, it } from "vitest";
import {
	type AllowanceOverride,
	allowanceOverrideView,
	isOverridableSituation,
	mileageOverrideScope,
	mileageSituation,
	overriddenMileageView,
	overriddenPerDiemView,
	overrideSituationHolds,
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

const mileageOverride = override({
	kind: "mileage",
	amount: "20.00",
	scope: mileageOverrideScope({
		expenseDate: "2026-09-14",
		route: "Berlin – Potsdam",
		distanceKm: "61.50",
		vehicle: "car",
	}),
	situation: { kind: "missing_coverage", reasons: ["policy_missing"] },
});

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

	it("allows an override only for missing coverage and unsupported cases, never official fallbacks", () => {
		expect(isOverridableSituation({ kind: "missing_coverage", reasons: [] })).toBe(true);
		expect(isOverridableSituation({ kind: "unsupported_case", reasons: [] })).toBe(true);
		expect(isOverridableSituation({ kind: "official_fallback", reasons: ["luxembourg"] })).toBe(
			false,
		);
		expect(isOverridableSituation({ kind: "missing_facts", reasons: [] })).toBe(false);
		expect(isOverridableSituation({ kind: "calculated", reasons: [] })).toBe(false);
	});

	it("treats a calculated per diem with days another report pays as an unsupported case", () => {
		const day = {
			dayType: "departure" as const,
			absenceMinutes: 600,
			allowance: "none" as const,
			rate: "0.00",
			versionId: null,
			meals: {
				breakfast: { provided: false, employeePayment: null, deduction: "0.00" },
				lunch: { provided: false, employeePayment: null, deduction: "0.00" },
				dinner: { provided: false, employeePayment: null, deduction: "0.00" },
			},
			mealsCountToward: null,
			deductions: "0.00",
			amount: "0.00",
		};
		const calculation = {
			status: "calculated" as const,
			currency: "EUR",
			amount: "0.00",
			absence: { startAt: "2026-09-14T05:00:00Z", endAt: "2026-09-14T15:00:00Z", minutes: 600 },
			rules: { key: "r", reference: "r", version: "r" },
			policies: [],
			days: [{ ...day, date: "2026-09-14", basis: "claimed_in_other_report" as const }],
		};
		expect(perDiemSituation(calculation)).toEqual({
			kind: "unsupported_case",
			reasons: ["overlapping_days"],
		});
		expect(
			perDiemSituation({
				...calculation,
				days: [{ ...day, date: "2026-09-14", basis: "absence_8h_or_less" as const }],
			}),
		).toEqual({ kind: "calculated", reasons: [] });
	});
});

describe("overrideSituationHolds", () => {
	const unsupported = { kind: "unsupported_case" as const, reasons: ["a", "b"] };

	it("keeps an override while the same situation still needs one", () => {
		expect(
			overrideSituationHolds(unsupported, { kind: "unsupported_case", reasons: ["b", "a"] }),
		).toBe(true);
		expect(
			overrideSituationHolds(
				{ kind: "missing_coverage", reasons: ["policy_missing"] },
				{ kind: "missing_coverage", reasons: ["policy_currency"] },
			),
		).toBe(true);
		// Unknown now (a frozen item without a stamp): the recorded situation stands.
		expect(overrideSituationHolds(unsupported, null)).toBe(true);
	});

	it("drops an override whose situation is resolved, changed or no longer overridable", () => {
		expect(overrideSituationHolds(unsupported, { kind: "calculated", reasons: [] })).toBe(false);
		expect(overrideSituationHolds(unsupported, { kind: "unsupported_case", reasons: ["a"] })).toBe(
			false,
		);
		expect(
			overrideSituationHolds(unsupported, {
				kind: "missing_coverage",
				reasons: ["policy_missing"],
			}),
		).toBe(false);
		expect(
			overrideSituationHolds(
				{ kind: "official_fallback", reasons: ["luxembourg"] },
				{ kind: "official_fallback", reasons: ["luxembourg"] },
			),
		).toBe(false);
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
			parseAllowanceOverrideDraft(
				{ ...valid, amount: "18,45" },
				{ kind: "mileage", currency: "EUR" },
			),
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
			parseAllowanceOverrideDraft(
				{ ...valid, amount: "10.50" },
				{ kind: "per_diem", currency: "JPY" },
			),
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
				reasons: ["international", "foreign_time_zone"],
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
				reasons: ["foreign_time_zone", "international"],
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

	it("stops counting an override once the situation it resolved is gone, and says so", () => {
		// The exceptional reasons changed: the manual amount was worked out for others.
		const changed = overriddenPerDiemView(
			perDiemItemView(itinerary, {
				status: "exceptional",
				reasons: ["foreign_time_zone"],
				overlappingDays: [],
			}),
			destinations,
			override(),
			"EUR",
		);
		expect(changed.override).toMatchObject({ applies: false, staleReason: "situation_resolved" });
		expect(changed.amount).toBeNull();
		expect(
			reportItemMissingRequirements(
				{ type: "per_diem", draft: DRAFT, receiptCount: 0, perDiem: changed },
				{ reimbursementCurrency: "EUR", trip: { startDate: "2026-09-14", endDate: "2026-09-16" } },
			),
		).toEqual(["per_diem_exceptional"]);

		// A policy now covers the mileage: the calculated amount counts, not the override.
		const covered = overriddenMileageView(
			{
				...mileageView,
				calculation: {
					status: "calculated",
					distanceKm: "61.50",
					ratePerKm: "0.30",
					currency: "EUR",
					exactAmount: "18.45",
					amount: "18.45",
					rounding: "half_up",
					policy: {
						policyId: "p",
						versionId: "v",
						effectiveFrom: "2026-01-01",
						vehicle: "car",
						ratePerKm: "0.30",
						currency: "EUR",
						source: { kind: "organization", reference: null, version: null, defaultKey: null },
					},
				},
				amount: "18.45",
				currency: "EUR",
			},
			"2026-09-14",
			mileageOverride,
			"EUR",
		);
		expect(covered?.override).toMatchObject({ applies: false, staleReason: "situation_resolved" });
		expect(covered?.amount).toBe("18.45");

		// A frozen item priced with today's policy (no stamp) keeps its recorded situation.
		const frozen = overriddenMileageView(
			{ ...mileageView, calculation: covered?.calculation ?? null },
			"2026-09-14",
			mileageOverride,
			"EUR",
			false,
		);
		expect(frozen?.override).toMatchObject({ applies: true, staleReason: null });
		expect(frozen?.amount).toBe("20.00");
	});

	it("names changed facts as the reason a stale override no longer applies", () => {
		const view = overriddenPerDiemView(
			perDiemItemView(
				{ ...itinerary, endTime: "20:00" },
				{
					status: "exceptional",
					reasons: ["international", "foreign_time_zone"],
					overlappingDays: [],
				},
			),
			destinations,
			override(),
			"EUR",
		);
		expect(view.override).toMatchObject({ applies: false, staleReason: "facts_changed" });
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
