import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ItemConversion } from "@/lib/travel-expenses/currency-conversion";
import { canonicalJson } from "./absence-facts";
import { ApprovalEvidenceError } from "./errors";
import { CONVERSION_FACTS_SCHEMA_VERSION } from "./travel-expense-report-conversion";
import {
	buildTravelExpenseReportSubmittedFacts,
	compareLiveTravelExpenseReportWithRevision,
	fingerprintTravelExpenseReportFacts,
	type TravelExpenseReportFactsInput,
} from "./travel-expense-report-facts";

/** #607: frozen conversion facts of foreign-currency expenses. */

type ItemRow = TravelExpenseReportFactsInput["items"][number];

function item(id: string, position: number, overrides: Partial<ItemRow> = {}): ItemRow {
	return {
		id,
		organizationId: "org-1",
		reportId: "report-1",
		type: "receipt",
		position,
		expenseDate: "2026-09-14",
		category: "transport",
		description: "Taxi",
		originalAmount: "89.90",
		originalCurrency: "EUR",
		paidBy: "employee",
		accountingReference: null,
		...overrides,
	};
}

function receipt(id: string, itemId: string) {
	return {
		id,
		organizationId: "org-1",
		reportId: "report-1",
		itemId,
		storageProvider: "s3-private",
		storageBucket: "private-bucket",
		storageKey: `travel-expenses/org-1/reports/report-1/${itemId}/${id}.pdf`,
		storageVersionId: "v1",
		checksumSha256: "a".repeat(64),
		sizeBytes: 2048,
		mimeType: "application/pdf",
	};
}

const cardCharge: ItemConversion = {
	basis: "card_charge",
	sourceCurrency: "USD",
	targetCurrency: "EUR",
	chargedAmount: "92.17",
	evidenceReceiptId: "r-statement",
};

const manualRate: ItemConversion = {
	basis: "manual_rate",
	sourceCurrency: "GBP",
	targetCurrency: "EUR",
	rate: { base: "GBP", quote: "EUR", value: "1.1675" },
	rateDate: "2026-09-13",
	reason: "Rate on the hotel's folio",
	authorizedBy: { employeeId: "admin-1", name: "Alex Admin" },
	authorizedAt: "2026-09-20T08:00:00Z",
};

function input(
	overrides: Partial<TravelExpenseReportFactsInput> = {},
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
			tripStartDate: "2026-09-13",
			tripEndDate: "2026-09-16",
			tripTimeZone: "Europe/London",
			tripDestinations: [{ place: "London", countryCode: "GB" }],
		},
		items: [
			item("taxi", 0, { originalAmount: "100.00", originalCurrency: "USD" }),
			item("hotel", 1, {
				category: "accommodation",
				description: "Hotel",
				originalAmount: "200.00",
				originalCurrency: "GBP",
				paidBy: "company",
			}),
			item("train", 2),
		],
		receipts: [
			receipt("r-taxi", "taxi"),
			receipt("r-statement", "taxi"),
			receipt("r-hotel", "hotel"),
			receipt("r-train", "train"),
		],
		conversions: [
			{ organizationId: "org-1", reportId: "report-1", itemId: "taxi", conversion: cardCharge },
			{ organizationId: "org-1", reportId: "report-1", itemId: "hotel", conversion: manualRate },
		],
		...overrides,
	};
}

function expectEvidenceError(fn: () => unknown, code: string, field: string) {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(ApprovalEvidenceError);
		expect((error as ApprovalEvidenceError).code).toBe(code);
		expect((error as ApprovalEvidenceError).details.field).toBe(field);
		return;
	}
	throw new Error("expected an approval evidence error");
}

describe("frozen conversion facts", () => {
	it("keeps the original money and freezes the applied conversion with its result", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(input());
		const [taxi, hotel, train] = facts.items;
		expect(taxi?.original).toEqual({ amount: "100.00", currency: "USD" });
		expect(taxi?.conversion).toEqual({
			basis: "card_charge",
			evidenceReceiptId: "r-statement",
			reimbursement: { amount: "92.17", currency: "EUR" },
		});
		// 200.00 × 1.1675 = 233.50
		expect(hotel?.conversion).toEqual({
			basis: "manual_rate",
			rate: { base: "GBP", quote: "EUR", value: "1.1675" },
			rateDate: "2026-09-13",
			reason: "Rate on the hotel's folio",
			authorizedBy: { employeeId: "admin-1", name: "Alex Admin" },
			authorizedAt: "2026-09-20T08:00:00Z",
			rounding: { mode: "half_up", minorUnitDigits: 2 },
			reimbursement: { amount: "233.50", currency: "EUR" },
		});
		// Nothing is added to an expense in the reimbursement currency.
		expect(train && "conversion" in train).toBe(false);
		expect(facts.totals).toEqual({
			currency: "EUR",
			reimbursable: "182.07",
			companyPaid: "233.50",
		});
	});

	it("refuses a foreign expense without a conversion instead of freezing a guess", () => {
		expectEvidenceError(
			() =>
				buildTravelExpenseReportSubmittedFacts(
					input({ conversions: input().conversions?.slice(1) }),
				),
			"evidence_incomplete",
			"items",
		);
	});

	it("refuses card charge evidence that is not one of the expense's receipts", () => {
		expectEvidenceError(
			() =>
				buildTravelExpenseReportSubmittedFacts(
					input({
						conversions: [
							{
								organizationId: "org-1",
								reportId: "report-1",
								itemId: "taxi",
								conversion: { ...cardCharge, evidenceReceiptId: "r-hotel" },
							},
							...(input().conversions?.slice(1) ?? []),
						],
					}),
				),
			"evidence_incomplete",
			"conversion_evidence",
		);
	});

	it("never freezes a conversion of another organization, report or expense", () => {
		for (const scope of [
			{ organizationId: "org-2", reportId: "report-1", itemId: "taxi" },
			{ organizationId: "org-1", reportId: "report-2", itemId: "taxi" },
			{ organizationId: "org-1", reportId: "report-1", itemId: "elsewhere" },
		]) {
			expectEvidenceError(
				() =>
					buildTravelExpenseReportSubmittedFacts(
						input({ conversions: [{ ...scope, conversion: cardCharge }] }),
					),
				"invariant",
				"conversion_scope",
			);
		}
	});

	it("holds a decision when the live conversion no longer matches the frozen one", () => {
		const submitted = buildTravelExpenseReportSubmittedFacts(input());
		expect(compareLiveTravelExpenseReportWithRevision(submitted, input())).toEqual({
			kind: "current",
		});
		const changed = input({
			conversions: [
				{
					organizationId: "org-1",
					reportId: "report-1",
					itemId: "taxi",
					conversion: { ...cardCharge, chargedAmount: "95.00" },
				},
				...(input().conversions?.slice(1) ?? []),
			],
		});
		expect(compareLiveTravelExpenseReportWithRevision(submitted, changed)).toEqual({
			kind: "material_change",
			changedFields: ["items", "totals"],
		});
	});

	it("adds conversion facts only from schema version 3, after #604's version 2", () => {
		const current = buildTravelExpenseReportSubmittedFacts(input());
		expect(CONVERSION_FACTS_SCHEMA_VERSION).toBe(3);
		expect(current.schemaVersion).toBeGreaterThanOrEqual(CONVERSION_FACTS_SCHEMA_VERSION);
		expect(current.items.some((submitted) => submitted.conversion)).toBe(true);
		// A version 2 snapshot of the same live rows never carries the key.
		const v2 = {
			...current,
			schemaVersion: 2,
			items: current.items.map(({ conversion: _added, ...rest }) => rest),
		};
		expect(compareLiveTravelExpenseReportWithRevision(v2, input())).toEqual({ kind: "current" });
	});

	it("still freezes a v3 report with conversions byte for byte", () => {
		// Golden values computed at schema version 3 (#607), before v4 (#605) added
		// project facts; this report has no project, so nothing changes.
		const V3_FACTS_SHA256 = "226061ea7f9a97b16c1f0c9cdcb06266cab6b53abeeb383735e38905ff519de0";
		const facts = { ...buildTravelExpenseReportSubmittedFacts(input()), schemaVersion: 3 };
		expect(createHash("sha256").update(canonicalJson(facts)).digest("hex")).toBe(V3_FACTS_SHA256);
		expect(fingerprintTravelExpenseReportFacts(facts)).toBe(
			`travel_expense_report:v3:${V3_FACTS_SHA256}`,
		);
		expect(compareLiveTravelExpenseReportWithRevision(facts, input())).toEqual({ kind: "current" });
	});

	it("compares a schema version 1 revision without conversion facts as current", () => {
		const sameCurrency = input({
			items: [item("train", 0)],
			receipts: [receipt("r-train", "train")],
			conversions: [],
		});
		const v1 = { ...buildTravelExpenseReportSubmittedFacts(sameCurrency), schemaVersion: 1 };
		expect(compareLiveTravelExpenseReportWithRevision(v1, sameCurrency)).toEqual({
			kind: "current",
		});
	});
});
