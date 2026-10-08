import { describe, expect, it } from "vitest";
import {
	buildExpenseHistory,
	countExpenseHistory,
	EXPENSE_HISTORY_FILTERS,
	type ExpenseHistoryInput,
	filterExpenseHistory,
} from "../expense-history";
import type { DraftReportSummary } from "../report-store";

function report(overrides: Partial<DraftReportSummary> & { id: string }): DraftReportSummary {
	return {
		kind: "standalone",
		status: "draft",
		submissionCount: 0,
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

	it("offers deleting only drafts that were never submitted (#684)", () => {
		const rows = buildExpenseHistory(
			input({
				reports: [
					report({ id: "new-draft", status: "draft", submissionCount: 0 }),
					report({ id: "withdrawn", status: "draft", submissionCount: 1 }),
					report({ id: "returned", status: "returned", submissionCount: 1 }),
					report({ id: "submitted", status: "submitted", submissionCount: 1 }),
					report({ id: "approved", status: "approved", submissionCount: 1 }),
				],
			}),
		);
		const deletable = rows.flatMap((row) =>
			row.source === "report" && row.deletable ? [row.id] : [],
		);
		expect(deletable).toEqual(["new-draft"]);
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
			awaiting_reimbursement: 0,
			rejected: 1,
		});
	});
});

describe("reimbursement state (#751)", () => {
	function line(state: "settled" | "outstanding" | "overpaid", currency = "EUR") {
		const balance = state === "outstanding" ? "10.00" : state === "overpaid" ? "-10.00" : "0.00";
		return {
			currency,
			entitlement: "100.00",
			reimbursed: "90.00",
			recovered: "0.00",
			balance,
			state,
		};
	}
	const reimbursed = { state: "settled" as const, currencies: [line("settled")] };
	const outstanding = { state: "outstanding" as const, currencies: [line("outstanding")] };
	const overpaid = { state: "overpaid" as const, currencies: [line("overpaid")] };
	const mixed = {
		state: "mixed" as const,
		currencies: [line("outstanding", "CHF"), line("overpaid", "EUR")],
	};
	const rows = buildExpenseHistory(
		input({
			reports: [
				report({ id: "reimbursed", status: "approved" }),
				report({ id: "outstanding", status: "approved" }),
				report({ id: "overpaid", status: "approved" }),
				report({ id: "mixed", status: "approved" }),
				report({ id: "no-balance", status: "approved" }),
				report({ id: "adjustment", status: "approved" }),
				report({ id: "submitted", status: "submitted" }),
			],
			claims: [
				{ ...claim, id: "legacy-outstanding" },
				{ ...claim, id: "legacy-reimbursed" },
			],
			adjustmentOriginals: new Map([["adjustment", "outstanding"]]),
			balances: new Map([
				["report:reimbursed", reimbursed],
				["report:outstanding", outstanding],
				["report:overpaid", overpaid],
				["report:mixed", mixed],
				["report:adjustment", outstanding],
				["report:submitted", outstanding],
				["legacy_claim:legacy-outstanding", outstanding],
				["legacy_claim:legacy-reimbursed", reimbursed],
			]),
		}),
	);
	const reimbursement = (id: string) => rows.find((row) => row.id === id)?.reimbursement;

	it("marks an approved expense whose balance is fully covered as reimbursed", () => {
		expect(reimbursement("reimbursed")).toBe("reimbursed");
		expect(reimbursement("legacy-reimbursed")).toBe("reimbursed");
	});
	it("marks an approved expense that still owes the employee money as awaiting reimbursement", () => {
		expect(reimbursement("outstanding")).toBe("awaiting");
		expect(reimbursement("legacy-outstanding")).toBe("awaiting");
		// One currency still owed, another overpaid: still owed in part.
		expect(reimbursement("mixed")).toBe("awaiting");
	});
	it("gives no reimbursement state to overpaid, unbalanced, adjustment or unapproved expenses", () => {
		expect(reimbursement("overpaid")).toBeNull();
		expect(reimbursement("no-balance")).toBeNull();
		expect(reimbursement("adjustment")).toBeNull();
		expect(reimbursement("submitted")).toBeNull();
	});
	it("filters and counts the expenses awaiting reimbursement", () => {
		expect(
			filterExpenseHistory(rows, "awaiting_reimbursement")
				.map((row) => row.id)
				.sort(),
		).toEqual(["legacy-outstanding", "mixed", "outstanding"]);
		expect(countExpenseHistory(rows)).toMatchObject({
			approved: 8,
			awaiting_reimbursement: 3,
		});
	});
	it("offers the awaiting reimbursement filter right after Approved", () => {
		expect(EXPENSE_HISTORY_FILTERS).toEqual([
			"all",
			"needs_action",
			"in_review",
			"approved",
			"awaiting_reimbursement",
			"rejected",
		]);
	});
});
