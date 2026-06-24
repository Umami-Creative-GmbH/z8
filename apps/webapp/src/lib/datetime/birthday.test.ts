import { Settings } from "luxon";
import { afterEach, describe, expect, it } from "vitest";
import { formatBirthdayDate } from "./birthday";

describe("birthday date helpers", () => {
	afterEach(() => {
		Settings.defaultZone = "system";
	});

	it("formats selected local calendar dates without shifting them to UTC", () => {
		Settings.defaultZone = "Europe/Berlin";

		expect(formatBirthdayDate(new Date("1987-01-06T23:00:00.000Z"))).toBe("January 7, 1987");
	});
});
