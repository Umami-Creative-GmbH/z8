import { describe, expect, it } from "vitest";
import {
	buildExpenseHistory,
	countExpenseHistory,
	type ExpenseHistoryInput,
	filterExpenseHistory,
} from "../expense-history";
import type { DraftReportSummary } from "../report-store";

function report(overrides: Partial<DraftReportSummary> & { id: string }): DraftReportSummary {
	return {
		kind: "standalone",
		status: "draft",
		updatedAt: "2026-10-01T10:00:00.000Z",
		expenseDate: "2026-09-14",
		description: "Hotel Hamburg",
		amount: "129.90",
		currency: "EUR",
		receiptCount: 1,
		trip: null,
		itemType: "receipt",
		itemCount: 1,
		totals: { currency: "EUR", reimbursable: "129.90", companyPaid: "0.00", excludedItemCount: 0 },
		...overrides,
	};
}

const claim = {
	id: "claim-1",
	type: "receipt" as const,
	status: "approved" as const,
	calculatedAmount: "120.50",
	calculatedCurrency: "EUR",
	tripStartDate: "2026-03-29",
	tripEndDate: "2026-03-31",
	destinationCity: "Berlin",
	updatedAt: "2026-04-02T08:00:00.000Z",
};

function input(overrides: Partial<ExpenseHistoryInput>): ExpenseHistoryInput {
	return {
		reports: [],
		adjustmentOriginals: new Map(),
		claims: [],
		conversions: new Map(),
		balances: new Map(),
		...overrides,
	};
}

describe("unified expense history", () => {
	it("lists new reports and earlier claims together, most recent activity first", () => {
		const rows = buildExpenseHistory(
			input({
				reports: [
					report({ id: "older", updatedAt: "2026-09-01T10:00:00.000Z" }),
					report({ id: "newer", updatedAt: "2026-10-03T10:00:00.000Z" }),
				],
				claims: [claim],
			}),
		);
		expect(rows.map((row) => `${row.source}:${row.id}`)).toEqual([
			"report:newer",
			"report:older",
			"legacy_claim:claim-1",
		]);
		expect(rows[2]).toMatchObject({
			href: "/travel-expenses/claim-1",
			claimType: "receipt",
			status: "approved",
			amount: { amount: "120.50", currency: "EUR" },
			dates: { start: "2026-03-29", end: "2026-03-31" },
			destination: "Berlin",
		});
		expect(rows[0]).toMatchObject({ href: "/travel-expenses/reports/newer" });
	});

	it("labels an adjustment with the report it corrects and leaves the balance on the original", () => {
		const balance = {
			state: "overpaid" as const,
			currencies: [
				{
					currency: "EUR",
					entitlement: "450.00",
					reimbursed: "500.00",
					recovered: "0.00",
					balance: "-50.00",
					state: "overpaid" as const,
				},
			],
		};
		const rows = buildExpenseHistory(
			input({
				reports: [
					report({
						id: "original",
						kind: "trip",
						status: "approved",
						trip: {
							purpose: "Customer workshop",
							startDate: "2026-09-14",
							endDate: "2026-09-16",
							itemCount: 2,
							reimbursable: "500.00",
							currency: "EUR",
						},
					}),
					report({ id: "adjustment", kind: "trip", status: "approved" }),
				],
				adjustmentOriginals: new Map([["adjustment", "original"]]),
				balances: new Map([
					["report:original", balance],
					["report:adjustment", balance],
				]),
			}),
		);
		const original = rows.find((row) => row.id === "original");
		const adjustment = rows.find((row) => row.id === "adjustment");
		expect(original).toMatchObject({ adjustmentOf: null, balance });
		expect(adjustment).toMatchObject({
			adjustmentOf: { reportId: "original", title: "Customer workshop" },
			balance: null,
		});
	});

	it("shows a converted legacy draft only as the report it was continued as", () => {
		const rows = buildExpenseHistory(
			input({
				reports: [report({ id: "continued" })],
				claims: [
					{ ...claim, id: "old-draft", status: "draft" },
					{ ...claim, id: "open-draft", status: "draft" },
				],
				conversions: new Map([["old-draft", "continued"]]),
			}),
		);
		expect(rows.map((row) => row.id)).toEqual(["continued", "open-draft"]);
		expect(rows[0]).toMatchObject({ continuedFromClaimId: "old-draft" });
		expect(rows[1]).toMatchObject({ canContinue: true });
	});

	it("keeps balances only for approved expenses", () => {
		const settled = { state: "settled" as const, currencies: [] };
		const rows = buildExpenseHistory(
			input({
				reports: [report({ id: "draft" })],
				claims: [claim],
				balances: new Map([
					["report:draft", settled],
					["legacy_claim:claim-1", settled],
				]),
			}),
		);
		expect(rows.find((row) => row.id === "draft")?.balance).toBeNull();
		expect(rows.find((row) => row.id === "claim-1")?.balance).toBe(settled);
	});
});

describe("status filters", () => {
	const rows = buildExpenseHistory(
		input({
			reports: [
				report({ id: "draft", status: "draft" }),
				report({ id: "returned", status: "returned" }),
				report({ id: "submitted", status: "submitted" }),
				report({ id: "approved", status: "approved" }),
				report({ id: "rejected", status: "rejected" }),
			],
			claims: [
				{ ...claim, id: "legacy-draft", status: "draft" },
				{ ...claim, id: "legacy-pending", status: "submitted" },
				{ ...claim, id: "legacy-approved", status: "approved" },
			],
		}),
	);
	const ids = (filter: Parameters<typeof filterExpenseHistory>[1]) =>
		filterExpenseHistory(rows, filter)
			.map((row) => row.id)
			.sort();

	it("groups drafts and returned reports as needing the employee's action", () => {
		expect(ids("needs_action")).toEqual(["draft", "legacy-draft", "returned"]);
	});
	it("groups pending reviews, approvals and rejections across both sources", () => {
		expect(ids("in_review")).toEqual(["legacy-pending", "submitted"]);
		expect(ids("approved")).toEqual(["approved", "legacy-approved"]);
		expect(ids("rejected")).toEqual(["rejected"]);
		expect(ids("all")).toHaveLength(8);
	});
	it("counts each filter", () => {
		expect(countExpenseHistory(rows)).toEqual({
			all: 8,
			needs_action: 3,
			in_review: 2,
			approved: 2,
			rejected: 1,
		});
	});
});
