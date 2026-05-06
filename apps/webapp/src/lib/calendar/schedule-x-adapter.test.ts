import "temporal-polyfill/global";

import { describe, expect, it } from "vitest";

import { calendarEventToScheduleX, generateBreakEvents } from "./schedule-x-adapter";
import type { HolidayEvent, WorkPeriodEvent } from "./types";

describe("calendarEventToScheduleX", () => {
	it("keeps holidays on a single day when the stored end date is next-day midnight", () => {
		const holiday: HolidayEvent = {
			id: "holiday-1",
			type: "holiday",
			date: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-02T00:00:00.000Z"),
			title: "Labor Day",
			color: "#f59e0b",
			metadata: {
				categoryName: "Public holiday",
				categoryType: "public",
				blocksTimeEntry: true,
				isRecurring: false,
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(holiday);

		expect(scheduleXEvent?.start.toString()).toBe("2026-05-01");
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-02");
	});
});

describe("generateBreakEvents", () => {
	it("creates CSS-selector-safe ids for generated breaks", () => {
		const firstPeriod: WorkPeriodEvent = {
			id: "work-1",
			type: "work_period",
			date: new Date("2026-05-04T08:00:00.000Z"),
			endDate: new Date("2026-05-04T12:00:00.000Z"),
			title: "Work period",
			color: "#10b981",
			metadata: {
				durationMinutes: 240,
				employeeName: "Kai Hentschel",
			},
		};
		const secondPeriod: WorkPeriodEvent = {
			id: "work-2",
			type: "work_period",
			date: new Date("2026-05-04T12:30:00.000Z"),
			endDate: new Date("2026-05-04T17:00:00.000Z"),
			title: "Work period",
			color: "#10b981",
			metadata: {
				durationMinutes: 270,
				employeeName: "Kai Hentschel",
			},
		};

		const scheduleXEvents = [firstPeriod, secondPeriod]
			.map(calendarEventToScheduleX)
			.filter((event) => event !== null);

		const [breakEvent] = generateBreakEvents(scheduleXEvents);

		expect(breakEvent?.id).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*$/);
		expect(breakEvent?._eventData.id).toBe(breakEvent?.id);
	});
});
