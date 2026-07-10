import { describe, expect, it } from "vitest";
import {
	isValidIanaTimeZone,
	isValidTimeZone,
	parseIanaTimeZone,
	parseTimeZone,
} from "./validation";

describe("timezone validation", () => {
	it.each([
		"UTC",
		"Europe/Berlin",
		"America/New_York",
		"Asia/Kathmandu",
	])("accepts %s as a generic timezone", (value) => {
		expect(parseTimeZone(value)).toBe(value);
		expect(isValidTimeZone(value)).toBe(true);
	});

	it("accepts fixed offsets only as generic timezones", () => {
		expect(parseTimeZone("+05:45")).toBe("+05:45");
		expect(isValidTimeZone("+05:45")).toBe(true);
		expect(() => parseIanaTimeZone("+05:45")).toThrow();
		expect(isValidIanaTimeZone("+05:45")).toBe(false);
	});

	it.each([
		"UTC",
		"Europe/Berlin",
		"America/New_York",
		"Asia/Kathmandu",
	])("accepts %s as an IANA timezone", (value) => {
		expect(parseIanaTimeZone(value)).toBe(value);
		expect(isValidIanaTimeZone(value)).toBe(true);
	});

	it.each([
		["undefined", undefined],
		["null", null],
		["a number", 545],
		["empty", ""],
		["whitespace-only", "   "],
		["leading whitespace", " Europe/Berlin"],
		["trailing whitespace", "Europe/Berlin "],
		["an invalid zone", "Not/A_Zone"],
		["a prefixed fixed offset", "UTC+05:45"],
	] as const)("rejects %s timezone input", (_description, value) => {
		expect(() => parseTimeZone(value)).toThrow();
		expect(() => parseIanaTimeZone(value)).toThrow();
		expect(isValidTimeZone(value)).toBe(false);
		expect(isValidIanaTimeZone(value)).toBe(false);
	});
});
