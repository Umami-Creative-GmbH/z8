import { describe, expect, it } from "vitest";
import {
	calculatePerDiem,
	type PerDiemItinerary,
	perDiemPolicyResolver,
	perDiemStampOf,
	type StampedPerDiemPolicy,
} from "@/lib/travel-expenses/per-diem";
import {
	BMF_FOREIGN_PER_DIEM_2026,
	foreignTableRates,
} from "@/lib/travel-expenses/statutory-foreign-per-diem";
import {
	GERMAN_DOMESTIC_PER_DIEM_DEFAULT,
	GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT,
} from "@/lib/travel-expenses/statutory-per-diem-defaults";
import {
	buildTravelExpenseReportSubmittedFacts,
	compareLiveTravelExpenseReportWithRevision,
	type TravelExpenseReportFactsInput,
} from "./travel-expense-report-facts";
import type { TravelExpenseReportPerDiemRow } from "./travel-expense-report-per-diem";

/** #611: frozen daily locations of an international per diem (schema version 10). */

const destinations = [
	{ place: "Paris", countryCode: "FR" },
	{ place: "Genf", countryCode: "CH" },
];
const noMeal = { provided: false, employeePayment: null };

// Monday to Paris, Tuesday on to Geneva, Wednesday home after a morning meeting in Geneva.
const itinerary: PerDiemItinerary = {
	startDate: "2026-09-14",
	startTime: "06:30",
	startTimeZone: "Europe/Berlin",
	endDate: "2026-09-16",
	endTime: "21:00",
	endTimeZone: "Europe/Berlin",
	overnight: "away",
	prolongedWorkplace: false,
	meals: [
		{
			date: "2026-09-14",
			breakfast: noMeal,
			lunch: noMeal,
			dinner: noMeal,
			night: { country: "FR", place: "paris" },
		},
		{
			date: "2026-09-15",
			breakfast: { provided: true, employeePayment: null },
			lunch: noMeal,
			dinner: noMeal,
			night: { country: "CH", place: "genf" },
		},
		{
			date: "2026-09-16",
			breakfast: { provided: true, employeePayment: null },
			lunch: noMeal,
			dinner: noMeal,
			activityAbroad: { country: "CH", place: "genf" },
		},
	],
};

function stamp(): StampedPerDiemPolicy {
	const calculation = calculatePerDiem(itinerary, {
		trip: { destinations },
		reimbursementCurrency: "EUR",
		resolvePolicy: perDiemPolicyResolver([
			{
				id: "pd-intl",
				policyId: "pd-policy",
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
			},
		]),
	});
	if (calculation.status !== "calculated") throw new Error(JSON.stringify(calculation));
	return perDiemStampOf(calculation);
}

function input(row: Partial<TravelExpenseReportPerDiemRow> = {}): TravelExpenseReportFactsInput {
	return {
		report: {
			id: "report-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			kind: "trip",
			reimbursementCurrency: "EUR",
			submissionCount: 1,
			tripPurpose: "Partner visits",
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
		perDiems: [
			{
				itemId: "pd",
				organizationId: "org-1",
				reportId: "report-1",
				...itinerary,
				policy: stamp(),
				...row,
			},
		],
	};
}

describe("frozen daily per diem locations", () => {
	it("freezes each day's location decision, the answers and the table edition", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(input());
		expect(facts.schemaVersion).toBe(10);
		const perDiem = facts.items[0]?.perDiem;
		// Paris arrival 39; Geneva full day 70 - breakfast 14 (20 % of 70); departure 47 - 14.
		expect(perDiem?.days.map((day) => [day.location?.area, day.rate, day.amount])).toEqual([
			["FR:paris", "39.00", "39.00"],
			["CH:genf", "70.00", "56.00"],
			["CH:genf", "47.00", "33.00"],
		]);
		expect(perDiem?.days[2]?.location).toEqual({
			entered: { country: "CH", place: "genf" },
			basis: "last_activity_abroad",
			rule: "listed",
			area: "CH:genf",
			country: "CH",
			place: "genf",
			label: "Schweiz – Genf",
		});
		expect(perDiem?.meals[0]?.night).toEqual({ country: "FR", place: "paris" });
		expect(perDiem?.rules.foreignTable?.key).toBe("de-bmf-foreign-per-diem-2026");
		expect(perDiem?.policies.map((policy) => policy.area)).toEqual(["FR:paris", "CH:genf"]);
		expect(facts.totals.reimbursable).toBe("128.00");
	});

	it("compares unchanged locations as current and a moved day as a material change", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(input());
		expect(compareLiveTravelExpenseReportWithRevision(facts, input())).toEqual({
			kind: "current",
		});
		const moved = structuredClone(itinerary.meals);
		if (moved[0]) moved[0].night = { country: "FR", place: null };
		expect(
			compareLiveTravelExpenseReportWithRevision(facts, input({ meals: moved })),
		).toMatchObject({ kind: "material_change" });
	});

	it("never matches daily locations against a revision frozen before version 10", () => {
		const facts = { ...buildTravelExpenseReportSubmittedFacts(input()), schemaVersion: 9 };
		expect(compareLiveTravelExpenseReportWithRevision(facts, input())).toMatchObject({
			kind: "material_change",
		});
	});
});
