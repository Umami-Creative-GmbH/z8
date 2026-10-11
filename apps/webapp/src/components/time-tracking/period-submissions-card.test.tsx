// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeePeriodViewRow } from "@/lib/time-tracking/period-submissions/employee-period-view";
import { PeriodSubmissionsCard } from "./period-submissions-card";

const state = vi.hoisted(() => ({
	submitPeriod: vi.fn(),
	withdrawPeriod: vi.fn(),
	refresh: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/period-submissions", () => ({
	submitPeriod: state.submitPeriod,
	withdrawPeriod: state.withdrawPeriod,
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

	it("lists what keeps the period open when submitting is refused", async () => {
		state.submitPeriod.mockResolvedValue({
			success: true,
			data: {
				kind: "refused",
				reason: "period_open",
				blockers: [
					{
						kind: "live_work",
						workPeriodId: "w1",
						startTime: "2026-03-08T07:00:00.000Z",
						endTime: null,
						timezone: "Europe/Berlin",
					},
					{
						kind: "time_correction",
						workPeriodId: "w2",
						startTime: "2026-03-03T07:00:00.000Z",
						endTime: "2026-03-03T15:00:00.000Z",
						timezone: "Europe/Berlin",
					},
					{
						kind: "manual_work",
						workPeriodId: "w3",
						startTime: "2026-03-04T07:00:00.000Z",
						endTime: "2026-03-04T11:00:00.000Z",
						timezone: "Europe/Berlin",
					},
					{
						kind: "absence_request",
						absenceId: "a1",
						startDate: "2026-03-08",
						endDate: "2026-03-10",
					},
				],
			},
		});
		render(<PeriodSubmissionsCard periods={[period({})]} />);
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("This period is still open");
		const items = Array.from(alert.querySelectorAll("li")).map((item) => item.textContent);
		expect(items).toEqual([
			expect.stringMatching(/^Work started .*8:00.* is still running\.$/),
			expect.stringMatching(/^A time correction for work on .*8:00.* is undecided\.$/),
			expect.stringMatching(/^Manual work on .*8:00.* is undecided\.$/),
			expect.stringMatching(/^An absence request for .*8.*10.* is undecided\.$/),
		]);
		expect(state.toastError).toHaveBeenCalledWith("This period is still open");
	});

	it("withdraws a submitted period and refreshes the page", async () => {
		state.withdrawPeriod.mockResolvedValue({ success: true, data: { kind: "withdrawn" } });
		render(
			<PeriodSubmissionsCard
				periods={[
					period({ status: "submitted", canSubmit: false }),
					period({ startDate: "2026-02-23", status: "approved", canSubmit: false }),
				]}
			/>,
		);
		const buttons = screen.getAllByRole("button", { name: "Withdraw" });
		expect(buttons).toHaveLength(1);
		fireEvent.click(buttons[0] as HTMLElement);
		await waitFor(() => expect(state.toastSuccess).toHaveBeenCalledWith("Submission withdrawn"));
		expect(state.withdrawPeriod).toHaveBeenCalledWith({ periodStartDate: "2026-03-02" });
		expect(state.refresh).toHaveBeenCalled();
	});

	it("explains a withdrawal that is no longer possible", async () => {
		state.withdrawPeriod.mockResolvedValue({
			success: true,
			data: { kind: "refused", reason: "not_pending" },
		});
		render(<PeriodSubmissionsCard periods={[period({ status: "submitted", canSubmit: false })]} />);
		fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith(
				"This submission was already decided and can no longer be withdrawn.",
			),
		);
		expect(state.refresh).toHaveBeenCalled();
	});
});
