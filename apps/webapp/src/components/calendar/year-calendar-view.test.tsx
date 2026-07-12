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
	return { id: title, type, date: new Date(date), title, color: "#2563eb", metadata: {} };
}

describe("YearCalendarView", () => {
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
