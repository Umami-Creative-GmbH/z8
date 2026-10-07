import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { type ReceiptItemDraft, receiptReportTotals } from "../receipt-report";
import {
	isTripCountryCode,
	parseTripDetailsDraft,
	type TripDetailsDraft,
	tripReportMissingRequirements,
} from "../trip-report";

const now = parseInstant("2026-10-07T12:00:00Z");

const blank = {
	purpose: null,
	startDate: null,
	endDate: null,
	timeZone: "Europe/Berlin",
	destinations: [],
};

function details(overrides: Partial<TripDetailsDraft> = {}): TripDetailsDraft {
	return {
		purpose: "Customer workshop",
		startDate: "2026-09-14",
		endDate: "2026-09-16",
		timeZone: "Europe/Berlin",
		destinations: [{ place: "Hamburg", countryCode: "DE" }],
		...overrides,
	};
}

function item(overrides: Partial<ReceiptItemDraft> = {}): ReceiptItemDraft {
	return {
		expenseDate: "2026-09-14",
		category: "transport",
		description: "Train to Hamburg",
		amount: "89.90",
		currency: "EUR",
		paidBy: "employee",
		accountingReference: null,
		...overrides,
	};
}

describe("parseTripDetailsDraft", () => {
	it("accepts a trip with nothing but its time zone so an unfinished trip can be saved", () => {
		expect(parseTripDetailsDraft(blank)).toEqual({ ok: true, draft: blank });
	});

	it("normalizes entered values and drops destination rows left entirely blank", () => {
		const result = parseTripDetailsDraft({
			purpose: "  Customer workshop ",
			startDate: "2026-09-14",
			endDate: "2026-09-16",
			timeZone: "America/New_York",
			destinations: [
				{ place: " Hamburg ", countryCode: "de" },
				{ place: " ", countryCode: null },
				{ place: null, countryCode: "AT" },
			],
		});
		expect(result).toEqual({
			ok: true,
			draft: {
				purpose: "Customer workshop",
				startDate: "2026-09-14",
				endDate: "2026-09-16",
				timeZone: "America/New_York",
				destinations: [
					{ place: "Hamburg", countryCode: "DE" },
					{ place: null, countryCode: "AT" },
				],
			},
		});
	});

	it("flags malformed dates, a return before departure and unknown zones or countries", () => {
		expect(parseTripDetailsDraft({ ...blank, startDate: "14.09.2026" })).toEqual({
			ok: false,
			errors: { startDate: "invalid_date" },
		});
		expect(
			parseTripDetailsDraft({ ...blank, startDate: "2026-09-16", endDate: "2026-09-14" }),
		).toEqual({ ok: false, errors: { endDate: "end_before_start" } });
		expect(parseTripDetailsDraft({ ...blank, timeZone: "Mars/Olympus" })).toEqual({
			ok: false,
			errors: { timeZone: "invalid_time_zone" },
		});
		expect(parseTripDetailsDraft({ ...blank, timeZone: null })).toEqual({
			ok: false,
			errors: { timeZone: "invalid_time_zone" },
		});
		expect(
			parseTripDetailsDraft({ ...blank, destinations: [{ place: "Atlantis", countryCode: "QQ" }] }),
		).toEqual({ ok: false, errors: { destinations: "invalid_destination" } });
	});

	it("limits text lengths and the number of destinations", () => {
		expect(parseTripDetailsDraft({ ...blank, purpose: "x".repeat(501) })).toEqual({
			ok: false,
			errors: { purpose: "too_long" },
		});
		expect(
			parseTripDetailsDraft({
				...blank,
				destinations: [{ place: "x".repeat(101), countryCode: "DE" }],
			}),
		).toEqual({ ok: false, errors: { destinations: "too_long" } });
		expect(
			parseTripDetailsDraft({
				...blank,
				destinations: Array.from({ length: 11 }, () => ({ place: "Hamburg", countryCode: "DE" })),
			}),
		).toEqual({ ok: false, errors: { destinations: "too_many_destinations" } });
	});
});

describe("isTripCountryCode", () => {
	it("accepts ISO countries and territories but not groupings", () => {
		expect(isTripCountryCode("DE")).toBe(true);
		expect(isTripCountryCode("XK")).toBe(true);
		expect(isTripCountryCode("EU")).toBe(false);
		expect(isTripCountryCode("de")).toBe(false);
		expect(isTripCountryCode("QQ")).toBe(false);
	});
});

describe("tripReportMissingRequirements", () => {
	it("lists the shared trip facts and expenses still missing", () => {
		expect(
			tripReportMissingRequirements({
				details: { ...blank, destinations: [{ place: "Hamburg", countryCode: null }] },
				items: [],
				reimbursementCurrency: "EUR",
				now,
			}),
		).toEqual({
			trip: ["purpose", "travel_dates", "destination", "expense_item"],
			items: [],
		});
	});

	it("names each incomplete expense by its id with its own missing facts", () => {
		expect(
			tripReportMissingRequirements({
				details: details(),
				items: [
					{ id: "train", draft: item(), receiptCount: 1 },
					{ id: "hotel", draft: item({ paidBy: null }), receiptCount: 0 },
				],
				reimbursementCurrency: "EUR",
				now,
			}),
		).toEqual({
			trip: [],
			items: [{ id: "hotel", missing: ["payment_ownership", "receipt"] }],
		});
	});

	it("is complete once trip facts and every expense are complete", () => {
		expect(
			tripReportMissingRequirements({
				details: details(),
				items: [{ id: "train", draft: item(), receiptCount: 1 }],
				reimbursementCurrency: "EUR",
				now,
			}),
		).toEqual({ trip: [], items: [] });
	});

	it("waits for the trip end, on the latest calendar date anywhere (#685)", () => {
		const missing = (at: string, endDate = "2026-10-08") =>
			tripReportMissingRequirements({
				details: details({ endDate }),
				items: [{ id: "train", draft: item(), receiptCount: 1 }],
				reimbursementCurrency: "EUR",
				now: parseInstant(at),
			}).trip;
		// 2026-10-08 starts in Pacific/Kiritimati (UTC+14) at 2026-10-07T10:00Z.
		expect(missing("2026-10-07T09:59:59Z")).toEqual(["trip_not_ended"]);
		expect(missing("2026-10-07T10:00:00Z")).toEqual([]);
		expect(missing("2026-10-07T09:59:59Z", "2026-10-07")).toEqual([]);
	});
});

describe("trip totals with mixed payers", () => {
	it("reimburses only employee-paid receipts while showing company-paid ones", () => {
		expect(
			receiptReportTotals(
				[
					item({ amount: "89.90", paidBy: "employee" }),
					item({ amount: "240.00", paidBy: "company", category: "accommodation" }),
					item({ amount: "12.10", paidBy: "employee", category: "meals" }),
					item({ amount: null, paidBy: "employee" }),
				],
				"EUR",
			),
		).toEqual({
			currency: "EUR",
			reimbursable: "102.00",
			companyPaid: "240.00",
			excludedItemCount: 1,
		});
	});
});
