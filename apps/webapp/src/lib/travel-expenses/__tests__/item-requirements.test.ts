import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ItemConversion } from "../currency-conversion";
import { reportItemMissingRequirements } from "../item-requirements";
import type { MileageItemView } from "../mileage";
import {
	emptyPerDiemItinerary,
	type PerDiemItinerary,
	perDiemItemView,
	tripDays,
} from "../per-diem";
import { receiptExceptionContext } from "../receipt-exception";
import type { ReceiptItemDraft } from "../receipt-report";

/** Per-type requirement dispatch (#606) keeps #604's and #607's receipt checks. */

const draft: ReceiptItemDraft = {
	expenseDate: "2026-09-14",
	category: "transport",
	description: "Taxi",
	amount: "100.00",
	currency: "USD",
	paidBy: "employee",
	accountingReference: null,
};

const cardCharge: ItemConversion = {
	basis: "card_charge",
	sourceCurrency: "USD",
	targetCurrency: "EUR",
	chargedAmount: "92.17",
	evidenceReceiptId: "r-1",
};

const context = { reimbursementCurrency: "EUR", now: parseInstant("2026-10-07T12:00:00Z") };

describe("reportItemMissingRequirements for receipt items", () => {
	it("requires a conversion of a foreign receipt and accepts a saved one (#607)", () => {
		expect(
			reportItemMissingRequirements({ type: "receipt", draft, receiptCount: 1 }, context),
		).toContain("conversion_missing");
		expect(
			reportItemMissingRequirements(
				{ type: "receipt", draft, receiptCount: 1, conversion: cardCharge },
				context,
			),
		).toEqual([]);
	});

	it("accepts a missing-receipt exception instead of a receipt (#604)", () => {
		const sameCurrency = { ...draft, currency: "EUR" };
		expect(
			reportItemMissingRequirements({ draft: sameCurrency, receiptCount: 0 }, context),
		).toEqual(["receipt"]);
		expect(
			reportItemMissingRequirements(
				{
					draft: sameCurrency,
					receiptCount: 0,
					receiptException: receiptExceptionContext("The printer was broken", true),
				},
				context,
			),
		).toEqual([]);
	});

	it("never asks a mileage item for a receipt or a conversion (#606)", () => {
		const missing = reportItemMissingRequirements(
			{ type: "mileage", draft, receiptCount: 0, mileage: null },
			context,
		);
		expect(missing).not.toContain("receipt");
		expect(missing).not.toContain("conversion_missing");
	});
});

describe("future-dated expense items (#685)", () => {
	// 2026-10-08 starts in Pacific/Kiritimati (UTC+14) at 2026-10-07T10:00Z.
	const beforeChange = parseInstant("2026-10-07T09:59:59Z");
	const atChange = parseInstant("2026-10-07T10:00:00Z");
	const complete = { ...draft, currency: "EUR", expenseDate: "2026-10-08" };

	it("refuses a receipt dated after the latest calendar date anywhere", () => {
		const missing = (now: typeof atChange, expenseDate = complete.expenseDate) =>
			reportItemMissingRequirements(
				{ draft: { ...complete, expenseDate }, receiptCount: 1 },
				{ reimbursementCurrency: "EUR", now },
			);
		expect(missing(beforeChange)).toEqual(["future_date"]);
		expect(missing(atChange)).toEqual([]);
		expect(missing(beforeChange, "2026-10-07")).toEqual([]);
	});

	it("refuses a mileage drive dated after the latest calendar date anywhere", () => {
		const mileage: MileageItemView = {
			route: "Berlin – Potsdam",
			distanceKm: "61.50",
			vehicle: "car",
			calculation: {
				status: "calculated",
				distanceKm: "61.50",
				ratePerKm: "0.3000",
				currency: "EUR",
				exactAmount: "18.450000",
				amount: "18.45",
				rounding: "half_up",
				policy: {
					policyId: "p",
					versionId: "v",
					effectiveFrom: "2026-01-01",
					vehicle: "car",
					ratePerKm: "0.3000",
					currency: "EUR",
					source: { kind: "organization", reference: null, version: null, defaultKey: null },
				},
			},
			amount: "18.45",
			currency: "EUR",
		};
		const missing = (now: typeof atChange) =>
			reportItemMissingRequirements(
				{ type: "mileage", draft: complete, receiptCount: 0, mileage },
				{ reimbursementCurrency: "EUR", now },
			);
		expect(missing(beforeChange)).toEqual(["future_date"]);
		expect(missing(atChange)).toEqual([]);
	});

	describe("per diem", () => {
		// Leaves Berlin, returns to New York (UTC-4 in October): a different return zone.
		const itinerary: PerDiemItinerary = {
			...emptyPerDiemItinerary("Europe/Berlin"),
			startDate: "2026-10-05",
			startTime: "08:00",
			endDate: "2026-10-06",
			endTime: "18:00",
			endTimeZone: "America/New_York",
			overnight: "away",
			meals: tripDays("2026-10-05", "2026-10-06").map((date) => ({
				date,
				breakfast: { provided: false, employeePayment: null },
				lunch: { provided: false, employeePayment: null },
				dinner: { provided: false, employeePayment: null },
			})),
		};
		const missing = (now: string) =>
			reportItemMissingRequirements(
				{
					type: "per_diem",
					draft,
					receiptCount: 0,
					perDiem: perDiemItemView(itinerary, { status: "incomplete" }),
				},
				{
					reimbursementCurrency: "EUR",
					trip: { startDate: "2026-10-05", endDate: "2026-10-06" },
					now: parseInstant(now),
				},
			);

		it("refuses a per diem until its exact return instant has passed", () => {
			// 18:00 in New York on 2026-10-06 is 22:00Z.
			expect(missing("2026-10-06T21:59:00Z")).toEqual(["per_diem_not_returned"]);
			expect(missing("2026-10-06T22:00:00Z")).toEqual([]);
			expect(missing("2026-10-06T22:01:00Z")).toEqual([]);
		});
	});
});
