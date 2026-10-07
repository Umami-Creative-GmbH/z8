import { describe, expect, it } from "vitest";
import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import { isApprovalInboxDetailChange, localizedTextFallback } from "../inbox/localized-text";
import {
	allowanceOverrideReviewRows,
	allowanceOverrideReviewSections,
} from "./travel-expense-report-allowance-override";

const mileage: TravelExpenseReportSubmittedItem = {
	itemId: "km",
	position: 0,
	type: "mileage",
	expenseDate: "2026-09-14",
	category: "transport",
	description: "Berlin – Potsdam",
	original: { amount: "18.45", currency: "EUR" },
	paidBy: "employee",
	accountingReference: null,
	receipts: [],
	allowanceOverride: {
		overrideId: "override-km",
		kind: "mileage",
		amount: "18.45",
		currency: "EUR",
		reason: "No mileage policy yet",
		evidence: "Route planner printout",
		calculationBasis: "61.50 km × 0.30 EUR",
		situation: { kind: "missing_coverage", reasons: ["policy_missing"] },
		scope: {
			kind: "mileage",
			expenseDate: "2026-09-14",
			route: "Berlin – Potsdam",
			distanceKm: "61.50",
			vehicle: "car",
		},
		authorizedBy: { employeeId: "admin-1", name: "Ada Admin" },
		authorizedAt: "2026-09-20T08:00:00Z",
	},
};

function values(rows: ReturnType<typeof allowanceOverrideReviewRows>) {
	return rows.map((row) =>
		isApprovalInboxDetailChange(row.value) ? null : localizedTextFallback(row.value),
	);
}

describe("allowance override review (#610)", () => {
	it("shows the override, its evidence, the facts and the authorizer on the item", () => {
		const rows = allowanceOverrideReviewRows(mileage);
		expect(values(rows)).toEqual([
			"18.45 EUR",
			"No organization policy covers it",
			"No mileage policy yet",
			"Route planner printout",
			"61.50 km × 0.30 EUR",
			"Berlin – Potsdam, 61.50 km, car",
			"No ordinary policy result",
			"Ada Admin, 2026-09-20T08:00:00Z",
		]);
		expect(rows.every((row) => row.tone === "warning")).toBe(true);
	});

	it("names the ordinary policy result beside the override when one was frozen", () => {
		const rows = allowanceOverrideReviewRows({
			...mileage,
			mileage: {
				route: "Berlin – Potsdam",
				distanceKm: "61.50",
				vehicle: "car",
				ratePerKm: "0.2500",
				currency: "EUR",
				exactAmount: "15.375000",
				amount: "15.38",
				rounding: "half_up",
				policy: {
					policyId: "p",
					versionId: "v",
					effectiveFrom: "2026-01-01",
					source: { kind: "organization", reference: null, version: null, defaultKey: null },
				},
			},
		});
		expect(values(rows)).toContain("15.38 EUR");
	});

	it("is absent for an ordinary item", () => {
		const { allowanceOverride: _override, ...ordinary } = mileage;
		expect(allowanceOverrideReviewRows(ordinary)).toEqual([]);
		expect(allowanceOverrideReviewSections({ items: [ordinary] })).toEqual([]);
	});

	it("calls out every manually set allowance prominently", () => {
		const [callout] = allowanceOverrideReviewSections({ items: [mileage] });
		if (callout?.type !== "callout") throw new Error("callout expected");
		expect(callout.tone).toBe("warning");
		expect(localizedTextFallback(callout.title)).toBe("Allowances set manually");
		expect(callout.body).toMatchObject({
			key: "approvals:approvals.evidence.allowanceOverrideCalloutBody",
		});
		expect(localizedTextFallback(callout.body)).toBe(
			"An expense administrator set these allowances manually instead of the calculated amount: Mileage 1: Berlin – Potsdam (18.45 EUR). Check the reason and evidence before deciding.",
		);
	});
});
