import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "./absence-facts";
import { ApprovalEvidenceError } from "./errors";
import {
	buildTravelExpenseReportSubmittedFacts,
	compareLiveTravelExpenseReportWithRevision,
	fingerprintTravelExpenseReportFacts,
	TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION,
	type TravelExpenseReportFactsInput,
} from "./travel-expense-report-facts";

type ItemRow = TravelExpenseReportFactsInput["items"][number];

function item(id: string, position: number, overrides: Partial<ItemRow> = {}): ItemRow {
	return {
		id,
		organizationId: "org-1",
		reportId: "report-1",
		type: "receipt",
		position,
		expenseDate: "2026-09-14",
		category: "meals",
		description: "Customer dinner",
		originalAmount: "64.20",
		originalCurrency: "EUR",
		paidBy: "employee",
		accountingReference: null,
		...overrides,
	};
}

const trainReceipt = {
	id: "r-1",
	organizationId: "org-1",
	reportId: "report-1",
	itemId: "train",
	storageProvider: "s3-private",
	storageBucket: "private-bucket",
	storageKey: "travel-expenses/org-1/reports/report-1/train/r-1-receipt.pdf",
	storageVersionId: "v1",
	checksumSha256: "a".repeat(64),
	sizeBytes: 2048,
	mimeType: "application/pdf",
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
			tripStartDate: "2026-09-14",
			tripEndDate: "2026-09-16",
			tripTimeZone: "Europe/Berlin",
			tripDestinations: [{ place: "Hamburg", countryCode: "DE" }],
		},
		items: [
			item("train", 0, { category: "transport", description: "Train", originalAmount: "89.90" }),
			item("dinner", 1, { receiptExceptionReason: "The restaurant printer was broken" }),
		],
		receipts: [trainReceipt],
		receiptExceptionsAllowed: true,
		...overrides,
	};
}

function evidenceErrorOf(fn: () => unknown) {
	try {
		fn();
	} catch (error) {
		if (error instanceof ApprovalEvidenceError) return { code: error.code, ...error.details };
		throw error;
	}
	throw new Error("expected an approval evidence error");
}

describe("frozen missing-receipt exceptions (#604)", () => {
	it("freezes the explained exception of an expense without receipts and counts it", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(input());

		expect(TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
		expect(facts.schemaVersion).toBe(TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION);
		expect(facts.items[1]).toMatchObject({
			itemId: "dinner",
			receipts: [],
			receiptException: { reason: "The restaurant printer was broken" },
		});
		expect(facts.totals).toEqual({ currency: "EUR", reimbursable: "154.10", companyPaid: "0.00" });
	});

	it("omits the key for expenses with receipts, even with a leftover explanation", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(
			input({
				items: [
					item("train", 0, { receiptExceptionReason: "Thought it was lost" }),
					item("dinner", 1, { receiptExceptionReason: "The restaurant printer was broken" }),
				],
			}),
		);
		expect(Object.hasOwn(facts.items[0] ?? {}, "receiptException")).toBe(false);
	});

	it("refuses to freeze an exception the organization does not allow", () => {
		expect(
			evidenceErrorOf(() =>
				buildTravelExpenseReportSubmittedFacts(input({ receiptExceptionsAllowed: false })),
			),
		).toEqual({ code: "evidence_incomplete", field: "items" });
		const { receiptExceptionsAllowed: _omitted, ...withoutPolicy } = input();
		expect(evidenceErrorOf(() => buildTravelExpenseReportSubmittedFacts(withoutPolicy))).toEqual({
			code: "evidence_incomplete",
			field: "items",
		});
	});

	it("compares an unchanged exception as current, whatever today's policy says", () => {
		const submitted = buildTravelExpenseReportSubmittedFacts(input());
		expect(
			compareLiveTravelExpenseReportWithRevision(
				submitted,
				input({ receiptExceptionsAllowed: false }),
			),
		).toEqual({ kind: "current" });
	});

	it("holds a report whose exception explanation changed or was replaced by a receipt", () => {
		const submitted = buildTravelExpenseReportSubmittedFacts(input());
		expect(
			compareLiveTravelExpenseReportWithRevision(
				submitted,
				input({
					items: [
						item("train", 0, {
							category: "transport",
							description: "Train",
							originalAmount: "89.90",
						}),
						item("dinner", 1, { receiptExceptionReason: "Something else" }),
					],
				}),
			),
		).toEqual({ kind: "material_change", changedFields: ["items"] });
	});

	it("still freezes a v2 report with an exception byte for byte", () => {
		// Golden values computed at schema version 2 (#604), before v3 (#607) added
		// conversion facts; this report has no foreign expense, so nothing changes.
		const V2_FACTS_SHA256 = "0f45fb85d93fc65649ca7b5c1ff8020331eebb2ec3f6dd2bd11e6734c1b1f4c8";
		const facts = { ...buildTravelExpenseReportSubmittedFacts(input()), schemaVersion: 2 };
		expect(createHash("sha256").update(canonicalJson(facts)).digest("hex")).toBe(V2_FACTS_SHA256);
		expect(fingerprintTravelExpenseReportFacts(facts)).toBe(
			`travel_expense_report:v2:${V2_FACTS_SHA256}`,
		);
		expect(compareLiveTravelExpenseReportWithRevision(facts, input())).toEqual({ kind: "current" });
	});

	it("snapshots live rows for a v1 revision without the exception key", () => {
		const current = buildTravelExpenseReportSubmittedFacts(input());
		// The same facts as a version 1 revision would have frozen them.
		const v1 = {
			...current,
			schemaVersion: 1,
			items: current.items.map(({ receiptException: _added, ...rest }) => rest),
		};
		expect(compareLiveTravelExpenseReportWithRevision(v1, input())).toEqual({ kind: "current" });
	});
});
