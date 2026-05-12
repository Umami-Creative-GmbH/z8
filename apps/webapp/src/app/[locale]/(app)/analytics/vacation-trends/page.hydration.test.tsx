/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Settings } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DateRange } from "@/lib/reports/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

const { getVacationTrendsDataMock } = vi.hoisted(() => ({
	getVacationTrendsDataMock: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
	default: () => () => null,
}));

vi.mock("@/components/analytics/export-button", () => ({
	ExportButton: () => <button type="button">Export</button>,
}));

type MockDateRangePickerProps = {
	value: DateRange;
	onChange: (range: DateRange) => void;
};

vi.mock("@/components/reports/date-range-picker", () => ({
	DateRangePicker: ({ value, onChange }: MockDateRangePickerProps) => (
		<div>
			<span data-testid="date-range-start">{value.start.toISOString()}</span>
			<button
				type="button"
				onClick={() =>
					onChange({
						start: new Date("2026-06-01T00:00:00.000Z"),
						end: new Date("2026-06-30T23:59:59.999Z"),
					})
				}
			>
				Choose Custom Range
			</button>
		</div>
	),
}));

vi.mock("../actions", () => ({
	getVacationTrendsData: getVacationTrendsDataMock,
}));

import VacationTrendsPage from "./page";

function hydrateFiscalSettings(fiscalYearStartMonth: number) {
	act(() => {
		useOrganizationSettings.getState().hydrate({
			organizationId: "org-1",
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
			timezone: "UTC",
			fiscalYearStartMonth,
			deletedAt: null,
		});
	});
}

describe("VacationTrendsPage fiscal range hydration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Settings.defaultZone = "utc";
		Settings.now = () => Date.parse("2026-05-12T10:30:00.000Z");
		useOrganizationSettings.getState().reset();
		getVacationTrendsDataMock.mockResolvedValue({
			success: true,
			data: {
				overall: {
					totalDaysAllocated: 0,
					totalDaysTaken: 0,
					totalDaysRemaining: 0,
					utilizationRate: 0,
				},
				byEmployee: [],
				byMonth: [],
				patterns: { peakMonths: [] },
			},
		});
	});

	afterEach(() => {
		Settings.now = () => Date.now();
		Settings.defaultZone = "system";
	});

	it("recomputes the default current year after fiscal settings hydrate", async () => {
		render(<VacationTrendsPage />);

		hydrateFiscalSettings(4);

		await waitFor(() => {
			expect(screen.getByTestId("date-range-start").textContent).toBe("2026-04-01T00:00:00.000Z");
		});
		await waitFor(() => {
			expect(getVacationTrendsDataMock).toHaveBeenCalledWith(
				expect.objectContaining({ start: new Date("2026-04-01T00:00:00.000Z") }),
			);
		});
	});

	it("does not overwrite a manually changed range when fiscal settings hydrate", async () => {
		render(<VacationTrendsPage />);

		fireEvent.click(screen.getByRole("button", { name: "Choose Custom Range" }));
		expect(screen.getByTestId("date-range-start").textContent).toBe("2026-06-01T00:00:00.000Z");

		hydrateFiscalSettings(4);

		expect(screen.getByTestId("date-range-start").textContent).toBe("2026-06-01T00:00:00.000Z");
	});
});
