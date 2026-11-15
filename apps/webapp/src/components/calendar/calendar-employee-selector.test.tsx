/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalendarEmployeeSelector } from "./calendar-employee-selector";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/hooks/use-calendar-employees", () => ({
	useCalendarEmployees: () => ({
		employees: [],
		isLoading: false,
		error: null,
	}),
}));

describe("CalendarEmployeeSelector limited roster", () => {
	it("does not call an authorized direct-linked colleague My Calendar when no selector options load", () => {
		render(
			<CalendarEmployeeSelector
				currentEmployeeId="viewer"
				selectedEmployeeId="colleague"
				isManagerOrAbove
				onEmployeeChange={() => {}}
			/>,
		);
		expect(screen.queryByText("My Calendar")).toBeNull();
	});
	it("retains the personal indicator for the current employee", () => {
		render(
			<CalendarEmployeeSelector
				currentEmployeeId="viewer"
				selectedEmployeeId="viewer"
				isManagerOrAbove
				onEmployeeChange={() => {}}
			/>,
		);
		expect(screen.getByText("My Calendar")).toBeTruthy();
	});
});
