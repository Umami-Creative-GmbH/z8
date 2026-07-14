/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	dateToCalendarString,
	formatDateRangeLabel,
	getDateRangeForPreset,
} from "@/lib/reports/date-ranges";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { DateRangePicker } from "./date-range-picker";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en-US",
		timezone: "UTC",
		timeFormat: "24h",
	}),
}));

describe("DateRangePicker", () => {
	beforeEach(() => {
		useOrganizationSettings.getState().reset();
	});

	it("disables and explains preset selection until organization settings are hydrated", () => {
		render(<DateRangePicker value={getDateRangeForPreset("current_year")} onChange={vi.fn()} />);

		expect((screen.getByRole("combobox", { name: "Period" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(screen.getByText("Loading organization settings before enabling presets.")).toBeTruthy();
	});

	it("keeps picker selections as local calendar strings", () => {
		expect(dateToCalendarString(new Date(2026, 4, 1))).toBe("2026-05-01");
	});

	it("formats calendar labels without converting through the host timezone", () => {
		expect(formatDateRangeLabel("2026-05-01", "2026-05-31")).toBe("May 1, 2026 - May 31, 2026");
	});
});
