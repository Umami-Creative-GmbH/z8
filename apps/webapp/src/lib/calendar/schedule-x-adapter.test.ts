import "temporal-polyfill/global";

import { describe, expect, it } from "vitest";

import { calendarEventToScheduleX, generateBreakEvents } from "./schedule-x-adapter";
import type { AbsenceEvent, HolidayEvent, TimeEntryEvent, WorkPeriodEvent } from "./types";

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

		expect(scheduleXEvent?.start.toString()).toBe("2026-05-18T03:40:00-04:00[America/New_York]");
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-18T11:40:00-04:00[America/New_York]");
	});

	it("renders work periods at the saved clock-in and clock-out offsets", () => {
		const workPeriod: WorkPeriodEvent = {
			id: "work-utc-plus-two",
			type: "work_period",
			date: new Date("2026-05-18T06:00:00.000Z"),
			endDate: new Date("2026-05-18T08:00:00.000Z"),
			title: "Work period",
			color: "#10b981",
			metadata: {
				durationMinutes: 120,
				employeeName: "Kai Hentschel",
				clockInUtcOffsetMinutes: 120,
				clockInTimezone: "Europe/Berlin",
				clockOutUtcOffsetMinutes: 120,
				clockOutTimezone: "Europe/Berlin",
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(workPeriod, "UTC");

		expect(scheduleXEvent?.start.toString()).toBe("2026-05-18T08:00:00+00:00[UTC]");
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-18T10:00:00+00:00[UTC]");
		expect(scheduleXEvent?._customContent?.timeGrid).toContain("UTC+02:00");
		expect(scheduleXEvent?._customContent?.timeGrid).toContain("Europe/Berlin");
	});

	it("keeps saved wall-clock placement independent of the selected calendar timezone", () => {
		const workPeriod: WorkPeriodEvent = {
			id: "work-berlin-wall-clock",
			type: "work_period",
			date: new Date("2026-05-18T07:00:00.000Z"),
			endDate: new Date("2026-05-18T15:00:00.000Z"),
			title: "Work period",
			color: "#10b981",
			metadata: {
				durationMinutes: 480,
				employeeName: "Kai Hentschel",
				clockInUtcOffsetMinutes: 120,
				clockInTimezone: "Europe/Berlin",
				clockOutUtcOffsetMinutes: 120,
				clockOutTimezone: "Europe/Berlin",
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(workPeriod, "Europe/Berlin");

		expect(scheduleXEvent?.start.toString()).toBe("2026-05-18T09:00:00+00:00[UTC]");
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-18T17:00:00+00:00[UTC]");
	});

	it("uses the clock-in offset and minimum visual duration for a running work period", () => {
		const runningPeriod: WorkPeriodEvent = {
			id: "work-running-berlin",
			type: "work_period",
			date: new Date("2026-05-18T14:48:00.000Z"),
			endDate: new Date("2026-05-18T14:51:00.000Z"),
			title: "Kai Hentschel - 3m (running)",
			color: "#10b981",
			metadata: {
				durationMinutes: 3,
				employeeName: "Kai Hentschel",
				clockInUtcOffsetMinutes: 120,
				clockInTimezone: "Europe/Berlin",
				isRunning: true,
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(runningPeriod, "UTC");

		expect(scheduleXEvent?.start.toString()).toBe("2026-05-18T16:48:00+00:00[UTC]");
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-18T17:18:00+00:00[UTC]");
	});

	it("renders the running indicator as a fixed round ping dot", () => {
		const runningPeriod: WorkPeriodEvent = {
			id: "work-running-dot",
			type: "work_period",
			date: new Date("2026-05-18T14:48:00.000Z"),
			endDate: new Date("2026-05-18T14:51:00.000Z"),
			title: "Kai Hentschel - 3m (running)",
			color: "#10b981",
			metadata: {
				durationMinutes: 3,
				employeeName: "Kai Hentschel",
				clockInUtcOffsetMinutes: 120,
				clockInTimezone: "Europe/Berlin",
				isRunning: true,
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(runningPeriod, "UTC");
		const timeGrid = scheduleXEvent?._customContent?.timeGrid ?? "";

		expect(timeGrid).toContain("relative inline-flex size-2 shrink-0");
		expect(timeGrid).toContain(
			"absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75",
		);
		expect(timeGrid).toContain("relative inline-flex size-2 rounded-full bg-red-500");
		expect(timeGrid).toContain("shrink-0");
		expect(timeGrid).toContain("rounded-full");
		expect(timeGrid).toContain("animate-ping");
		expect(timeGrid).not.toContain("animate-pulse");
	});

	it("renders a stop button for authorized running work periods", () => {
		const runningPeriod: WorkPeriodEvent = {
			id: "work-running-action",
			type: "work_period",
			date: new Date("2026-05-18T14:48:00.000Z"),
			endDate: new Date("2026-05-18T14:51:00.000Z"),
			title: "Kai Hentschel - 3m (running)",
			color: "#10b981",
			metadata: {
				durationMinutes: 3,
				employeeName: "Kai Hentschel",
				isRunning: true,
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(runningPeriod, "UTC", {
			canClockOutRunningPeriod: () => true,
		});

		expect(scheduleXEvent?._customContent?.timeGrid).toContain(
			"data-running-clock-out-button",
		);
		expect(scheduleXEvent?._customContent?.timeGrid).toContain(
			'data-work-period-id="work-running-action"',
		);
		expect(scheduleXEvent?._customContent?.timeGrid).toContain(
			'aria-label="Stop running work period for Kai Hentschel"',
		);
		expect(scheduleXEvent?._customContent?.timeGrid).toContain("Stop");
	});

	it("escapes the contextual stop button accessible label", () => {
		const runningPeriod: WorkPeriodEvent = {
			id: "work-running-action-escaped",
			type: "work_period",
			date: new Date("2026-05-18T14:48:00.000Z"),
			endDate: new Date("2026-05-18T14:51:00.000Z"),
			title: "Fallback <unsafe>",
			color: "#10b981",
			metadata: {
				durationMinutes: 3,
				employeeName: 'Ada "The Countess" Lovelace & Team',
				isRunning: true,
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(runningPeriod, "UTC", {
			canClockOutRunningPeriod: () => true,
		});

		expect(scheduleXEvent?._customContent?.timeGrid).toContain(
			'aria-label="Stop running work period for Ada &quot;The Countess&quot; Lovelace &amp; Team"',
		);
	});

	it("does not render a stop button for unauthorized running work periods", () => {
		const runningPeriod: WorkPeriodEvent = {
			id: "work-running-action-denied",
			type: "work_period",
			date: new Date("2026-05-18T14:48:00.000Z"),
			endDate: new Date("2026-05-18T14:51:00.000Z"),
			title: "Kai Hentschel - 3m (running)",
			color: "#10b981",
			metadata: {
				durationMinutes: 3,
				employeeName: "Kai Hentschel",
				isRunning: true,
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(runningPeriod, "UTC", {
			canClockOutRunningPeriod: () => false,
		});

		expect(scheduleXEvent?._customContent?.timeGrid).not.toContain(
			"data-running-clock-out-button",
		);
		expect(scheduleXEvent?._customContent?.timeGrid).not.toContain("Stop");
	});

	it("uses different saved offsets for travel work-period endpoints", () => {
		const workPeriod: WorkPeriodEvent = {
			id: "work-travel",
			type: "work_period",
			date: new Date("2026-05-18T06:00:00.000Z"),
			endDate: new Date("2026-05-18T11:00:00.000Z"),
			title: "Work period",
			color: "#10b981",
			metadata: {
				durationMinutes: 300,
				employeeName: "Kai Hentschel",
				clockInUtcOffsetMinutes: 120,
				clockInTimezone: "Europe/Berlin",
				clockOutUtcOffsetMinutes: -300,
				clockOutTimezone: "America/New_York",
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(workPeriod, "UTC");

		expect(scheduleXEvent?.start.toString()).toBe("2026-05-18T08:00:00+00:00[UTC]");
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-18T13:00:00+00:00[UTC]");
		expect(scheduleXEvent?._customContent?.timeGrid).toContain("Europe/Berlin (UTC+02:00)");
		expect(scheduleXEvent?._customContent?.timeGrid).toContain("America/New_York (UTC-05:00)");
	});

	it("falls back to the configured calendar timezone when saved offsets are missing", () => {
		const workPeriod: WorkPeriodEvent = {
			id: "work-fallback",
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

		expect(scheduleXEvent?.start.toString()).toBe("2026-05-18T03:40:00-04:00[America/New_York]");
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-18T11:40:00-04:00[America/New_York]");
	});

	it("keeps single-day holidays on one Schedule-X full-day date", () => {
		const holiday: HolidayEvent = {
			id: "holiday-1",
			type: "holiday",
			date: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-01T23:59:59.999Z"),
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
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-01");
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

	it("renders time-entry markers at their saved offset wall-clock time", () => {
		const timeEntry: TimeEntryEvent = {
			id: "clock-in-berlin",
			type: "time_entry",
			date: new Date("2026-05-26T05:00:00.000Z"),
			title: "Kai Hentschel - Clock In",
			color: "#10b981",
			metadata: {
				entryType: "clock_in",
				employeeName: "Kai Hentschel",
				time: "07:00",
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(timeEntry, "UTC");

		expect(scheduleXEvent?.start.toString()).toBe("2026-05-26T07:00:00+00:00[UTC]");
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-26T07:30:00+00:00[UTC]");
	});
});

describe("generateBreakEvents", () => {
	it("renders generated breaks between saved wall-clock work-period times", () => {
		const firstPeriod: WorkPeriodEvent = {
			id: "work-utc-plus-two-morning",
			type: "work_period",
			date: new Date("2026-05-04T06:00:00.000Z"),
			endDate: new Date("2026-05-04T10:00:00.000Z"),
			title: "Morning work",
			color: "#10b981",
			metadata: {
				durationMinutes: 240,
				employeeName: "Kai Hentschel",
				clockInUtcOffsetMinutes: 120,
				clockInTimezone: "Europe/Berlin",
				clockOutUtcOffsetMinutes: 120,
				clockOutTimezone: "Europe/Berlin",
			},
		};
		const secondPeriod: WorkPeriodEvent = {
			id: "work-utc-plus-two-afternoon",
			type: "work_period",
			date: new Date("2026-05-04T10:30:00.000Z"),
			endDate: new Date("2026-05-04T15:00:00.000Z"),
			title: "Afternoon work",
			color: "#10b981",
			metadata: {
				durationMinutes: 270,
				employeeName: "Kai Hentschel",
				clockInUtcOffsetMinutes: 120,
				clockInTimezone: "Europe/Berlin",
				clockOutUtcOffsetMinutes: 120,
				clockOutTimezone: "Europe/Berlin",
			},
		};

		const scheduleXEvents = [firstPeriod, secondPeriod]
			.map((event) => calendarEventToScheduleX(event, "UTC"))
			.filter((event) => event !== null);

		const [breakEvent] = generateBreakEvents(scheduleXEvents, "UTC");

		expect(breakEvent?.start.toString()).toBe("2026-05-04T12:00:00+00:00[UTC]");
		expect(breakEvent?.end.toString()).toBe("2026-05-04T12:30:00+00:00[UTC]");
		expect(breakEvent?._eventData.date.toISOString()).toBe("2026-05-04T12:00:00.000Z");
		expect(breakEvent?._eventData.endDate?.toISOString()).toBe("2026-05-04T12:30:00.000Z");
	});

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
