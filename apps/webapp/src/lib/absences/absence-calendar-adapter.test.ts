import { describe, expect, it } from "vitest";

import { holidaysToCalendarEvents } from "./absence-calendar-adapter";
import type { Holiday } from "./types";

describe("holidaysToCalendarEvents", () => {
	it("keeps holidays on a single day when the stored end date is next-day midnight", () => {
		const holiday: Holiday = {
			id: "holiday-1",
			name: "Labor Day",
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-02T00:00:00.000Z"),
			categoryId: "category-1",
		};

		const events = holidaysToCalendarEvents([holiday]);

		expect(events).toHaveLength(1);
		expect(events[0]?.date.toISOString()).toBe("2026-05-01T00:00:00.000Z");
	});
});
