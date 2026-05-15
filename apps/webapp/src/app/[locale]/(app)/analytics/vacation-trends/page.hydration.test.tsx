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

function hydrateOrganizationSettings(timezone = "UTC") {
	act(() => {
		useOrganizationSettings.getState().hydrate({
			organizationId: "org-1",
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
			timezone,
			deletedAt: null,
		});
	});
}

describe("VacationTrendsPage range hydration", () => {
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

	it("keeps the default current calendar year after organization settings hydrate", async () => {
		render(<VacationTrendsPage />);

		expect(getVacationTrendsDataMock).not.toHaveBeenCalled();
		expect(screen.queryByTestId("date-range-start")).toBeNull();

		hydrateOrganizationSettings();

		await waitFor(() => {
			expect(screen.getByTestId("date-range-start").textContent).toBe("2026-01-01T00:00:00.000Z");
		});
		await waitFor(() => {
			expect(getVacationTrendsDataMock).toHaveBeenCalledWith(
				expect.objectContaining({ start: new Date("2026-01-01T00:00:00.000Z") }),
			);
		});
	});

	it("uses hydrated organization timezone for the default current calendar year", async () => {
		render(<VacationTrendsPage />);

		hydrateOrganizationSettings("Europe/Berlin");

		await waitFor(() => {
			expect(screen.getByTestId("date-range-start").textContent).toBe(
				"2025-12-31T23:00:00.000Z",
			);
		});
		await waitFor(() => {
			expect(getVacationTrendsDataMock).toHaveBeenCalledWith(
				expect.objectContaining({
					start: new Date("2025-12-31T23:00:00.000Z"),
					end: new Date("2026-12-31T22:59:59.999Z"),
				}),
			);
		});
		expect(getVacationTrendsDataMock).not.toHaveBeenCalledWith(
			expect.objectContaining({
				start: new Date("2026-01-01T00:00:00.000Z"),
				end: new Date("2026-12-31T23:59:59.999Z"),
			}),
		);
	});

	it("does not fetch twice when hydration recomputes an equivalent default range", async () => {
		render(<VacationTrendsPage />);

		hydrateOrganizationSettings();

		await waitFor(() => {
			expect(getVacationTrendsDataMock).toHaveBeenCalledTimes(1);
		});
	});

	it("does not overwrite a manually changed range when organization settings update", async () => {
		render(<VacationTrendsPage />);
		hydrateOrganizationSettings();

		await screen.findByTestId("date-range-start");

		fireEvent.click(screen.getByRole("button", { name: "Choose Custom Range" }));
		expect(screen.getByTestId("date-range-start").textContent).toBe("2026-06-01T00:00:00.000Z");

		hydrateOrganizationSettings("Europe/Berlin");

		expect(screen.getByTestId("date-range-start").textContent).toBe("2026-06-01T00:00:00.000Z");
	});
});
