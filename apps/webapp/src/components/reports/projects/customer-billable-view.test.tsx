/* @vitest-environment jsdom */

import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BillableFigures, CustomerBillableReport } from "@/lib/reports/project-types";
import { render } from "@/test/render-with-translations";

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", timeFormat: "24h" }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/components/reports/report-document-export-buttons", () => ({
	ReportDocumentExportButtons: () => null,
}));

import { CustomerBillableView } from "./customer-billable-view";

function figures(overrides: Partial<BillableFigures> = {}): BillableFigures {
	return {
		access: "revenue",
		currency: "EUR",
		billableMinutes: 0,
		billableHours: 0,
		nonBillableMinutes: 0,
		nonBillableHours: 0,
		withoutCustomerMinutes: 0,
		withoutCustomerHours: 0,
		withoutCustomerWorkCount: 0,
		unpricedWorkCount: 0,
		unpricedHours: 0,
		pendingReviewCount: 0,
		revenue: "0.00",
		...overrides,
	} as BillableFigures;
}

const project = (id: string, name: string) => ({
	id,
	name,
	description: null,
	status: "active" as const,
	color: null,
	budgetHours: null,
	deadline: null,
	customer: null,
});

describe("CustomerBillableView", () => {
	it("lists projects without a customer in a group of their own", () => {
		const internal = figures({
			withoutCustomerMinutes: 60,
			withoutCustomerHours: 1,
			withoutCustomerWorkCount: 1,
		});
		const report: CustomerBillableReport = {
			period: { startDate: "2026-03-01", endDate: "2026-03-31" },
			access: "revenue",
			billableTime: { currency: "EUR", ratesResolvedAt: "2026-04-01T00:00:00Z" },
			customers: [],
			withoutCustomer: {
				totalHours: 1,
				totalMinutes: 60,
				workPeriodCount: 1,
				billable: internal,
				projects: [
					{
						project: project("p1", "Internal"),
						totalHours: 1,
						totalMinutes: 60,
						workPeriodCount: 1,
						billable: internal,
					},
				],
			},
			totals: { totalHours: 1, totalMinutes: 60, workPeriodCount: 1, billable: internal },
		};
		render(<CustomerBillableView report={report} onProjectSelect={() => {}} />);

		const group = screen.getByRole("button", { name: "Without customer" });
		expect(screen.getByText("1.0 h billable without customer, cannot be handed off")).toBeTruthy();
		fireEvent.click(group);
		expect(screen.getByRole("button", { name: "Internal" })).toBeTruthy();
	});
});
