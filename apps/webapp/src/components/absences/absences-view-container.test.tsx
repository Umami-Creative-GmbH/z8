/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AbsenceYearCalendar } from "./absence-year-calendar";
import { AbsencesViewContainer } from "./absences-view-container";

const mockGetAbsenceCalendarYearData = vi.hoisted(() => vi.fn());

vi.mock("@/app/[locale]/(app)/absences/actions", () => ({
	getAbsenceCalendarYearData: mockGetAbsenceCalendarYearData,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useWeekStartDay: () => "monday",
}));

vi.mock("./absence-entries-table", () => ({
	AbsenceEntriesTable: ({
		absences,
		currentDate,
	}: {
		absences: Array<{ id: string }>;
		currentDate: string;
	}) => (
		<div data-current-date={currentDate} data-absence-count={absences.length}>
			Absence entries
		</div>
	),
}));

vi.mock("./request-absence-dialog", () => ({
	RequestAbsenceDialog: ({ open, onSuccess }: { open?: boolean; onSuccess?: () => void }) => (
		<div data-testid="request-absence-dialog" data-open={open ? "true" : "false"}>
			<button type="button" onClick={onSuccess}>
				Simulate request success
			</button>
		</div>
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
	beforeEach(() => {
		mockGetAbsenceCalendarYearData.mockReset();
	});

	it("shows a primary add absence action in the view header", () => {
		render(
			<AbsencesViewContainer
				absences={[]}
				categories={categories}
				currentYear={2026}
				holidays={[]}
				organizationId="org-1"
				remainingDays={10}
				currentDate="2026-05-20"
			/>,
		);

		const button = screen.getByRole("button", { name: "Add absence" });

		expect(button).toBeTruthy();
		expect(screen.getByTestId("request-absence-dialog").getAttribute("data-open")).toBe("false");

		fireEvent.click(button);

		expect(screen.getByTestId("request-absence-dialog").getAttribute("data-open")).toBe("true");
	});

	it("loads holidays for the selected calendar year", async () => {
		mockGetAbsenceCalendarYearData.mockResolvedValue({
			absences: [],
			holidays: [
				{
					id: "holiday-2027",
					name: "New 2027 Holiday",
					startDate: new Date(2027, 0, 6),
					endDate: new Date(2027, 0, 6),
					categoryId: "public",
				},
			],
		});

		render(
			<AbsencesViewContainer
				absences={[]}
				categories={categories}
				currentYear={2026}
				holidays={[]}
				organizationId="org-1"
				remainingDays={10}
				currentDate="2026-05-20"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Next year" }));

		await waitFor(() => {
			expect(mockGetAbsenceCalendarYearData).toHaveBeenCalledWith(2027);
		});
		await waitFor(() => {
			expect(screen.getAllByRole("button", { name: "6" })[0].className).toContain("bg-amber-100");
		});
	});

	it("reloads absence data after a request succeeds", async () => {
		mockGetAbsenceCalendarYearData.mockResolvedValue({
			absences: [
				{
					id: "absence-1",
					category: { name: "Vacation", color: null, type: "vacation" },
					status: "pending",
					startDate: "2026-05-20",
					endDate: "2026-05-20",
				},
			],
			holidays: [],
		});

		render(
			<AbsencesViewContainer
				absences={[]}
				categories={categories}
				currentYear={2026}
				holidays={[]}
				organizationId="org-1"
				remainingDays={10}
				currentDate="2026-05-20"
			/>,
		);

		expect(
			screen
				.getAllByRole("button", { name: "20" })
				.some((button) => button.className.includes("bg-yellow-100")),
		).toBe(false);

		fireEvent.click(screen.getByRole("button", { name: "Simulate request success" }));

		await waitFor(() => {
			expect(mockGetAbsenceCalendarYearData).toHaveBeenCalledWith(2026);
		});
		await waitFor(() => {
			expect(
				screen
					.getAllByRole("button", { name: "20" })
					.some((button) => button.className.includes("bg-yellow-100")),
			).toBe(true);
		});
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
