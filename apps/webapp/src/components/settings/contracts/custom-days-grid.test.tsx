/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CustomWorkDay } from "@/lib/contracts/types";
import {
	CustomDaysGrid,
	createDefaultCustomDays,
	sumCustomWorkDayMinutes,
} from "./custom-days-grid";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [k, v]) => text.replaceAll(`{${k}}`, String(v)),
				fallback,
			),
	}),
}));

function ControlledGrid({ initial }: { initial?: CustomWorkDay[] }) {
	const [days, setDays] = useState<CustomWorkDay[]>(() => initial ?? createDefaultCustomDays(2400));
	return (
		<div>
			<CustomDaysGrid value={days} onChange={setDays} />
			<output data-testid="total-minutes">{sumCustomWorkDayMinutes(days)}</output>
		</div>
	);
}

describe("CustomDaysGrid (#1930)", () => {
	it("renders an ARIA grid with 7 weekday rows backed by integer minutesPerDay", () => {
		render(<ControlledGrid />);

		const grid = screen.getByRole("grid", { name: "Custom working days schedule" });
		const rows = within(grid).getAllByRole("row");
		// 1 header row + 7 weekday rows
		expect(rows).toHaveLength(8);
		expect(screen.getByTestId("total-minutes").textContent).toBe("2400");
	});

	it("supports arrow-key navigation across days and columns", () => {
		render(<ControlledGrid />);

		const mondayToggle = screen.getByRole("checkbox", { name: "Monday work day" });
		const tuesdayToggle = screen.getByRole("checkbox", { name: "Tuesday work day" });
		const mondayHours = screen.getByRole("spinbutton", { name: "Monday hours" });

		mondayToggle.focus();
		expect(document.activeElement).toBe(mondayToggle);

		fireEvent.keyDown(mondayToggle, { key: "ArrowDown" });
		expect(document.activeElement).toBe(tuesdayToggle);

		fireEvent.keyDown(tuesdayToggle, { key: "ArrowUp" });
		expect(document.activeElement).toBe(mondayToggle);

		fireEvent.keyDown(mondayToggle, { key: "ArrowRight" });
		expect(document.activeElement).toBe(mondayHours);

		fireEvent.keyDown(mondayHours, { key: "ArrowLeft" });
		expect(document.activeElement).toBe(mondayToggle);
	});

	it("updates integer minutesPerDay, toggles work days, and shows validation feedback for 0-minute work days", () => {
		render(<ControlledGrid />);

		const mondayHours = screen.getByRole("spinbutton", { name: "Monday hours" });
		const mondayMinutes = screen.getByRole("spinbutton", { name: "Monday minutes" });

		fireEvent.change(mondayHours, { target: { value: "6" } });
		fireEvent.change(mondayMinutes, { target: { value: "30" } });
		// 2400 - 480 + 390 = 2310
		expect(screen.getByTestId("total-minutes").textContent).toBe("2310");

		// Setting an active work day to 0h 0m surfaces accessible validation alert
		fireEvent.change(mondayHours, { target: { value: "0" } });
		fireEvent.change(mondayMinutes, { target: { value: "0" } });
		expect(screen.getByRole("alert").textContent).toMatch(/between 1 minute and 24 hours/);

		// Turning off the work day clears the error and disables inputs
		const mondayToggle = screen.getByRole("checkbox", { name: "Monday work day" });
		fireEvent.click(mondayToggle);
		expect(screen.queryByRole("alert")).toBeNull();
		expect((mondayHours as HTMLInputElement).disabled).toBe(true);
	});
});
