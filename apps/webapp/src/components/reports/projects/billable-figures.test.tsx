/* @vitest-environment jsdom */

import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillableFigures, ProjectTeamMember } from "@/lib/reports/project-types";
import { render } from "@/test/render-with-translations";

const display = vi.hoisted(() => ({ locale: "en-US" }));

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: display.locale, timezone: "UTC", timeFormat: "24h" }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

import { BillableEmployeeTable, BillableFiguresCard } from "./billable-figures";

const base = {
	currency: "EUR",
	billableMinutes: 150,
	billableHours: 2.5,
	nonBillableMinutes: 60,
	nonBillableHours: 1,
	withoutCustomerMinutes: 0,
	withoutCustomerHours: 0,
	withoutCustomerWorkCount: 0,
	unpricedWorkCount: 0,
	unpricedHours: 0,
	pendingReviewCount: 0,
	revenue: "200.00",
};
const context = { currency: "EUR", ratesResolvedAt: "2026-05-02T08:00:00Z" };
const invoicing = {
	invoicedMinutes: 60,
	invoicedHours: 1,
	invoicedRevenue: "80.00",
	uninvoicedMinutes: 90,
	uninvoicedHours: 1.5,
	uninvoicedRevenue: "120.00",
	changedAfterInvoicingCount: 2,
};
const full = {
	access: "full" as const,
	...base,
	cost: "100.00",
	margin: "100.00",
	marginPercent: 50,
	costUnknownWorkCount: 0,
};

beforeEach(() => {
	display.locale = "en-US";
});

describe("BillableFiguresCard", () => {
	it("shows a project manager hours and revenue, and no cost or margin", () => {
		const figures: BillableFigures = { access: "revenue", ...base };
		render(<BillableFiguresCard figures={figures} context={context} />);

		expect(screen.getByText("Revenue")).toBeTruthy();
		expect(screen.getByText("€200.00")).toBeTruthy();
		expect(screen.queryByText("Cost")).toBeNull();
		expect(screen.queryByText("Margin")).toBeNull();
	});

	it("shows an unknown margin as cost unknown, never as 100%", () => {
		const figures: BillableFigures = {
			...full,
			cost: null,
			margin: null,
			marginPercent: null,
			costUnknownWorkCount: 1,
		};
		const { container } = render(<BillableFiguresCard figures={figures} context={context} />);

		expect(screen.getAllByText("Cost unknown")).toHaveLength(2);
		expect(container.textContent).not.toContain("100");
	});

	it("formats hours with the viewer's decimal separator and a spaced unit", () => {
		display.locale = "de-DE";
		const figures: BillableFigures = { access: "revenue", ...base };
		render(<BillableFiguresCard figures={figures} context={context} />);

		expect(screen.getByText("2,5 h")).toBeTruthy();
		expect(screen.getByText("1,0 h")).toBeTruthy();
	});

	it("links owners and admins from the changed-after-invoicing count to the marked work", () => {
		const figures: BillableFigures = { ...full, invoicing };
		render(<BillableFiguresCard figures={figures} context={context} />);

		const link = screen.getByRole("link", {
			name: "2 invoiced work periods were changed after invoicing",
		});
		expect(link.getAttribute("href")).toBe(
			"/settings/billable-time/hand-off#changed-after-invoicing",
		);
	});

	it("gives project managers the count without a link to the admin-only hand-off area", () => {
		const figures: BillableFigures = { access: "revenue", ...base, invoicing };
		render(<BillableFiguresCard figures={figures} context={context} />);

		expect(screen.getByText("2 invoiced work periods were changed after invoicing")).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("flags billable work on projects without a customer, which cannot be handed off", () => {
		const figures: BillableFigures = {
			access: "revenue",
			...base,
			withoutCustomerMinutes: 90,
			withoutCustomerHours: 1.5,
			withoutCustomerWorkCount: 2,
		};
		render(<BillableFiguresCard figures={figures} context={context} />);

		expect(
			screen.getByText(
				"1.5 h of billable work without customer (2 work periods): no revenue, cannot be handed off",
			),
		).toBeTruthy();
	});
});

describe("BillableEmployeeTable", () => {
	it("lists each employee's hours in the viewer's locale", () => {
		display.locale = "de-DE";
		const employees = [
			{ employeeId: "e1", employeeName: "Ada", billable: full },
		] as unknown as ProjectTeamMember[];
		render(<BillableEmployeeTable employees={employees} />);

		const row = screen.getByRole("row", { name: /Ada/ });
		expect(within(row).getByText("2,5 h")).toBeTruthy();
		expect(within(row).getByText("1,0 h")).toBeTruthy();
	});
});
