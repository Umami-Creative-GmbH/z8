/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent, DailyWorkHoursSummaries } from "@/lib/calendar/types";
import { MonthWorkSummaryView } from "./month-work-summary-view";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) => {
			if (!params) return fallback;
			return Object.entries(params).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, value),
				fallback,
			);
		},
	}),
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useWeekStartDay: () => "monday",
}));

function workSummary(requiredMinutes: number, actualMinutes: number) {
	const deltaMinutes = actualMinutes - requiredMinutes;
	return {
		requiredMinutes,
		actualMinutes,
		deltaMinutes,
		status:
			deltaMinutes > 0
				? ("over" as const)
				: deltaMinutes === 0
					? ("met" as const)
					: ("under" as const),
		policyId: "policy-1",
		policyName: "Standard",
	};
}

function event(date: string, type: CalendarEvent["type"], title: string): CalendarEvent {
	return {
		id: `${type}-${date}`,
		type,
		date: new Date(`${date}T00:00:00.000Z`),
		title,
		color: "#2563eb",
		metadata: {},
	};
}

function renderView(overrides: Partial<Parameters<typeof MonthWorkSummaryView>[0]> = {}) {
	const props = {
		monthDate: new Date("2026-05-01T00:00:00.000Z"),
		events: [event("2026-05-04", "holiday", "Holiday")],
		workHoursData: new Map([
			["2026-05-04", workSummary(480, 606)],
			["2026-05-05", workSummary(360, 431)],
		]) satisfies DailyWorkHoursSummaries,
		viewMode: "month" as const,
		onViewModeChange: vi.fn(),
		onMonthChange: vi.fn(),
		onDayClick: vi.fn(),
		onRefresh: vi.fn(),
		...overrides,
	};

	render(<MonthWorkSummaryView {...props} />);
	return props;
}

describe("MonthWorkSummaryView", () => {
	it("renders daily, weekly, and monthly work summaries with event badges", () => {
		renderView();

		expect(screen.getByRole("heading", { name: "May 2026" })).toBeTruthy();
		expect(screen.getByText("Daily, weekly, and monthly policy hours")).toBeTruthy();
		expect(screen.getByText("+2:06")).toBeTruthy();
		expect(screen.getByText("10:06 / 8:00")).toBeTruthy();
		expect(screen.getByText("+1:11")).toBeTruthy();
		expect(screen.getByText("7:11 / 6:00")).toBeTruthy();
		expect(screen.getAllByText("+3:17")).toHaveLength(2);
		expect(screen.getAllByText("17:17 / 14:00")).toHaveLength(2);
		expect(screen.getByText("Holiday")).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "Monday, May 4, 2026: 10:06 recorded, 8:00 required, +2:06 over requirement. 1 event: Holiday",
			}),
		).toBeTruthy();
	});

	it("calls onDayClick with the clicked day", () => {
		const props = renderView();

		fireEvent.click(screen.getByRole("button", { name: /Monday, May 4, 2026/ }));

		const clickedDate = DateTime.fromJSDate(props.onDayClick.mock.calls[0][0]);
		expect(clickedDate.toObject()).toMatchObject({ year: 2026, month: 5, day: 4 });
	});

	it("handles month navigation and view mode changes", () => {
		const props = renderView();

		fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
		fireEvent.mouseDown(screen.getByRole("tab", { name: "Week" }), {
			button: 0,
			ctrlKey: false,
		});

		const previousMonth = DateTime.fromJSDate(props.onMonthChange.mock.calls[0][0]);
		expect(previousMonth.toObject()).toMatchObject({ year: 2026, month: 4, day: 1 });
		expect(props.onViewModeChange).toHaveBeenCalledWith("week");
	});

	it("shows an empty month total state when no policy requirements exist", () => {
		renderView({ workHoursData: new Map(), events: [] });

		expect(screen.queryByText("0:00 / 0:00")).toBeNull();
		expect(screen.getByText("No policy hours in this month")).toBeTruthy();
	});

	it("does not expose inactive-month work summaries in accessible day content", () => {
		renderView({
			workHoursData: new Map([
				["2026-04-30", workSummary(480, 300)],
				["2026-05-04", workSummary(480, 606)],
			]),
		});

		expect(screen.getByRole("button", { name: "Thursday, April 30, 2026" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /April 30, 2026:.*5:00 recorded/ })).toBeNull();
		expect(screen.queryByText("under requirement")).toBeNull();
	});
});
