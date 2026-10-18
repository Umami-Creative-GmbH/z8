// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeePeriodViewRow } from "@/lib/time-tracking/period-submissions/employee-period-view";
import type { PeriodSubmissionBlocker } from "@/lib/time-tracking/period-submissions/submission-blockers";
import type {
	EmployeePeriodReadinessRow,
	PeriodSubmissionReadiness,
} from "@/lib/time-tracking/period-submissions/submission-readiness";
import { PeriodSubmissionsCard } from "./period-submissions-card";

const state = vi.hoisted(() => ({
	submitPeriod: vi.fn(),
	withdrawPeriod: vi.fn(),
	readPeriodReadiness: vi.fn(),
	refresh: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/period-submissions", () => ({
	submitPeriod: state.submitPeriod,
	withdrawPeriod: state.withdrawPeriod,
	readPeriodReadiness: state.readPeriodReadiness,
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: { success: state.toastSuccess, error: state.toastError } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback
				.replace(
					/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g,
					(_match, name: string, one: string, other: string) =>
						(params?.[name] === 1 ? one : other).replace("#", String(params?.[name])),
				)
				.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));

const SCOPE = { organizationId: "org-1", employeeId: "employee-1" };

const LIVE: PeriodSubmissionBlocker = {
	kind: "live_work",
	workPeriodId: "w1",
	startTime: "2026-03-08T07:00:00.000Z",
	endTime: null,
	timezone: "Europe/Berlin",
};
const ABSENCE: PeriodSubmissionBlocker = {
	kind: "absence_request",
	absenceId: "a1",
	startDate: "2026-03-08",
	endDate: "2026-03-10",
};

function period(overrides: Partial<EmployeePeriodViewRow> = {}): EmployeePeriodViewRow {
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

const READY: PeriodSubmissionReadiness = {
	ready: true,
	refusals: [],
	blockers: [],
	opensOn: "2026-03-08",
};

function assessed(
	row: EmployeePeriodViewRow,
	readiness: Partial<PeriodSubmissionReadiness> = {},
): EmployeePeriodReadinessRow {
	return { ...row, readiness: { ...READY, opensOn: row.opensOn, ...readiness } };
}

function view(...periods: EmployeePeriodReadinessRow[]) {
	return {
		success: true,
		data: { employeeId: SCOPE.employeeId, timezone: "Europe/Berlin", periods },
	};
}

function renderCard(periods: EmployeePeriodViewRow[]) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<PeriodSubmissionsCard periods={periods} {...SCOPE} />
		</QueryClientProvider>,
	);
	return client;
}

const submitButton = () => screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;

describe("PeriodSubmissionsCard", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("checks every displayed period without a submission attempt or expansion", async () => {
		const open = period({
			startDate: "2026-03-09",
			endDate: "2026-03-15",
			canSubmit: false,
			opensOn: "2026-03-15",
		});
		const current = period();
		state.readPeriodReadiness.mockResolvedValue(
			view(
				assessed(open, {
					ready: false,
					refusals: ["period_not_ended", "period_open"],
					blockers: [LIVE],
				}),
				assessed(current),
			),
		);
		renderCard([open, current]);

		expect(await screen.findByText("Ready to submit")).toBeTruthy();
		expect(state.readPeriodReadiness).toHaveBeenCalledWith(SCOPE);
		expect(state.submitPeriod).not.toHaveBeenCalled();
		expect(screen.getByText(/Submitting opens on Mar 15, 2026\./)).toBeTruthy();
		expect(screen.getByText("1 item keeps this period open.")).toBeTruthy();
		const [first, second] = screen.getAllByRole("button", {
			name: "Submit",
		}) as HTMLButtonElement[];
		expect(first?.disabled).toBe(true);
		expect(second?.disabled).toBe(false);
	});

	it("keeps submitted and approved statuses, never calling them ready", async () => {
		const submitted = period({ status: "submitted", canSubmit: false });
		const approved = period({ startDate: "2026-02-23", status: "approved", canSubmit: false });
		const rejected = period({
			startDate: "2026-02-16",
			status: "rejected",
			rejectionReason: "Friday is missing",
		});
		state.readPeriodReadiness.mockResolvedValue(
			view(
				assessed(submitted, { ready: false, refusals: ["already_submitted"] }),
				assessed(approved, { ready: false, refusals: ["already_submitted"] }),
				assessed(rejected),
			),
		);
		renderCard([submitted, approved, rejected]);

		expect(await screen.findByText("Ready to submit")).toBeTruthy();
		expect(screen.getAllByText("Ready to submit")).toHaveLength(1);
		expect(screen.getByText("Submitted")).toBeTruthy();
		expect(screen.getByText("Approved")).toBeTruthy();
		expect(screen.getByText("Reason: Friday is missing")).toBeTruthy();
		expect(screen.getAllByRole("button", { name: "Submit" })).toHaveLength(1);
		expect(screen.getAllByRole("button", { name: "Withdraw" })).toHaveLength(1);
	});

	it("expands what keeps the period open with a keyboard-operable control", async () => {
		state.readPeriodReadiness.mockResolvedValue(
			view(
				assessed(period(), { ready: false, refusals: ["period_open"], blockers: [LIVE, ABSENCE] }),
			),
		);
		renderCard([period()]);

		const toggle = await screen.findByRole("button", { name: "Show details" });
		expect(screen.getByText("2 items keep this period open.")).toBeTruthy();
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(submitButton().disabled).toBe(true);
		fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
		expect(Array.from(list?.querySelectorAll("li") ?? []).map((item) => item.textContent)).toEqual([
			expect.stringMatching(/^Work started .*8:00.* is still running\.$/),
			expect.stringMatching(/^An absence request for .*8.*10.* is undecided\.$/),
		]);
		expect(screen.getByRole("button", { name: "Hide details" })).toBe(toggle);
	});

	it("explains a period without an approver", async () => {
		state.readPeriodReadiness.mockResolvedValue(
			view(assessed(period(), { ready: false, refusals: ["no_approver"] })),
		);
		renderCard([period()]);
		expect(
			await screen.findByText(
				"No one can approve this period yet. Ask an administrator to assign you a manager.",
			),
		).toBeTruthy();
		expect(submitButton().disabled).toBe(true);
	});

	it("disables Submit while checking and explains why", () => {
		state.readPeriodReadiness.mockReturnValue(new Promise(() => {}));
		renderCard([period()]);
		expect(submitButton().disabled).toBe(true);
		expect(screen.getByText("Checking whether this period is ready…")).toBeTruthy();
		expect(submitButton().getAttribute("aria-describedby")).toBeTruthy();
	});

	it("says readiness is unavailable when the check fails, and Retry recovers", async () => {
		// The read is retried once before it counts as failed.
		state.readPeriodReadiness.mockResolvedValue({ success: false, error: "boom" });
		renderCard([period()]);

		const alert = await screen.findByRole("alert", {}, { timeout: 4000 });
		expect(alert.textContent).toContain("Submission readiness is unavailable");
		expect(submitButton().disabled).toBe(true);
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2);

		state.readPeriodReadiness.mockResolvedValue(view(assessed(period())));
		fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("Ready to submit")).toBeTruthy();
		expect(submitButton().disabled).toBe(false);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("never keeps an earlier ready result after a failed check", async () => {
		state.readPeriodReadiness.mockResolvedValueOnce(view(assessed(period())));
		const client = renderCard([period()]);
		await screen.findByText("Ready to submit");

		state.readPeriodReadiness.mockResolvedValue({ success: false, error: "boom" });
		await act(() => client.invalidateQueries());
		expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toBeTruthy();
		expect(screen.queryByText("Ready to submit")).toBeNull();
		expect(submitButton().disabled).toBe(true);
	});

	it("submits a ready period, then refreshes the page and readiness", async () => {
		const ready = view(assessed(period()));
		state.readPeriodReadiness.mockResolvedValue(ready);
		state.submitPeriod.mockResolvedValue({ success: true, data: { kind: "submitted" } });
		renderCard([period()]);
		await waitFor(() => expect(submitButton().disabled).toBe(false));

		state.readPeriodReadiness.mockResolvedValue(
			view(
				assessed(period({ status: "submitted" }), {
					ready: false,
					refusals: ["already_submitted"],
				}),
			),
		);
		fireEvent.click(submitButton());
		await waitFor(() =>
			expect(state.toastSuccess).toHaveBeenCalledWith("Period submitted for approval"),
		);
		expect(state.submitPeriod).toHaveBeenCalledWith({ periodStartDate: "2026-03-02" });
		expect(state.refresh).toHaveBeenCalled();
		expect(await screen.findByText("Submitted")).toBeTruthy();
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2);
	});

	it("explains a refusal from an obstacle that appeared after a ready result, then shows it", async () => {
		state.readPeriodReadiness.mockResolvedValue(view(assessed(period())));
		state.submitPeriod.mockResolvedValue({
			success: true,
			data: { kind: "refused", reason: "period_open", blockers: [ABSENCE] },
		});
		renderCard([period()]);
		await waitFor(() => expect(submitButton().disabled).toBe(false));

		state.readPeriodReadiness.mockResolvedValue(
			view(assessed(period(), { ready: false, refusals: ["period_open"], blockers: [ABSENCE] })),
		);
		fireEvent.click(submitButton());
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("This period is still open");
		expect(state.toastError).toHaveBeenCalledWith("This period is still open");
		expect(await screen.findByText(/An absence request for .* is undecided\./)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Hide details" })).toBeTruthy();
		expect(submitButton().disabled).toBe(true);
		expect(state.refresh).not.toHaveBeenCalled();
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2);
	});

	it("withdraws a submitted period, then refreshes the page and readiness", async () => {
		const submitted = period({ status: "submitted", canSubmit: false });
		state.readPeriodReadiness.mockResolvedValue(
			view(assessed(submitted, { ready: false, refusals: ["already_submitted"] })),
		);
		state.withdrawPeriod.mockResolvedValue({ success: true, data: { kind: "withdrawn" } });
		renderCard([submitted]);
		await waitFor(() => expect(state.readPeriodReadiness).toHaveBeenCalledTimes(1));

		fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
		await waitFor(() => expect(state.toastSuccess).toHaveBeenCalledWith("Submission withdrawn"));
		expect(state.withdrawPeriod).toHaveBeenCalledWith({ periodStartDate: "2026-03-02" });
		expect(state.refresh).toHaveBeenCalled();
		await waitFor(() => expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2));
	});

	it("explains a withdrawal that is no longer possible", async () => {
		const submitted = period({ status: "submitted", canSubmit: false });
		state.readPeriodReadiness.mockResolvedValue(
			view(assessed(submitted, { ready: false, refusals: ["already_submitted"] })),
		);
		state.withdrawPeriod.mockResolvedValue({
			success: true,
			data: { kind: "refused", reason: "not_pending" },
		});
		renderCard([submitted]);
		fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith(
				"This submission was already decided and can no longer be withdrawn.",
			),
		);
		expect(state.refresh).toHaveBeenCalled();
	});
});
