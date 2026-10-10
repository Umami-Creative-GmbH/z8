// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getPayrollExportScopeAction: vi.fn(),
	getOvertimePayoutExportReadinessAction: vi.fn(),
	startScopedPayrollExportAction: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

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
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/app/[locale]/(app)/payroll/actions", () => ({
	getPayrollExportScopeAction: mocks.getPayrollExportScopeAction,
	getOvertimePayoutExportReadinessAction: mocks.getOvertimePayoutExportReadinessAction,
	startScopedPayrollExportAction: mocks.startScopedPayrollExportAction,
}));

import { FormerEmployeesExportCard } from "./former-employees-export-card";

function renderCard() {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<FormerEmployeesExportCard
				initialMonth="2026-07"
				exportFormats={[{ id: "datev_lohn", label: "DATEV Lohn & Gehalt" }]}
			/>
		</QueryClientProvider>,
	);
}

describe("FormerEmployeesExportCard (#1001)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOvertimePayoutExportReadinessAction.mockResolvedValue({
			success: true,
			data: { unmappedPayoutCount: 0 },
		});
		mocks.startScopedPayrollExportAction.mockResolvedValue({
			success: true,
			data: { jobId: "job-1", isAsync: true },
		});
	});

	it("exports the shown month when one of the employees was still employed in it", async () => {
		mocks.getPayrollExportScopeAction.mockResolvedValue({
			success: true,
			data: { employeeCount: 1 },
		});
		renderCard();

		const exportButton = screen.getByRole("button", { name: /Export/ });
		await waitFor(() => expect(exportButton).toHaveProperty("disabled", false));
		fireEvent.click(exportButton);

		await waitFor(() =>
			expect(mocks.startScopedPayrollExportAction).toHaveBeenCalledWith({
				startDate: "2026-07-01",
				endDate: "2026-07-31",
				label: "July 2026",
				formatId: "datev_lohn",
			}),
		);
	});

	it("says so and offers no export when nobody was employed in the month", async () => {
		mocks.getPayrollExportScopeAction.mockResolvedValue({
			success: true,
			data: { employeeCount: 0 },
		});
		renderCard();

		expect(
			await screen.findByText("No one in your payroll access was employed in this period."),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: /Export/ })).toHaveProperty("disabled", true);
	});

	it("moves to the previous month", async () => {
		mocks.getPayrollExportScopeAction.mockResolvedValue({
			success: true,
			data: { employeeCount: 1 },
		});
		renderCard();

		fireEvent.click(screen.getByRole("button", { name: "Previous month" }));

		expect(await screen.findByText("June 2026")).toBeTruthy();
		await waitFor(() =>
			expect(mocks.getPayrollExportScopeAction).toHaveBeenCalledWith({
				startDate: "2026-06-01",
				endDate: "2026-06-30",
				label: "June 2026",
			}),
		);
	});
});
