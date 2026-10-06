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
			new RegExp(
				`^travel_expense_report:v${TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION}:[0-9a-f]{64}$`,
			),
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
		// Later versions only add optional facts this report does not have, so
		// its facts as of version 1 are today's facts at version 1.
		const facts = { ...buildTravelExpenseReportSubmittedFacts(input()), schemaVersion: 1 };
		expect(createHash("sha256").update(canonicalJson(facts)).digest("hex")).toBe(V1_FACTS_SHA256);
		expect(fingerprintTravelExpenseReportFacts(facts)).toBe(V1_FINGERPRINT);
		expect(compareLiveTravelExpenseReportWithRevision(facts, input())).toEqual({
			kind: "current",
		});
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

describe("project attribution (schema version 4)", () => {
	const projectP1 = {
		projectId: "p1",
		name: "Hamburg rollout",
		customerId: "c1",
		customerName: "Hanse AG",
		inheritedFromTrip: true,
		basis: "employee_assignment",
	} as const;
	const projectP2 = {
		projectId: "p2",
		name: "Legacy migration",
		customerId: null,
		customerName: null,
		inheritedFromTrip: false,
		basis: "exception",
		exception: {
			exceptionId: "x1",
			validFrom: "2026-09-01",
			validTo: "2026-09-30",
			reason: "Staffed before assignments were recorded",
			evidence: "Staffing plan Q3, signed by the project lead",
			authorizedByEmployeeId: "admin-1",
			authorizedAt: "2026-10-01T09:00:00Z",
		},
	} as const;

	function attributed(overrides: Partial<TravelExpenseReportFactsInput> = {}) {
		return input({
			report: { ...input().report, projectId: "p1" },
			items: [
				item("hotel", 1, {
					category: "accommodation",
					description: "Hotel, two nights",
					originalAmount: "240.00",
					paidBy: "company",
					projectId: "p2",
					projectInherits: false,
				}),
				item("train", 0, { projectId: null, projectInherits: true }),
			],
			projectAttribution: { train: projectP1, hotel: projectP2 },
			...overrides,
		});
	}

	it("freezes each expense's effective project with how its use was proven", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(attributed());
		expect(facts.items.map((frozen) => [frozen.itemId, frozen.project])).toEqual([
			["train", projectP1],
			["hotel", projectP2],
		]);
	});

	it("omits the project of an expense without one", () => {
		const facts = buildTravelExpenseReportSubmittedFacts(
			attributed({
				report: { ...input().report, projectId: null },
				projectAttribution: { hotel: projectP2 },
			}),
		);
		expect(facts.items[0]).not.toHaveProperty("project");
		expect(facts.items[1]?.project).toEqual(projectP2);
	});

	it("refuses an attributed expense whose eligibility was not resolved", () => {
		expectEvidenceError(
			() => buildTravelExpenseReportSubmittedFacts(attributed({ projectAttribution: { train: projectP1 } })),
			"evidence_incomplete",
			"project_attribution",
		);
		expectEvidenceError(
			() =>
				buildTravelExpenseReportSubmittedFacts(
					attributed({
						projectAttribution: { train: projectP1, hotel: { ...projectP2, projectId: "p3" } },
					}),
				),
			"evidence_incomplete",
			"project_attribution",
		);
	});

	it("keeps the frozen names when only the project's live name changed", () => {
		const submitted = buildTravelExpenseReportSubmittedFacts(attributed());
		// Live rows carry project ids only; renames never reach the comparison.
		expect(
			compareLiveTravelExpenseReportWithRevision(
				submitted,
				attributed({ projectAttribution: undefined }),
			),
		).toEqual({ kind: "current" });
	});

	it("holds a report whose live project attribution changed after submission", () => {
		const submitted = buildTravelExpenseReportSubmittedFacts(attributed());
		const changed = (overrides: Partial<TravelExpenseReportFactsInput>) =>
			compareLiveTravelExpenseReportWithRevision(submitted, attributed(overrides));
		expect(changed({ report: { ...input().report, projectId: "p9" } })).toEqual({
			kind: "material_change",
			changedFields: ["items"],
		});
		expect(changed({ report: { ...input().report, projectId: null } })).toEqual({
			kind: "material_change",
			changedFields: ["items"],
		});
	});

	it("adds project facts only from schema version 4, after #607's version 3", () => {
		const current = buildTravelExpenseReportSubmittedFacts(attributed());
		expect(current.schemaVersion).toBeGreaterThanOrEqual(4);
		// A version 3 snapshot of the same live rows never carries the key.
		const v3 = {
			...current,
			schemaVersion: 3,
			items: current.items.map(({ project: _added, ...rest }) => rest),
		};
		expect(compareLiveTravelExpenseReportWithRevision(v3, attributed())).toEqual({
			kind: "current",
		});
	});
});