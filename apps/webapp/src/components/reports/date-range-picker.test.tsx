/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { DateRangePicker } from "./date-range-picker";

describe("DateRangePicker", () => {
	beforeEach(() => {
		useOrganizationSettings.getState().reset();
	});

	it("disables and explains preset selection until organization settings are hydrated", () => {
		render(
			<DateRangePicker
				value={getDateRangeForPreset("current_year")}
				onChange={vi.fn()}
			/>,
		);

		expect((screen.getByRole("combobox", { name: "Period" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(screen.getByText("Loading organization settings before enabling presets.")).toBeTruthy();
	});
});
