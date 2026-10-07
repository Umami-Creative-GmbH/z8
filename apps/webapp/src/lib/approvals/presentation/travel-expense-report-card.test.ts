import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type {
	TravelExpenseReportSubmittedFacts,
	TravelExpenseReportSubmittedItem,
} from "../evidence/travel-expense-report-facts";
import { buildTravelExpenseReportCardFacts } from "./travel-expense-report-card";

const t = (_key: string, fallback: string, params?: Record<string, string | number>) =>
	fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ""));

function item(
	position: number,
	overrides: Partial<TravelExpenseReportSubmittedItem> = {},
): TravelExpenseReportSubmittedItem {
	const itemId = `item-${position}`;
	return {
		itemId,
		position,
		type: "receipt",
		expenseDate: "2026-09-14",
		category: "transport",
		description: "Private description",
		original: { amount: "89.90", currency: "EUR" },
		paidBy: "employee",
		accountingReference: null,
		receipts: [
			{
				receiptId: `receipt-${position}`,
				itemId,
				object: { provider: "s3-private", bucket: "b", key: `k/${position}`, versionId: "v1" },
				checksumSha256: "a".repeat(64),
				sizeBytes: 10,
				mimeType: "application/pdf",
			},
		],
		...overrides,
	};
}

function revision(
	overrides: {
		facts?: Partial<TravelExpenseReportSubmittedFacts>;
		subjectName?: string | null;
		submitterEmployeeId?: string;
	} = {},
) {
	const facts: TravelExpenseReportSubmittedFacts = {
		schemaVersion: 1,
		kind: "travel_expense_report",
		organizationId: "org-1",
		reportId: "report-1",
		submissionCycle: 1,
		subjectEmployeeId: "e-subject",
		requesterEmployeeId: "e-subject",
		reportKind: "trip",
		reimbursementCurrency: "EUR",
		trip: {
			purpose: "Customer workshop",
			startDate: "2026-09-14",
			endDate: "2026-09-16",
			timeZone: "Pacific/Auckland",
			destinations: [
				{ place: "Hamburg", countryCode: "DE" },
				{ place: "Vienna", countryCode: "AT" },
			],
		},
		items: [
			item(0),
			item(1, { paidBy: "company", original: { amount: "1240.00", currency: "EUR" } }),
		],
		totals: { currency: "EUR", reimbursable: "89.90", companyPaid: "1240.00" },
		...overrides.facts,
	};
	return {
		facts,
		labels: {
			subjectName: overrides.subjectName === undefined ? "Avery Requester" : overrides.subjectName,
			submitterName: "Sam Submitter",
			receiptFileNames: { "receipt-0": "private-hotel.pdf" },
		},
		submitter: {
			kind: "employee" as const,
			employeeId: overrides.submitterEmployeeId ?? "e-subject",
			userId: "u-subject",
		},
		requesterEmployeeId: "e-subject",
		submittedAt: parseInstant("2026-09-17T22:30:00Z"),
	};
}

const berlin24 = { locale: "en", timezone: "Europe/Berlin", timeFormat: "24h" as const };

function asMap(facts: ReturnType<typeof buildTravelExpenseReportCardFacts>) {
	return Object.fromEntries((facts ?? []).map((fact) => [fact.label, fact.value]));
}

describe("buildTravelExpenseReportCardFacts", () => {
	it("shows only the frozen report facts, with trip days that never shift by zone", () => {
		const facts = asMap(buildTravelExpenseReportCardFacts(revision(), berlin24, t));
		expect(facts).toEqual({
			Employee: "Avery Requester",
			Report: "Trip",
			Purpose: "Customer workshop",
			"Trip dates": "Sep 14, 2026 – Sep 16, 2026",
			Destination: "Hamburg, DE; Vienna, AT",
			Expenses: "2",
			"Reimbursable to employee": "89.90 EUR",
			"Paid by company": "1,240.00 EUR",
			Receipts: "2 attached",
			Submitted: "Sep 18, 2026, 00:30 (Europe/Berlin)",
		});
		// Descriptions and receipt files stay in authenticated review.
		expect(JSON.stringify(facts)).not.toContain("Private description");
		expect(JSON.stringify(facts)).not.toContain("private-hotel");
	});

	it("states a standalone report without trip facts or a zero company total", () => {
		const facts = asMap(
			buildTravelExpenseReportCardFacts(
				revision({
					facts: {
						reportKind: "standalone",
						trip: null,
						items: [item(0)],
						totals: { currency: "EUR", reimbursable: "89.90", companyPaid: "0.00" },
					},
				}),
				{ locale: "de", timezone: "UTC", timeFormat: "24h" },
				t,
			),
		);
		expect(facts).toMatchObject({
			Report: "Standalone expense",
			Expenses: "1",
			"Reimbursable to employee": "89,90 EUR",
		});
		expect(facts).not.toHaveProperty("Trip dates");
		expect(facts).not.toHaveProperty("Paid by company");
	});

	it("names a different submitter", () => {
		const facts = asMap(
			buildTravelExpenseReportCardFacts(
				revision({ submitterEmployeeId: "e-assistant" }),
				berlin24,
				t,
			),
		);
		expect(facts["Submitted by"]).toBe("Sam Submitter");
	});

	it("keeps mileage and per diem expenses, which carry no receipt by design, actionable (#623 review)", () => {
		const facts = buildTravelExpenseReportCardFacts(
			revision({
				facts: {
					items: [
						item(0),
						item(1, { type: "mileage", category: "transport", receipts: [] }),
						item(2, { type: "per_diem", category: "meals", receipts: [] }),
					],
				},
			}),
			berlin24,
			t,
		);
		expect(facts).not.toBeNull();
		expect(asMap(facts).Expenses).toBe("3");
	});

	it.each([
		[
			"a receipt expense with an accepted missing-receipt exception",
			revision({
				facts: {
					items: [item(0, { receipts: [], receiptException: { reason: "Lost on the train" } })],
				},
			}),
		],
		["no employee name", revision({ subjectName: null })],
		["no expenses", revision({ facts: { items: [] } })],
		["an expense without a receipt", revision({ facts: { items: [item(0, { receipts: [] })] } })],
		[
			"unintelligible totals",
			revision({ facts: { totals: { currency: "EUR", reimbursable: "1", companyPaid: "0.00" } } }),
		],
		[
			"unintelligible trip days",
			revision({
				facts: {
					trip: {
						purpose: "x",
						startDate: "2026-13-40",
						endDate: "2026-13-41",
						timeZone: "UTC",
						destinations: [],
					},
				},
			}),
		],
	])("keeps a report with %s review-only", (_case, input) => {
		expect(buildTravelExpenseReportCardFacts(input, berlin24, t)).toBeNull();
	});
});
