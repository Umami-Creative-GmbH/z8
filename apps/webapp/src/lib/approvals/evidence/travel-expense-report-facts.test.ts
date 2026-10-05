import { describe, expect, it } from "vitest";
import { ApprovalEvidenceError } from "./errors";
import {
	buildTravelExpenseReportSubmittedFacts,
	compareLiveTravelExpenseReportWithRevision,
	fingerprintTravelExpenseReportFacts,
	type TravelExpenseReportFactsInput,
} from "./travel-expense-report-facts";

const checksumA = "a".repeat(64);
const checksumB = "b".repeat(64);

type ItemRow = TravelExpenseReportFactsInput["items"][number];
type ReceiptRow = TravelExpenseReportFactsInput["receipts"][number];

function item(id: string, position: number, overrides: Partial<ItemRow> = {}): ItemRow {
	return {
		id,
		organizationId: "org-1",
		reportId: "report-1",
		type: "receipt",
		position,
		expenseDate: "2026-09-14",
		category: "transport",
		description: "Train to Hamburg",
		originalAmount: "89.90",
		originalCurrency: "EUR",
		paidBy: "employee",
		accountingReference: null,
		...overrides,
	};
}

function receipt(id: string, itemId: string, overrides: Partial<ReceiptRow> = {}): ReceiptRow {
	return {
		id,
		organizationId: "org-1",
		reportId: "report-1",
		itemId,
		storageProvider: "s3-private",
		storageBucket: "private-bucket",
		storageKey: `travel-expenses/org-1/reports/report-1/${itemId}/${id}-receipt.pdf`,
		storageVersionId: "v1",
		checksumSha256: checksumA,
		sizeBytes: 2048,
		mimeType: "application/pdf",
		...overrides,
	};
}

function input(overrides: Partial<TravelExpenseReportFactsInput> = {}): TravelExpenseReportFactsInput {
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
			item("hotel", 1, {
				category: "accommodation",
				description: "Hotel, two nights",
				originalAmount: "240.00",
				paidBy: "company",
			}),
			item("train", 0),
		],
		receipts: [
			receipt("r-3", "hotel", { checksumSha256: checksumB }),
			receipt("r-1", "train"),
			receipt("r-2", "hotel"),
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

describe("buildTravelExpenseReportSubmittedFacts", () => {
	it("freezes the trip, every expense in report order with its exact receipts, and the totals", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(input());

		expect(facts).toEqual({
			schemaVersion: 1,
			kind: "travel_expense_report",
			organizationId: "org-1",
			reportId: "report-1",
			submissionCycle: 1,
			subjectEmployeeId: "employee-1",
			requesterEmployeeId: "employee-1",
			reportKind: "trip",
			reimbursementCurrency: "EUR",
			trip: {
				purpose: "Customer workshop",
				startDate: "2026-09-14",
				endDate: "2026-09-16",
				timeZone: "Europe/Berlin",
				destinations: [{ place: "Hamburg", countryCode: "DE" }],
			},
			items: [
				{
					itemId: "train",
					position: 0,
					type: "receipt",
					expenseDate: "2026-09-14",
					category: "transport",
					description: "Train to Hamburg",
					original: { amount: "89.90", currency: "EUR" },
					paidBy: "employee",
					accountingReference: null,
					receipts: [
						{
							receiptId: "r-1",
							itemId: "train",
							object: {
								provider: "s3-private",
								bucket: "private-bucket",
								key: "travel-expenses/org-1/reports/report-1/train/r-1-receipt.pdf",
								versionId: "v1",
							},
							checksumSha256: checksumA,
							sizeBytes: 2048,
							mimeType: "application/pdf",
						},
					],
				},
				expect.objectContaining({
					itemId: "hotel",
					position: 1,
					paidBy: "company",
					original: { amount: "240.00", currency: "EUR" },
					receipts: [
						expect.objectContaining({ receiptId: "r-2", checksumSha256: checksumA }),
						expect.objectContaining({ receiptId: "r-3", checksumSha256: checksumB }),
					],
				}),
			],
			totals: { currency: "EUR", reimbursable: "89.90", companyPaid: "240.00" },
		});
		expect(fingerprintTravelExpenseReportFacts(facts)).toMatch(
			/^travel_expense_report:v1:[0-9a-f]{64}$/,
		);
	});

	it("freezes a standalone report without inventing trip facts", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(
			input({
				report: {
					...input().report,
					kind: "standalone",
					tripPurpose: null,
					tripStartDate: null,
					tripEndDate: null,
					tripTimeZone: null,
					tripDestinations: [],
				},
				items: [item("train", 0, { paidBy: "company" })],
				receipts: [receipt("r-1", "train")],
			}),
		);
		expect(facts.trip).toBeNull();
		expect(facts.totals).toEqual({ currency: "EUR", reimbursable: "0.00", companyPaid: "89.90" });
	});

	it("refuses incomplete facts instead of freezing a guess", () => {
		expectEvidenceError(
			() => buildTravelExpenseReportSubmittedFacts(input({ receipts: [receipt("r-1", "train")] })),
			"evidence_incomplete",
			"items",
		);
		expectEvidenceError(
			() =>
				buildTravelExpenseReportSubmittedFacts(
					input({ report: { ...input().report, tripPurpose: null } }),
				),
			"evidence_incomplete",
			"trip",
		);
		expectEvidenceError(
			() =>
				buildTravelExpenseReportSubmittedFacts(
					input({
						receipts: [
							receipt("r-1", "train", { checksumSha256: "not-a-checksum" }),
							receipt("r-2", "hotel"),
						],
					}),
				),
			"evidence_incomplete",
			"receipt_checksum",
		);
	});

	it("never freezes a row from another organization or report", () => {
		expectEvidenceError(
			() =>
				buildTravelExpenseReportSubmittedFacts(
					input({
						receipts: [
							receipt("r-1", "train", { organizationId: "org-2" }),
							receipt("r-2", "hotel"),
						],
					}),
				),
			"invariant",
			"receipt_scope",
		);
		expectEvidenceError(
			() =>
				buildTravelExpenseReportSubmittedFacts(
					input({ items: [item("train", 0, { reportId: "report-2" }), item("hotel", 1)] }),
				),
			"invariant",
			"item_scope",
		);
	});
});

describe("compareLiveTravelExpenseReportWithRevision", () => {
	const submitted = buildTravelExpenseReportSubmittedFacts(input());

	it("accepts unchanged live rows", () => {
		expect(compareLiveTravelExpenseReportWithRevision(submitted, input())).toEqual({
			kind: "current",
		});
	});

	it("holds a report whose amount or receipts changed after submission", () => {
		const amount = compareLiveTravelExpenseReportWithRevision(
			submitted,
			input({ items: [item("train", 0, { originalAmount: "99.90" }), input().items[0] as ItemRow] }),
		);
		const receipts = compareLiveTravelExpenseReportWithRevision(
			submitted,
			input({ receipts: [receipt("r-1", "train"), receipt("r-2", "hotel")] }),
		);
		expect([amount, receipts]).toEqual([
			{ kind: "material_change", changedFields: ["items", "totals"] },
			{ kind: "material_change", changedFields: ["items"] },
		]);
	});

	it("holds a report whose live rows can no longer be frozen", () => {
		expect(
			compareLiveTravelExpenseReportWithRevision(submitted, input({ receipts: [] })),
		).toEqual({ kind: "material_change", changedFields: ["unverifiable:items"] });
	});
});
