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

	it("disables preset selection until organization settings are hydrated", () => {
		render(
			<DateRangePicker
				value={getDateRangeForPreset("current_year")}
				onChange={vi.fn()}
			/>,
		);

		expect((screen.getByRole("combobox") as HTMLButtonElement).disabled).toBe(true);
	});
});
