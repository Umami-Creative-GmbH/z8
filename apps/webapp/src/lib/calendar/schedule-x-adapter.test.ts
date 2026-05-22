import "temporal-polyfill/global";

import { describe, expect, it } from "vitest";

import { calendarEventToScheduleX, generateBreakEvents } from "./schedule-x-adapter";
import type { AbsenceEvent, HolidayEvent, WorkPeriodEvent } from "./types";

describe("calendarEventToScheduleX", () => {
	it("renders timed work periods in the configured timezone instead of the runtime timezone", () => {
		const workPeriod: WorkPeriodEvent = {
			id: "work-berlin",
			type: "work_period",
			date: new Date("2026-05-18T07:40:00.000Z"),
			endDate: new Date("2026-05-18T15:40:00.000Z"),
			title: "Work period",
			color: "#10b981",
			metadata: {
				durationMinutes: 480,
				employeeName: "Kai Hentschel",
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(workPeriod, "America/New_York");

		expect(scheduleXEvent?.start.toString()).toBe(
			"2026-05-18T03:40:00-04:00[America/New_York]",
		);
		expect(scheduleXEvent?.end.toString()).toBe(
			"2026-05-18T11:40:00-04:00[America/New_York]",
		);
	});

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

	it("keeps multi-day absences on their stored inclusive date range", () => {
		const absence: AbsenceEvent = {
			id: "absence-1",
			type: "absence",
			date: new Date("2026-05-20T00:00:00.000Z"),
			endDate: new Date("2026-05-21T00:00:00.000Z"),
			title: "Home office",
			color: "#3b82f6",
			metadata: {
				categoryName: "Home office",
				status: "approved",
				employeeName: "Kai Hentschel",
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(absence);

		expect(scheduleXEvent?.start.toString()).toBe("2026-05-20");
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-21");
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
			.map((event) => calendarEventToScheduleX(event))
			.filter((event) => event !== null);

		const [breakEvent] = generateBreakEvents(scheduleXEvents);

		expect(breakEvent?.id).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*$/);
		expect(breakEvent?._eventData.id).toBe(breakEvent?.id);
	});

	it("keeps break fallback copy and exposes translation keys", () => {
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
			.map((event) => calendarEventToScheduleX(event))
			.filter((event) => event !== null);

		const [breakEvent] = generateBreakEvents(scheduleXEvents);

		expect(breakEvent?._eventData).toMatchObject({
			title: "Break - 30m",
			description: "Break between work periods",
			titleKey: "calendar.calendar.break.titleWithDuration",
			descriptionKey: "calendar.calendar.break.description",
		});
	});
});
