// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PayrollWorkspace } from "./payroll-workspace";

const actionMocks = vi.hoisted(() => ({
	exportPayrollPdfAction: vi.fn(),
	getPayrollWorkspaceSummaryAction: vi.fn(),
	startScopedPayrollExportAction: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/payroll/actions", () => ({
	exportPayrollPdfAction: actionMocks.exportPayrollPdfAction,
	getPayrollWorkspaceSummaryAction: actionMocks.getPayrollWorkspaceSummaryAction,
	startScopedPayrollExportAction: actionMocks.startScopedPayrollExportAction,
}));

const summary = {
	organizationName: "Acme GmbH",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
	generatedBy: { id: "payroll-1", name: "Payroll User" },
	totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 2 },
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
		{
			id: "employee-2",
			name: "Grace Hopper",
			employeeNumber: "E-2",
			teamName: "Engineering",
			contractType: "fixed",
			workedHours: 0,
			absenceDaysByCategory: [],
			hasBlockers: false,
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
	beforeEach(() => {
		vi.clearAllMocks();
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValue({ success: true, data: summary });
	});

	it("renders summary cards, employee rows, period controls, and blockers", () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		expect(screen.getByText("Payroll")).toBeTruthy();
		expect(screen.getAllByText("June 2026").length).toBeGreaterThanOrEqual(2);
		expect(screen.getByRole("button", { name: "Month" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Week" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Custom" })).toBeTruthy();
		expect(screen.getByLabelText("Start")).toBeTruthy();
		expect(screen.getByLabelText("End")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
		expect(screen.getByText("Selected period")).toBeTruthy();
		expect(screen.getByText("Employees")).toBeTruthy();
		expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText("Worked hours")).toBeTruthy();
		expect(screen.getByText("8.00 h")).toBeTruthy();
		expect(screen.getByText("Blockers")).toBeTruthy();
		expect(screen.getByText("Payroll filters")).toBeTruthy();
		expect(screen.getByLabelText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByLabelText("Grace Hopper")).toBeTruthy();
		expect(screen.getByLabelText("Ops")).toBeTruthy();
		expect(screen.getByLabelText("Engineering")).toBeTruthy();
		expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText("Missing clock-out")).toBeTruthy();
		expect(screen.getByText("Download combined PDF")).toBeTruthy();
		expect(screen.getByText("Trigger payroll export")).toBeTruthy();
	});

	it("passes scoped employee ids when employee and team filters change", async () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByLabelText("Ada Lovelace"));
		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
				expect.objectContaining({ employeeIds: ["employee-1"] }),
			);
		});

		fireEvent.click(screen.getByLabelText("Ops"));
		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenLastCalledWith(
				expect.objectContaining({ employeeIds: ["employee-1"] }),
			);
		});
	});
});
