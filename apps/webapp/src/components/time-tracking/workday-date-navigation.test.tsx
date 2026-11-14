/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { weekDates } from "./workday-date-helpers";
import {
	WorkdayMonthPicker,
	WorkdayWeekStrip,
} from "./workday-date-navigation";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: { children: ReactNode; href: string }) => (
		<a {...props}>{children}</a>
	),
}));
afterEach(cleanup);

describe("workday date navigation", () => {
	it("honors the saved first weekday across a year boundary", () => {
		expect(weekDates("2027-01-01", "monday").map(String)).toEqual([
			"2026-12-28",
			"2026-12-29",
			"2026-12-30",
			"2026-12-31",
			"2027-01-01",
			"2027-01-02",
			"2027-01-03",
		]);
		expect(weekDates("2027-01-01", "sunday")[0].toString()).toBe("2026-12-27");
	});

	it("links each weekday to the real selected-day route and identifies selection accessibly", () => {
		render(<WorkdayWeekStrip dateKey="2026-11-14" weekStartDay="monday" />);
		expect(
			screen
				.getByRole("link", { name: "Saturday, November 14, 2026" })
				.getAttribute("aria-current"),
		).toBe("date");
		expect(
			screen
				.getByRole("link", { name: "Friday, November 13, 2026" })
				.getAttribute("href"),
		).toBe("/time-tracking?date=2026-11-13");
	});

	it("browses months without selecting a different date and keeps Today tied to employee context", () => {
		render(
			<WorkdayMonthPicker
				dateKey="2026-11-14"
				todayDateKey="2026-11-15"
				weekStartDay="monday"
			/>,
		);
		expect(
			screen.getByRole("link", { name: "Today" }).getAttribute("href"),
		).toBe("/time-tracking?date=2026-11-15");
		fireEvent.click(screen.getByRole("button", { name: "Next month" }));
		const month = screen.getByRole("navigation", {
			name: "Select a calendar day",
		});
		expect(
			within(month)
				.getByRole("link", { name: "Thursday, December 31, 2026" })
				.getAttribute("href"),
		).toBe("/time-tracking?date=2026-12-31");
		expect(month.querySelector('[aria-current="date"]')).toBeNull();
	});
});
