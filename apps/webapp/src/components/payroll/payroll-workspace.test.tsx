// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import { PayrollWorkspace } from "./payroll-workspace";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/payroll/actions", () => ({
	exportPayrollPdfAction: vi.fn(),
	getPayrollWorkspaceSummaryAction: vi.fn(),
	startScopedPayrollExportAction: vi.fn(),
}));

const summary = {
	organizationName: "Acme GmbH",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
	generatedBy: { id: "payroll-1", name: "Payroll User" },
	totals: { employeeCount: 1, totalWorkedHours: 8, blockerCount: 2 },
	employees: [
		{
			id: "employee-1",
			name: "Ada Lovelace",
			employeeNumber: "E-1",
			teamName: "Ops",
			contractType: "hourly",
			workedHours: 8,
			absenceDaysByCategory: [],
			hasBlockers: true,
		},
	],
	blockers: [
		{
			id: "blocker-1",
			employeeId: "employee-1",
			type: "missing_clock_out",
			label: "Missing clock-out",
		},
		{
			id: "blocker-2",
			employeeId: "employee-1",
			type: "pending_absence",
			label: "Pending absence approval",
		},
	],
} as const;

describe("PayrollWorkspace", () => {
	it("renders summary cards, employee rows, period controls, and blockers", () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		expect(screen.getByText("Payroll")).toBeTruthy();
		expect(screen.getByText("June 2026")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Month" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Week" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Custom" })).toBeTruthy();
		expect(screen.getByLabelText("Start")).toBeTruthy();
		expect(screen.getByLabelText("End")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
		expect(screen.getByText("Employees")).toBeTruthy();
		expect(screen.getByText("1")).toBeTruthy();
		expect(screen.getByText("Worked hours")).toBeTruthy();
		expect(screen.getByText("8.00 h")).toBeTruthy();
		expect(screen.getByText("Blockers")).toBeTruthy();
		expect(screen.getByText("2")).toBeTruthy();
		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("Missing clock-out")).toBeTruthy();
		expect(screen.getByText("Download combined PDF")).toBeTruthy();
		expect(screen.getByText("Trigger payroll export")).toBeTruthy();
	});
});
