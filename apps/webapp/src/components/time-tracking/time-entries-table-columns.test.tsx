/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getTimeEntriesColumns, type WorkPeriodData } from "./time-entries-table-columns";

const t = ((_key: string, fallback: string) => fallback) as never;

const workPeriod: WorkPeriodData = {
	id: "period-1",
	startTime: new Date("2026-05-03T12:05:00.000Z"),
	endTime: new Date("2026-05-03T14:30:00.000Z"),
	durationMinutes: 145,
	approvalStatus: "approved",
	clockIn: { id: "clock-in-1", isSuperseded: false, notes: null },
	clockOut: { id: "clock-out-1", isSuperseded: false, notes: null },
};

describe("getTimeEntriesColumns", () => {
	it("formats clock-in and clock-out cells with the selected time format", () => {
		const columns = getTimeEntriesColumns({
			t,
			employeeTimezone: "Europe/Berlin",
			timeFormat: "12h",
			hasManager: false,
			renderEditAction: vi.fn(),
		});
		const row = { original: workPeriod };
		const clockIn = columns.find((column) => column.id === "clockIn");
		const clockOut = columns.find((column) => column.id === "clockOut");

		render(
			<>
				{typeof clockIn?.cell === "function" ? clockIn.cell({ row } as never) : null}
				{typeof clockOut?.cell === "function" ? clockOut.cell({ row } as never) : null}
			</>,
		);

		expect(screen.getByText("2:05 PM")).toBeTruthy();
		expect(screen.getByText("4:30 PM")).toBeTruthy();
	});
});
