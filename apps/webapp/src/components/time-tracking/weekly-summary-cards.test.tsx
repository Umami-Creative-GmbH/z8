/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { buildDayTotalBasis, summarizeDayTotals } from "@/lib/time-tracking/day-totals";
import { WeeklySummaryCards } from "./weekly-summary-cards";

afterEach(() => {
	vi.useRealTimers();
});

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const summary = {
	todayMinutes: 120,
	weekMinutes: 600,
	monthMinutes: 1800,
};

describe("WeeklySummaryCards", () => {
	it("renders all-time work balance as a fourth summary card", () => {
		render(
			<WeeklySummaryCards
				summary={summary}
				workBalance={{
					employeeId: "employee-1",
					organizationId: "org-1",
					actualMinutes: 2520,
					requiredMinutes: 2400,
					balanceMinutes: 120,
					computedFromDate: "2026-05-01",
					computedThroughDate: "2026-05-22",
					computedAt: new Date("2026-05-22T12:00:00.000Z"),
				}}
			/>,
		);

		expect(screen.getByText("All-time balance")).toBeTruthy();
		expect(screen.getByText("+2:00h")).toBeTruthy();
	});

	it("renders a missing-balance fallback", () => {
		render(<WeeklySummaryCards summary={summary} workBalance={null} />);

		expect(screen.getByText("Not calculated yet")).toBeTruthy();
	});

	it("advances the day totals on each elapsed minute of live work", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
		// 240 completed minutes today and live work started 45 minutes ago.
		const dayTotalBasis = buildDayTotalBasis({
			periods: [
				{
					startTime: new Date("2026-10-07T06:00:00Z"),
					endTime: new Date("2026-10-07T10:00:00Z"),
					surchargeMinutes: null,
				},
				{ startTime: new Date("2026-10-07T11:15:00Z"), endTime: null, surchargeMinutes: null },
			],
			timezone: "Europe/Berlin",
			weekStartDay: "monday",
		});
		const liveSummary = {
			...summarizeDayTotals(dayTotalBasis, parseInstant("2026-10-07T12:00:00Z")),
			dayTotalBasis,
		};

		render(<WeeklySummaryCards summary={liveSummary} workBalance={null} />);
		// Today, This Week and This Month.
		expect(screen.getAllByText("4h 45m")).toHaveLength(3);

		act(() => vi.advanceTimersByTime(60_000));
		expect(screen.getAllByText("4h 46m")).toHaveLength(3);
	});
});
