import { describe, expect, it } from "vitest";
import { ApprovalEvidenceError } from "./errors";
import {
	buildTravelExpenseSubmittedFacts,
	compareLiveTravelExpenseWithRevision,
	fingerprintTravelExpenseMaterialFacts,
	type TravelExpenseFactsInput,
} from "./travel-expense-facts";

const checksumA = "a".repeat(64);
const checksumB = "b".repeat(64);

function attachment(
	id: string,
	overrides: Partial<TravelExpenseFactsInput["attachments"][number]> = {},
): TravelExpenseFactsInput["attachments"][number] {
	return {
		id,
		claimId: "claim-1",
		organizationId: "org-1",
		storageProvider: "s3-private",
		storageBucket: "private-bucket",
		storageKey: `travel-expenses/org-1/claim-1/${id}-receipt.pdf`,
		storageVersionId: null,
		checksumSha256: checksumA,
		sizeBytes: 1024,
		mimeType: "application/pdf",
		...overrides,
	};
}

function input(
	overrides: {
		claim?: Partial<TravelExpenseFactsInput["claim"]>;
		attachments?: TravelExpenseFactsInput["attachments"];
	} = {},
): TravelExpenseFactsInput {
	return {
		claim: {
			id: "claim-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			type: "receipt",
			tripStartDate: "2026-03-29",
			tripEndDate: "2026-03-31",
			tripDateTimeZone: "Europe/Berlin",
			tripStart: new Date("2026-03-28T23:00:00.000Z"),
			tripEnd: new Date("2026-03-31T21:59:59.999Z"),
			originalAmount: "120.50",
			originalCurrency: "EUR",
			calculatedAmount: "120.50",
			calculatedCurrency: "EUR",
			destinationCity: "Hamburg",
			destinationCountry: "DE",
			projectId: "project-1",
			...overrides.claim,
		},
		attachments: overrides.attachments ?? [attachment("att-2"), attachment("att-1")],
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

describe("buildTravelExpenseSubmittedFacts", () => {
	it("captures entered logical trip dates with their interpretation, not the synthetic bounds", () => {
		const facts = buildTravelExpenseSubmittedFacts(input());

		expect(facts.tripDates).toEqual({
			startDate: "2026-03-29",
			endDate: "2026-03-31",
			interpretation: { source: "entered_logical_dates", zone: "Europe/Berlin" },
		});
		expect(facts.compatibility).toEqual({
			encoding: "effective_zone_day_bounds",
			tripStartAt: "2026-03-28T23:00:00Z",
			tripEndAt: "2026-03-31T21:59:59.999Z",
		});
	});

	it("keeps persisted money/currency pairs verbatim and invents no calculation basis", () => {
		const facts = buildTravelExpenseSubmittedFacts(
			input({ claim: { calculatedAmount: "99.00", calculatedCurrency: "CHF" } }),
		);

		expect(facts.money).toEqual({
			original: { amount: "120.50", currency: "EUR" },
			calculated: { amount: "99.00", currency: "CHF" },
		});
		expect(Object.keys(facts)).not.toEqual(
			expect.arrayContaining(["exchangeRate", "reimbursement", "tax"]),
		);
	});

	it("freezes a receipt manifest sorted by attachment with object identity and checksum", () => {
		const facts = buildTravelExpenseSubmittedFacts(
			input({
				attachments: [
					attachment("att-2", { checksumSha256: checksumB, storageVersionId: "v2" }),
					attachment("att-1"),
				],
			}),
		);

		expect(facts.receipts.required).toBe(true);
		expect(facts.receipts.manifest).toEqual([
			{
				attachmentId: "att-1",
				claimId: "claim-1",
				object: {
					provider: "s3-private",
					bucket: "private-bucket",
					key: "travel-expenses/org-1/claim-1/att-1-receipt.pdf",
					versionId: null,
				},
				checksumSha256: checksumA,
				sizeBytes: 1024,
				mimeType: "application/pdf",
			},
			expect.objectContaining({
				attachmentId: "att-2",
				checksumSha256: checksumB,
				object: expect.objectContaining({ versionId: "v2" }),
			}),
		]);
	});

	it("does not copy notes or file names into facts", () => {
		const facts = buildTravelExpenseSubmittedFacts(input());
		const serialized = JSON.stringify(facts);

		expect(serialized).not.toContain("notes");
		expect(serialized).not.toContain("fileName");
	});

	it("refuses to guess trip dates when the entered logical dates were not captured", () => {
		expectEvidenceError(
			() =>
				buildTravelExpenseSubmittedFacts(
					input({ claim: { tripStartDate: null, tripEndDate: null, tripDateTimeZone: null } }),
				),
			"evidence_incomplete",
			"trip_dates",
		);
		expectEvidenceError(
			() => buildTravelExpenseSubmittedFacts(input({ claim: { tripDateTimeZone: null } })),
			"evidence_incomplete",
			"trip_dates",
		);
		expectEvidenceError(
			() =>
				buildTravelExpenseSubmittedFacts(
					input({ claim: { tripStartDate: "2026-04-02", tripEndDate: "2026-04-01" } }),
				),
			"evidence_incomplete",
			"trip_dates",
		);
	});

	it("rejects malformed persisted money instead of normalizing it", () => {
		expectEvidenceError(
			() => buildTravelExpenseSubmittedFacts(input({ claim: { originalAmount: "12.5" } })),
			"evidence_incomplete",
			"money",
		);
		expectEvidenceError(
			() => buildTravelExpenseSubmittedFacts(input({ claim: { calculatedCurrency: "eur" } })),
			"evidence_incomplete",
			"money",
		);
	});

	it("requires at least one receipt for receipt claims and none for mileage", () => {
		expectEvidenceError(
			() => buildTravelExpenseSubmittedFacts(input({ attachments: [] })),
			"evidence_incomplete",
			"receipts",
		);

		const mileage = buildTravelExpenseSubmittedFacts(
			input({ claim: { type: "mileage" }, attachments: [] }),
		);
		expect(mileage.receipts).toEqual({ required: false, manifest: [] });
	});

	it("holds historical attachments without a server-computed checksum", () => {
		expectEvidenceError(
			() =>
				buildTravelExpenseSubmittedFacts(
					input({ attachments: [attachment("att-1", { checksumSha256: null })] }),
				),
			"evidence_incomplete",
			"receipt_checksum",
		);
	});

	it("treats foreign or unrelated attachments as an integrity contradiction", () => {
		expectEvidenceError(
			() =>
				buildTravelExpenseSubmittedFacts(
					input({ attachments: [attachment("att-1", { organizationId: "org-2" })] }),
				),
			"invariant",
			"receipt_scope",
		);
		expectEvidenceError(
			() =>
				buildTravelExpenseSubmittedFacts(
					input({ attachments: [attachment("att-1", { claimId: "claim-2" })] }),
				),
			"invariant",
			"receipt_scope",
		);
	});

	it("refuses receipts outside organization-scoped private storage", () => {
		expectEvidenceError(
			() =>
				buildTravelExpenseSubmittedFacts(
					input({ attachments: [attachment("att-1", { storageProvider: "s3-public" })] }),
				),
			"evidence_incomplete",
			"receipt_storage",
		);
	});
});

describe("fingerprintTravelExpenseMaterialFacts", () => {
	it("is versioned and ignores attachment order, project and compatibility encodings", () => {
		const base = buildTravelExpenseSubmittedFacts(input());
		const reordered = buildTravelExpenseSubmittedFacts(
			input({
				claim: {
					projectId: null,
					tripStart: new Date("2026-03-29T00:00:00.000Z"),
					tripDateTimeZone: "UTC",
				},
				attachments: [attachment("att-1"), attachment("att-2")],
			}),
		);

		expect(fingerprintTravelExpenseMaterialFacts(base)).toMatch(/^travel_expense:v1:[0-9a-f]{64}$/);
		expect(fingerprintTravelExpenseMaterialFacts(reordered)).toBe(
			fingerprintTravelExpenseMaterialFacts(base),
		);
	});

	it("changes with the receipt content identity, not only the receipt count", () => {
		const base = buildTravelExpenseSubmittedFacts(input());
		const replacedContent = buildTravelExpenseSubmittedFacts(
			input({
				attachments: [attachment("att-2"), attachment("att-1", { checksumSha256: checksumB })],
			}),
		);

		expect(fingerprintTravelExpenseMaterialFacts(replacedContent)).not.toBe(
			fingerprintTravelExpenseMaterialFacts(base),
		);
	});
});

describe("compareLiveTravelExpenseWithRevision", () => {
	const submitted = buildTravelExpenseSubmittedFacts(input());

	it("stays current when only non-material references changed", () => {
		expect(
			compareLiveTravelExpenseWithRevision(submitted, input({ claim: { projectId: null } })),
		).toEqual({ kind: "current" });
	});

	it("reports a changed receipt set as a material change", () => {
		expect(
			compareLiveTravelExpenseWithRevision(
				submitted,
				input({ attachments: [attachment("att-1"), attachment("att-2"), attachment("att-3")] }),
			),
		).toEqual({ kind: "material_change", changedFields: ["receipts"] });
	});

	it("reports changed money and dates by field", () => {
		expect(
			compareLiveTravelExpenseWithRevision(
				submitted,
				input({ claim: { calculatedAmount: "10.00", tripEndDate: "2026-04-01" } }),
			),
		).toEqual({ kind: "material_change", changedFields: ["tripDates", "money"] });
	});

	it("treats live facts that can no longer be verified as a material change", () => {
		expect(compareLiveTravelExpenseWithRevision(submitted, input({ attachments: [] }))).toEqual({
			kind: "material_change",
			changedFields: ["unverifiable:receipts"],
		});
	});
});
