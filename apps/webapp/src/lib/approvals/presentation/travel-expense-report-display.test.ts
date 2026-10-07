import { describe, expect, it } from "vitest";
import type { TravelExpenseReportSubmittedFacts } from "../evidence/travel-expense-report-facts";
import { localizedTextFallback } from "../inbox/localized-text";
import { travelExpenseReportDisplay } from "./travel-expense-report-display";

const item = (description: string, expenseDate: string) => ({ description, expenseDate });

const trip = {
	trip: {
		purpose: "Customer workshop",
		startDate: "2026-10-01",
		endDate: "2026-10-03",
		timeZone: "Europe/Berlin",
		destinations: [],
	},
	items: [item("Train", "2026-10-01"), item("Hotel", "2026-10-02")],
	totals: { currency: "EUR", reimbursable: "440.61", companyPaid: "0.00" },
} as unknown as TravelExpenseReportSubmittedFacts;

describe("travelExpenseReportDisplay", () => {
	it("states a trip report's list row with typed dates and amounts (#687)", () => {
		const display = travelExpenseReportDisplay(trip);

		expect(display).toMatchObject({
			title: "Trip expense report",
			subtitle: "Customer workshop · 2026-10-01 – 2026-10-03",
			summary: "2 expenses · reimbursable EUR 440.61",
			icon: "receipt",
		});
		expect(display.localized?.title).toEqual({
			key: "approvals:approvals.reportSummary.tripTitle",
			fallback: "Trip expense report",
		});
		expect(display.localized?.subtitle.params).toEqual({
			name: "Customer workshop",
			dates: { kind: "plain_date_range", start: "2026-10-01", end: "2026-10-03" },
		});
		expect(display.localized?.summary.params).toEqual({
			count: 2,
			reimbursable: { kind: "money", amount: "440.61", currency: "EUR" },
		});
	});

	it("adds the company-paid total and names a standalone report by its first expense", () => {
		const display = travelExpenseReportDisplay({
			...trip,
			trip: null,
			items: [item("Taxi", "2026-10-02")],
			totals: { currency: "CHF", reimbursable: "0.00", companyPaid: "240.50" },
		});

		expect(display.title).toBe("Expense report");
		expect(display.subtitle).toBe("Taxi · 2026-10-02");
		expect(display.summary).toBe("1 expense · reimbursable CHF 0.00 · company-paid CHF 240.50");
		expect(localizedTextFallback(display.localized?.title ?? "")).toBe("Expense report");
		expect(display.localized?.subtitle.params?.dates).toEqual({
			kind: "plain_date",
			date: "2026-10-02",
		});
		expect(display.localized?.summary).toMatchObject({
			key: "approvals:approvals.reportSummary.detailWithCompanyPaid",
			params: {
				count: 1,
				reimbursable: { kind: "money", amount: "0.00", currency: "CHF" },
				companyPaid: { kind: "money", amount: "240.50", currency: "CHF" },
			},
		});
	});

	it("says so when the submitted facts are unavailable", () => {
		expect(travelExpenseReportDisplay(null)).toEqual({
			title: "Expense report",
			subtitle: "Submitted facts unavailable",
			summary: "",
			icon: "receipt",
		});
	});
});
