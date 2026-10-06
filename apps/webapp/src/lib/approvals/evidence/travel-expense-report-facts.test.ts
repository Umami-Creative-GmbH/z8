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
			schemaVersion: TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION,
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
			new RegExp(`^travel_expense_report:v${TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION}:[0-9a-f]{64}$`),
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

describe("schema version 1 revisions", () => {
	// Golden values captured from the #602 builder before the reader became
	// version tolerant: a v1 revision must stay byte-identical forever.
	const V1_FACTS_SHA256 = "92387a68b285d22199d798bca29b32f7b99c997748bcbb59ba6135dcb1cdceec";
	const V1_FINGERPRINT =
		"travel_expense_report:v1:92387a68b285d22199d798bca29b32f7b99c997748bcbb59ba6135dcb1cdceec";

	it("still freezes a v1 report byte for byte", () => {
		// Later versions only add optional facts this report does not have
		// (receipt exceptions, #604; mileage, #606), so its facts as of version 1
		// are today's facts at version 1.
		const facts = { ...buildTravelExpenseReportSubmittedFacts(input()), schemaVersion: 1 };
		expect(createHash("sha256").update(canonicalJson(facts)).digest("hex")).toBe(V1_FACTS_SHA256);
		expect(fingerprintTravelExpenseReportFacts(facts)).toBe(V1_FINGERPRINT);
	});

	it("fingerprints facts under the version they were frozen with", () => {
		const facts = { ...buildTravelExpenseReportSubmittedFacts(input()), schemaVersion: 7 };
		expect(fingerprintTravelExpenseReportFacts(facts)).toMatch(
			/^travel_expense_report:v7:[0-9a-f]{64}$/,
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
			input({
				items: [item("train", 0, { originalAmount: "99.90" }), input().items[0] as ItemRow],
			}),
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

	it("compares facts only, not today's completeness rules", () => {
		// Live rows that no longer satisfy the submission rules are a change of
		// facts, never a re-validation of the frozen revision.
		expect(compareLiveTravelExpenseReportWithRevision(submitted, input({ receipts: [] }))).toEqual({
			kind: "material_change",
			changedFields: ["items"],
		});
	});

	it("cannot verify a revision frozen with a version this build does not know", () => {
		expect(
			compareLiveTravelExpenseReportWithRevision({ ...submitted, schemaVersion: 99 }, input()),
		).toEqual({ kind: "material_change", changedFields: ["unverifiable:schema_version"] });
	});

	it("holds a report whose live rows break organization scope", () => {
		expect(
			compareLiveTravelExpenseReportWithRevision(
				submitted,
				input({
					receipts: [
						receipt("r-3", "hotel", { checksumSha256: checksumB, organizationId: "org-2" }),
						receipt("r-1", "train"),
						receipt("r-2", "hotel"),
					],
				}),
			),
		).toEqual({ kind: "material_change", changedFields: ["unverifiable:receipt_scope"] });
	});
});

describe("mileage items (#606)", () => {
	const stamp = {
		policyId: "policy-1",
		versionId: "version-2026",
		effectiveFrom: "2026-01-01",
		vehicle: "car" as const,
		ratePerKm: "0.3000",
		currency: "EUR",
		source: {
			kind: "statutory_default" as const,
			reference: "§ 9 Abs. 1 Satz 3 Nr. 4a Satz 2 EStG",
			version: "LStH 2026, Anhang 25 III",
			defaultKey: "de-mileage-estg-9-1-4a",
		},
		expenseDate: "2026-09-15",
	};
	const drive = item("drive", 2, {
		type: "mileage",
		expenseDate: "2026-09-15",
		category: null,
		description: null,
		originalAmount: null,
		originalCurrency: null,
		paidBy: "employee",
		mileageRoute: "Hamburg hotel – customer site – back",
		mileageDistanceKm: "123.45",
		mileageVehicle: "car",
		mileagePolicy: stamp,
	});
	const withDrive = (row: ItemRow = drive) => input({ items: [...input().items, row] });

	it("freezes the route, distance, applied policy version and breakdown, and counts the amount", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(withDrive());

		expect(facts.items[2]).toEqual({
			itemId: "drive",
			position: 2,
			type: "mileage",
			expenseDate: "2026-09-15",
			category: "transport",
			description: "Hamburg hotel – customer site – back",
			original: { amount: "37.04", currency: "EUR" },
			paidBy: "employee",
			accountingReference: null,
			receipts: [],
			mileage: {
				route: "Hamburg hotel – customer site – back",
				distanceKm: "123.45",
				vehicle: "car",
				ratePerKm: "0.3000",
				currency: "EUR",
				exactAmount: "37.035000",
				amount: "37.04",
				rounding: "half_up",
				policy: {
					policyId: "policy-1",
					versionId: "version-2026",
					effectiveFrom: "2026-01-01",
					source: stamp.source,
				},
			},
		});
		expect(facts.totals).toEqual({ currency: "EUR", reimbursable: "126.94", companyPaid: "240.00" });
	});

	it("refuses a mileage item that was not priced under the submission lock", () => {
		for (const row of [
			{ ...drive, mileagePolicy: null },
			{ ...drive, mileagePolicy: { ...stamp, expenseDate: "2026-09-14" } },
			{ ...drive, mileagePolicy: { ...stamp, currency: "CHF" } },
			{ ...drive, mileageRoute: null },
		]) {
			expectEvidenceError(
				() => buildTravelExpenseReportSubmittedFacts(withDrive(row)),
				"evidence_incomplete",
				"mileage",
			);
		}
	});

	it("compares against the stamped policy, so later policy changes never hold the decision", () => {
		const submitted = buildTravelExpenseReportSubmittedFacts(withDrive());
		// The live rows keep their stamp; today's policy is never consulted.
		expect(compareLiveTravelExpenseReportWithRevision(submitted, withDrive())).toEqual({
			kind: "current",
		});
		expect(
			compareLiveTravelExpenseReportWithRevision(
				submitted,
				withDrive({ ...drive, mileageDistanceKm: "130.00" }),
			),
		).toEqual({ kind: "material_change", changedFields: ["items", "totals"] });
		expect(
			compareLiveTravelExpenseReportWithRevision(
				submitted,
				withDrive({ ...drive, mileagePolicy: null }),
			),
		).toEqual({ kind: "material_change", changedFields: ["items", "totals"] });
	});
});
