import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import * as helpers from "./holiday-import-helpers";

describe("holiday import helpers", () => {
	it("ignores a stale preview response after a newer selection starts loading", () => {
		const guard = helpers.createRequestVersionGuard();
		const firstRequest = guard.start();
		const secondRequest = guard.start();

		expect(guard.isCurrent(firstRequest)).toBe(false);
		expect(guard.isCurrent(secondRequest)).toBe(true);
	});

	it("ignores a stale preview response after the dialog closes", () => {
		const guard = helpers.createRequestVersionGuard();
		const request = guard.start();
		guard.invalidate();

		expect(guard.isCurrent(request)).toBe(false);
	});

	it("keeps same-name holidays independently selectable", () => {
		const first = helpers.getHolidayIdentity({
			name: "Spring Holiday",
			date: "2026-03-20 00:00:00",
			startDate: "2026-03-20T00:00:00.000Z",
			endDate: "2026-03-21T00:00:00.000Z",
			type: "public",
			region: "north",
			isDuplicate: false,
		});
		const second = helpers.getHolidayIdentity({
			name: "Spring Holiday",
			date: "2026-03-20 00:00:00",
			startDate: "2026-03-20T00:00:00.000Z",
			endDate: "2026-03-21T00:00:00.000Z",
			type: "public",
			region: "south",
			isDuplicate: false,
		});

		expect(first).not.toBe(second);
	});

	it("converts assignment dates from explicit UTC Temporal values", () => {
		const date = helpers.toUtcDate(Temporal.ZonedDateTime.from("2026-01-01T00:00:00+00:00[UTC]"));

		expect(date.toISOString()).toBe("2026-01-01T00:00:00.000Z");
	});

	it("formats the provider business date without shifting its start instant", () => {
		expect(helpers.formatHolidayPreviewDate("2026-05-01 00:00:00", "en-US")).toBe("May 1, 2026");
	});

	it("provides an accessible checkbox label for each holiday", () => {
		expect(
			helpers.getHolidayCheckboxLabel({
				name: "Spring Holiday",
				date: "2026-03-20 00:00:00",
				startDate: "2026-03-19T23:00:00.000Z",
				endDate: "2026-03-20T23:00:00.000Z",
				type: "public",
				isDuplicate: false,
			}),
		).toBe("Spring Holiday, 2026-03-20, public");
	});
});
