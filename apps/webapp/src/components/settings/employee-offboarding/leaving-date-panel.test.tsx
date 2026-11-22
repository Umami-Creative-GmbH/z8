/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeOffboardingView } from "@/lib/employee-lifecycle/view-types";

const mocks = vi.hoisted(() => ({
	useEmployeeOffboarding: vi.fn(),
	usePastDeparturePreview: vi.fn(),
	recordPastDeparture: vi.fn(),
	correctPastDepartureDate: vi.fn(),
	recordHistoricalDepartureDate: vi.fn(),
	scheduleDeparture: vi.fn(),
	offboardNow: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [k, v]) => text.replaceAll(`{${k}}`, String(v)),
				fallback,
			),
	}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/query/use-employee-offboarding", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/query/use-employee-offboarding")>()),
	useEmployeeOffboarding: mocks.useEmployeeOffboarding,
	usePastDeparturePreview: mocks.usePastDeparturePreview,
}));

vi.mock("./replacement-employee-select", () => ({
	ReplacementEmployeeSelect: ({
		value,
		onChange,
	}: {
		value: string | null;
		onChange: (id: string | null) => void;
	}) => (
		<button type="button" data-testid="mock-replacement-select" onClick={() => onChange("mgr-2")}>
			{value ?? "No replacement"}
		</button>
	),
}));

import { LeavingDatePanel } from "./leaving-date-panel";

function baseView(overrides: Partial<EmployeeOffboardingView> = {}): EmployeeOffboardingView {
	return {
		employeeId: "emp-1",
		organizationId: "org-1",
		employmentPeriodId: "period-1",
		state: "active",
		departure: null,
		deactivation: null,
		previousEmploymentPeriodId: null,
		membershipApproved: true,
		followUp: { pending: 0, failed: 0, openReviews: 0 },
		failedTasks: [],
		reviews: [],
		futureWork: { shifts: 0, absences: 0, employmentTerms: 0 },
		deputyAbsences: 0,
		workBalance: null,
		capabilities: {
			schedule: true,
			cancel: false,
			offboardNow: true,
			rehire: false,
			resolve: true,
			recordPastDeparture: true,
			correctPastDepartureDate: false,
			recordHistoricalDepartureDate: false,
		},
		...overrides,
	};
}

function renderPanel() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<LeavingDatePanel organizationId="org-1" employeeId="emp-1" />
		</QueryClientProvider>,
	);
}

describe("LeavingDatePanel (#1930)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.recordPastDeparture.mockResolvedValue({ success: true, data: {} });
		mocks.correctPastDepartureDate.mockResolvedValue({ success: true, data: {} });
		mocks.recordHistoricalDepartureDate.mockResolvedValue({ success: true, data: {} });
		mocks.scheduleDeparture.mockResolvedValue({ success: true, data: {} });
		mocks.offboardNow.mockResolvedValue({ success: true, data: {} });
		mocks.usePastDeparturePreview.mockReturnValue({
			isFetching: false,
			data: {
				lastWorkingDay: "2026-05-15",
				cutoff: "2026-05-15T22:00:00Z",
				timezone: "Europe/Berlin",
				pendingDutyCount: 0,
				replacementOptions: [],
				exceptions: ["work_after_cutoff", "payroll_reconciliation"],
				equipment: [],
				impact: {
					workAfterCutoff: {
						workPeriodCount: 2,
						timeEntryCount: 4,
						workPeriodIds: ["wp-1", "wp-2"],
						earliestWorkAt: "2026-05-16T08:00:00Z",
						latestWorkAt: "2026-05-17T16:00:00Z",
						hasRunningTimer: false,
					},
					payrollReconciliation: {
						closedMonths: ["2026-05"],
						settledDayCount: 5,
						settledDates: ["2026-05-16"],
						earliestSettledDate: "2026-05-16",
						latestSettledDate: "2026-05-20",
						requiresReconciliation: true,
					},
					requiresWorkAfterCutoffReview: true,
					requiresPayrollReconciliationReview: true,
				},
			},
		});
	});

	it("supports Will Leave, Offboard Now, and Has Left with live closed/settled payroll preview and searchable replacement picker", async () => {
		mocks.useEmployeeOffboarding.mockReturnValue({
			view: baseView(),
			isLoading: false,
			isMutating: false,
			scheduleDeparture: mocks.scheduleDeparture,
			offboardNow: mocks.offboardNow,
			recordPastDeparture: mocks.recordPastDeparture,
			correctPastDepartureDate: mocks.correctPastDepartureDate,
			recordHistoricalDepartureDate: mocks.recordHistoricalDepartureDate,
		});

		renderPanel();

		expect(screen.getByText("Will Leave (future date)")).toBeTruthy();
		expect(screen.getByText("Offboard Now (immediate)")).toBeTruthy();
		expect(screen.getByText("Has Left (past date)")).toBeTruthy();

		// Switch to Has Left (past date)
		fireEvent.click(screen.getByLabelText("Has Left (past date)"));
		fireEvent.change(screen.getByLabelText("Last working day"), {
			target: { value: "2026-05-15" },
		});

		expect(await screen.findByTestId("past-departure-preview")).toBeTruthy();
		expect(screen.getByText("2 work periods after cutoff")).toBeTruthy();
		expect(screen.getByText("1 closed months overlapping")).toBeTruthy();
		expect(screen.getByText("5 settled payroll days overlapping")).toBeTruthy();

		// Pick replacement via searchable picker & submit retrospective departure
		fireEvent.click(screen.getByTestId("mock-replacement-select"));
		fireEvent.click(screen.getByRole("button", { name: "Record past leaving date" }));

		await waitFor(() =>
			expect(mocks.recordPastDeparture).toHaveBeenCalledWith(
				expect.objectContaining({
					employeeId: "emp-1",
					lastWorkingDay: "2026-05-15",
					replacementEmployeeId: "mgr-2",
				}),
			),
		);
	});

	it("supports strictly date-only Past Date Correction on an already-effective departure", async () => {
		mocks.useEmployeeOffboarding.mockReturnValue({
			view: baseView({
				state: "offboarded",
				departure: {
					id: "dep-1",
					revision: 2,
					mode: "retrospective",
					lastWorkingDay: "2026-05-15",
					cutoff: "2026-05-15T22:00:00Z",
					timezone: "Europe/Berlin",
					replacementEmployeeId: null,
					blockedReason: null,
				},
				capabilities: {
					schedule: false,
					cancel: false,
					offboardNow: false,
					rehire: true,
					resolve: true,
					recordPastDeparture: false,
					correctPastDepartureDate: true,
					recordHistoricalDepartureDate: false,
				},
			}),
			isLoading: false,
			isMutating: false,
			scheduleDeparture: mocks.scheduleDeparture,
			offboardNow: mocks.offboardNow,
			recordPastDeparture: mocks.recordPastDeparture,
			correctPastDepartureDate: mocks.correctPastDepartureDate,
			recordHistoricalDepartureDate: mocks.recordHistoricalDepartureDate,
		});

		renderPanel();

		expect(screen.getByText("Strictly date-only correction")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Last working day"), {
			target: { value: "2026-05-10" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Correct past date" }));

		await waitFor(() =>
			expect(mocks.correctPastDepartureDate).toHaveBeenCalledWith(
				expect.objectContaining({
					employeeId: "emp-1",
					departureId: "dep-1",
					expectedRevision: 2,
					lastWorkingDay: "2026-05-10",
				}),
			),
		);
	});

	it("supports Legacy Former Employee historical leaving-date backfill", async () => {
		mocks.useEmployeeOffboarding.mockReturnValue({
			view: baseView({
				state: "legacy_inactive",
				capabilities: {
					schedule: false,
					cancel: false,
					offboardNow: false,
					rehire: false,
					resolve: true,
					recordPastDeparture: false,
					correctPastDepartureDate: false,
					recordHistoricalDepartureDate: true,
				},
			}),
			isLoading: false,
			isMutating: false,
			scheduleDeparture: mocks.scheduleDeparture,
			offboardNow: mocks.offboardNow,
			recordPastDeparture: mocks.recordPastDeparture,
			correctPastDepartureDate: mocks.correctPastDepartureDate,
			recordHistoricalDepartureDate: mocks.recordHistoricalDepartureDate,
		});

		renderPanel();

		fireEvent.change(screen.getByLabelText("Last working day"), {
			target: { value: "2024-12-31" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Record historical date" }));

		await waitFor(() =>
			expect(mocks.recordHistoricalDepartureDate).toHaveBeenCalledWith(
				expect.objectContaining({
					employeeId: "emp-1",
					lastWorkingDay: "2024-12-31",
				}),
			),
		);
	});
});
