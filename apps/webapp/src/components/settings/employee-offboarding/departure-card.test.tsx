/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeOffboardingView } from "@/lib/employee-lifecycle/view-types";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

import { DepartureCard } from "./departure-card";

const none = { schedule: false, cancel: false, offboardNow: false, rehire: false, resolve: false };

function view(overrides: Partial<EmployeeOffboardingView>): EmployeeOffboardingView {
	return {
		employeeId: "employee-1",
		organizationId: "org-1",
		employmentPeriodId: "period-1",
		state: "active",
		departure: null,
		previousEmploymentPeriodId: null,
		membershipApproved: true,
		followUp: { pending: 0, failed: 0, openReviews: 0 },
		failedTasks: [],
		reviews: [],
		futureWork: { shifts: 0, absences: 0, employmentTerms: 0 },
		deputyAbsences: 0,
		workBalance: null,
		capabilities: none,
		...overrides,
	};
}

const departure = {
	id: "departure-1",
	revision: 2,
	mode: "scheduled" as const,
	lastWorkingDay: "2026-09-30",
	cutoff: "2026-09-30T22:00:00Z",
	timezone: "Europe/Berlin",
	replacementEmployeeId: null,
	blockedReason: null,
};

function renderCard(value: EmployeeOffboardingView) {
	const handlers = {
		onSchedule: vi.fn(),
		onOffboardNow: vi.fn(),
		onCancelDeparture: vi.fn(),
		onRehire: vi.fn(),
		onRecordFinalPayout: vi.fn(),
	};
	render(<DepartureCard view={value} isMutating={false} followUpList={null} {...handlers} />);
	return handlers;
}

describe("DepartureCard", () => {
	it("offers scheduling and immediate departure for an active employee by keyboard", async () => {
		const user = userEvent.setup();
		const handlers = renderCard(
			view({ capabilities: { ...none, schedule: true, offboardNow: true } }),
		);

		expect(screen.getByTestId("departure-state").textContent).toBe("Employed");
		await user.tab();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Schedule departure" }));
		await user.keyboard("{Enter}");
		await user.tab();
		await user.keyboard(" ");

		expect(handlers.onSchedule).toHaveBeenCalledTimes(1);
		expect(handlers.onOffboardNow).toHaveBeenCalledTimes(1);
	});

	it("shows a scheduled departure's cutoff in its frozen zone with edit and cancel", async () => {
		const user = userEvent.setup();
		const handlers = renderCard(
			view({
				state: "scheduled",
				departure,
				capabilities: { ...none, schedule: true, cancel: true, offboardNow: true },
			}),
		);

		expect(
			screen.getByText(
				/Access and paid-seat usage end at Oct 1, 2026, 12:00 AM \(Europe\/Berlin\)/,
			),
		).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Edit departure" }));
		await user.click(screen.getByRole("button", { name: "Cancel departure" }));

		expect(handlers.onSchedule).toHaveBeenCalled();
		expect(handlers.onCancelDeparture).toHaveBeenCalled();
	});

	it("links work kept after the cutoff to the pages that manage it", () => {
		renderCard(
			view({
				state: "offboarded",
				departure,
				futureWork: { shifts: 2, absences: 1, employmentTerms: 0 },
			}),
		);

		const kept = screen.getByRole("list", { name: "Kept after the departure" });
		expect(
			screen.getByRole("link", { name: "Shifts on or after the cutoff: 2" }).getAttribute("href"),
		).toBe("/scheduling?employeeId=employee-1&date=2026-10-01");
		expect(
			screen.getByRole("link", { name: "Absences on or after the cutoff: 1" }).getAttribute("href"),
		).toBe("/calendar/employee-1?date=2026-10-01");
		expect(kept.textContent).not.toContain("Employment terms");
	});

	it("lists the absences the employee is deputy on, linked to exactly those team absences", () => {
		renderCard(view({ state: "scheduled", departure, deputyAbsences: 3 }));

		const cover = screen.getByRole("list", { name: "Cover to rearrange" });
		expect(
			screen
				.getByRole("link", { name: "Deputy on running or upcoming absences: 3" })
				.getAttribute("href"),
		).toBe(
			"/team/absences?year=2026&deputy=employee-1&coverAt=2026-09-30T22%3A00%3A00Z",
		);
		expect(cover.textContent).toContain("Deputy on running or upcoming absences: 3");
	});

	it("shows no deputy cover when the employee covers no absence", () => {
		renderCard(view({ state: "scheduled", departure }));

		expect(screen.queryByRole("list", { name: "Cover to rearrange" })).toBeNull();
	});

	it("shows no future-work list when nothing is dated after the cutoff", () => {
		renderCard(view({ state: "offboarded", departure }));

		expect(screen.queryByRole("list", { name: "Kept after the departure" })).toBeNull();
	});

	it("explains a departure blocked by the final owner without offering to depart", () => {
		renderCard(
			view({
				state: "blocked",
				departure: { ...departure, blockedReason: "final_accessible_owner" },
				capabilities: { ...none, cancel: true },
			}),
		);

		expect(
			screen.getByText("Assign and activate another approved owner before this employee leaves."),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Offboard now" })).toBeNull();
		expect(screen.getByRole("button", { name: "Cancel departure" })).toBeTruthy();
	});

	it("shows an effective departure separately from its failed cleanup", () => {
		renderCard(
			view({
				state: "offboarded",
				employmentPeriodId: null,
				previousEmploymentPeriodId: "period-1",
				departure: { ...departure, mode: "immediate", lastWorkingDay: null },
				followUp: { pending: 1, failed: 1, openReviews: 2 },
				capabilities: { ...none, rehire: true, resolve: true },
			}),
		);

		expect(screen.getByTestId("departure-state").textContent).toBe("Departure effective");
		expect(screen.getByRole("status").textContent).toBe(
			"Follow-up work pending · 1 failed · 2 to review",
		);
		expect(screen.getByRole("button", { name: "Rehire employee" })).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "View historical calendar" }).getAttribute("href"),
		).toBe("/calendar/employee-1");
	});

	it("gives a manager a read-only view", () => {
		renderCard(view({ state: "scheduled", departure, capabilities: none }));

		expect(screen.queryAllByRole("button")).toHaveLength(0);
	});

	it("shows a departing employee's work balance and offers a final overtime payout", async () => {
		const user = userEvent.setup();
		const handlers = renderCard(
			view({
				state: "offboarded",
				departure,
				workBalance: {
					balance: { balanceMinutes: 360, computedThroughDate: "2026-10-09" },
					finalPayout: { defaultDay: "2026-10-09", defaultMinutes: 360, latestDay: "2026-10-10" },
				},
			}),
		);

		const balance = screen.getByRole("region", { name: "Work balance" });
		expect(balance.textContent).toContain("+6:00h");
		expect(balance.textContent).toContain("Through Oct 9, 2026");
		await user.click(screen.getByRole("button", { name: "Record final overtime payout" }));

		expect(handlers.onRecordFinalPayout).toHaveBeenCalledTimes(1);
	});

	it("shows the work balance without the payout action when none is offered", () => {
		renderCard(
			view({
				state: "scheduled",
				departure,
				workBalance: {
					balance: { balanceMinutes: -90, computedThroughDate: "2026-10-09" },
					finalPayout: null,
				},
			}),
		);

		expect(screen.getByRole("region", { name: "Work balance" }).textContent).toContain("-1:30h");
		expect(screen.queryByRole("button", { name: "Record final overtime payout" })).toBeNull();
	});

	it("says when the work balance is not calculated yet", () => {
		renderCard(
			view({
				state: "legacy_inactive",
				employmentPeriodId: null,
				workBalance: { balance: null, finalPayout: null },
			}),
		);

		expect(screen.getByRole("region", { name: "Work balance" }).textContent).toContain(
			"Not calculated yet",
		);
	});

	it("shows no work balance when the view has none", () => {
		renderCard(view({ state: "offboarded", departure }));

		expect(screen.queryByRole("region", { name: "Work balance" })).toBeNull();
	});

	it("keeps unknown legacy history without inventing a date", () => {
		renderCard(view({ state: "legacy_inactive", employmentPeriodId: null }));

		expect(screen.getByText("Date not recorded")).toBeTruthy();
	});
});
