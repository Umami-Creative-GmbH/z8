/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const { ScheduleShiftList } = await import("./schedule-shift-list");

const lateShift = {
	id: "shift-1",
	employeeId: null,
	// Berlin midnight of Monday 2026-11-16.
	date: new Date("2026-11-15T23:00:00Z"),
	startTime: "14:00",
	endTime: "22:00",
	status: "published",
	notes: null,
	subarea: { id: "floor", name: "Floor", location: { id: "store", name: "Store" } },
} as ShiftWithRelations;

function renderList(timeFormat: "12h" | "24h") {
	render(
		<UserPreferencesProvider timeFormat={timeFormat}>
			<ScheduleShiftList
				shifts={[lateShift]}
				organizationTimezone="Europe/Berlin"
				onSelect={vi.fn()}
			/>
		</UserPreferencesProvider>,
	);
	return screen.getByRole("button").textContent;
}

afterEach(cleanup);

describe("schedule shift list times (#2018)", () => {
	it("writes a shift's times in the planner's 24-hour format", () => {
		const text = renderList("24h");
		expect(text).toContain("14:00 – 22:00");
		expect(text).not.toMatch(/PM/);
	});

	it("writes a shift's times in the planner's 12-hour format", () => {
		expect(renderList("12h")).toContain("2:00 PM – 10:00 PM");
	});
});
