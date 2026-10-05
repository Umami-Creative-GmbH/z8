import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { TravelExpenseReportSubmittedRevisionRecord } from "../evidence/travel-expense-report-store";
import { buildTravelExpenseReportReviewSections } from "./travel-expense-report-review";

function revision(): TravelExpenseReportSubmittedRevisionRecord {
	const receipt = (receiptId: string, itemId: string) => ({
		receiptId,
		itemId,
		object: { provider: "s3-private", bucket: "b", key: `k-${receiptId}`, versionId: null },
		checksumSha256: "a".repeat(64),
		sizeBytes: 10,
		mimeType: "application/pdf",
	});
	return {
		id: "rev-1",
		authority: "legacy",
		organizationId: "org-1",
		reportId: "report-1",
		submissionCycle: 1,
		requestCycleKey: "travel_expense_report:report-1:submission:1",
		revision: 1,
		subjectEmployeeId: "e-1",
		requesterEmployeeId: "e-1",
		submitter: { kind: "employee", employeeId: "e-1", userId: "u-1" },
		materialFingerprint: "travel_expense_report:v1:x",
		facts: {
			schemaVersion: 1,
			kind: "travel_expense_report",
			organizationId: "org-1",
			reportId: "report-1",
			submissionCycle: 1,
			subjectEmployeeId: "e-1",
			requesterEmployeeId: "e-1",
			reportKind: "trip",
			reimbursementCurrency: "EUR",
			trip: {
				purpose: "Customer workshop",
				startDate: "2026-09-14",
				endDate: "2026-09-16",
				timeZone: "Asia/Tokyo",
				destinations: [{ place: "Osaka", countryCode: "JP" }],
			},
			items: [
				{
					itemId: "train",
					position: 0,
					type: "receipt",
					expenseDate: "2026-09-14",
					category: "transport",
					description: "Shinkansen",
					original: { amount: "89.90", currency: "EUR" },
					paidBy: "employee",
					accountingReference: "PRJ-7",
					receipts: [receipt("r-1", "train")],
				},
				{
					itemId: "hotel",
					position: 1,
					type: "receipt",
					expenseDate: "2026-09-15",
					category: "accommodation",
					description: "Hotel",
					original: { amount: "240.00", currency: "EUR" },
					paidBy: "company",
					accountingReference: null,
					receipts: [receipt("r-2", "hotel"), receipt("r-3", "hotel")],
				},
			],
			totals: { currency: "EUR", reimbursable: "89.90", companyPaid: "240.00" },
		},
		labels: {
			subjectName: "Avery Requester",
			submitterName: "Avery Requester",
			receiptFileNames: { "r-1": "ticket.pdf", "r-2": "hotel.pdf", "r-3": "folio.pdf" },
		},
		submittedAt: parseInstant("2026-09-17T08:00:00Z"),
		legacy: { approvalRequestId: "req-1", chainInstanceId: null, observedWorkflowId: null },
	};
}

describe("buildTravelExpenseReportReviewSections", () => {
	it("shows the frozen trip, its totals and every expense with its receipts", () => {
		const { sections, decisionsBlocked } = buildTravelExpenseReportReviewSections({
			status: "evidenced",
			revision: revision(),
			comparison: { kind: "current" },
			decisions: [],
		});

		expect(decisionsBlocked).toBe(false);
		const [report, train, hotel] = sections;
		expect(report).toMatchObject({
			type: "key_value",
			rows: expect.arrayContaining([
				expect.objectContaining({ value: "Customer workshop" }),
				// Travel dates as entered, with the zone they are calendar days in.
				expect.objectContaining({ value: "2026-09-14 – 2026-09-16" }),
				expect.objectContaining({ value: "Asia/Tokyo" }),
				expect.objectContaining({ value: "Osaka, JP" }),
				expect.objectContaining({ value: "89.90 EUR" }),
				expect.objectContaining({ value: "240.00 EUR" }),
			]),
		});
		expect(train).toMatchObject({
			type: "key_value",
			title: "1. Shinkansen",
			rows: expect.arrayContaining([
				expect.objectContaining({ value: "2026-09-14" }),
				expect.objectContaining({ value: "89.90 EUR" }),
				expect.objectContaining({ value: "PRJ-7" }),
				expect.objectContaining({ value: "1: ticket.pdf" }),
			]),
		});
		expect(hotel).toMatchObject({
			title: "2. Hotel",
			rows: expect.arrayContaining([
				expect.objectContaining({
					value: { key: "approvals:approvals.evidence.paidByCompany", fallback: "Company" },
				}),
				expect.objectContaining({ value: "2: hotel.pdf, folio.pdf" }),
			]),
		});
		expect(sections.at(-1)).toMatchObject({
			type: "timeline",
			events: [expect.objectContaining({ label: "Submitted", at: "2026-09-17T08:00:00Z" })],
		});
	});

	it("blocks decisions when the live report no longer matches its submission", () => {
		const { sections, decisionsBlocked } = buildTravelExpenseReportReviewSections({
			status: "evidenced",
			revision: revision(),
			comparison: { kind: "material_change", changedFields: ["items"] },
			decisions: [],
		});
		expect(decisionsBlocked).toBe(true);
		expect(sections).toContainEqual(
			expect.objectContaining({ type: "callout", tone: "danger" }),
		);
	});

	it("blocks decisions when no frozen submission exists", () => {
		expect(buildTravelExpenseReportReviewSections({ status: "not_captured" })).toEqual({
			sections: [expect.objectContaining({ type: "callout", tone: "warning" })],
			decisionsBlocked: true,
		});
	});
});
