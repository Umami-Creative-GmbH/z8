/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { WorkPeriodEvent } from "@/lib/calendar/types";
import {
	buildCalendarTimeZoneDate,
	filterEventsForScheduleXView,
	hasExceededPointerDragThreshold,
	isIntentionalRangePointerDown,
	isScheduleXEventElement,
	resolveClickableCalendarEvent,
} from "./schedule-x-calendar";

const completedWorkPeriod: WorkPeriodEvent = {
	id: "work-completed",
	type: "work_period",
	date: new Date("2026-05-18T08:00:00.000Z"),
	endDate: new Date("2026-05-18T16:00:00.000Z"),
	title: "Completed work period",
	color: "#10b981",
	metadata: {
		durationMinutes: 480,
		employeeName: "Kai Hentschel",
	},
};

const runningWorkPeriod: WorkPeriodEvent = {
	id: "work-running",
	type: "work_period",
	date: new Date("2026-05-18T16:30:00.000Z"),
	title: "Running work period",
	color: "#10b981",
	metadata: {
		durationMinutes: 0,
		employeeName: "Kai Hentschel",
		isRunning: true,
	},
};

describe("filterEventsForScheduleXView", () => {
	it("keeps running work periods in day and week views", () => {
		const events = [completedWorkPeriod, runningWorkPeriod];

		expect(filterEventsForScheduleXView(events, "day")).toEqual(events);
		expect(filterEventsForScheduleXView(events, "week")).toEqual(events);
	});

	it("removes only running work periods from month and year views", () => {
		const events = [completedWorkPeriod, runningWorkPeriod];

		expect(filterEventsForScheduleXView(events, "month")).toEqual([completedWorkPeriod]);
		expect(filterEventsForScheduleXView(events, "year")).toEqual([completedWorkPeriod]);
	});
});

describe("resolveClickableCalendarEvent", () => {
	it("returns null for running work periods", () => {
		const events = [
			{ id: runningWorkPeriod.id, _eventData: runningWorkPeriod },
			{ id: completedWorkPeriod.id, _eventData: completedWorkPeriod },
		];

		expect(resolveClickableCalendarEvent(events, { id: runningWorkPeriod.id })).toBeNull();
	});

	it("returns clicked non-running events", () => {
		const events = [
			{ id: runningWorkPeriod.id, _eventData: runningWorkPeriod },
			{ id: completedWorkPeriod.id, _eventData: completedWorkPeriod },
		];

		expect(resolveClickableCalendarEvent(events, { id: completedWorkPeriod.id })).toBe(
			completedWorkPeriod,
		);
	});
});

describe("calendar timezone source", () => {
	it("supports an explicit calendar timezone for timed work periods", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/calendar/schedule-x-calendar.tsx"),
			"utf8",
		);

		expect(source).toContain("timeZone: explicitTimeZone");
		expect(source).toContain("explicitTimeZone ?? viewerTimeZone");
		expect(source).not.toContain("useOrganizationTimezone");
	});
});

describe("isScheduleXEventElement", () => {
	it.each([
		"sx__event",
		"sx__time-grid-event",
		"sx__date-grid-event",
	])("identifies %s elements as Schedule-X events", (className) => {
		const eventElement = document.createElement("div");
		eventElement.className = className;
		const child = document.createElement("span");
		eventElement.append(child);

		expect(isScheduleXEventElement(child)).toBe(true);
	});

	it("does not identify empty grid cells as Schedule-X events", () => {
		const gridCell = document.createElement("div");
		gridCell.className = "sx__time-grid-day";

		expect(isScheduleXEventElement(gridCell)).toBe(false);
	});
});

describe("isIntentionalRangePointerDown", () => {
	it("accepts primary mouse and pen pointerdown events", () => {
		expect(isIntentionalRangePointerDown({ button: 0, pointerType: "mouse" })).toBe(true);
		expect(isIntentionalRangePointerDown({ button: 0, pointerType: "pen" })).toBe(true);
	});

	it("ignores touch and non-primary pointerdown events", () => {
		expect(isIntentionalRangePointerDown({ button: 0, pointerType: "touch" })).toBe(false);
		expect(isIntentionalRangePointerDown({ button: 1, pointerType: "mouse" })).toBe(false);
		expect(isIntentionalRangePointerDown({ button: 2, pointerType: "pen" })).toBe(false);
	});
});

describe("hasExceededPointerDragThreshold", () => {
	it("requires movement beyond the drag threshold", () => {
		expect(
			hasExceededPointerDragThreshold({ clientX: 10, clientY: 20 }, { clientX: 13, clientY: 22 }),
		).toBe(false);
		expect(
			hasExceededPointerDragThreshold({ clientX: 10, clientY: 20 }, { clientX: 15, clientY: 20 }),
		).toBe(true);
	});
});

describe("buildCalendarTimeZoneDate", () => {
	it("builds range selection instants in the calendar timezone", () => {
		const selectedDate = buildCalendarTimeZoneDate("2026-05-29", 10 * 60 + 15, "Europe/Berlin");

		expect(DateTime.fromJSDate(selectedDate, { zone: "Europe/Berlin" }).toFormat("HH:mm")).toBe(
			"10:15",
		);
		expect(selectedDate.toISOString()).toBe("2026-05-29T08:15:00.000Z");
	});
});
