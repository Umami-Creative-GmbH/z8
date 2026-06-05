// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
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

const baseSummary: PayrollWorkspaceSummary = {
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
};

function buildSummary(overrides: Partial<PayrollWorkspaceSummary> = {}): PayrollWorkspaceSummary {
	return {
		...baseSummary,
		...overrides,
		period: overrides.period ?? baseSummary.period,
		totals: overrides.totals ?? baseSummary.totals,
		employees: overrides.employees ?? baseSummary.employees,
		blockers: overrides.blockers ?? baseSummary.blockers,
	};
}

const summary = buildSummary();

describe("PayrollWorkspace", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValue({
			success: true,
			data: summary,
		});
	});

	it("renders summary cards, employee rows, period controls, and blockers", () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		expect(screen.getByText("Payroll")).toBeTruthy();
		expect(
			screen.getByText("Review payroll totals, readiness, and exports for the selected period."),
		).toBeTruthy();
		expect(screen.getByRole("heading", { name: "June 2026" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Previous period" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Next period" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Current period" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Month" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Week" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Custom" })).toBeTruthy();
		expect(screen.getByLabelText("Start")).toBeTruthy();
		expect(screen.getByLabelText("End")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
		expect(screen.getByText("Employees")).toBeTruthy();
		expect(screen.getByText("Worked hours")).toBeTruthy();
		expect(screen.getByText("8.00 h")).toBeTruthy();
		expect(screen.getByText("Ready")).toBeTruthy();
		const readySummaryCard = screen.getByText("Ready").closest('[data-slot="card"]');
		expect(readySummaryCard).toBeTruthy();
		expect(within(readySummaryCard as HTMLElement).getByText("1")).toBeTruthy();
		expect(screen.getByText("Blockers")).toBeTruthy();
		expect(screen.getAllByText("Selected period")).toHaveLength(1);
		expect(screen.getByText("Payroll scope")).toBeTruthy();
		expect(screen.getByLabelText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByLabelText("Grace Hopper")).toBeTruthy();
		expect(screen.getByLabelText("Ops")).toBeTruthy();
		expect(screen.getByLabelText("Engineering")).toBeTruthy();
		expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText("Missing clock-out")).toBeTruthy();
		expect(screen.getByText("Download PDF")).toBeTruthy();
		expect(screen.getByText("Trigger export")).toBeTruthy();
	});

	it("disables export controls when no export formats are configured", () => {
		render(<PayrollWorkspace initialSummary={summary} exportFormats={[]} />);

		const exportLabel = screen.getByText("Payroll export target");
		const exportTarget = screen.getByLabelText("Payroll export target") as HTMLButtonElement;
		const triggerExportButton = screen.getByRole("button", {
			name: "Trigger export",
		}) as HTMLButtonElement;

		expect(exportLabel.getAttribute("for")).toBe("payroll-export-target");
		expect(exportTarget.id).toBe("payroll-export-target");
		expect(exportTarget.disabled).toBe(true);
		expect(triggerExportButton.disabled).toBe(true);
		expect(screen.getByText("No configured payroll export target")).toBeTruthy();
	});

	it("disables PDF and export actions when filters produce no matches", async () => {
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
		fireEvent.click(screen.getByLabelText("Engineering"));

		await waitFor(() => {
			expect(
				screen.getAllByText("No employees match the selected payroll filters.").length,
			).toBeGreaterThan(0);
		});
		const employeesSummaryCard = screen.getByText("Employees").closest('[data-slot="card"]');
		expect(employeesSummaryCard).toBeTruthy();
		expect(within(employeesSummaryCard as HTMLElement).getByText("0")).toBeTruthy();
		const employeeTotalsCard = screen.getByText("Employee totals").closest('[data-slot="card"]');
		expect(employeeTotalsCard).toBeTruthy();
		expect(within(employeeTotalsCard as HTMLElement).queryByText("E-1")).toBeNull();
		expect(
			(screen.getByRole("button", { name: "Download PDF" }) as HTMLButtonElement).disabled,
		).toBe(true);
		expect(
			(screen.getByRole("button", { name: "Trigger export" }) as HTMLButtonElement).disabled,
		).toBe(true);
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

	it("moves to the previous month from the selected month", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
			success: true,
			data: buildSummary({
				period: { start: "2026-05-01", end: "2026-05-31", label: "May 2026" },
			}),
		});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Previous period" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
				expect.objectContaining({
					startDate: "2026-05-01",
					endDate: "2026-05-31",
					label: "May 2026",
				}),
			);
		});
	});

	it("moves to the next month from the selected month", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
			success: true,
			data: buildSummary({
				period: { start: "2026-07-01", end: "2026-07-31", label: "July 2026" },
			}),
		});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Next period" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
				expect.objectContaining({
					startDate: "2026-07-01",
					endDate: "2026-07-31",
					label: "July 2026",
				}),
			);
		});
	});

	it("moves to the previous week from the selected week", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction
			.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-06-01", end: "2026-06-07", label: "Jun 1 - Jun 7, 2026" },
				}),
			})
			.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-05-25", end: "2026-05-31", label: "May 25 - May 31, 2026" },
				}),
			});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Week" }));
		await waitFor(() =>
			expect(screen.getAllByText("Jun 1 - Jun 7, 2026").length).toBeGreaterThan(0),
		);
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Previous period" }) as HTMLButtonElement).disabled,
			).toBe(false),
		);

		fireEvent.click(screen.getByRole("button", { name: "Previous period" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenLastCalledWith(
				expect.objectContaining({
					startDate: "2026-05-25",
					endDate: "2026-05-31",
					label: "May 25 - May 31, 2026",
				}),
			);
		});
	});

	it("keeps month mode when switching to week fails", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction
			.mockResolvedValueOnce({
				success: false,
				error: "Unable to load week",
			})
			.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-05-01", end: "2026-05-31", label: "May 2026" },
				}),
			});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Week" }));
		await waitFor(() =>
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(1),
		);
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Previous period" }) as HTMLButtonElement).disabled,
			).toBe(false),
		);

		fireEvent.click(screen.getByRole("button", { name: "Previous period" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenLastCalledWith(
				expect.objectContaining({
					startDate: "2026-05-01",
					endDate: "2026-05-31",
					label: "May 2026",
				}),
			);
		});
	});

	it("moves to the next week from the selected week", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction
			.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-06-01", end: "2026-06-07", label: "Jun 1 - Jun 7, 2026" },
				}),
			})
			.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-06-08", end: "2026-06-14", label: "Jun 8 - Jun 14, 2026" },
				}),
			});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Week" }));
		await waitFor(() =>
			expect(screen.getAllByText("Jun 1 - Jun 7, 2026").length).toBeGreaterThan(0),
		);
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Next period" }) as HTMLButtonElement).disabled,
			).toBe(false),
		);

		fireEvent.click(screen.getByRole("button", { name: "Next period" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenLastCalledWith(
				expect.objectContaining({
					startDate: "2026-06-08",
					endDate: "2026-06-14",
					label: "Jun 8 - Jun 14, 2026",
				}),
			);
		});
	});

	it("returns to the current month", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));

		try {
			actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-08-01", end: "2026-08-31", label: "August 2026" },
				}),
			});

			render(
				<PayrollWorkspace
					initialSummary={summary}
					exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: "Current period" }));

			await waitFor(() => {
				expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
					expect.objectContaining({
						startDate: "2026-08-01",
						endDate: "2026-08-31",
						label: "August 2026",
					}),
				);
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
