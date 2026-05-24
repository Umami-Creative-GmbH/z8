import { describe, expect, it } from "vitest";
import { getCalendarProvider, getSupportedProviders, isProviderSupported } from "./index";

describe("calendar provider registry", () => {
	it("returns the concrete Google and Microsoft 365 provider implementations", () => {
		expect(getCalendarProvider("google").provider).toBe("google");
		expect(getCalendarProvider("microsoft365").provider).toBe("microsoft365");
	});

	it("lists only implemented providers as supported provider options", () => {
		expect(getSupportedProviders().map((provider) => provider.provider)).toEqual([
			"google",
			"microsoft365",
		]);
	});

	it("throws for calendar providers without implementations", () => {
		expect(() => getCalendarProvider("icloud")).toThrow(
			'Calendar provider "icloud" is not supported',
		);
		expect(() => getCalendarProvider("caldav")).toThrow(
			'Calendar provider "caldav" is not supported',
		);
	});

	it("reports unimplemented calendar providers as unsupported", () => {
		expect(isProviderSupported("icloud")).toBe(false);
		expect(isProviderSupported("caldav")).toBe(false);
	});
});
