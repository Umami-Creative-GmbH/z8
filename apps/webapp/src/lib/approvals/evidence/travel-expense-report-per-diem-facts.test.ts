import { describe, expect, it } from "vitest";
import {
	calculatePerDiem,
	type PerDiemItinerary,
	perDiemPolicyResolver,
	perDiemStampOf,
	type StampedPerDiemPolicy,
	tripDays,
} from "@/lib/travel-expenses/per-diem";
import { GERMAN_DOMESTIC_PER_DIEM_DEFAULT } from "@/lib/travel-expenses/statutory-per-diem-defaults";
import { ApprovalEvidenceError } from "./errors";
import {
	buildTravelExpenseReportSubmittedFacts,
	compareLiveTravelExpenseReportWithRevision,
	type TravelExpenseReportFactsInput,
} from "./travel-expense-report-facts";
import type { TravelExpenseReportPerDiemRow } from "./travel-expense-report-per-diem";

/** #609: frozen per diem facts (schema version 7). */

const destinations = [{ place: "Hamburg", countryCode: "DE" }];

function itinerary(overrides: Partial<PerDiemItinerary> = {}): PerDiemItinerary {
	return {
		startDate: "2026-09-14",
		startTime: "07:00",
		startTimeZone: "Europe/Berlin",
		endDate: "2026-09-16",
		endTime: "18:00",
		endTimeZone: "Europe/Berlin",
		overnight: "away",
		prolongedWorkplace: false,
		meals: tripDays("2026-09-14", "2026-09-16").map((date) => ({
			date,
			breakfast: { provided: date !== "2026-09-14", employeePayment: null },
			lunch: { provided: false, employeePayment: null },
			dinner: { provided: false, employeePayment: null },
		})),
		...overrides,
	};
}

function stampFor(trip: PerDiemItinerary, fullDay = "28.00"): StampedPerDiemPolicy {
	const calculation = calculatePerDiem(trip, {
		trip: { destinations },
		reimbursementCurrency: "EUR",
		resolvePolicy: perDiemPolicyResolver([
			{
				id: "pd-v1",
				policyId: "pd-policy",
				effectiveFrom: "2026-01-01",
				currency: "EUR",
				source: { kind: "organization", reference: "Travel policy", version: null, defaultKey: null },
				withdrawnAt: null,
				rates: { DE: { ...GERMAN_DOMESTIC_PER_DIEM_DEFAULT.rates, fullDay } },
			},
		]),
	});
	if (calculation.status !== "calculated") throw new Error("not calculated");
	return perDiemStampOf(calculation);
}

function row(trip: PerDiemItinerary, stamp: StampedPerDiemPolicy | null): TravelExpenseReportPerDiemRow {
	return {
		itemId: "pd",
		organizationId: "org-1",
		reportId: "report-1",
		...trip,
		policy: stamp,
	};
}

function input(perDiem: TravelExpenseReportPerDiemRow): TravelExpenseReportFactsInput {
	return {
		report: {
			id: "report-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			kind: "trip",
			reimbursementCurrency: "EUR",
			submissionCount: 1,
			tripPurpose: "Customer workshop",
			tripStartDate: "2026-09-14",
			tripEndDate: "2026-09-16",
			tripTimeZone: "Europe/Berlin",
			tripDestinations: destinations,
		},
		items: [
			{
				id: "pd",
				organizationId: "org-1",
				reportId: "report-1",
				type: "per_diem",
				position: 0,
				expenseDate: "2026-09-14",
				category: null,
				description: null,
				originalAmount: null,
				originalCurrency: null,
				paidBy: "employee",
				accountingReference: null,
			},
		],
		receipts: [],
		perDiems: [perDiem],
	};
}

describe("per diem facts", () => {
	it("freezes the itinerary, stamped policy and daily breakdown with totals", () => {
		const trip = itinerary();
		const facts = buildTravelExpenseReportSubmittedFacts(input(row(trip, stampFor(trip))));
		expect(facts.schemaVersion).toBe(7);
		const [item] = facts.items;
		expect(item).toMatchObject({
			type: "per_diem",
			expenseDate: "2026-09-14",
			category: "meals",
			description: "Per diem",
			// 14 + (28 - 5.60) + (14 - 5.60)
			original: { amount: "44.80", currency: "EUR" },
		});
		expect(item?.perDiem).toMatchObject({
			start: { date: "2026-09-14", time: "07:00", at: "2026-09-14T05:00:00Z" },
			end: { date: "2026-09-16", time: "18:00", at: "2026-09-16T16:00:00Z" },
			overnight: "away",
			amount: "44.80",
			rules: { key: "de-domestic-per-diem-estg-9-4a-2026" },
			policies: [expect.objectContaining({ versionId: "pd-v1", area: "DE" })],
		});
		expect(item?.perDiem?.days.map((day) => day.amount)).toEqual(["14.00", "22.40", "8.40"]);
		expect(facts.totals).toEqual({ currency: "EUR", reimbursable: "44.80", companyPaid: "0.00" });
	});

	it("freezes a legitimate zero allowance", () => {
		const trip = itinerary({
			startDate: "2026-09-14",
			endDate: "2026-09-14",
			startTime: "09:00",
			endTime: "15:00",
			overnight: null,
			meals: tripDays("2026-09-14", "2026-09-14").map((date) => ({
				date,
				breakfast: { provided: false, employeePayment: null },
				lunch: { provided: false, employeePayment: null },
				dinner: { provided: false, employeePayment: null },
			})),
		});
		const facts = buildTravelExpenseReportSubmittedFacts({
			...input(row(trip, stampFor(trip))),
			report: { ...input(row(trip, null)).report, tripEndDate: "2026-09-14" },
		});
		expect(facts.items[0]?.original.amount).toBe("0.00");
		expect(facts.totals.reimbursable).toBe("0.00");
	});

	it("refuses to freeze a per diem without a stamp or off the trip dates", () => {
		const trip = itinerary();
		expect(() => buildTravelExpenseReportSubmittedFacts(input(row(trip, null)))).toThrow(
			ApprovalEvidenceError,
		);
		const moved = itinerary({ endDate: "2026-09-15", meals: itinerary().meals.slice(0, 2) });
		expect(() => buildTravelExpenseReportSubmittedFacts(input(row(moved, stampFor(moved))))).toThrow(
			ApprovalEvidenceError,
		);
	});

	it("compares as current from the stamp, whatever today's policy says", () => {
		const trip = itinerary();
		const live = input(row(trip, stampFor(trip)));
		const facts = buildTravelExpenseReportSubmittedFacts(live);
		expect(compareLiveTravelExpenseReportWithRevision(facts, live)).toEqual({ kind: "current" });
	});

	it("holds a changed itinerary or stamp as a material change", () => {
		const trip = itinerary();
		const facts = buildTravelExpenseReportSubmittedFacts(input(row(trip, stampFor(trip))));
		const later = itinerary({ endTime: "23:00" });
		expect(
			compareLiveTravelExpenseReportWithRevision(facts, input(row(later, stampFor(trip)))),
		).toEqual({ kind: "material_change", changedFields: ["items"] });
		expect(
			compareLiveTravelExpenseReportWithRevision(facts, input(row(trip, stampFor(trip, "30.00")))),
		).toEqual({ kind: "material_change", changedFields: ["items", "totals"] });
		expect(compareLiveTravelExpenseReportWithRevision(facts, input(row(trip, null)))).toMatchObject({
			kind: "material_change",
		});
	});

	it("refuses a per diem row of another report as a scope breach", () => {
		const trip = itinerary();
		const foreign = { ...row(trip, stampFor(trip)), reportId: "report-2" };
		expect(() => buildTravelExpenseReportSubmittedFacts(input(foreign))).toThrow(
			expect.objectContaining({ code: "invariant" }),
		);
	});
});
