/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { isScheduleXEventElement } from "./schedule-x-calendar";

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
