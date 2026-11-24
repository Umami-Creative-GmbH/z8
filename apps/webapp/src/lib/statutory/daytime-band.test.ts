import { describe, expect, it } from "vitest";
import { formatMinuteOfDayForPreference } from "./daytime-band";

describe("formatMinuteOfDayForPreference", () => {
	it("writes a band minute as a 24-hour clock time, the end of the day as 24:00", () => {
		expect(formatMinuteOfDayForPreference(0, "24h")).toBe("00:00");
		expect(formatMinuteOfDayForPreference(6 * 60 + 15, "24h")).toBe("06:15");
		expect(formatMinuteOfDayForPreference(18 * 60, "24h")).toBe("18:00");
		expect(formatMinuteOfDayForPreference(1440, "24h")).toBe("24:00");
	});

	it("writes a band minute as a 12-hour clock time, the end of the day as midnight", () => {
		expect(formatMinuteOfDayForPreference(0, "12h")).toBe("12:00 AM");
		expect(formatMinuteOfDayForPreference(6 * 60 + 15, "12h")).toBe("6:15 AM");
		expect(formatMinuteOfDayForPreference(12 * 60, "12h")).toBe("12:00 PM");
		expect(formatMinuteOfDayForPreference(18 * 60, "12h")).toBe("6:00 PM");
		expect(formatMinuteOfDayForPreference(23 * 60 + 45, "12h")).toBe("11:45 PM");
		expect(formatMinuteOfDayForPreference(1440, "12h")).toBe("12:00 AM");
	});
});
