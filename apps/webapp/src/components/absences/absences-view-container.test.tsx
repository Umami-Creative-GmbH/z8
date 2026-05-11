/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { AbsenceYearCalendar } from "./absence-year-calendar";
import { AbsencesViewContainer } from "./absences-view-container";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useWeekStartDay: () => "monday",
}));

vi.mock("./absence-entries-table", () => ({
	AbsenceEntriesTable: () => <div>Absence entries</div>,
}));

vi.mock("./request-absence-dialog", () => ({
	RequestAbsenceDialog: ({ open }: { open?: boolean }) => (
		<div data-testid="request-absence-dialog" data-open={open ? "true" : "false"} />
	),
}));

const categories: ComponentProps<typeof AbsencesViewContainer>["categories"] = [
	{
		id: "vacation",
		name: "Vacation",
		type: "vacation",
		color: null,
		requiresApproval: true,
		countsAgainstVacation: true,
	},
];

describe("AbsencesViewContainer", () => {
	it("shows a primary add absence action in the view header", () => {
		render(
			<AbsencesViewContainer
				absences={[]}
				categories={categories}
				currentYear={2026}
				holidays={[]}
				organizationId="org-1"
				remainingDays={10}
			/>,
		);

		const button = screen.getByRole("button", { name: "Add absence" });

		expect(button).toBeTruthy();
		expect(screen.getByTestId("request-absence-dialog").getAttribute("data-open")).toBe("false");

		fireEvent.click(button);

		expect(screen.getByTestId("request-absence-dialog").getAttribute("data-open")).toBe("true");
	});
});

describe("AbsenceYearCalendar", () => {
	it("uses a six-column desktop grid so the year fits in two rows", () => {
		render(<AbsenceYearCalendar absences={[]} holidays={[]} initialYear={2026} />);

		const monthGrid = screen.getByText("January").parentElement?.parentElement;

		expect(monthGrid?.className).toContain("lg:grid-cols-6");
		expect(monthGrid?.className).not.toContain("lg:grid-cols-4");
	});
});
