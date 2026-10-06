import { describe, expect, it } from "vitest";
import { composeAdjustmentBaseline } from "@/lib/travel-expenses/adjustment";
import {
	buildTravelExpenseReportSubmittedFacts,
	compareLiveTravelExpenseReportWithRevision,
	fingerprintTravelExpenseReportFacts,
	type TravelExpenseReportFactsInput,
} from "./travel-expense-report-facts";

const report: TravelExpenseReportFactsInput["report"] = {
	id: "adjustment-1",
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
};

const item = {
	id: "hotel",
	organizationId: "org-1",
	reportId: "adjustment-1",
	type: "receipt" as const,
	position: 0,
	expenseDate: "2026-09-14",
	category: "accommodation" as const,
	description: "Hotel",
	originalAmount: "450.00",
	originalCurrency: "EUR",
	paidBy: "employee" as const,
	accountingReference: null,
};

const receipt = {
	id: "r-1",
	organizationId: "org-1",
	reportId: "adjustment-1",
	itemId: "hotel",
	storageProvider: "s3-private",
	storageBucket: "private-bucket",
	// The copied receipt names the original report's stored object.
	storageKey: "travel-expenses/org-1/reports/original-1/hotel/r-0-invoice.pdf",
	storageVersionId: "v1",
	checksumSha256: "a".repeat(64),
	sizeBytes: 2048,
	mimeType: "application/pdf",
};

const baseline = composeAdjustmentBaseline(
	{
		originalReportId: "original-1",
		revisionId: "revision-0",
		submissionCycle: 1,
		currency: "EUR",
		approvedAmount: "500.00",
	},
	[],
);

const link = { originalReportId: "original-1", reason: "The hotel refunded one night" };

const adjustmentInput: TravelExpenseReportFactsInput = {
	report,
	items: [item],
	receipts: [receipt],
	adjustment: link,
	adjustmentBaseline: baseline,
};

describe("adjustment report facts (v8, #615)", () => {
	it("freezes the corrected report, its reason, baseline and signed delta", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(adjustmentInput);

		expect(facts.schemaVersion).toBe(8);
		expect(facts.totals).toEqual({ currency: "EUR", reimbursable: "450.00", companyPaid: "0.00" });
		expect(facts.adjustment).toEqual({
			originalReportId: "original-1",
			reason: "The hotel refunded one night",
			baseline,
			delta: { amount: "-50.00", currency: "EUR" },
		});
		expect(fingerprintTravelExpenseReportFacts(facts)).toMatch(/^travel_expense_report:v8:/);
	});

	it("is material: the reviewed delta and baseline are part of the fingerprint", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(adjustmentInput);
		const otherBaseline = buildTravelExpenseReportSubmittedFacts({
			...adjustmentInput,
			adjustmentBaseline: composeAdjustmentBaseline({ ...baseline, approvedAmount: "480.00" }, []),
		});
		expect(fingerprintTravelExpenseReportFacts(otherBaseline)).not.toBe(
			fingerprintTravelExpenseReportFacts(facts),
		);
	});

	it("refuses to freeze an adjustment without its resolved baseline", () => {
		expect(() =>
			buildTravelExpenseReportSubmittedFacts({ ...adjustmentInput, adjustmentBaseline: undefined }),
		).toThrow(expect.objectContaining({ code: "evidence_incomplete" }));
		expect(() =>
			buildTravelExpenseReportSubmittedFacts({
				...adjustmentInput,
				adjustmentBaseline: { ...baseline, originalReportId: "another-report" },
			}),
		).toThrow(expect.objectContaining({ code: "evidence_incomplete" }));
		expect(() =>
			buildTravelExpenseReportSubmittedFacts({
				...adjustmentInput,
				adjustmentBaseline: { ...baseline, currency: "USD" },
			}),
		).toThrow(expect.objectContaining({ code: "evidence_incomplete" }));
	});

	it("compares unchanged live rows as current and a changed correction as material", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(adjustmentInput);
		// Live rows carry the link only; the frozen baseline is kept when comparing.
		const live = { ...adjustmentInput, adjustmentBaseline: undefined };
		expect(compareLiveTravelExpenseReportWithRevision(facts, live)).toEqual({ kind: "current" });

		const changed = { ...live, items: [{ ...item, originalAmount: "440.00" }] };
		expect(compareLiveTravelExpenseReportWithRevision(facts, changed)).toEqual({
			kind: "material_change",
			changedFields: ["items", "totals", "adjustment"],
		});
		const unlinked = { ...live, adjustment: null };
		expect(compareLiveTravelExpenseReportWithRevision(facts, unlinked)).toEqual({
			kind: "material_change",
			changedFields: ["adjustment"],
		});
	});

	it("adds nothing to a report that is not an adjustment", () => {
		const plain = buildTravelExpenseReportSubmittedFacts({
			report,
			items: [item],
			receipts: [receipt],
		});
		expect("adjustment" in plain).toBe(false);
	});
});
