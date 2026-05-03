import { describe, expect, it } from "vitest";
import { Settings } from "luxon";
import { getSelectedWorkdayDate } from "./workday-timeline-date";

describe("getSelectedWorkdayDate", () => {
	it("uses a valid YYYY-MM-DD date param in the employee timezone", () => {
		const result = getSelectedWorkdayDate({
			dateParam: "2026-05-03",
			timezone: "Europe/Berlin",
			now: new Date("2026-05-04T10:00:00.000Z"),
		});

		expect(result.dateKey).toBe("2026-05-03");
		expect(result.previousDateKey).toBe("2026-05-02");
		expect(result.nextDateKey).toBe("2026-05-04");
		expect(result.startUtc.toISO()).toBe("2026-05-02T22:00:00.000Z");
		expect(result.endUtc.toISO()).toBe("2026-05-03T21:59:59.999Z");
	});

	it("falls back to today in the employee timezone when the date param is invalid", () => {
		const result = getSelectedWorkdayDate({
			dateParam: "not-a-date",
			timezone: "America/New_York",
			now: new Date("2026-05-04T02:30:00.000Z"),
		});

		expect(result.dateKey).toBe("2026-05-03");
		expect(result.label).toBe("May 3, 2026");
	});

	it("falls back to UTC when the timezone is invalid", () => {
		const result = getSelectedWorkdayDate({
			dateParam: "2026-05-03",
			timezone: "Invalid/Zone",
			now: new Date("2026-05-04T02:30:00.000Z"),
		});

		expect(result.dateKey).toBe("2026-05-03");
		expect(result.todayDateKey).toBe("2026-05-04");
		expect(result.startUtc.toISO()).toBe("2026-05-03T00:00:00.000Z");
		expect(result.endUtc.toISO()).toBe("2026-05-03T23:59:59.999Z");
	});

	it("formats the label in English regardless of the default locale", () => {
		const previousLocale = Settings.defaultLocale;
		Settings.defaultLocale = "de";

		try {
			const result = getSelectedWorkdayDate({
				dateParam: "2026-05-03",
				timezone: "UTC",
				now: new Date("2026-05-04T02:30:00.000Z"),
			});

			expect(result.label).toBe("May 3, 2026");
		} finally {
			Settings.defaultLocale = previousLocale;
		}
	});

	it("falls back to today when the date param is missing", () => {
		const result = getSelectedWorkdayDate({
			dateParam: undefined,
			timezone: "UTC",
			now: new Date("2026-05-04T02:30:00.000Z"),
		});

		expect(result.dateKey).toBe("2026-05-04");
		expect(result.todayDateKey).toBe("2026-05-04");
	});
});
