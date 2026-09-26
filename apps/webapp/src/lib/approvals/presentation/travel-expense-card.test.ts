import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { LegacyTravelExpenseSubmittedRevisionRecord } from "../evidence/store";
import type { TravelExpenseReceiptManifestItem } from "../evidence/travel-expense-facts";
import { buildTravelExpenseCardFacts } from "./travel-expense-card";

const t = (_key: string, fallback: string, params?: Record<string, string | number>) =>
	fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ""));

function receipt(id: string): TravelExpenseReceiptManifestItem {
	return {
		attachmentId: id,
		claimId: "claim-1",
		object: { provider: "s3-private", bucket: "b", key: `k/${id}`, versionId: "v1" },
		checksumSha256: "a".repeat(64),
		sizeBytes: 10,
		mimeType: "application/pdf",
	};
}

type Facts = LegacyTravelExpenseSubmittedRevisionRecord["facts"];

function revision(
	overrides: {
		facts?: Partial<Facts>;
		labels?: Partial<LegacyTravelExpenseSubmittedRevisionRecord["labels"]>;
		submitter?: LegacyTravelExpenseSubmittedRevisionRecord["submitter"];
	} = {},
): LegacyTravelExpenseSubmittedRevisionRecord {
	return {
		id: "rev-1",
		authority: "legacy",
		organizationId: "org-1",
		claimId: "claim-1",
		requestCycleKey: "travel_expense_claim:claim-1:submission",
		revision: 1,
		subjectEmployeeId: "e-subject",
		requesterEmployeeId: "e-subject",
		submitter: overrides.submitter ?? {
			kind: "employee",
			employeeId: "e-subject",
			userId: "u-subject",
		},
		materialFingerprint: "travel_expense:v1:x",
		facts: {
			schemaVersion: 1,
			kind: "travel_expense",
			organizationId: "org-1",
			claimId: "claim-1",
			subjectEmployeeId: "e-subject",
			requesterEmployeeId: "e-subject",
			claimType: "receipt",
			tripDates: {
				startDate: "2026-03-29",
				endDate: "2026-03-31",
				interpretation: { source: "entered_logical_dates", zone: "Pacific/Auckland" },
			},
			money: {
				original: { amount: "1234.50", currency: "EUR" },
				calculated: { amount: "1234.50", currency: "EUR" },
			},
			destination: { city: "Hamburg", country: "DE" },
			receipts: { required: true, manifest: [receipt("att-1"), receipt("att-2")] },
			projectId: "project-1",
			compatibility: {
				encoding: "effective_zone_day_bounds",
				tripStartAt: "2026-03-28T11:00:00Z",
				tripEndAt: "2026-03-31T10:59:59.999Z",
			},
			...overrides.facts,
		},
		labels: {
			subjectName: "Avery Requester",
			requesterName: "Avery Requester",
			submitterName: "Avery Requester",
			projectName: "Launch",
			receiptFileNames: { "att-1": "private-hotel.pdf", "att-2": "taxi.pdf" },
			...overrides.labels,
		},
		provenance: "captured_at_submission",
		submittedAt: parseInstant("2026-07-01T22:30:00Z"),
		legacy: { approvalRequestId: "request-1", chainInstanceId: null, observedWorkflowId: null },
	};
}

const berlin24 = { locale: "en", timezone: "Europe/Berlin", timeFormat: "24h" as const };

function asMap(facts: ReturnType<typeof buildTravelExpenseCardFacts>) {
	return Object.fromEntries((facts ?? []).map((fact) => [fact.label, fact.value]));
}

describe("buildTravelExpenseCardFacts", () => {
	it("shows the claim's submitted facts with logical dates that never shift by zone", () => {
		const facts = asMap(buildTravelExpenseCardFacts(revision(), berlin24, t));
		expect(facts).toEqual({
			Employee: "Avery Requester",
			"Claim type": "Receipt",
			"Trip dates": "Mar 29, 2026 – Mar 31, 2026",
			"Claim amount": "1,234.50 EUR",
			Destination: "Hamburg, DE",
			Project: "Launch",
			Receipts: "2 attached",
			Submitted: "Jul 2, 2026, 00:30 (Europe/Berlin)",
		});
		// Receipt contents, file names and notes stay in authenticated review.
		expect(JSON.stringify(facts)).not.toContain("private-hotel");
	});

	it("formats amounts for the recipient's locale without converting or re-rounding", () => {
		const facts = asMap(
			buildTravelExpenseCardFacts(
				revision({
					facts: {
						money: {
							original: { amount: "180000.00", currency: "JPY" },
							calculated: { amount: "1099.99", currency: "EUR" },
						},
					},
				}),
				{ locale: "de", timezone: "UTC", timeFormat: "24h" },
				t,
			),
		);
		expect(facts["Claim amount"]).toBe("1.099,99 EUR");
		// Shown because it differs; labelled as the persisted original, not a rate.
		expect(facts["Original amount"]).toBe("180.000,00 JPY");
	});

	it("names a separately evidenced submitter and marks unavailable optional labels", () => {
		const facts = asMap(
			buildTravelExpenseCardFacts(
				revision({
					submitter: { kind: "employee", employeeId: "e-assistant", userId: "u-a" },
					labels: { submitterName: null, projectName: null },
					facts: { destination: { city: null, country: null }, projectId: null },
				}),
				berlin24,
				t,
			),
		);
		expect(facts["Submitted by"]).toBe("Unavailable");
		expect(facts).not.toHaveProperty("Project");
		expect(facts).not.toHaveProperty("Destination");
	});

	it("shows no receipt count for claims that need no receipts", () => {
		const facts = asMap(
			buildTravelExpenseCardFacts(
				revision({ facts: { claimType: "mileage", receipts: { required: false, manifest: [] } } }),
				berlin24,
				t,
			),
		);
		expect(facts["Claim type"]).toBe("Mileage");
		expect(facts).not.toHaveProperty("Receipts");
	});

	it("is not actionable when essential facts are missing", () => {
		expect(
			buildTravelExpenseCardFacts(revision({ labels: { subjectName: null } }), berlin24, t),
		).toBeNull();
		expect(
			buildTravelExpenseCardFacts(
				revision({ facts: { receipts: { required: true, manifest: [] } } }),
				berlin24,
				t,
			),
		).toBeNull();
		expect(
			buildTravelExpenseCardFacts(
				revision({
					facts: {
						money: {
							original: { amount: "12", currency: "EUR" },
							calculated: { amount: "12", currency: "EUR" },
						},
					},
				}),
				berlin24,
				t,
			),
		).toBeNull();
		expect(
			buildTravelExpenseCardFacts(
				revision({
					facts: {
						tripDates: {
							startDate: "not-a-date",
							endDate: "2026-03-31",
							interpretation: { source: "entered_logical_dates", zone: "UTC" },
						},
					},
				}),
				berlin24,
				t,
			),
		).toBeNull();
	});
});
