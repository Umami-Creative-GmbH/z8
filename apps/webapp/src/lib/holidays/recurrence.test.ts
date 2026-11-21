import { describe, expect, it } from "vitest";
import { holidayStoredDates } from "./recurrence";

function dates(start: string, end: string): string {
	const stored = holidayStoredDates(new Date(start), new Date(end));
	return `${stored.start}..${stored.end}`;
}

describe("holidayStoredDates", () => {
	it("reads UTC-date rows on their UTC dates", () => {
		expect(dates("2026-12-24T00:00:00.000Z", "2026-12-26T00:00:00.000Z")).toBe(
			"2026-12-24..2026-12-26",
		);
		expect(dates("2026-12-25T00:00:00.000Z", "2026-12-25T23:59:59.999Z")).toBe(
			"2026-12-25..2026-12-25",
		);
		expect(dates("2026-12-24T14:37:12.345Z", "2026-12-24T14:37:12.345Z")).toBe(
			"2026-12-24..2026-12-24",
		);
	});

	it("reads imported local-midnight rows on their local dates", () => {
		// Europe/Berlin winter and summer, America/New_York, Asia/Tokyo, Asia/Kolkata.
		expect(dates("2026-12-24T23:00:00.000Z", "2026-12-25T23:00:00.000Z")).toBe(
			"2026-12-25..2026-12-25",
		);
		expect(dates("2026-05-13T22:00:00.000Z", "2026-05-14T22:00:00.000Z")).toBe(
			"2026-05-14..2026-05-14",
		);
		expect(dates("2026-01-01T05:00:00.000Z", "2026-01-02T05:00:00.000Z")).toBe(
			"2026-01-01..2026-01-01",
		);
		expect(dates("2026-12-31T15:00:00.000Z", "2027-01-01T15:00:00.000Z")).toBe(
			"2027-01-01..2027-01-01",
		);
		expect(dates("2026-01-25T18:30:00.000Z", "2026-01-26T18:30:00.000Z")).toBe(
			"2026-01-26..2026-01-26",
		);
	});

	it("reads imported rows of zones 10 to 14 hours from UTC on their local dates", () => {
		// Pacific/Auckland summer time (UTC+13): local midnight is 11:00 UTC the day before.
		expect(dates("2026-12-24T11:00:00.000Z", "2026-12-25T11:00:00.000Z")).toBe(
			"2026-12-25..2026-12-25",
		);
		// Pacific/Auckland standard time (UTC+12).
		expect(dates("2026-06-21T12:00:00.000Z", "2026-06-22T12:00:00.000Z")).toBe(
			"2026-06-22..2026-06-22",
		);
		// Pacific/Chatham summer time (UTC+13:45).
		expect(dates("2026-12-24T10:15:00.000Z", "2026-12-25T10:15:00.000Z")).toBe(
			"2026-12-25..2026-12-25",
		);
		// Pacific/Honolulu (UTC-10): local midnight is 10:00 UTC the same day.
		expect(dates("2026-12-25T10:00:00.000Z", "2026-12-26T10:00:00.000Z")).toBe(
			"2026-12-25..2026-12-25",
		);
	});

	it("keeps an edited end date of an imported row, stored at UTC midnight, inclusive", () => {
		// Imported German Christmas (23:00Z start) whose end was moved to Boxing Day.
		expect(dates("2026-12-24T23:00:00.000Z", "2026-12-26T00:00:00.000Z")).toBe(
			"2026-12-25..2026-12-26",
		);
		expect(dates("2026-12-24T23:00:00.000Z", "2026-12-26T23:59:59.999Z")).toBe(
			"2026-12-25..2026-12-26",
		);
		// An end before the decoded start falls back to the UTC dates.
		expect(dates("2026-12-24T23:00:00.000Z", "2026-12-24T23:59:59.999Z")).toBe(
			"2026-12-24..2026-12-24",
		);
	});

	it("reads an imported multi-day row across a DST change on its local dates", () => {
		expect(dates("2026-10-24T22:00:00.000Z", "2026-10-26T23:00:00.000Z")).toBe(
			"2026-10-25..2026-10-26",
		);
		expect(dates("2026-03-28T23:00:00.000Z", "2026-03-30T22:00:00.000Z")).toBe(
			"2026-03-29..2026-03-30",
		);
	});
});
