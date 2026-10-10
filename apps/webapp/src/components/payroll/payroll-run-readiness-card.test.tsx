// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PayrollRunReadinessEntry } from "@/lib/travel-expenses/payroll-run-readiness";
import { PayrollRunReadinessList } from "./payroll-run-readiness-card";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
vi.mock("@/app/[locale]/(app)/payroll/actions", () => ({
	getPayrollRunReadinessAction: vi.fn(),
}));

const EMPLOYEE = "e8540000-0000-4000-8000-000000000001";

function entry(
	id: string,
	skip: PayrollRunReadinessEntry["skip"],
	overrides: Partial<PayrollRunReadinessEntry> = {},
): PayrollRunReadinessEntry {
	return {
		source: { type: "report", id },
		employeeId: EMPLOYEE,
		employeeName: "Ada Lovelace",
		title: { kind: "standalone", description: `Expense ${id}`, expenseDate: "2026-10-02" },
		outstanding: [{ currency: "EUR", amount: "30.00" }],
		skip,
		financeQueueHref: `/travel-expenses/finance?employee=${EMPLOYEE}&currency=EUR`,
		...overrides,
	};
}

function row(id: string) {
	const cell = screen.getByText(`Expense ${id}`);
	const item = cell.closest("li");
	if (!item) throw new Error(`no row for ${id}`);
	return within(item);
}

describe("PayrollRunReadinessList", () => {
	it("gives each report the reason the payroll run leaves it out, with what to pay by bank transfer", () => {
		render(
			<PayrollRunReadinessList
				entries={[
					entry(
						"chf",
						{ reason: "currency_not_eur" },
						{
							outstanding: [{ currency: "CHF", amount: "90.00" }],
						},
					),
					entry("meals", {
						reason: "unmapped_wage_type",
						kinds: ["receipt_meals", "mileage_excess"],
					}),
					entry("drive", {
						reason: "no_statutory_baseline",
						items: [
							{
								itemId: "i1",
								cause: "allowance_override",
								type: "mileage",
								expenseDate: "2026-10-07",
								description: "Office – customer – back",
							},
						],
					}),
					entry("paid", { reason: "reimbursed_outside_payroll" }),
					entry("negative", { reason: "negative_difference", kinds: ["per_diem_excess"] }),
					entry("held", {
						reason: "included_in_other_run",
						run: {
							jobId: "job-1",
							formatId: "datev_lohn",
							formatName: "DATEV Lohn & Gehalt",
							periodStart: "2026-09-01",
							periodEnd: "2026-09-30",
							includedAt: "2026-09-30T10:00:00Z",
							partlyConfirmed: false,
						},
					}),
					entry("nothing", { reason: "nothing_owed" }),
					entry("connector", { reason: "api_connector" }),
				]}
			/>,
		);

		expect(row("chf").getByText(/only euro amounts/i)).toBeTruthy();
		expect(row("chf").getByText(/CHF\s?90\.00/)).toBeTruthy();
		expect(
			row("meals").getByText(/No wage type is mapped .*Receipts: meals, Mileage: taxable excess/),
		).toBeTruthy();
		expect(
			row("drive").getByText(/No statutory baseline for: Office – customer – back \(set by hand\)/),
		).toBeTruthy();
		expect(row("paid").getByText(/paid by bank transfer or recovered/i)).toBeTruthy();
		expect(row("negative").getByText(/Per diem: taxable excess/)).toBeTruthy();
		expect(row("held").getByText(/DATEV Lohn & Gehalt/)).toBeTruthy();
		expect(row("nothing").getByText(/nothing left for payroll/i)).toBeTruthy();
		expect(row("connector").getByText(/API connector/)).toBeTruthy();
		expect(row("paid").getByText("Ada Lovelace")).toBeTruthy();
		expect(row("paid").getByRole("link").getAttribute("href")).toBe(
			`/travel-expenses/finance?employee=${EMPLOYEE}&currency=EUR`,
		);
	});

	it("names a legacy claim and a trip", () => {
		render(
			<PayrollRunReadinessList
				entries={[
					entry(
						"claim",
						{ reason: "legacy_claim" },
						{
							source: { type: "legacy_claim", id: "claim" },
							title: { kind: "legacy_claim", claimType: "receipt", startDate: null, endDate: null },
						},
					),
					entry(
						"trip",
						{ reason: "currency_not_eur" },
						{
							title: { kind: "trip", purpose: "Customer workshop", startDate: null, endDate: null },
						},
					),
				]}
			/>,
		);

		expect(screen.getByText("Legacy receipt claim")).toBeTruthy();
		expect(screen.getByText(/never paid through payroll/i)).toBeTruthy();
		expect(screen.getByText("Customer workshop")).toBeTruthy();
	});
});
