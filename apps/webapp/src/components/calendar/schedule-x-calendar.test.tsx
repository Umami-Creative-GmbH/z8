/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
	buildCalendarTimeZoneDate,
	hasExceededPointerDragThreshold,
	isIntentionalRangePointerDown,
	isScheduleXEventElement,
} from "./schedule-x-calendar";

describe("isScheduleXEventElement", () => {
	it.each(["sx__event", "sx__time-grid-event", "sx__date-grid-event"])(
		"identifies %s elements as Schedule-X events",
		(className) => {
			const eventElement = document.createElement("div");
			eventElement.className = className;
			const child = document.createElement("span");
			eventElement.append(child);

			expect(isScheduleXEventElement(child)).toBe(true);
		},
	);

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
