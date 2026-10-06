import { describe, expect, it } from "vitest";
import type { ItemConversion } from "@/lib/travel-expenses/currency-conversion";
import { REFERENCE_RATE_FACTS_SCHEMA_VERSION } from "./travel-expense-report-conversion";
import {
	buildTravelExpenseReportSubmittedFacts,
	compareLiveTravelExpenseReportWithRevision,
	type TravelExpenseReportFactsInput,
} from "./travel-expense-report-facts";

/** #608: frozen reference-rate conversions. */

const reference: ItemConversion = {
	basis: "reference_rate",
	sourceCurrency: "USD",
	targetCurrency: "EUR",
	rate: { base: "EUR", quote: "USD", value: "1.1525" },
	rateDate: "2026-04-02",
	expenseDate: "2026-04-05",
	source: {
		provider: "ecb",
		publicationId: "pub-2026-04-02-v1",
		publicationVersion: 1,
		contentSha256: "f".repeat(64),
		retrievedAt: "2026-04-02T15:00:00Z",
		policyApprovedAt: "2026-03-01T09:00:00Z",
	},
};

function input(conversion: ItemConversion = reference): TravelExpenseReportFactsInput {
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
				id: "taxi",
				organizationId: "org-1",
				reportId: "report-1",
				type: "receipt",
				position: 0,
				expenseDate: "2026-04-05",
				category: "transport",
				description: "Taxi on Easter Sunday",
				originalAmount: "100.00",
				originalCurrency: "USD",
				paidBy: "employee",
				accountingReference: null,
			},
		],
		receipts: [
			{
				id: "r-taxi",
				organizationId: "org-1",
				reportId: "report-1",
				itemId: "taxi",
				storageProvider: "s3-private",
				storageBucket: "private-bucket",
				storageKey: "travel-expenses/org-1/reports/report-1/taxi/r-taxi.pdf",
				storageVersionId: "v1",
				checksumSha256: "a".repeat(64),
				sizeBytes: 2048,
				mimeType: "application/pdf",
			},
		],
		conversions: [{ organizationId: "org-1", reportId: "report-1", itemId: "taxi", conversion }],
	};
}

describe("frozen reference-rate conversion facts", () => {
	it("freezes the publication, its real date, the expense date and the rounded result", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(input());
		expect(facts.schemaVersion).toBeGreaterThanOrEqual(REFERENCE_RATE_FACTS_SCHEMA_VERSION);
		expect(facts.items[0]?.conversion).toEqual({
			basis: "reference_rate",
			rate: { base: "EUR", quote: "USD", value: "1.1525" },
			rateDate: "2026-04-02",
			expenseDate: "2026-04-05",
			source: reference.basis === "reference_rate" ? reference.source : undefined,
			rounding: { mode: "half_up", minorUnitDigits: 2 },
			reimbursement: { amount: "86.77", currency: "EUR" },
		});
		expect(facts.totals).toEqual({ currency: "EUR", reimbursable: "86.77", companyPaid: "0.00" });
	});

	it("holds a decision when the stored conversion names another publication version", () => {
		const submitted = buildTravelExpenseReportSubmittedFacts(input());
		expect(compareLiveTravelExpenseReportWithRevision(submitted, input())).toEqual({
			kind: "current",
		});
		if (reference.basis !== "reference_rate") throw new Error("unreachable");
		const corrected = input({
			...reference,
			rate: { ...reference.rate, value: "1.153" },
			source: { ...reference.source, publicationId: "pub-2026-04-02-v2", publicationVersion: 2 },
		});
		expect(compareLiveTravelExpenseReportWithRevision(submitted, corrected)).toMatchObject({
			kind: "material_change",
		});
	});

	it("never emits a reference conversion into a revision of an older schema version", () => {
		expect(REFERENCE_RATE_FACTS_SCHEMA_VERSION).toBe(6);
		const v5 = { ...buildTravelExpenseReportSubmittedFacts(input()), schemaVersion: 5 };
		// The v5 snapshot of the same rows has no conversion for the expense: it changed.
		expect(compareLiveTravelExpenseReportWithRevision(v5, input())).not.toEqual({
			kind: "current",
		});
	});
});
