import { describe, expect, it } from "vitest";
import {
	formatTimeStringForPreference,
	getTimeFormatDateTimeOptions,
	normalizeTimeFormat,
} from "./time-format";

describe("time format preferences", () => {
	it("defaults unknown values to 24h", () => {
		expect(normalizeTimeFormat(null)).toBe("24h");
		expect(normalizeTimeFormat(undefined)).toBe("24h");
		expect(normalizeTimeFormat("locale")).toBe("24h");
	});

	it("accepts 12h and 24h", () => {
		expect(normalizeTimeFormat("12h")).toBe("12h");
		expect(normalizeTimeFormat("24h")).toBe("24h");
	});

	it("returns Intl options for the selected format", () => {
		expect(getTimeFormatDateTimeOptions("24h")).toEqual({
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
		expect(getTimeFormatDateTimeOptions("12h")).toEqual({
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		});
	});

	it("formats stored HH:mm strings without changing storage values", () => {
		expect(formatTimeStringForPreference("08:00", "24h")).toBe("08:00");
		expect(formatTimeStringForPreference("17:30", "24h")).toBe("17:30");
		expect(formatTimeStringForPreference("08:00", "12h")).toBe("8:00 AM");
		expect(formatTimeStringForPreference("17:30", "12h")).toBe("5:30 PM");
	});

	it("returns invalid HH:mm strings unchanged", () => {
		expect(formatTimeStringForPreference("open", "12h")).toBe("open");
		expect(formatTimeStringForPreference("25:99", "12h")).toBe("25:99");
	});
});
