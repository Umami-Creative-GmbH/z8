/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { groupYearCalendarEventsByDate } from "./year-calendar-events";
import { YearCalendarView } from "./year-calendar-view";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useWeekStartDay: () => "monday",
}));

function event(type: CalendarEvent["type"], date: string, title: string): CalendarEvent {
	return {
		id: title,
		type,
		date: new Date(date),
		title,
		color: "#2563eb",
		metadata: {},
	};
}

describe("YearCalendarView", () => {
	it("keeps all-day spans on logical dates across leap days and year boundaries", () => {
		const holiday = {
			...event("holiday", "2028-02-28T00:00:00.000Z", "Holiday"),
			endDate: new Date("2028-03-01T00:00:00.000Z"),
		};
		const vacation = {
			...event("absence", "2026-12-31T00:00:00.000Z", "Vacation"),
			endDate: new Date("2027-01-02T00:00:00.000Z"),
		};

		expect([...groupYearCalendarEventsByDate([holiday, vacation], "America/New_York")]).toEqual([
			["2028-02-28", [holiday]],
			["2028-02-29", [holiday]],
			["2028-03-01", [holiday]],
			["2026-12-31", [vacation]],
			["2027-01-01", [vacation]],
			["2027-01-02", [vacation]],
		]);
	});

	it("keeps timed work on its employee-local start date rather than expanding its end date", () => {
		const work = {
			...event("work_period", "2026-06-01T02:00:00.000Z", "Work"),
			endDate: new Date("2026-06-01T06:00:00.000Z"),
		};

		expect([...groupYearCalendarEventsByDate([work], "America/New_York")]).toEqual([
			["2026-05-31", [work]],
		]);
	});

	it("highlights every vacation day across a month boundary, including the final day", () => {
		const vacation = {
			...event("absence", "2026-08-31T00:00:00.000Z", "Vacation"),
			endDate: new Date("2026-09-05T00:00:00.000Z"),
			metadata: { status: "approved" },
		};

		render(
			<YearCalendarView
				events={[vacation]}
				year={2026}
				viewMode="year"
				onYearChange={vi.fn()}
				onViewModeChange={vi.fn()}
				timeZone="America/New_York"
			/>,
		);

		for (const label of [
			"August 31",
			"September 1",
			"September 2",
			"September 3",
			"September 4",
			"September 5",
		]) {
			expect(screen.getByRole("button", { name: `${label}, 2026` }).className).toContain(
				"bg-blue-100",
			);
		}
		expect(screen.getByRole("button", { name: "August 30, 2026" }).className).not.toContain(
			"bg-blue-100",
		);
		expect(screen.getByRole("button", { name: "September 6, 2026" }).className).not.toContain(
			"bg-blue-100",
		);
	});

	it("keeps all timeframe tabs visible in a full-width mobile row", () => {
		render(
			<YearCalendarView
				events={[]}
				year={2026}
				viewMode="year"
				onYearChange={vi.fn()}
				onViewModeChange={vi.fn()}
				timeZone="UTC"
			/>,
		);

		const tabs = screen.getByRole("tab", { name: "Day" }).closest('[data-slot="tabs"]');
		const tabsList = tabs?.querySelector('[data-slot="tabs-list"]');

		expect(tabs?.className).toContain("w-full");
		expect(tabsList?.className).toContain("grid-cols-4");
	});

	it("uses the employee timezone for timed event keys and logical keys for all-day events", () => {
		const events = [
			event("work_period", "2026-06-01T00:00:00.000Z", "Timed"),
			event("holiday", "2026-06-01T00:00:00.000Z", "Holiday"),
		];

		expect(groupYearCalendarEventsByDate(events, "America/New_York")).toEqual(
			new Map([
				["2026-05-31", [events[0]]],
				["2026-06-01", [events[1]]],
			]),
		);

		render(
			<YearCalendarView
				events={events}
				year={2026}
				viewMode="year"
				onYearChange={vi.fn()}
				onViewModeChange={vi.fn()}
				timeZone="America/New_York"
			/>,
		);

		expect(screen.getByRole("button", { name: "May 31, 2026" }).textContent).toBe("31");
		expect(screen.getByRole("button", { name: "June 1, 2026" }).textContent).toBe("1");
	});
});
