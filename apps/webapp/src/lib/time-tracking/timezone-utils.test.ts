import { Settings } from "luxon";
import { afterEach, describe, expect, it } from "vitest";
import { getTimezoneAbbreviation } from "./timezone-utils";

const originalNow = Settings.now;
const originalLocale = Settings.defaultLocale;

afterEach(() => {
	Settings.now = originalNow;
	Settings.defaultLocale = originalLocale;
});

describe("getTimezoneAbbreviation", () => {
	it("returns a stable timezone label across server and browser locales", () => {
		Settings.now = () => Date.parse("2026-05-29T12:00:00.000Z");

		Settings.defaultLocale = "en-US";
		const serverLabel = getTimezoneAbbreviation("Europe/Berlin");

		Settings.defaultLocale = "de-DE";
		const clientLabel = getTimezoneAbbreviation("Europe/Berlin");

		expect(clientLabel).toBe(serverLabel);
	});
});
