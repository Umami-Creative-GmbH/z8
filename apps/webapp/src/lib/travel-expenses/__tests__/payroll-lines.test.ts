import { describe, expect, it } from "vitest";
import type { TravelExpenseReportSubmittedItem } from "@/lib/approvals/evidence/travel-expense-report-facts";
import type { TravelExpenseReportSubmittedPerDiem } from "@/lib/approvals/evidence/travel-expense-report-per-diem";
import type { MileageVehicle } from "../mileage";
import { formatUnits, parseUnits, STORED_AMOUNT_SCALE, sumUnits } from "../money";
import {
	computePayrollLines,
	type PayrollLine,
	type PayrollLinesInput,
	type PayrollRevision,
} from "../payroll-lines";
import {
	calculatePerDiem,
	type PerDiemItinerary,
	type PerDiemMealDay,
	type PerDiemPolicyVersion,
	type PerDiemRates,
	perDiemPolicyResolver,
	tripDays,
} from "../per-diem";
import type { PerDiemLocation } from "../per-diem-location";
import type { ReceiptExpenseCategory } from "../receipt-report.types";
import {
	GERMAN_DOMESTIC_PER_DIEM_DEFAULT,
	GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT,
} from "../statutory-per-diem-defaults";

/*
 * Payroll lines of an approved expense report (#850, ADR 0004). Expected
 * amounts are worked out by hand from § 9 Abs. 4a EStG (28 / 14 euros, meals
 * 5.60 / 11.20 / 11.20) and § 5 BRKG (0.30 / 0.20 per km), never recomputed
 * the way the code does.
 */

const noMeal = { provided: false, employeePayment: null };
const provided = { provided: true, employeePayment: null };

function itinerary(
	start: string,
	end: string,
	days: Partial<Omit<PerDiemMealDay, "date">>[] = [],
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
	};
}

/**
 * An organization's per diem version. Foreign rates are priced only from a
 * version carrying a verified foreign table, so those name the BMF default.
 */
function perDiemVersion(rates: Partial<Record<string, PerDiemRates>>): PerDiemPolicyVersion {
	const foreign = Object.keys(rates).some((area) => area !== "DE");
	return {
		id: "v-org",
		policyId: "policy-org",
		effectiveFrom: "2026-01-01",
		currency: "EUR",
		source: foreign
			? {
					kind: "statutory_default",
					reference: null,
					version: null,
					defaultKey: GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT.key,
				}
			: { kind: "organization", reference: null, version: null, defaultKey: null },
		withdrawnAt: null,
		rates,
	};
}

/** Rates above the statutory ones: 40 / 20 euros, meals at 20 and 40 percent of 40. */
const GENEROUS_DOMESTIC = {
	DE: {
		fullDay: "40.00",
		partialDay: "20.00",
		breakfastDeduction: "8.00",
		lunchDeduction: "16.00",
		dinnerDeduction: "16.00",
	},
};

const at = (country: string): PerDiemLocation => ({ country, place: null });

const STATUTORY_DOMESTIC = { DE: { ...GERMAN_DOMESTIC_PER_DIEM_DEFAULT.rates } };

/** A per diem item frozen the way submission freezes it, priced with `rates`. */
function perDiemItem(
	trip: PerDiemItinerary,
	rates: Partial<Record<string, PerDiemRates>> = STATUTORY_DOMESTIC,
	options: { itemId?: string; destinations?: string[]; claimedElsewhere?: string[] } = {},
): TravelExpenseReportSubmittedItem {
	const calculation = calculatePerDiem(trip, {
		trip: { destinations: destinationsOf(options.destinations) },
		reimbursementCurrency: "EUR",
		resolvePolicy: perDiemPolicyResolver([perDiemVersion(rates)]),
		overlappingDays: options.claimedElsewhere,
	});
	if (calculation.status !== "calculated") {
		throw new Error(`fixture not calculated: ${JSON.stringify(calculation)}`);
	}
	const perDiem: TravelExpenseReportSubmittedPerDiem = {
		start: {
			date: trip.startDate ?? "",
			time: trip.startTime ?? "",
			timeZone: trip.startTimeZone ?? "",
			at: calculation.absence.startAt,
		},
		end: {
			date: trip.endDate ?? "",
			time: trip.endTime ?? "",
			timeZone: trip.endTimeZone ?? "",
			at: calculation.absence.endAt,
		},
		overnight: trip.startDate === trip.endDate ? null : trip.overnight,
		absenceMinutes: calculation.absence.minutes,
		meals: structuredClone(trip.meals),
		days: structuredClone(calculation.days),
		currency: calculation.currency,
		amount: calculation.amount,
		rules: { ...calculation.rules },
		policies: calculation.policies.map(({ currency: _currency, ...policy }) => policy),
	};
	return {
		...baseItem(options.itemId ?? "per-diem"),
		type: "per_diem",
		expenseDate: perDiem.start.date,
		category: "meals",
		description: "Per diem",
		original: { amount: calculation.amount, currency: "EUR" },
		perDiem,
	};
}

/** A mileage item frozen with the organization's rate per km. */
function mileageItem(
	distanceKm: string,
	ratePerKm: string,
	amount: string,
	options: { itemId?: string; vehicle?: MileageVehicle; expenseDate?: string } = {},
): TravelExpenseReportSubmittedItem {
	return {
		...baseItem(options.itemId ?? "mileage"),
		type: "mileage",
		expenseDate: options.expenseDate ?? "2026-03-02",
		category: "transport",
		description: "Office – customer – back",
		original: { amount, currency: "EUR" },
		mileage: {
			route: "Office – customer – back",
			distanceKm,
			vehicle: options.vehicle ?? "car",
			ratePerKm,
			currency: "EUR",
			exactAmount: amount,
			amount,
			rounding: "half_up",
			policy: {
				policyId: "policy-org",
				versionId: "v-mileage",
				effectiveFrom: "2026-01-01",
				source: { kind: "organization", reference: null, version: null, defaultKey: null },
			},
		},
	};
}

function baseItem(itemId: string): TravelExpenseReportSubmittedItem {
	return {
		itemId,
		position: 0,
		type: "receipt",
		expenseDate: "2026-03-02",
		category: "other",
		description: "Item",
		original: { amount: "0.00", currency: "EUR" },
		paidBy: "employee",
		accountingReference: null,
		receipts: [],
	};
}

function destinationsOf(countries: string[] = ["DE"]) {
	return countries.map((countryCode) => ({ place: null, countryCode }));
}

function revision(
	items: TravelExpenseReportSubmittedItem[],
	options: { currency?: string; destinations?: string[] } = {},
): PayrollRevision {
	return {
		reimbursementCurrency: options.currency ?? "EUR",
		trip: {
			purpose: "Customer visit",
			startDate: "2026-03-02",
			endDate: "2026-03-04",
			timeZone: "Europe/Berlin",
			destinations: destinationsOf(options.destinations),
		},
		items: items.map((item, position) => ({ ...item, position })),
	};
}

function reportInput(
	items: TravelExpenseReportSubmittedItem[],
	overrides: Partial<Extract<PayrollLinesInput, { source: "report" }>> = {},
	destinations?: string[],
): PayrollLinesInput {
	return {
		source: "report",
		revision: revision(items, { destinations }),
		settlementEntries: [],
		priorLines: [],
		...overrides,
	};
}

describe("per diem at the statutory rates", () => {
	it("puts the whole per diem on the statutory share", () => {
		// Arrival 14 + full day 28 + departure 14.
		const item = perDiemItem(itinerary("2026-03-02T08:00", "2026-03-04T18:00"));

		expect(computePayrollLines(reportInput([item]))).toEqual({
			ok: true,
			lines: [{ kind: "per_diem_statutory", amount: "56.00", currency: "EUR" }],
		});
	});
});

describe("per diem above the statutory rates", () => {
	it("splits a domestic trip with meal reductions into statutory share and taxable excess", () => {
		// Breakfast provided on the full day, lunch on the departure day.
		const trip = itinerary("2026-03-02T08:00", "2026-03-04T18:00", [
			{},
			{ breakfast: provided },
			{ lunch: provided },
		]);
		const item = perDiemItem(trip, GENEROUS_DOMESTIC);
		// Organization: 20 + (40 − 8) + (20 − 16) = 56.
		expect(item.original.amount).toBe("56.00");

		// Statutory: 14 + (28 − 5.60) + (14 − 11.20) = 39.20; excess 56 − 39.20 = 16.80.
		expect(computePayrollLines(reportInput([item]))).toEqual({
			ok: true,
			lines: [
				{ kind: "per_diem_statutory", amount: "39.20", currency: "EUR" },
				{ kind: "per_diem_excess", amount: "16.80", currency: "EUR" },
			],
		});
	});

	it("leaves a day another report already paid out of the statutory share too", () => {
		const item = perDiemItem(itinerary("2026-03-02T08:00", "2026-03-04T18:00"), GENEROUS_DOMESTIC, {
			claimedElsewhere: ["2026-03-03"],
		});
		// Organization: 20 + 0 + 20 = 40.
		expect(item.original.amount).toBe("40.00");

		// Statutory: 14 + 0 + 14 = 28; excess 12.
		expect(computePayrollLines(reportInput([item]))).toEqual({
			ok: true,
			lines: [
				{ kind: "per_diem_statutory", amount: "28.00", currency: "EUR" },
				{ kind: "per_diem_excess", amount: "12.00", currency: "EUR" },
			],
		});
	});

	it("splits a single partial day", () => {
		const item = perDiemItem(itinerary("2026-03-02T07:00", "2026-03-02T17:30"), GENEROUS_DOMESTIC);

		expect(computePayrollLines(reportInput([item]))).toEqual({
			ok: true,
			lines: [
				{ kind: "per_diem_statutory", amount: "14.00", currency: "EUR" },
				{ kind: "per_diem_excess", amount: "6.00", currency: "EUR" },
			],
		});
	});

	it("splits a trip abroad against the BMF table of each day", () => {
		// Austria 2026: 50 / 33 euros (BMF 05.12.2025). The organization pays 60 / 40.
		const trip = itinerary("2026-03-02T08:00", "2026-03-03T18:00", [
			{ night: at("AT") },
			{ activityAbroad: at("AT"), breakfast: provided },
		]);
		const item = perDiemItem(
			trip,
			{
				...GENEROUS_DOMESTIC,
				AT: {
					fullDay: "60.00",
					partialDay: "40.00",
					breakfastDeduction: "12.00",
					lunchDeduction: "24.00",
					dinnerDeduction: "24.00",
				},
			},
			{ destinations: ["AT"] },
		);
		// Organization: 40 + (40 − 12) = 68.
		expect(item.original.amount).toBe("68.00");

		// Statutory: 33 + (33 − 10, a fifth of 50) = 56; excess 12.
		expect(computePayrollLines(reportInput([item], {}, ["AT"]))).toEqual({
			ok: true,
			lines: [
				{ kind: "per_diem_statutory", amount: "56.00", currency: "EUR" },
				{ kind: "per_diem_excess", amount: "12.00", currency: "EUR" },
			],
		});
	});
});

describe("mileage", () => {
	it("puts mileage at the statutory rate on the statutory share", () => {
		// Motorcycle: 50 km × 0.20 = 10.00 (§ 5 Abs. 1 BRKG).
		const item = mileageItem("50.00", "0.2000", "10.00", { vehicle: "other_motor_vehicle" });

		expect(computePayrollLines(reportInput([item]))).toEqual({
			ok: true,
			lines: [{ kind: "mileage_statutory", amount: "10.00", currency: "EUR" }],
		});
	});

	it("splits mileage above the statutory rate, rounding so both parts add up", () => {
		// Organization: 123.45 km × 0.42 = 51.849 → 51.85; statutory × 0.30 = 37.035 → 37.04.
		const item = mileageItem("123.45", "0.4200", "51.85");

		expect(computePayrollLines(reportInput([item]))).toEqual({
			ok: true,
			lines: [
				{ kind: "mileage_statutory", amount: "37.04", currency: "EUR" },
				{ kind: "mileage_excess", amount: "14.81", currency: "EUR" },
			],
		});
	});

	it("caps the statutory share at the amount paid when the organization pays less", () => {
		// 100 km × 0.25 = 25.00, below the statutory 30.00.
		const item = mileageItem("100.00", "0.2500", "25.00");

		expect(computePayrollLines(reportInput([item]))).toEqual({
			ok: true,
			lines: [{ kind: "mileage_statutory", amount: "25.00", currency: "EUR" }],
		});
	});
});

function receiptItem(
	itemId: string,
	category: ReceiptExpenseCategory,
	amount: string,
	options: Partial<TravelExpenseReportSubmittedItem> = {},
): TravelExpenseReportSubmittedItem {
	return {
		...baseItem(itemId),
		category,
		original: { amount, currency: "EUR" },
		...options,
	};
}

describe("receipts", () => {
	it("puts each employee-paid receipt on its category's line at its reimbursable amount", () => {
		const items = [
			receiptItem("train", "transport", "89.90"),
			receiptItem("taxi", "transport", "23.10"),
			receiptItem("hotel", "accommodation", "112.00", {
				// Paid in francs; reimbursed at the frozen card charge.
				original: { amount: "118.00", currency: "CHF" },
				conversion: {
					basis: "card_charge",
					sourceCurrency: "CHF",
					targetCurrency: "EUR",
					chargedAmount: "125.37",
					evidenceReceiptId: null,
					reimbursement: { amount: "125.37", currency: "EUR" },
				} as TravelExpenseReportSubmittedItem["conversion"],
			}),
			receiptItem("dinner", "meals", "31.50"),
			receiptItem("garage", "parking", "18.00"),
			receiptItem("adapter", "other", "9.99"),
			receiptItem("flight", "transport", "420.00", { paidBy: "company" }),
		];

		expect(computePayrollLines(reportInput(items))).toEqual({
			ok: true,
			lines: [
				{ kind: "receipt_transport", amount: "113.00", currency: "EUR" },
				{ kind: "receipt_accommodation", amount: "125.37", currency: "EUR" },
				{ kind: "receipt_meals", amount: "31.50", currency: "EUR" },
				{ kind: "receipt_parking", amount: "18.00", currency: "EUR" },
				{ kind: "receipt_other", amount: "9.99", currency: "EUR" },
			],
		});
	});
});

/** The item with an expense administrator's manual allowance (#610), which `original` then holds. */
function overridden(
	item: TravelExpenseReportSubmittedItem,
	amount: string,
): TravelExpenseReportSubmittedItem {
	return {
		...item,
		original: { amount, currency: "EUR" },
		allowanceOverride: {
			overrideId: `override-${item.itemId}`,
			amount,
			currency: "EUR",
		} as TravelExpenseReportSubmittedItem["allowanceOverride"],
	};
}

/** The same frozen facts in another year, e.g. one no verified foreign table covers yet. */
function inYear(
	year: string,
	item: TravelExpenseReportSubmittedItem,
): TravelExpenseReportSubmittedItem {
	return JSON.parse(JSON.stringify(item).replaceAll("2026-", `${year}-`));
}

const ABROAD = itinerary("2026-03-02T08:00", "2026-03-03T18:00", [
	{ night: at("AT") },
	{ activityAbroad: at("AT") },
]);
const BMF_AT = {
	AT: {
		fullDay: "50.00",
		partialDay: "33.00",
		breakfastDeduction: "10.00",
		lunchDeduction: "20.00",
		dinnerDeduction: "20.00",
	},
};

describe("no statutory baseline", () => {
	it("leaves out a report with an overridden per diem or mileage, naming the items", () => {
		const items = [
			receiptItem("train", "transport", "89.90"),
			overridden(
				perDiemItem(ABROAD, BMF_AT, { itemId: "per-diem", destinations: ["AT"] }),
				"80.00",
			),
			overridden(mileageItem("100.00", "0.3000", "30.00"), "45.00"),
		];

		expect(computePayrollLines(reportInput(items, {}, ["AT"]))).toEqual({
			ok: false,
			reason: "no_statutory_baseline",
			items: [
				{ itemId: "per-diem", cause: "allowance_override" },
				{ itemId: "mileage", cause: "allowance_override" },
			],
		});
	});

	it("leaves out an exceptional itinerary through the override that alone prices it", () => {
		// A trip abroad in 2027 before the BMF table for 2027 is verified (#892): no ordinary result.
		const { perDiem: _ordinary, ...exceptional } = inYear(
			"2027",
			perDiemItem(ABROAD, BMF_AT, { destinations: ["AT"] }),
		);

		expect(
			computePayrollLines(reportInput([overridden(exceptional, "70.00")], {}, ["AT"])),
		).toEqual({
			ok: false,
			reason: "no_statutory_baseline",
			items: [{ itemId: "per-diem", cause: "allowance_override" }],
		});
	});

	it("splits a domestic trip in 2027: the domestic rules are open-ended (#891)", () => {
		const item = inYear("2027", perDiemItem(itinerary("2026-03-02T08:00", "2026-03-04T18:00")));

		expect(computePayrollLines(reportInput([item]))).toEqual({
			ok: true,
			lines: [{ kind: "per_diem_statutory", amount: "56.00", currency: "EUR" }],
		});
	});

	it("leaves out a trip abroad in 2027 until that year's BMF table is verified (#892)", () => {
		const item = inYear("2027", perDiemItem(ABROAD, BMF_AT, { destinations: ["AT"] }));

		expect(computePayrollLines(reportInput([item], {}, ["AT"]))).toEqual({
			ok: false,
			reason: "no_statutory_baseline",
			items: [{ itemId: "per-diem", cause: "outside_verified_tables" }],
		});
	});

	it("leaves out frozen per diem days before the verified rule edition", () => {
		const item = inYear("2025", perDiemItem(itinerary("2026-03-02T08:00", "2026-03-04T18:00")));

		expect(computePayrollLines(reportInput([item]))).toEqual({
			ok: false,
			reason: "no_statutory_baseline",
			items: [{ itemId: "per-diem", cause: "outside_verified_tables" }],
		});
	});

	it("leaves out a frozen itinerary the statutory rules do not cover", () => {
		const item = perDiemItem(itinerary("2026-03-02T08:00", "2026-03-04T18:00"));
		const frozen = item.perDiem as TravelExpenseReportSubmittedPerDiem;
		const travelledOn = {
			...item,
			perDiem: { ...frozen, end: { ...frozen.end, timeZone: "Asia/Tokyo" } },
		};

		expect(computePayrollLines(reportInput([travelledOn])).ok).toBe(false);
		expect(computePayrollLines(reportInput([travelledOn]))).toMatchObject({
			reason: "no_statutory_baseline",
			items: [{ itemId: "per-diem", cause: "exceptional_itinerary" }],
		});
	});

	it("leaves out mileage driven before the verified statutory rates", () => {
		const item = mileageItem("100.00", "0.3000", "30.00", { expenseDate: "2025-12-30" });

		expect(computePayrollLines(reportInput([item]))).toEqual({
			ok: false,
			reason: "no_statutory_baseline",
			items: [{ itemId: "mileage", cause: "outside_verified_tables" }],
		});
	});
});

const line = (kind: PayrollLine["kind"], amount: string): PayrollLine => ({
	kind,
	amount,
	currency: "EUR",
});

describe("earlier payroll runs", () => {
	// Split 39.20 statutory + 16.80 excess (see "per diem above the statutory rates").
	const adjustedTrip = () =>
		perDiemItem(
			itinerary("2026-03-02T08:00", "2026-03-04T18:00", [
				{},
				{ breakfast: provided },
				{ lunch: provided },
			]),
			GENEROUS_DOMESTIC,
		);

	it("carries only what earlier payroll runs did not, per kind", () => {
		const input = reportInput([adjustedTrip(), receiptItem("train", "transport", "89.90")], {
			// An adjustment raised the per diem after two runs carried the earlier amounts.
			priorLines: [
				line("per_diem_statutory", "30.00"),
				line("receipt_transport", "89.90"),
				line("per_diem_statutory", "4.00"),
				line("per_diem_excess", "10.00"),
			],
			settlementEntries: [
				{ kind: "reimbursement", payrollRunId: "run-1" },
				{ kind: "reimbursement", payrollRunId: "run-2" },
			],
		});

		expect(computePayrollLines(input)).toEqual({
			ok: true,
			lines: [line("per_diem_statutory", "5.20"), line("per_diem_excess", "6.80")],
		});
	});

	it("owes nothing once earlier runs carried everything", () => {
		const input = reportInput([adjustedTrip()], {
			priorLines: [line("per_diem_statutory", "39.20"), line("per_diem_excess", "16.80")],
			settlementEntries: [{ kind: "reimbursement", payrollRunId: "run-1" }],
		});

		expect(computePayrollLines(input)).toEqual({ ok: false, reason: "nothing_owed" });
	});

	it("owes nothing for a report the company paid entirely", () => {
		const input = reportInput([
			receiptItem("flight", "transport", "420.00", { paidBy: "company" }),
		]);

		expect(computePayrollLines(input)).toEqual({ ok: false, reason: "nothing_owed" });
	});

	it("leaves out a report whose amount moved between kinds", () => {
		// The same 56.00 in total, but more of it statutory than the split now allows.
		const input = reportInput([adjustedTrip()], {
			priorLines: [line("per_diem_statutory", "50.00"), line("per_diem_excess", "6.00")],
			settlementEntries: [{ kind: "reimbursement", payrollRunId: "run-1" }],
		});

		expect(computePayrollLines(input)).toEqual({
			ok: false,
			reason: "negative_difference",
			kinds: ["per_diem_statutory"],
		});
	});

	it("leaves out a report an adjustment lowered below what a run carried", () => {
		const input = reportInput([receiptItem("train", "transport", "60.00")], {
			priorLines: [line("receipt_transport", "89.90")],
			settlementEntries: [{ kind: "reimbursement", payrollRunId: "run-1" }],
		});

		expect(computePayrollLines(input)).toEqual({
			ok: false,
			reason: "negative_difference",
			kinds: ["receipt_transport"],
		});
	});
});

describe("reports a payroll run cannot carry", () => {
	it("leaves out a legacy claim", () => {
		expect(computePayrollLines({ source: "legacy_claim" })).toEqual({
			ok: false,
			reason: "legacy_claim",
		});
	});

	it("leaves out a report reimbursed in another currency", () => {
		const input: PayrollLinesInput = {
			source: "report",
			revision: revision(
				[
					receiptItem("train", "transport", "89.90", {
						original: { amount: "89.90", currency: "CHF" },
					}),
				],
				{ currency: "CHF" },
			),
			settlementEntries: [],
			priorLines: [],
		};

		expect(computePayrollLines(input)).toEqual({ ok: false, reason: "currency_not_eur" });
	});

	it("leaves out a report with a bank-transfer reimbursement", () => {
		const input = reportInput([receiptItem("train", "transport", "89.90")], {
			settlementEntries: [
				{ kind: "reimbursement", payrollRunId: "run-1" },
				{ kind: "reimbursement", payrollRunId: null },
			],
			priorLines: [line("receipt_transport", "40.00")],
		});

		expect(computePayrollLines(input)).toEqual({
			ok: false,
			reason: "reimbursed_outside_payroll",
		});
	});

	it("leaves out a report with a recovery", () => {
		const input = reportInput([receiptItem("train", "transport", "89.90")], {
			settlementEntries: [{ kind: "recovery", payrollRunId: null }],
		});

		expect(computePayrollLines(input)).toEqual({
			ok: false,
			reason: "reimbursed_outside_payroll",
		});
	});

	it("names the money already paid outside payroll before any item without a baseline", () => {
		const input = reportInput([overridden(mileageItem("100.00", "0.3000", "30.00"), "45.00")], {
			settlementEntries: [{ kind: "reimbursement", payrollRunId: null }],
		});

		expect(computePayrollLines(input)).toEqual({
			ok: false,
			reason: "reimbursed_outside_payroll",
		});
	});
});

describe("rounding", () => {
	it.each([
		// distance, organization rate, amount paid (rounded half up), statutory (× 0.30, half up)
		["0.05", "0.3500", "0.02", "0.02"],
		["17.35", "0.3800", "6.59", "5.21"],
		["333.33", "0.4150", "138.33", "100.00"],
		["1.15", "0.3100", "0.36", "0.35"],
	])("splits %s km at %s into parts that add up to %s", (distanceKm, rate, paid, statutory) => {
		const result = computePayrollLines(reportInput([mileageItem(distanceKm, rate, paid)]));
		if (!result.ok) throw new Error(`expected lines, got ${result.reason}`);
		const amounts = Object.fromEntries(result.lines.map((entry) => [entry.kind, entry.amount]));

		expect(amounts.mileage_statutory).toBe(statutory);
		const parts = [amounts.mileage_statutory, amounts.mileage_excess].map((amount = "0.00") => {
			const units = parseUnits(amount, STORED_AMOUNT_SCALE);
			if (units === null) throw new Error(`not an amount: ${amount}`);
			return units;
		});
		expect(formatUnits(sumUnits(parts), STORED_AMOUNT_SCALE)).toBe(paid);
	});
});
