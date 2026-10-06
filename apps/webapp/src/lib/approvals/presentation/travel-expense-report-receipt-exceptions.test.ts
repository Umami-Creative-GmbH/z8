import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { TravelExpenseReportSubmittedRevisionRecord } from "../evidence/travel-expense-report-store";
import { buildTravelExpenseReportReviewSections } from "./travel-expense-report-review";

function revision(): TravelExpenseReportSubmittedRevisionRecord {
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
		materialFingerprint: "travel_expense_report:v2:x",
		facts: {
			schemaVersion: 2,
			kind: "travel_expense_report",
			organizationId: "org-1",
			reportId: "report-1",
			submissionCycle: 1,
			subjectEmployeeId: "e-1",
			requesterEmployeeId: "e-1",
			reportKind: "standalone",
			reimbursementCurrency: "EUR",
			trip: null,
			items: [
				{
					itemId: "dinner",
					position: 0,
					type: "receipt",
					expenseDate: "2026-09-14",
					category: "meals",
					description: "Customer dinner",
					original: { amount: "64.20", currency: "EUR" },
					paidBy: "employee",
					accountingReference: null,
					receipts: [],
					receiptException: { reason: "The restaurant printer was broken" },
				},
			],
			totals: { currency: "EUR", reimbursable: "64.20", companyPaid: "0.00" },
		},
		labels: { subjectName: "Avery", submitterName: "Avery", receiptFileNames: {} },
		submittedAt: parseInstant("2026-09-17T08:00:00Z"),
		legacy: { approvalRequestId: "req-1", chainInstanceId: null, observedWorkflowId: null },
	};
}

describe("missing-receipt exceptions in report review (#604)", () => {
	const { sections } = buildTravelExpenseReportReviewSections({
		status: "evidenced",
		revision: revision(),
		comparison: { kind: "current" },
		decisions: [],
	});

	it("asks the reviewer to accept each exception right after the report summary", () => {
		expect(sections[1]).toEqual({
			type: "receipt_exception_acceptance",
			title: {
				key: "approvals:approvals.evidence.receiptExceptionsTitle",
				fallback: "Missing receipts",
			},
			items: [
				{
					itemId: "dinner",
					label: "1. Customer dinner",
					reason: "The restaurant printer was broken",
				},
			],
		});
	});

	it("flags the expense itself instead of listing an attached receipt", () => {
		const expense = sections.find(
			(section) => section.type === "key_value" && section.title === "1. Customer dinner",
		);
		expect(expense).toMatchObject({
			rows: expect.arrayContaining([
				{
					label: { key: "approvals:approvals.evidence.receipts", fallback: "Receipts" },
					value: {
						key: "approvals:approvals.evidence.receiptMissingException",
						fallback: "Missing — exception requested",
					},
					tone: "warning",
				},
				{
					label: {
						key: "approvals:approvals.evidence.receiptExceptionReason",
						fallback: "Why the receipt is missing",
					},
					value: "The restaurant printer was broken",
					tone: "warning",
				},
			]),
		});
		expect(expense).not.toMatchObject({
			rows: expect.arrayContaining([expect.objectContaining({ value: "0: " })]),
		});
	});
});
