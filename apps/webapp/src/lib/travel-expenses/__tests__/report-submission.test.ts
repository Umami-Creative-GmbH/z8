import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { calculateMileageItem, type MileageCalculation, mileageItemView } from "../mileage";
import type { ReceiptItemDraft } from "../receipt-report";
import {
	checkReportSubmission,
	type ReviewedReportVersions,
	type SubmissionReportFacts,
} from "../report-submission";

/** Evaluated after every date of the fixtures (#685). */
const now = parseInstant("2026-10-07T12:00:00Z");
const check = (report: SubmissionReportFacts, reviewed: ReviewedReportVersions) =>
	checkReportSubmission(report, reviewed, now);

function receipt(overrides: Partial<ReceiptItemDraft> = {}): ReceiptItemDraft {
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

const trip = {
	kind: "trip" as const,
	reimbursementCurrency: "EUR",
	detailsVersion: 4,
	details: {
		purpose: "Customer workshop",
		startDate: "2026-09-14",
		endDate: "2026-09-16",
		timeZone: "Europe/Berlin",
		destinations: [{ place: "Hamburg", countryCode: "DE" }],
	},
	items: [
		{ id: "train", version: 2, draft: receipt(), receiptIds: ["train-r1"] },
		{
			id: "hotel",
			version: 3,
			draft: receipt({
				category: "accommodation",
				description: "Hotel, two nights",
				amount: "240.00",
				paidBy: "company",
			}),
			receiptIds: ["hotel-r1", "hotel-r2"],
		},
	],
};

const reviewedTrip = {
	detailsVersion: 4,
	items: [
		{ id: "train", version: 2, receiptIds: ["train-r1"] },
		{ id: "hotel", version: 3, receiptIds: ["hotel-r2", "hotel-r1"] },
	],
};

describe("checkReportSubmission", () => {
	it("accepts a complete trip and totals employee-paid and company-paid costs separately", () => {
		expect(check(trip, reviewedTrip)).toEqual({
			ok: true,
			totals: { currency: "EUR", reimbursable: "89.90", companyPaid: "240.00", total: "329.90" },
		});
	});

	it("totals a foreign hotel by its authorized conversion (#607)", () => {
		const [train, hotel] = trip.items;
		if (!train || !hotel) throw new Error("fixture");
		const report = {
			...trip,
			items: [
				train,
				{
					...hotel,
					draft: { ...hotel.draft, amount: "300.00", currency: "USD" },
					conversion: {
						basis: "manual_rate" as const,
						sourceCurrency: "USD",
						targetCurrency: "EUR",
						rate: { base: "EUR", quote: "USD", value: "1.25" },
						rateDate: "2026-09-14",
						reason: "Hotel invoice rate",
						evidence: "Hotel invoice no. 88",
						authorizedBy: { employeeId: "admin", name: "Admin" },
						authorizedAt: "2026-09-20T08:00:00Z",
					},
				},
			],
		};
		expect(check(report, reviewedTrip)).toEqual({
			ok: true,
			totals: { currency: "EUR", reimbursable: "89.90", companyPaid: "240.00", total: "329.90" },
		});
	});

	it("accepts a company-paid-only report with a zero reimbursable total", () => {
		const report = {
			kind: "standalone" as const,
			reimbursementCurrency: "EUR",
			detailsVersion: 1,
			details: null,
			items: [
				{ id: "parking", version: 5, draft: receipt({ paidBy: "company" }), receiptIds: ["p-r1"] },
			],
		};
		expect(
			check(report, {
				detailsVersion: null,
				items: [{ id: "parking", version: 5, receiptIds: ["p-r1"] }],
			}),
		).toEqual({
			ok: true,
			totals: { currency: "EUR", reimbursable: "0.00", companyPaid: "89.90", total: "89.90" },
		});
	});

	it("lists what keeps an incomplete report in draft", () => {
		const report = {
			...trip,
			details: { ...trip.details, purpose: null },
			items: [
				{ id: "train", version: 2, draft: receipt(), receiptIds: [] },
				{ id: "hotel", version: 3, draft: receipt({ currency: "USD" }), receiptIds: ["hotel-r1"] },
			],
		};
		expect(
			check(report, {
				...reviewedTrip,
				items: [
					{ id: "train", version: 2, receiptIds: [] },
					{ id: "hotel", version: 3, receiptIds: ["hotel-r1"] },
				],
			}),
		).toEqual({
			ok: false,
			reason: "incomplete",
			missing: {
				trip: ["purpose"],
				items: [
					{ id: "train", missing: ["receipt"] },
					{ id: "hotel", missing: ["conversion_missing"] },
				],
			},
		});
	});

	it("refuses a report that changed after the employee reviewed it", () => {
		const changedItem = check(trip, {
			...reviewedTrip,
			items: [
				{ id: "train", version: 1, receiptIds: ["train-r1"] },
				{ id: "hotel", version: 3, receiptIds: ["hotel-r1", "hotel-r2"] },
			],
		});
		const changedDetails = check(trip, { ...reviewedTrip, detailsVersion: 3 });
		const addedItem = check(trip, {
			...reviewedTrip,
			items: [{ id: "train", version: 2, receiptIds: ["train-r1"] }],
		});
		// A receipt attached after the review step is not what the employee reviewed.
		const addedReceipt = check(trip, {
			...reviewedTrip,
			items: [
				{ id: "train", version: 2, receiptIds: ["train-r1"] },
				{ id: "hotel", version: 3, receiptIds: ["hotel-r1"] },
			],
		});
		expect([changedItem, changedDetails, addedItem, addedReceipt]).toEqual([
			{ ok: false, reason: "changed_since_review" },
			{ ok: false, reason: "changed_since_review" },
			{ ok: false, reason: "changed_since_review" },
			{ ok: false, reason: "changed_since_review" },
		]);
	});

	it("refuses a future-dated report until its dates have happened (#685)", () => {
		const [train, hotel] = trip.items;
		if (!train || !hotel) throw new Error("fixture");
		const report = {
			...trip,
			details: { ...trip.details, endDate: "2026-10-09" },
			items: [{ ...train, draft: receipt({ expenseDate: "2026-10-09" }) }, hotel],
		};
		expect(checkReportSubmission(report, reviewedTrip, now)).toEqual({
			ok: false,
			reason: "incomplete",
			missing: {
				trip: ["trip_not_ended"],
				items: [{ id: "train", missing: ["future_date"] }],
			},
		});
		// 2026-10-09 starts in Pacific/Kiritimati (UTC+14) at 2026-10-08T10:00Z.
		expect(
			checkReportSubmission(report, reviewedTrip, parseInstant("2026-10-08T10:00:00Z")),
		).toMatchObject({ ok: true });
	});

	it("requires exactly one expense on a standalone report", () => {
		const report = {
			kind: "standalone" as const,
			reimbursementCurrency: "EUR",
			detailsVersion: 1,
			details: null,
			items: [],
		};
		expect(check(report, { detailsVersion: null, items: [] })).toEqual({
			ok: false,
			reason: "incomplete",
			missing: { trip: ["expense_item"], items: [] },
		});
	});
});

describe("checkReportSubmission with mileage (#606)", () => {
	const policy = {
		policyId: "policy",
		versionId: "v2026",
		effectiveFrom: "2026-01-01",
		vehicle: "car" as const,
		ratePerKm: "0.3000",
		currency: "EUR",
		source: { kind: "organization" as const, reference: null, version: null, defaultKey: null },
	};
	const mileageDraft = {
		expenseDate: "2026-09-15",
		route: "Hamburg hotel – customer site – back",
		distanceKm: "61.50",
		vehicle: "car" as const,
		accountingReference: null,
	};

	function mileageItem(calculation: MileageCalculation) {
		return {
			id: "drive",
			version: 2,
			type: "mileage" as const,
			draft: receipt({ category: null, description: null, amount: null, currency: null }),
			receiptIds: [],
			mileage: mileageItemView(
				{
					type: "mileage",
					mileageRoute: mileageDraft.route,
					mileageDistanceKm: mileageDraft.distanceKm,
					mileageVehicle: "car",
				},
				calculation,
			),
		};
	}

	const calculated = calculateMileageItem(mileageDraft, { status: "found", policy }, "EUR");

	it("counts a priced mileage item, without receipts, toward the employee's entitlement", () => {
		const report = { ...trip, items: [...trip.items, mileageItem(calculated)] };
		expect(
			check(report, {
				detailsVersion: 4,
				items: [
					...reviewedTrip.items,
					{ id: "drive", version: 2, receiptIds: [], amount: "18.45" },
				],
			}),
		).toEqual({
			ok: true,
			totals: { currency: "EUR", reimbursable: "108.35", companyPaid: "240.00", total: "348.35" },
		});
	});

	it("refuses a calculated amount that differs from the one the employee reviewed", () => {
		const report = { ...trip, items: [...trip.items, mileageItem(calculated)] };
		expect(
			check(report, {
				detailsVersion: 4,
				items: [
					...reviewedTrip.items,
					{ id: "drive", version: 2, receiptIds: [], amount: "15.00" },
				],
			}),
		).toEqual({ ok: false, reason: "changed_since_review" });
	});

	it("keeps a mileage item without policy coverage in draft with actionable guidance", () => {
		const report = {
			...trip,
			items: [mileageItem({ status: "policy_missing", expenseDate: "2026-09-15", vehicle: "car" })],
		};
		expect(
			check(report, {
				detailsVersion: 4,
				items: [{ id: "drive", version: 2, receiptIds: [] }],
			}),
		).toEqual({
			ok: false,
			reason: "incomplete",
			missing: { trip: [], items: [{ id: "drive", missing: ["mileage_policy_missing"] }] },
		});
	});
});
