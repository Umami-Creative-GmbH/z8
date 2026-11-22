import { Settings } from "luxon";
import { describe, expect, it } from "vitest";
import { serializeInstant } from "@/lib/datetime/temporal-wire";
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
		expect(serializeInstant(result.startUtc)).toBe("2026-05-02T22:00:00.000Z");
		expect(serializeInstant(result.endUtc)).toBe("2026-05-03T21:59:59.999Z");
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
		expect(serializeInstant(result.startUtc)).toBe("2026-05-03T00:00:00.000Z");
		expect(serializeInstant(result.endUtc)).toBe("2026-05-03T23:59:59.999Z");
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

	it("formats the workday label using the active locale (de vs en) across DST boundaries", () => {
		const springDe = getSelectedWorkdayDate({
			dateParam: "2026-03-29",
			timezone: "Europe/Berlin",
			locale: "de",
			now: new Date("2026-03-29T10:00:00.000Z"),
		});
		const springEn = getSelectedWorkdayDate({
			dateParam: "2026-03-29",
			timezone: "Europe/Berlin",
			locale: "en",
			now: new Date("2026-03-29T10:00:00.000Z"),
		});

		expect(springDe.label).toBe("29. März 2026");
		expect(springEn.label).toBe("March 29, 2026");
		// Spring-forward day in Europe/Berlin is 23 hours long: 2026-03-28T23:00Z .. 2026-03-29T21:59:59.999Z
		expect(serializeInstant(springDe.startUtc)).toBe("2026-03-28T23:00:00.000Z");
		expect(serializeInstant(springDe.endUtc)).toBe("2026-03-29T21:59:59.999Z");

		const fallDe = getSelectedWorkdayDate({
			dateParam: "2026-10-25",
			timezone: "Europe/Berlin",
			locale: "de",
			now: new Date("2026-10-25T10:00:00.000Z"),
		});
		// Fall-back day in Europe/Berlin is 25 hours long: 2026-10-24T22:00Z .. 2026-10-25T22:59:59.999Z
		expect(fallDe.label).toBe("25. Oktober 2026");
		expect(serializeInstant(fallDe.startUtc)).toBe("2026-10-24T22:00:00.000Z");
		expect(serializeInstant(fallDe.endUtc)).toBe("2026-10-25T22:59:59.999Z");
	});
});
