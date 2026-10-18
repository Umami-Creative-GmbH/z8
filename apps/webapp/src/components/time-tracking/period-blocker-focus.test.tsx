// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query/keys";
import {
	CLOCK_REGION_ID,
	TIMELINE_REGION_ID,
} from "@/lib/time-tracking/period-submissions/blocker-navigation";
import type { PeriodSubmissionBlocker } from "@/lib/time-tracking/period-submissions/submission-blockers";
import { announcePeriodBlockerArrival, PeriodBlockerFocus } from "./period-blocker-focus";

const state = vi.hoisted(() => ({ readPeriodReadiness: vi.fn() }));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/period-submissions", () => ({
	readPeriodReadiness: state.readPeriodReadiness,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const SCOPE = { organizationId: "org-1", employeeId: "employee-1" };

const MANUAL: PeriodSubmissionBlocker = {
	kind: "manual_work",
	workPeriodId: "w-1",
	startTime: "2026-03-03T08:00:00.000Z",
	endTime: "2026-03-03T12:00:00.000Z",
	timezone: "Europe/Berlin",
};
const LIVE: PeriodSubmissionBlocker = {
	kind: "live_work",
	workPeriodId: "w-2",
	startTime: "2026-03-04T08:00:00.000Z",
	endTime: null,
	timezone: "Europe/Berlin",
};
const UNLISTED_CORRECTION: PeriodSubmissionBlocker = {
	kind: "time_correction",
	listedInMyRequests: false,
	workPeriodId: "w-3",
	startTime: "2026-03-05T08:00:00.000Z",
	endTime: "2026-03-05T12:00:00.000Z",
	timezone: "Europe/Berlin",
};

function readinessWith(...blockers: PeriodSubmissionBlocker[]) {
	return {
		success: true,
		data: {
			employeeId: SCOPE.employeeId,
			timezone: "Europe/Berlin",
			periods: [
				{
					startDate: "2026-03-02",
					endDate: "2026-03-08",
					status: "awaiting_submission",
					rejectionReason: null,
					submittedAt: null,
					canSubmit: true,
					opensOn: "2026-03-08",
					readiness: {
						ready: blockers.length === 0,
						refusals: blockers.length === 0 ? [] : ["period_open"],
						blockers,
						opensOn: "2026-03-08",
					},
				},
			],
		},
	};
}

/**
 * The page around the focus: the destinations' targets as the regions render them, once the
 * regions have streamed in (`streamed`).
 */
function Page({
	focus,
	targets,
	streamed = true,
}: {
	focus: string | undefined;
	targets: string[];
	streamed?: boolean;
}) {
	return (
		<>
			<PeriodBlockerFocus {...SCOPE} focus={focus} waitForTargetMs={50} />
			{streamed ? (
				<>
					<div id={CLOCK_REGION_ID}>
						{targets
							.filter((id) => id === "time-clock")
							.map((id) => (
								<div key={id} id={id} tabIndex={-1}>
									{id}
								</div>
							))}
					</div>
					<div id={TIMELINE_REGION_ID}>
						{targets
							.filter((id) => id !== "time-clock")
							.map((id) => (
								<div key={id} id={id} tabIndex={-1}>
									{id}
								</div>
							))}
					</div>
				</>
			) : null}
		</>
	);
}

function renderPage(focus: string | undefined, targets: string[], client = new QueryClient()) {
	const view = render(
		<QueryClientProvider client={client}>
			<Page focus={focus} targets={targets} />
		</QueryClientProvider>,
	);
	return { client, view };
}

describe("PeriodBlockerFocus", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});
	afterEach(cleanup);

	it("focuses pending manual work on the timeline once readiness confirms it still blocks", async () => {
		state.readPeriodReadiness.mockResolvedValue(readinessWith(MANUAL));
		renderPage("manual_work:w-1", ["time-clock", "work-period-w-1"]);

		await waitFor(() =>
			expect(document.activeElement).toBe(document.getElementById("work-period-w-1")),
		);
		expect(state.readPeriodReadiness).toHaveBeenCalledWith(SCOPE);
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("brings live work to the clock controls without acting on them", async () => {
		state.readPeriodReadiness.mockResolvedValue(readinessWith(LIVE));
		renderPage("live_work:w-2", ["time-clock", "work-period-w-2"]);

		await waitFor(() => expect(document.activeElement).toBe(document.getElementById("time-clock")));
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("re-checks readiness on arrival even when a result is cached", async () => {
		const client = new QueryClient();
		client.setQueryData(
			queryKeys.periodSubmissions.readiness(SCOPE.organizationId, SCOPE.employeeId),
			readinessWith(MANUAL).data,
		);
		// Decided in the meantime: the fresh check no longer lists it.
		state.readPeriodReadiness.mockResolvedValue(readinessWith());
		renderPage("manual_work:w-1", ["work-period-w-1"], client);

		const notice = await screen.findByRole("status");
		expect(notice.textContent).toBe(
			"This work no longer keeps a period open. Period readiness was checked again.",
		);
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(document.activeElement).toBe(notice));
	});

	it.each([
		["decided or withdrawn work", "manual_work:w-1", readinessWith()],
		["live work that has ended", "live_work:w-2", readinessWith(MANUAL)],
		["a forged or another employee's work id", "manual_work:foreign", readinessWith(MANUAL)],
	])("explains %s without disclosing anything", async (_name, focus, readiness) => {
		state.readPeriodReadiness.mockResolvedValue(readiness);
		renderPage(focus, ["time-clock", "work-period-w-1", "work-period-foreign"]);

		const notice = await screen.findByRole("status");
		expect(notice.textContent).toBe(
			"This work no longer keeps a period open. Period readiness was checked again.",
		);
		// Nothing was focused or marked for the link's target.
		expect(document.activeElement).toBe(notice);
	});

	it("explains work that still blocks but is not shown on this day", async () => {
		state.readPeriodReadiness.mockResolvedValue(readinessWith(MANUAL));
		renderPage("manual_work:w-1", ["time-clock"]);

		const notice = await screen.findByRole("status");
		expect(notice.textContent).toBe(
			"This work can't be shown here. Period readiness was checked again.",
		);
	});

	it("still focuses a shown target when readiness cannot be checked", async () => {
		state.readPeriodReadiness.mockResolvedValue({ success: false, error: "boom" });
		renderPage("manual_work:w-1", ["work-period-w-1"]);

		await waitFor(
			() => expect(document.activeElement).toBe(document.getElementById("work-period-w-1")),
			{ timeout: 4000 },
		);
	});

	it("focuses the corrected work of a correction My Requests cannot show", async () => {
		state.readPeriodReadiness.mockResolvedValue(readinessWith(UNLISTED_CORRECTION));
		renderPage("time_correction:w-3", ["work-period-w-3"]);

		await waitFor(() =>
			expect(document.activeElement).toBe(document.getElementById("work-period-w-3")),
		);
	});

	it("waits for the timeline to stream in before saying the work can't be shown", async () => {
		state.readPeriodReadiness.mockResolvedValue(readinessWith(MANUAL));
		const client = new QueryClient();
		const tree = (streamed: boolean) => (
			<QueryClientProvider client={client}>
				<Page focus="manual_work:w-1" targets={["work-period-w-1"]} streamed={streamed} />
			</QueryClientProvider>
		);
		const view = render(tree(false));
		await waitFor(() => expect(state.readPeriodReadiness).toHaveBeenCalled());
		// Well past the wait for the target: the region itself has not rendered yet.
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(screen.queryByRole("status")).toBeNull();

		view.rerender(tree(true));
		await waitFor(() =>
			expect(document.activeElement).toBe(document.getElementById("work-period-w-1")),
		);
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("checks readiness and moves focus again when the same blocker link is followed again", async () => {
		state.readPeriodReadiness.mockResolvedValue(readinessWith(MANUAL));
		renderPage("manual_work:w-1", ["work-period-w-1"]);
		const target = document.getElementById("work-period-w-1") as HTMLElement;
		await waitFor(() => expect(document.activeElement).toBe(target));
		target.blur();
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(1);

		// The link points at the page already shown: the URL does not change.
		act(() => announcePeriodBlockerArrival("manual_work:w-1"));

		await waitFor(() => expect(state.readPeriodReadiness).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(document.activeElement).toBe(target));
	});

	it("ignores a followed link for other work", async () => {
		state.readPeriodReadiness.mockResolvedValue(readinessWith(MANUAL));
		renderPage("manual_work:w-1", ["work-period-w-1"]);
		await waitFor(() =>
			expect(document.activeElement).toBe(document.getElementById("work-period-w-1")),
		);

		act(() => announcePeriodBlockerArrival("live_work:w-2"));

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(state.readPeriodReadiness).toHaveBeenCalledTimes(1);
	});

	it("does nothing without a valid focus", () => {
		renderPage("absence:a-1", ["work-period-w-1"]);
		renderPage(undefined, []);
		expect(state.readPeriodReadiness).not.toHaveBeenCalled();
		expect(screen.queryByRole("status")).toBeNull();
	});
});
