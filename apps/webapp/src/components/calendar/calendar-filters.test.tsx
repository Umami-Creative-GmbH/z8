/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import { CalendarFiltersComponent } from "./calendar-filters";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

const filters: CalendarFilters = {
	showHolidays: true,
	showAbsences: true,
	showTimeEntries: false,
	showWorkPeriods: true,
};

describe("CalendarFiltersComponent", () => {
	it("uses prefixed switch ids to avoid duplicates when rendered twice", () => {
		render(
			<>
				<CalendarFiltersComponent
					filters={filters}
					onFiltersChange={vi.fn()}
					idPrefix="calendar-desktop"
				/>
				<CalendarFiltersComponent
					filters={filters}
					onFiltersChange={vi.fn()}
					idPrefix="calendar-mobile"
				/>
			</>,
		);

		const switchIds = screen.getAllByRole("switch").map((control) => control.id);

		expect(switchIds).toEqual([
			"calendar-desktop-show-holidays",
			"calendar-desktop-show-absences",
			"calendar-desktop-show-time-entries",
			"calendar-desktop-show-work-periods",
			"calendar-mobile-show-holidays",
			"calendar-mobile-show-absences",
			"calendar-mobile-show-time-entries",
			"calendar-mobile-show-work-periods",
		]);
		expect(new Set(switchIds).size).toBe(switchIds.length);
	});
});
