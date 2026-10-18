// @vitest-environment jsdom

import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	useViewRefreshAction,
	ViewRefreshProvider,
} from "@/components/providers/view-refresh-provider";
import type { EmployeePeriodViewRow } from "@/lib/time-tracking/period-submissions/employee-period-view";
import type { PeriodSubmissionBlocker } from "@/lib/time-tracking/period-submissions/submission-blockers";
import type {
	EmployeePeriodReadinessRow,
	PeriodSubmissionReadiness,
} from "@/lib/time-tracking/period-submissions/submission-readiness";
import { invalidatePeriodSubmissionReadiness } from "@/lib/query/period-submission-readiness";
import { PeriodSubmissionsCard } from "./period-submissions-card";

const state = vi.hoisted(() => ({
	submitPeriod: vi.fn(),
	withdrawPeriod: vi.fn(),
	readPeriodReadiness: vi.fn(),
	refresh: vi.fn(),
	viewRefresh: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
	announceArrival: vi.fn(),
}));

vi.mock("./period-blocker-focus", () => ({
	announcePeriodBlockerArrival: state.announceArrival,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/period-submissions", () => ({
	submitPeriod: state.submitPeriod,
	withdrawPeriod: state.withdrawPeriod,
	readPeriodReadiness: state.readPeriodReadiness,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: state.refresh }),
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.viewRefresh }) }));
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

function renderCard(periods: EmployeePeriodViewRow[], scope = SCOPE) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const card = (cardScope: typeof SCOPE) => (
		<QueryClientProvider client={client}>
			<ViewRefreshProvider>
				<PeriodSubmissionsCard periods={periods} {...cardScope} />
				<HeaderRefresh />
			</ViewRefreshProvider>
		</QueryClientProvider>
	);
	const rendered = render(card(scope));
	return Object.assign(client, {
		rerenderWith: (next: typeof SCOPE) => rendered.rerender(card(next)),
		unmountCard: rendered.unmount,
	});
}

/** The page header's view-refresh control. */
function HeaderRefresh() {
	const { refresh } = useViewRefreshAction();
	return (
		<button type="button" onClick={refresh}>
			Refresh view
		</button>
	);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
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
		expect(
			Array.from(list?.querySelectorAll("li") ?? []).map(
				(item) => item.querySelector("[data-blocker-source]")?.textContent,
			),
		).toEqual([
			expect.stringMatching(/^Work started .*8:00.* is still running\.$/),
			expect.stringMatching(/^An absence request for .*8.*10.* is undecided\.$/),
		]);
		expect(screen.getByRole("button", { name: "Hide details" })).toBe(toggle);
	});

	it("explains each blocker's next action and links to where it is handled", async () => {
		const correction: PeriodSubmissionBlocker = {
			kind: "time_correction",
			listedInMyRequests: true,
			workPeriodId: "w2",
			startTime: "2026-03-03T08:00:00.000Z",
			endTime: "2026-03-03T16:00:00.000Z",
			timezone: "Europe/Berlin",
		};
		// Work that started before the period, on Sunday evening in Berlin.
		const manual: PeriodSubmissionBlocker = {
			kind: "manual_work",
			workPeriodId: "w3",
			startTime: "2026-03-01T21:00:00.000Z",
			endTime: "2026-03-02T02:00:00.000Z",
			timezone: "Europe/Berlin",
		};
		state.readPeriodReadiness.mockResolvedValue(
			view(
				assessed(period(), {
					ready: false,
					refusals: ["period_open"],
					blockers: [manual, correction, LIVE, ABSENCE],
				}),
			),
		);
		renderCard([period()]);
		fireEvent.click(await screen.findByRole("button", { name: "Show details" }));

		const items = within(
			document.getElementById(
				screen.getByRole("button", { name: "Hide details" }).getAttribute("aria-controls") ?? "",
			) as HTMLElement,
		).getAllByRole("listitem");
		const [manualItem, correctionItem, liveItem, absenceItem] = items as HTMLElement[];

		expect(manualItem?.textContent).toContain("An approver decides this work.");
		const manualLink = within(manualItem as HTMLElement).getByRole("link", {
			name: "Show on timeline",
		});
		expect(manualLink.getAttribute("href")).toBe(
			"/time-tracking?date=2026-03-02&focus=manual_work%3Aw3",
		);
		expect(manualItem?.textContent).not.toMatch(/cancel|withdraw/i);

		expect(correctionItem?.textContent).toContain(
			"An approver decides this correction. While it waits, you can cancel it in My Requests.",
		);
		expect(
			within(correctionItem as HTMLElement)
				.getByRole("link", { name: "Open request" })
				.getAttribute("href"),
		).toBe("/my-requests?request=time_correction%3Aw2");

		expect(liveItem?.textContent).toContain("Clock out when this work ends.");
		expect(
			within(liveItem as HTMLElement)
				.getByRole("link", { name: "Go to the clock" })
				.getAttribute("href"),
		).toBe("/time-tracking?focus=live_work%3Aw1");

		expect(absenceItem?.textContent).toContain(
			"An approver decides this absence. While it waits, you can cancel it in My Requests.",
		);
		const absenceLink = within(absenceItem as HTMLElement).getByRole("link", {
			name: "Open request",
		});
		expect(absenceLink.getAttribute("href")).toBe("/my-requests?request=absence%3Aa1");

		// Each link is described by the blocker it opens, for screen readers.
		const describedBy = document.getElementById(absenceLink.getAttribute("aria-describedby") ?? "");
		expect(describedBy?.textContent).toMatch(/^An absence request for .* is undecided\.$/);
		// Nothing here acts on the source itself.
		expect(within(absenceItem as HTMLElement).queryByRole("button")).toBeNull();

		// Following a link says so, so the page it opens can focus again even at the same URL.
		fireEvent.click(within(liveItem as HTMLElement).getByRole("link", { name: "Go to the clock" }));
		expect(state.announceArrival).toHaveBeenCalledWith("live_work:w1");
	});

	it("never promises My Requests for a correction it cannot show", async () => {
		const unlisted: PeriodSubmissionBlocker = {
			kind: "time_correction",
			listedInMyRequests: false,
			workPeriodId: "w4",
			startTime: "2026-03-04T08:00:00.000Z",
			endTime: "2026-03-04T16:00:00.000Z",
			timezone: "Europe/Berlin",
		};
		state.readPeriodReadiness.mockResolvedValue(
			view(assessed(period(), { ready: false, refusals: ["period_open"], blockers: [unlisted] })),
		);
		renderCard([period()]);
		fireEvent.click(await screen.findByRole("button", { name: "Show details" }));

		const [item] = within(
			document.getElementById(
				screen.getByRole("button", { name: "Hide details" }).getAttribute("aria-controls") ?? "",
			) as HTMLElement,
		).getAllByRole("listitem");
		expect(item?.textContent).toContain(
			"An approver decides this correction. You can only wait for their decision.",
		);
		expect(item?.textContent).not.toMatch(/My Requests|cancel/i);
		expect(
			within(item as HTMLElement)
				.getByRole("link", { name: "Show on timeline" })
				.getAttribute("href"),
		).toBe("/time-tracking?date=2026-03-04&focus=time_correction%3Aw4");
	});

	it("explains a period submissions cannot start for while the write gate is closed", async () => {
		state.readPeriodReadiness.mockResolvedValue(
			view(assessed(period(), { ready: false, refusals: ["write_gate_closed"] })),
		);
		renderCard([period()]);
		expect(
			await screen.findByText(
				"Period submissions are paused in your organization right now. Try again later, or ask an administrator.",
			),
		).toBeTruthy();
		expect(submitButton().disabled).toBe(true);
	});

	it("explains a submission the write gate refused, without a generic failure, and checks again", async () => {
		state.readPeriodReadiness.mockResolvedValue(view(assessed(period())));
		state.submitPeriod.mockResolvedValue({
			success: true,
			data: { kind: "refused", reason: "write_gate_closed" },
		});
		renderCard([period()]);
		await waitFor(() => expect(submitButton().disabled).toBe(false));

		state.readPeriodReadiness.mockResolvedValue(
			view(assessed(period(), { ready: false, refusals: ["write_gate_closed"] })),
		);
		fireEvent.click(submitButton());
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe(
			"Period submissions are paused in your organization right now. Try again later, or ask an administrator.",
		);
		expect(state.toastError).not.toHaveBeenCalled();
		await waitFor(() => expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(submitButton().disabled).toBe(true));
	});

	it("announces no row summary for the first result, only later changes", async () => {
		const first = deferred<ReturnType<typeof view>>();
		state.readPeriodReadiness.mockReturnValueOnce(first.promise);
		const client = renderCard([period()]);
		const mutations: MutationRecord[] = [];
		const observer = new MutationObserver((records) => mutations.push(...records));
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["aria-live"],
			attributeOldValue: true,
		});

		await act(async () => first.resolve(view(assessed(period()))));
		const summary = await screen.findByText("Ready to submit");
		const region = summary.closest("[aria-live]") as HTMLElement;
		await waitFor(() => expect(region.getAttribute("aria-live")).toBe("polite"));
		observer.disconnect();
		// The first summary went in while its region was silent, and only then did it start announcing.
		const inserted = mutations.findIndex(
			(record) => record.type === "childList" && region.contains(record.target),
		);
		const enabled = mutations.findIndex(
			(record) => record.type === "attributes" && record.target === region,
		);
		expect(inserted).toBeGreaterThanOrEqual(0);
		expect(mutations[enabled]?.oldValue).toBe("off");
		expect(enabled).toBeGreaterThan(inserted);

		// A later change is announced.
		state.readPeriodReadiness.mockResolvedValue(
			view(assessed(period(), { ready: false, refusals: ["no_approver"] })),
		);
		await act(() => client.invalidateQueries());
		expect(
			await screen.findByText(
				"No one can approve this period yet. Ask an administrator to assign you a manager.",
			),
		).toBeTruthy();
		expect(region.getAttribute("aria-live")).toBe("polite");
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
		// The alert says it; a toast would announce it twice.
		expect(state.toastError).not.toHaveBeenCalled();
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

describe("PeriodSubmissionsCard keeps readiness current (#1350)", () => {
	const BLOCKED = view(
		assessed(period(), { ready: false, refusals: ["period_open"], blockers: [LIVE] }),
	);
	const READY_VIEW = view(assessed(period()));

	beforeEach(() => {
		vi.resetAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		focusManager.setFocused(undefined);
		vi.useRealTimers();
	});

	const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

	it("checks again every 30 seconds while visible, keeping Submit usable during the check", async () => {
		state.readPeriodReadiness.mockResolvedValueOnce(READY_VIEW);
		renderCard([period()]);
		await waitFor(() => expect(submitButton().disabled).toBe(false));

		const next = deferred<ReturnType<typeof view>>();
		state.readPeriodReadiness.mockReturnValueOnce(next.promise);
		await tick(29_000);
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(1);
		await tick(1_000);
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2);
		// The background check keeps the last successful result and its Submit.
		expect(submitButton().disabled).toBe(false);
		expect(screen.queryByText("Checking whether this period is ready…")).toBeNull();

		await act(async () => next.resolve(BLOCKED));
		expect(await screen.findByText("1 item keeps this period open.")).toBeTruthy();
		expect(submitButton().disabled).toBe(true);
		expect(screen.getByText("Submit is available once this period is ready.")).toBeTruthy();
	});

	it("shows another person's decision at the next check without any navigation", async () => {
		const submitted = period({ status: "submitted", canSubmit: false });
		state.readPeriodReadiness.mockResolvedValueOnce(
			view(
				assessed(submitted, { ready: false, refusals: ["already_submitted"] }),
				assessed(period({ startDate: "2026-02-23", endDate: "2026-03-01" }), {
					ready: false,
					refusals: ["period_open"],
					blockers: [ABSENCE],
				}),
			),
		);
		renderCard([submitted]);
		expect(await screen.findByText("Submitted")).toBeTruthy();
		expect(screen.getByText("1 item keeps this period open.")).toBeTruthy();

		// The approver approved the submission and decided the absence request meanwhile.
		state.readPeriodReadiness.mockResolvedValue(
			view(
				assessed(period({ status: "approved", canSubmit: false }), {
					ready: false,
					refusals: ["already_submitted"],
				}),
				assessed(period({ startDate: "2026-02-23", endDate: "2026-03-01" })),
			),
		);
		await tick(30_000);
		expect(await screen.findByText("Approved")).toBeTruthy();
		expect(screen.queryByText("Submitted")).toBeNull();
		expect(screen.getByText("Ready to submit")).toBeTruthy();
		expect(screen.queryByText("1 item keeps this period open.")).toBeNull();
		expect(submitButton().disabled).toBe(false);
		expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
		// Status and readiness sit in polite live regions, announced only when they change.
		expect(screen.getByText("Approved").closest("[aria-live]")?.getAttribute("aria-live")).toBe(
			"polite",
		);
	});

	it("opens Submit at the check after the period's last day begins", async () => {
		const ending = period({ canSubmit: false, opensOn: "2026-03-08" });
		state.readPeriodReadiness.mockResolvedValueOnce(
			view(assessed(ending, { ready: false, refusals: ["period_not_ended"] })),
		);
		renderCard([ending]);
		expect(await screen.findByText(/Submitting opens on Mar 8, 2026\./)).toBeTruthy();
		expect(submitButton().disabled).toBe(true);

		// The employee's local day turned over on the server's assessment.
		state.readPeriodReadiness.mockResolvedValue(READY_VIEW);
		await tick(30_000);
		expect(await screen.findByText("Ready to submit")).toBeTruthy();
		expect(submitButton().disabled).toBe(false);
	});

	it("does not check while the page is hidden, and checks when it is shown again", async () => {
		state.readPeriodReadiness.mockResolvedValue(READY_VIEW);
		renderCard([period()]);
		await screen.findByText("Ready to submit");

		act(() => focusManager.setFocused(false));
		await tick(95_000);
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(1);

		state.readPeriodReadiness.mockResolvedValue(BLOCKED);
		act(() => focusManager.setFocused(true));
		expect(await screen.findByText("1 item keeps this period open.")).toBeTruthy();
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2);
	});

	it("checks when the window regains focus", async () => {
		state.readPeriodReadiness.mockResolvedValue(READY_VIEW);
		renderCard([period()]);
		await screen.findByText("Ready to submit");

		state.readPeriodReadiness.mockResolvedValue(BLOCKED);
		act(() => {
			window.dispatchEvent(new Event("focus"));
		});
		expect(await screen.findByText("1 item keeps this period open.")).toBeTruthy();
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2);
	});

	it("stops checking once the card has left the view", async () => {
		state.readPeriodReadiness.mockResolvedValue(READY_VIEW);
		const client = renderCard([period()]);
		await screen.findByText("Ready to submit");

		client.unmountCard();
		await tick(95_000);
		act(() => {
			window.dispatchEvent(new Event("focus"));
		});
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(1);
	});

	it("checks again when the view's Refresh control is used", async () => {
		state.readPeriodReadiness.mockResolvedValue(READY_VIEW);
		renderCard([period()]);
		await screen.findByText("Ready to submit");

		state.readPeriodReadiness.mockResolvedValue(BLOCKED);
		fireEvent.click(screen.getByRole("button", { name: "Refresh view" }));
		expect(await screen.findByText("1 item keeps this period open.")).toBeTruthy();
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2);
		await waitFor(() => expect(state.viewRefresh).toHaveBeenCalled());
	});

	it("checks again after the employee's own change elsewhere invalidates readiness", async () => {
		state.readPeriodReadiness.mockResolvedValue(READY_VIEW);
		const client = renderCard([period()]);
		await screen.findByText("Ready to submit");

		// Clocking in elsewhere on the page starts live work.
		state.readPeriodReadiness.mockResolvedValue(BLOCKED);
		await act(() => invalidatePeriodSubmissionReadiness(client));
		expect(await screen.findByText("1 item keeps this period open.")).toBeTruthy();
		expect(submitButton().disabled).toBe(true);
	});

	it("never lets a late answer from an earlier check overwrite a newer one", async () => {
		state.readPeriodReadiness.mockResolvedValueOnce(BLOCKED);
		const client = renderCard([period()]);
		await screen.findByText("1 item keeps this period open.");

		const earlier = deferred<ReturnType<typeof view>>();
		const newer = deferred<ReturnType<typeof view>>();
		state.readPeriodReadiness.mockReturnValueOnce(earlier.promise);
		state.readPeriodReadiness.mockReturnValueOnce(newer.promise);
		await tick(30_000);
		await act(() => {
			void invalidatePeriodSubmissionReadiness(client);
		});
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(3);

		await act(async () => newer.resolve(READY_VIEW));
		expect(await screen.findByText("Ready to submit")).toBeTruthy();
		// The earlier check still says the live work is running.
		await act(async () => earlier.resolve(BLOCKED));
		await tick(0);
		expect(screen.getByText("Ready to submit")).toBeTruthy();
		expect(screen.queryByText("1 item keeps this period open.")).toBeNull();
		expect(submitButton().disabled).toBe(false);
	});

	it("never shows another organization's readiness after an organization switch", async () => {
		state.readPeriodReadiness.mockResolvedValueOnce(READY_VIEW);
		const client = renderCard([period()]);
		await screen.findByText("Ready to submit");

		const other = { organizationId: "org-2", employeeId: "employee-9" };
		const answer = deferred<ReturnType<typeof view>>();
		state.readPeriodReadiness.mockReturnValueOnce(answer.promise);
		client.rerenderWith(other);
		expect(state.readPeriodReadiness).toHaveBeenLastCalledWith(other);
		expect(screen.queryByText("Ready to submit")).toBeNull();
		expect(submitButton().disabled).toBe(true);
		expect(screen.getByText("Checking whether this period is ready…")).toBeTruthy();

		await act(async () => answer.resolve(BLOCKED));
		expect(await screen.findByText("1 item keeps this period open.")).toBeTruthy();
		expect(screen.queryByText("Ready to submit")).toBeNull();
	});

	it("disables Submit when a check fails, keeps one alert through failing checks, and recovers", async () => {
		state.readPeriodReadiness.mockResolvedValueOnce(READY_VIEW);
		renderCard([period()]);
		await screen.findByText("Ready to submit");

		state.readPeriodReadiness.mockResolvedValue({ success: false, error: "boom" });
		await tick(30_000);
		await tick(1_000); // the one retry
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("Submission readiness is unavailable");
		expect(screen.queryByText("Ready to submit")).toBeNull();
		expect(submitButton().disabled).toBe(true);
		expect(screen.getByText("Submit is unavailable until readiness can be checked.")).toBeTruthy();

		// A background check that fails again changes nothing, so nothing is announced again.
		const calls = state.readPeriodReadiness.mock.calls.length;
		await tick(31_000);
		expect(state.readPeriodReadiness.mock.calls.length).toBeGreaterThan(calls);
		expect(screen.getByRole("alert")).toBe(alert);
		expect(submitButton().disabled).toBe(true);

		// Retry checks (Submit says so) and recovers.
		const answer = deferred<ReturnType<typeof view>>();
		state.readPeriodReadiness.mockReturnValueOnce(answer.promise);
		fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(screen.getByText("Checking whether this period is ready…")).toBeTruthy(),
		);
		expect(submitButton().disabled).toBe(true);
		await act(async () => answer.resolve(READY_VIEW));
		expect(await screen.findByText("Ready to submit")).toBeTruthy();
		await waitFor(() => expect(submitButton().disabled).toBe(false));
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("checks before offering Submit again after the employee's own refused attempt", async () => {
		state.readPeriodReadiness.mockResolvedValueOnce(READY_VIEW);
		state.submitPeriod.mockResolvedValue({
			success: true,
			data: { kind: "refused", reason: "no_approver" },
		});
		renderCard([period()]);
		await waitFor(() => expect(submitButton().disabled).toBe(false));

		const answer = deferred<ReturnType<typeof view>>();
		state.readPeriodReadiness.mockReturnValueOnce(answer.promise);
		fireEvent.click(submitButton());
		await waitFor(() => expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2));
		// The ready result predates the refusal, so it no longer offers Submit.
		expect(submitButton().disabled).toBe(true);
		expect(screen.getByText("Checking whether this period is ready…")).toBeTruthy();

		await act(async () =>
			answer.resolve(view(assessed(period(), { ready: false, refusals: ["no_approver"] }))),
		);
		await waitFor(() =>
			expect(screen.getByText("Submit is available once this period is ready.")).toBeTruthy(),
		);
		expect(submitButton().disabled).toBe(true);
	});

	it("keeps an unchanged period's details open and its focus across checks", async () => {
		state.readPeriodReadiness.mockResolvedValue(BLOCKED);
		renderCard([period()]);
		const toggle = await screen.findByRole("button", { name: "Show details" });
		fireEvent.click(toggle);
		toggle.focus();

		await tick(30_000);
		await waitFor(() => expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2));
		await tick(0);
		const after = screen.getByRole("button", { name: "Hide details" });
		expect(after).toBe(toggle);
		expect(after.getAttribute("aria-expanded")).toBe("true");
		expect(document.activeElement).toBe(toggle);
	});
});
