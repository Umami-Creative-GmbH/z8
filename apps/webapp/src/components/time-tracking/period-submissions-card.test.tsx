// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeePeriodViewRow } from "@/lib/time-tracking/period-submissions/employee-period-view";
import { PeriodSubmissionsCard } from "./period-submissions-card";

const state = vi.hoisted(() => ({
	submitPeriod: vi.fn(),
	refresh: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/period-submissions", () => ({
	submitPeriod: state.submitPeriod,
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: { success: state.toastSuccess, error: state.toastError } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
	}),
}));

function period(overrides: Partial<EmployeePeriodViewRow>): EmployeePeriodViewRow {
	return {
		startDate: "2026-03-02",
		endDate: "2026-03-08",
		status: "awaiting_submission",
		rejectionReason: null,
		submittedAt: null,
		canSubmit: true,
		opensOn: "2026-03-08",
		...overrides,
	};
}

describe("PeriodSubmissionsCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows each period's status and the rejection reason", () => {
		render(
			<PeriodSubmissionsCard
				periods={[
					period({
						startDate: "2026-03-09",
						endDate: "2026-03-15",
						canSubmit: false,
						opensOn: "2026-03-15",
					}),
					period({ status: "rejected", rejectionReason: "Friday is missing" }),
					period({
						startDate: "2026-02-23",
						endDate: "2026-03-01",
						status: "approved",
						canSubmit: false,
					}),
				]}
			/>,
		);
		expect(screen.getByText("Rejected")).toBeTruthy();
		expect(screen.getByText("Reason: Friday is missing")).toBeTruthy();
		expect(screen.getByText("Approved")).toBeTruthy();
		expect(screen.getByText(/You can submit from/)).toBeTruthy();
		expect(screen.getAllByRole("button", { name: "Submit" })).toHaveLength(1);
	});

	it("submits a period and refreshes the page", async () => {
		state.submitPeriod.mockResolvedValue({ success: true, data: { kind: "submitted" } });
		render(<PeriodSubmissionsCard periods={[period({})]} />);
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		await waitFor(() =>
			expect(state.toastSuccess).toHaveBeenCalledWith("Period submitted for approval"),
		);
		expect(state.submitPeriod).toHaveBeenCalledWith({ periodStartDate: "2026-03-02" });
		expect(state.refresh).toHaveBeenCalled();
	});

	it("explains a refusal", async () => {
		state.submitPeriod.mockResolvedValue({
			success: true,
			data: { kind: "refused", reason: "period_not_ended" },
		});
		render(<PeriodSubmissionsCard periods={[period({})]} />);
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith(
				"You can submit this period from its last day onward.",
			),
		);
		expect(state.refresh).not.toHaveBeenCalled();
	});
});
