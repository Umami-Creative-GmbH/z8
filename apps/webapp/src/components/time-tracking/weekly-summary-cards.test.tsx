/* @vitest-environment jsdom */

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DayTotalWorkPeriod } from "@/lib/time-tracking/day-totals";
import {
	buildTimeKpiBasis,
	summarizeTimeKpis,
	type TimeKpiLimits,
} from "@/lib/time-tracking/time-kpis";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";
import { WeeklySummaryCards } from "./weekly-summary-cards";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/components/work-balance/balance-adjustment-history-button", () => ({
	BalanceAdjustmentHistoryButton: () => null,
}));

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function completed(start: string, end: string, surchargeMinutes: number | null = null) {
	return { startTime: new Date(start), endTime: new Date(end), surchargeMinutes };
}

function weekdays(first: string, last: string, minutes = 480) {
	const required: Record<string, number> = {};
	for (let date = parsePlainDate(first); date.toString() <= last; date = date.add({ days: 1 })) {
		if (date.dayOfWeek <= 5) required[date.toString()] = minutes;
	}
	return required;
}

function renderCards(
	periods: DayTotalWorkPeriod[],
	now: string,
	options: {
		requiredMinutesByDate?: Record<string, number>;
		limits?: TimeKpiLimits;
		workBalance?: EmployeeWorkBalancePayload;
	} = {},
) {
	const basis = buildTimeKpiBasis({
		periods,
		timezone: "Europe/Berlin",
		weekStartDay: "monday",
		requiredMinutesByDate: options.requiredMinutesByDate ?? {},
		limits: options.limits ?? null,
	});
	render(
		<WeeklySummaryCards
			kpis={{ kpis: summarizeTimeKpis(basis, parseInstant(now)), basis }}
			workBalance={options.workBalance ?? null}
		/>,
	);
}

function card(label: string) {
	const heading = screen.getByText(label);
	const region = heading.closest<HTMLElement>("[data-slot=kpi-card]");
	if (!region) throw new Error(`No KPI card labelled ${label}`);
	return region;
}

// Wednesday 2026-10-07, 14:00 in Berlin.
const NOW = "2026-10-07T12:00:00Z";
const REQUIRED = { requiredMinutesByDate: weekdays("2026-09-01", "2026-10-31") };

describe("time tracking KPI cards", () => {
	it("shows the week's progress toward its required time, ahead or behind so far", () => {
		renderCards(
			[
				completed("2026-10-05T06:00:00Z", "2026-10-05T16:00:00Z"),
				completed("2026-10-06T06:00:00Z", "2026-10-06T16:00:00Z"),
			],
			NOW,
			REQUIRED,
		);

		const week = card("This Week");
		expect(within(week).getByText("20h 00m")).toBeTruthy();
		// 20h worked against 20h 40m required by Wednesday 14:00.
		expect(within(week).getByText("20h 00m of 40h 00m · 0h 40m behind")).toBeTruthy();
		const bar = within(week).getByRole("progressbar");
		expect(bar.getAttribute("aria-valuenow")).toBe("1200");
		expect(bar.getAttribute("aria-valuemax")).toBe("2400");
	});

	it("compares with the previous period as a duration and percentage", () => {
		renderCards(
			[
				// Last week up to Wednesday 14:00: 10h.
				completed("2026-09-28T06:00:00Z", "2026-09-28T16:00:00Z"),
				// This week: 11h 30m.
				completed("2026-10-05T06:00:00Z", "2026-10-05T17:30:00Z"),
			],
			NOW,
			REQUIRED,
		);

		expect(within(card("This Week")).getByText("1h 30m (+15%) vs last week")).toBeTruthy();
	});

	it("shows only the duration when the previous period had no work", () => {
		renderCards([completed("2026-10-05T06:00:00Z", "2026-10-05T07:00:00Z")], NOW, REQUIRED);

		expect(within(card("This Week")).getByText("1h 00m vs last week")).toBeTruthy();
	});

	it("has no bar when there is no required time today", () => {
		renderCards([completed("2026-10-07T06:00:00Z", "2026-10-07T07:00:00Z")], NOW);

		const today = card("Today");
		expect(within(today).getByText("No required time today")).toBeTruthy();
		expect(within(today).queryByRole("progressbar")).toBeNull();
		expect(within(card("This Week")).queryByRole("progressbar")).toBeNull();
	});

	it("headlines worked time and adds surcharge as a footnote only when there is some", () => {
		renderCards([completed("2026-10-07T06:00:00Z", "2026-10-07T08:00:00Z", 30)], NOW, REQUIRED);

		const today = card("Today");
		expect(within(today).getByText("2h 00m")).toBeTruthy();
		expect(within(today).getByText("+0h 30m surcharge")).toBeTruthy();
		cleanup();

		renderCards([completed("2026-10-07T06:00:00Z", "2026-10-07T08:00:00Z")], NOW, REQUIRED);
		expect(within(card("Today")).queryByText(/surcharge/)).toBeNull();
	});

	it("marks the card's status from required time and the work policy's limits", () => {
		renderCards([completed("2026-10-07T00:00:00Z", "2026-10-07T09:45:00Z")], NOW, {
			...REQUIRED,
			limits: { maxDailyMinutes: 600, maxWeeklyMinutes: null, alertBeforeLimitMinutes: 30 },
		});

		expect(card("Today").dataset.tone).toBe("warning");
		expect(card("This Month").dataset.tone).toBe("info");
	});

	it("advances the KPIs, bar and status on each elapsed minute of live work", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-07T13:29:00Z"));
		// Live since 06:00 in Berlin; 9h 29m worked, a minute before the daily limit's warning.
		renderCards(
			[{ startTime: new Date("2026-10-07T04:00:00Z"), endTime: null, surchargeMinutes: null }],
			"2026-10-07T13:29:00Z",
			{
				...REQUIRED,
				limits: { maxDailyMinutes: 600, maxWeeklyMinutes: null, alertBeforeLimitMinutes: 30 },
			},
		);
		expect(within(card("Today")).getByText("9h 29m")).toBeTruthy();
		expect(card("Today").dataset.tone).toBe("success");

		act(() => vi.advanceTimersByTime(60_000));
		expect(within(card("Today")).getByText("9h 30m")).toBeTruthy();
		expect(within(card("This Week")).getByText("9h 30m")).toBeTruthy();
		expect(within(card("Today")).getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
			"570",
		);
		expect(card("Today").dataset.tone).toBe("warning");
	});

	it("shows the all-time work balance as the fourth card", () => {
		renderCards([], NOW, {
			workBalance: {
				employeeId: "employee-1",
				organizationId: "org-1",
				actualMinutes: 2520,
				requiredMinutes: 2400,
				adjustmentMinutes: 0,
				balanceMinutes: 120,
				computedFromDate: "2026-05-01",
				computedThroughDate: "2026-05-22",
				computedAt: new Date("2026-05-22T12:00:00.000Z"),
			},
		});

		const balance = card("All-time balance");
		expect(within(balance).getByText("+2:00h")).toBeTruthy();
		expect(balance.dataset.tone).toBe("neutral");
	});

	it("says when the work balance is not calculated yet", () => {
		renderCards([], NOW);

		expect(within(card("All-time balance")).getByText("Not calculated yet")).toBeTruthy();
	});
});
