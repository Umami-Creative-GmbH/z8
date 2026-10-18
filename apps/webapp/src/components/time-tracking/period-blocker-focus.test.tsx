// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query/keys";
import type { PeriodSubmissionBlocker } from "@/lib/time-tracking/period-submissions/submission-blockers";
import { PeriodBlockerFocus } from "./period-blocker-focus";

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

/** The page around the focus: the destinations' targets as the regions render them. */
function Page({ focus, targets }: { focus: string | undefined; targets: string[] }) {
	return (
		<>
			<PeriodBlockerFocus {...SCOPE} focus={focus} waitForTargetMs={50} />
			{targets.map((id) => (
				<div key={id} id={id} tabIndex={-1}>
					{id}
				</div>
			))}
		</>
	);
}

function renderPage(focus: string | undefined, targets: string[], client = new QueryClient()) {
	render(
		<QueryClientProvider client={client}>
			<Page focus={focus} targets={targets} />
		</QueryClientProvider>,
	);
	return client;
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

	it("does nothing without a valid focus", () => {
		renderPage("time_correction:w-1", ["work-period-w-1"]);
		renderPage(undefined, []);
		expect(state.readPeriodReadiness).not.toHaveBeenCalled();
		expect(screen.queryByRole("status")).toBeNull();
	});
});
