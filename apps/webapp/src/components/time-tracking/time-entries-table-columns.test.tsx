/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	getTimeEntriesColumns,
	type WorkPeriodData,
} from "./time-entries-table-columns";

const t = ((_key: string, fallback: string) => fallback) as never;

const workPeriod: WorkPeriodData = {
	id: "period-1",
	startTime: new Date("2026-05-03T12:05:00.000Z"),
	endTime: new Date("2026-05-03T14:30:00.000Z"),
	durationMinutes: 145,
	approvalStatus: "approved",
	approvalRequestId: null,
	workLocationType: "remote",
	workCategoryId: "category-1",
	clockIn: {
		id: "clock-in-1",
		isSuperseded: false,
		notes: null,
		utcOffsetMinutes: 120,
	},
	clockOut: {
		id: "clock-out-1",
		isSuperseded: false,
		notes: null,
		utcOffsetMinutes: -240,
	},
};

describe("getTimeEntriesColumns", () => {
	it("formats clock-in and clock-out cells with the selected time format", () => {
		const columns = getTimeEntriesColumns({
			t,
			locale: "en-US",
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
				{typeof clockIn?.cell === "function"
					? clockIn.cell({ row } as never)
					: null}
				{typeof clockOut?.cell === "function"
					? clockOut.cell({ row } as never)
					: null}
			</>,
		);

		expect(screen.getByText("2:05 PM")).toBeTruthy();
		expect(screen.getByText("10:30 AM")).toBeTruthy();
	});

	it("uses a neutral header for endpoint values with independent captured offsets", () => {
		const columns = getTimeEntriesColumns({
			t,
			locale: "en-US",
			employeeTimezone: "Europe/Berlin",
			timeFormat: "12h",
			hasManager: false,
			renderEditAction: vi.fn(),
		});
		const clockIn = columns.find((column) => column.id === "clockIn");
		const clockOut = columns.find((column) => column.id === "clockOut");

		render(
			<>
				{typeof clockIn?.header === "function"
					? clockIn.header({} as never)
					: null}
				{typeof clockOut?.header === "function"
					? clockOut.header({} as never)
					: null}
			</>,
		);

		expect(screen.getAllByText("Recorded local time")).toHaveLength(2);
		expect(screen.queryByText("(CEST)")).toBeNull();
	});

	it("formats captured endpoint dates with the active locale", () => {
		const columns = getTimeEntriesColumns({
			t,
			locale: "fr-FR",
			employeeTimezone: "Europe/Berlin",
			timeFormat: "24h",
			hasManager: false,
			renderEditAction: vi.fn(),
		});
		const date = columns.find((column) => column.accessorKey === "startTime");

		render(
			typeof date?.cell === "function"
				? date.cell({ row: { original: workPeriod } } as never)
				: null,
		);

		expect(screen.getByText("03/05/2026")).toBeTruthy();
	});

	it("passes complete period metadata to the edit renderer", () => {
		const renderEditAction = vi.fn();
		const columns = getTimeEntriesColumns({
			t,
			locale: "en-US",
			employeeTimezone: "Europe/Berlin",
			timeFormat: "24h",
			hasManager: true,
			renderEditAction,
		});
		const actions = columns.find((column) => column.id === "actions");

		if (typeof actions?.cell === "function") {
			actions.cell({ row: { original: workPeriod } } as never);
		}

		expect(renderEditAction).toHaveBeenCalledWith(
			expect.objectContaining({
				workLocationType: "remote",
				workCategoryId: "category-1",
			}),
			expect.any(Boolean),
		);
	});
});
