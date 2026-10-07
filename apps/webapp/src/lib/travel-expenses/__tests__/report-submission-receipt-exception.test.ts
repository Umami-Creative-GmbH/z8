import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { receiptExceptionContext } from "../receipt-exception";
import type { ReceiptItemDraft } from "../receipt-report";
import {
	checkReportSubmission,
	type ReviewedReportVersions,
	type SubmissionReportFacts,
} from "../report-submission";

/** Evaluated after every date of the fixtures (#685). */
const now = parseInstant("2026-10-07T12:00:00Z");
const check = (report: SubmissionReportFacts, reviewed: ReviewedReportVersions) =>
	checkReportSubmission(report, reviewed, now);

const dinner: ReceiptItemDraft = {
	expenseDate: "2026-09-14",
	category: "meals",
	description: "Customer dinner",
	amount: "64.20",
	currency: "EUR",
	paidBy: "employee",
	accountingReference: null,
};

function standalone(item: {
	receiptException?: ReturnType<typeof receiptExceptionContext>;
	receiptExceptionVersion?: number;
}) {
	return {
		kind: "standalone" as const,
		reimbursementCurrency: "EUR",
		detailsVersion: 1,
		details: null,
		items: [{ id: "dinner", version: 3, draft: dinner, receiptIds: [], ...item }],
	};
}

const reviewed = (receiptExceptionVersion?: number) => ({
	detailsVersion: null,
	items: [
		{
			id: "dinner",
			version: 3,
			receiptIds: [],
			...(receiptExceptionVersion === undefined ? {} : { receiptExceptionVersion }),
		},
	],
});

describe("checkReportSubmission with missing-receipt exceptions (#604)", () => {
	it("submits an explained exception the organization allows", () => {
		expect(
			check(
				standalone({
					receiptException: receiptExceptionContext("Restaurant card terminal only", true),
					receiptExceptionVersion: 2,
				}),
				reviewed(2),
			),
		).toEqual({
			ok: true,
			totals: { currency: "EUR", reimbursable: "64.20", companyPaid: "0.00", total: "64.20" },
		});
	});

	it("keeps the report incomplete once the organization no longer allows exceptions", () => {
		expect(
			check(
				standalone({
					receiptException: receiptExceptionContext("Restaurant card terminal only", false),
					receiptExceptionVersion: 2,
				}),
				reviewed(2),
			),
		).toEqual({
			ok: false,
			reason: "incomplete",
			missing: { trip: [], items: [{ id: "dinner", missing: ["receipt_exception_not_allowed"] }] },
		});
	});

	it("keeps a report without receipt or exception incomplete", () => {
		expect(check(standalone({}), reviewed())).toEqual({
			ok: false,
			reason: "incomplete",
			missing: { trip: [], items: [{ id: "dinner", missing: ["receipt"] }] },
		});
	});

	it("refuses an exception that changed after the employee reviewed it", () => {
		const report = standalone({
			receiptException: receiptExceptionContext("Edited later", true),
			receiptExceptionVersion: 3,
		});
		expect(check(report, reviewed(2))).toEqual({
			ok: false,
			reason: "changed_since_review",
		});
		// A review that did not see any exception version saw version 0.
		expect(check(report, reviewed())).toEqual({
			ok: false,
			reason: "changed_since_review",
		});
	});
});
