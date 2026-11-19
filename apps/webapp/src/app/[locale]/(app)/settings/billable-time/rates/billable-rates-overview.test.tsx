/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillableRateSeriesSummary } from "@/lib/billable-time/billable-rates";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", hour12: false }),
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/billable-time/billable-rate-series", () => ({
	BillableRateSeries: () => null,
	BillableRateActionPanel: () => null,
}));

import { AddBillableRateAction, BillableRatesOverview } from "./billable-rates-overview";

const period = { id: "p", effectiveFrom: "2025-01-01", effectiveTo: null, hourlyRate: "90.00" };

function summary(overrides: Partial<BillableRateSeriesSummary>): BillableRateSeriesSummary {
	return {
		level: "project",
		employeeId: null,
		projectId: null,
		customerId: null,
		employeeName: null,
		projectName: null,
		customerName: null,
		periods: [period],
		...overrides,
	};
}

afterEach(cleanup);

describe("BillableRatesOverview", () => {
	it("names rate targets that no longer resolve as deleted, muted", () => {
		render(
			<BillableRatesOverview
				currency="EUR"
				series={[
					summary({ level: "project", projectId: "pr-1", projectName: null }),
					summary({
						level: "customer",
						customerId: "c-1",
						customerName: null,
						periods: [{ ...period, id: "c" }],
					}),
					summary({
						level: "employee_project",
						employeeId: "e-1",
						projectId: "pr-2",
						employeeName: "Ada Lovelace",
						projectName: null,
						periods: [{ ...period, id: "ep" }],
					}),
					summary({
						level: "employee",
						employeeId: "e-2",
						employeeName: "Grace Hopper",
						periods: [{ ...period, id: "e" }],
					}),
				]}
			/>,
		);

		expect(screen.queryByText("?")).toBeNull();
		const project = screen.getByText("Deleted project");
		expect(project.closest("td")?.className).toContain("text-muted-foreground");
		expect(screen.getByText("Deleted customer")).toBeTruthy();
		expect(screen.getByText("Ada Lovelace · Deleted project")).toBeTruthy();
		const employee = screen.getByText("Grace Hopper");
		expect(employee.closest("td")?.className).toContain("font-medium");
		expect(employee.closest("td")?.className).not.toContain("text-muted-foreground");
	});

	it("leaves adding a rate to the page header action", () => {
		render(<BillableRatesOverview currency="EUR" series={[]} />);

		expect(screen.queryByRole("button", { name: "Add rate" })).toBeNull();
	});
});

describe("AddBillableRateAction", () => {
	it("opens the add-rate panel", async () => {
		const user = userEvent.setup();
		render(<AddBillableRateAction options={{ employees: [], projects: [], customers: [] }} />);

		await user.click(screen.getByRole("button", { name: "Add rate" }));

		expect(await screen.findByText("Choose the rate level and what the rate is for.")).toBeTruthy();
	});
});
