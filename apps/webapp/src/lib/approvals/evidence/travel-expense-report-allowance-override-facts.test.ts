import { describe, expect, it } from "vitest";
import {
	type AllowanceOverride,
	mileageOverrideScope,
	perDiemOverrideScope,
} from "@/lib/travel-expenses/allowance-override";
import {
	calculatePerDiem,
	type PerDiemItinerary,
	perDiemPolicyResolver,
	perDiemStampOf,
	tripDays,
} from "@/lib/travel-expenses/per-diem";
import { GERMAN_DOMESTIC_PER_DIEM_DEFAULT } from "@/lib/travel-expenses/statutory-per-diem-defaults";
import { ApprovalEvidenceError } from "./errors";
import type { TravelExpenseReportAllowanceOverrideRow } from "./travel-expense-report-allowance-override";
import {
	buildTravelExpenseReportSubmittedFacts,
	compareLiveTravelExpenseReportWithRevision,
	type TravelExpenseReportFactsInput,
} from "./travel-expense-report-facts";

/** #610: frozen allowance overrides (schema version 9). */

const paris = [{ place: "Paris", countryCode: "FR" }];

const itinerary: PerDiemItinerary = {
	startDate: "2026-09-14",
	startTime: "07:00",
	startTimeZone: "Europe/Paris",
	endDate: "2026-09-16",
	endTime: "18:00",
	endTimeZone: "Europe/Paris",
	overnight: "away",
	prolongedWorkplace: false,
	meals: tripDays("2026-09-14", "2026-09-16").map((date) => ({
		date,
		breakfast: { provided: date !== "2026-09-14", employeePayment: null },
		lunch: { provided: false, employeePayment: null },
		dinner: { provided: false, employeePayment: null },
	})),
};

const authorized = {
	reason: "International trip; no verified rates yet",
	evidence: "BMF Auslandsreisekosten 2026, France: Paris",
	calculationBasis: "2 × 39.00 + 58.00 − 2 × 11.60 breakfast",
	authorizedBy: { employeeId: "admin-1", name: "Ada Admin" },
	authorizedAt: "2026-09-20T08:00:00Z",
};

function perDiemOverride(overrides: Partial<AllowanceOverride> = {}): AllowanceOverride {
	return {
		id: "override-pd",
		kind: "per_diem",
		amount: "112.80",
		currency: "EUR",
		scope: perDiemOverrideScope(itinerary, paris),
		situation: { kind: "unsupported_case", reasons: ["international", "foreign_time_zone"] },
		...authorized,
		...overrides,
	};
}

function overrideRow(
	itemId: string,
	override: AllowanceOverride,
): TravelExpenseReportAllowanceOverrideRow {
	return { organizationId: "org-1", reportId: "report-1", itemId, override };
}

function perDiemInput(
	overrides: TravelExpenseReportAllowanceOverrideRow[],
	trip: PerDiemItinerary = itinerary,
): TravelExpenseReportFactsInput {
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
			tripTimeZone: "Europe/Paris",
			tripDestinations: paris,
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
			{ itemId: "pd", organizationId: "org-1", reportId: "report-1", ...trip, policy: null },
		],
		allowanceOverrides: overrides,
	};
}

const mileageFacts = {
	expenseDate: "2026-09-14",
	mileageRoute: "Berlin – Potsdam – Berlin",
	mileageDistanceKm: "61.50",
	mileageVehicle: "car" as const,
};

function mileageInput(
	overrides: TravelExpenseReportAllowanceOverrideRow[],
	facts: Partial<typeof mileageFacts> = {},
): TravelExpenseReportFactsInput {
	return {
		report: {
			id: "report-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			kind: "standalone",
			reimbursementCurrency: "EUR",
			submissionCount: 1,
			tripPurpose: null,
			tripStartDate: null,
			tripEndDate: null,
			tripTimeZone: null,
			tripDestinations: [],
		},
		items: [
			{
				id: "km",
				organizationId: "org-1",
				reportId: "report-1",
				type: "mileage",
				position: 0,
				category: null,
				description: null,
				originalAmount: null,
				originalCurrency: null,
				paidBy: "employee",
				accountingReference: null,
				mileagePolicy: null,
				...mileageFacts,
				...facts,
			},
		],
		receipts: [],
		allowanceOverrides: overrides,
	};
}

const mileageOverride: AllowanceOverride = {
	id: "override-km",
	kind: "mileage",
	amount: "18.45",
	currency: "EUR",
	scope: mileageOverrideScope({
		expenseDate: mileageFacts.expenseDate,
		route: mileageFacts.mileageRoute,
		distanceKm: mileageFacts.mileageDistanceKm,
		vehicle: mileageFacts.mileageVehicle,
	}),
	situation: { kind: "missing_coverage", reasons: ["policy_missing"] },
	...authorized,
};

describe("allowance override facts", () => {
	it("freezes an exceptional per diem with its override, the facts and the authorizer", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(
			perDiemInput([overrideRow("pd", perDiemOverride())]),
		);
		expect(facts.schemaVersion).toBe(11);
		const [item] = facts.items;
		expect(item).toMatchObject({
			type: "per_diem",
			category: "meals",
			original: { amount: "112.80", currency: "EUR" },
			allowanceOverride: {
				overrideId: "override-pd",
				kind: "per_diem",
				amount: "112.80",
				currency: "EUR",
				reason: authorized.reason,
				evidence: authorized.evidence,
				calculationBasis: authorized.calculationBasis,
				situation: { kind: "unsupported_case", reasons: ["international", "foreign_time_zone"] },
				authorizedBy: { employeeId: "admin-1", name: "Ada Admin" },
				authorizedAt: "2026-09-20T08:00:00Z",
				scope: { kind: "per_diem", destinations: paris },
			},
		});
		// No ordinary result exists for an unsupported itinerary.
		expect(item?.perDiem).toBeUndefined();
		expect(facts.totals).toEqual({ currency: "EUR", reimbursable: "112.80", companyPaid: "0.00" });
	});

	it("freezes a mileage override without a policy, keeping the entered distance", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(
			mileageInput([overrideRow("km", mileageOverride)]),
		);
		const [item] = facts.items;
		expect(item).toMatchObject({
			type: "mileage",
			category: "transport",
			description: "Berlin – Potsdam – Berlin",
			original: { amount: "18.45", currency: "EUR" },
			allowanceOverride: {
				scope: { kind: "mileage", distanceKm: "61.50", vehicle: "car" },
				situation: { kind: "missing_coverage", reasons: ["policy_missing"] },
			},
		});
		expect(item?.mileage).toBeUndefined();
		expect(facts.totals.reimbursable).toBe("18.45");
	});

	it("keeps the ordinary per diem result beside an override of days another report pays", () => {
		const hamburg = [{ place: "Hamburg", countryCode: "DE" }];
		const trip: PerDiemItinerary = {
			...itinerary,
			startTimeZone: "Europe/Berlin",
			endTimeZone: "Europe/Berlin",
		};
		const calculation = calculatePerDiem(trip, {
			trip: { destinations: hamburg },
			reimbursementCurrency: "EUR",
			resolvePolicy: perDiemPolicyResolver([
				{
					id: "pd-v1",
					policyId: "pd",
					effectiveFrom: "2026-01-01",
					currency: "EUR",
					withdrawnAt: null,
					source: {
						kind: "statutory_default",
						reference: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.reference,
						version: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.version,
						defaultKey: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.key,
					},
					rates: { DE: { ...GERMAN_DOMESTIC_PER_DIEM_DEFAULT.rates } },
				},
			]),
			overlappingDays: ["2026-09-16"],
		});
		if (calculation.status !== "calculated") throw new Error("not calculated");
		const input = (situation: AllowanceOverride["situation"]): TravelExpenseReportFactsInput => {
			const base = perDiemInput([
				overrideRow(
					"pd",
					perDiemOverride({
						amount: "50.40",
						scope: perDiemOverrideScope(trip, hamburg),
						situation,
					}),
				),
			]);
			return {
				...base,
				report: { ...base.report, tripTimeZone: "Europe/Berlin", tripDestinations: hamburg },
				perDiems: [
					{
						itemId: "pd",
						organizationId: "org-1",
						reportId: "report-1",
						...trip,
						policy: perDiemStampOf(calculation),
					},
				],
			};
		};
		// The claimed day is still claimed: the override for it applies beside the calculation.
		const facts = buildTravelExpenseReportSubmittedFacts(
			input({ kind: "unsupported_case", reasons: ["overlapping_days"] }),
		);
		expect(facts.items[0]?.perDiem?.amount).toBe(calculation.amount);
		expect(facts.items[0]?.perDiem?.days.at(-1)?.basis).toBe("claimed_in_other_report");
		expect(facts.items[0]?.original.amount).toBe("50.40");
		expect(facts.items[0]?.allowanceOverride?.amount).toBe("50.40");
		// An override recorded for another situation no longer applies: the calculation counts.
		const resolved = buildTravelExpenseReportSubmittedFacts(
			input({ kind: "missing_coverage", reasons: ["policy_missing"] }),
		);
		expect(resolved.items[0]?.allowanceOverride).toBeUndefined();
		expect(resolved.items[0]?.original.amount).toBe(calculation.amount);
	});

	it("drops a mileage override once the stamped policy prices its facts", () => {
		const facts = buildTravelExpenseReportSubmittedFacts({
			...mileageInput([overrideRow("km", mileageOverride)]),
			items: [
				{
					...mileageInput([]).items[0],
					mileagePolicy: {
						policyId: "mp",
						versionId: "mp-v1",
						effectiveFrom: "2026-01-01",
						vehicle: "car",
						ratePerKm: "0.3000",
						currency: "EUR",
						source: { kind: "organization", reference: null, version: null, defaultKey: null },
						expenseDate: "2026-09-14",
					},
				} as TravelExpenseReportFactsInput["items"][number],
			],
		});
		// The override resolved missing coverage, which the stamped policy now provides.
		expect(facts.items[0]?.mileage?.amount).toBe("18.45");
		expect(facts.items[0]?.original.amount).toBe("18.45");
		expect(facts.items[0]?.allowanceOverride).toBeUndefined();
	});

	it("refuses an override authorized for other facts: the item stays unpriced", () => {
		expect(() =>
			buildTravelExpenseReportSubmittedFacts(
				mileageInput([overrideRow("km", mileageOverride)], { mileageDistanceKm: "70.00" }),
			),
		).toThrow(ApprovalEvidenceError);
		expect(() =>
			buildTravelExpenseReportSubmittedFacts(
				perDiemInput([overrideRow("pd", perDiemOverride())], { ...itinerary, endTime: "20:00" }),
			),
		).toThrow(ApprovalEvidenceError);
	});

	it("never lets an override bypass the trip dates", () => {
		const shifted = {
			...perDiemInput([overrideRow("pd", perDiemOverride())]),
		};
		shifted.report = { ...shifted.report, tripStartDate: "2026-09-13" };
		expect(() => buildTravelExpenseReportSubmittedFacts(shifted)).toThrow(ApprovalEvidenceError);
	});

	it("compares as current while the override and facts are unchanged", () => {
		const live = perDiemInput([overrideRow("pd", perDiemOverride())]);
		const facts = buildTravelExpenseReportSubmittedFacts(live);
		expect(compareLiveTravelExpenseReportWithRevision(facts, live)).toEqual({ kind: "current" });
		expect(
			compareLiveTravelExpenseReportWithRevision(
				facts,
				perDiemInput([overrideRow("pd", perDiemOverride({ id: "other", amount: "100.00" }))]),
			),
		).toEqual({ kind: "material_change", changedFields: ["items", "totals"] });
		expect(compareLiveTravelExpenseReportWithRevision(facts, perDiemInput([]))).toMatchObject({
			kind: "material_change",
		});
	});

	it("refuses an override row of another report or item type", () => {
		const foreign = { ...overrideRow("pd", perDiemOverride()), reportId: "report-2" };
		expect(() => buildTravelExpenseReportSubmittedFacts(perDiemInput([foreign]))).toThrow(
			expect.objectContaining({ code: "invariant" }),
		);
		const wrongKind = overrideRow("pd", { ...mileageOverride });
		expect(() => buildTravelExpenseReportSubmittedFacts(perDiemInput([wrongKind]))).toThrow(
			expect.objectContaining({ code: "invariant" }),
		);
	});

	it("ignores overrides when snapshotting an older revision version", () => {
		const live = perDiemInput([overrideRow("pd", perDiemOverride())]);
		const v8 = { ...buildTravelExpenseReportSubmittedFacts(live), schemaVersion: 8 };
		// A v8 revision never had an override, so the live override cannot match it.
		expect(compareLiveTravelExpenseReportWithRevision(v8, live).kind).toBe("material_change");
	});
});
