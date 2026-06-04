import { describe, expect, it } from "vitest";
import { getTimeCorrectionDefaultValues, isValidClockRange } from "./time-correction-dialog-utils";

describe("getTimeCorrectionDefaultValues", () => {
	it("defaults endpoint dates in the employee timezone across UTC/local boundaries", () => {
		const values = getTimeCorrectionDefaultValues(
			{
				id: "work-period-1",
				startTime: new Date("2026-06-03T22:30:00.000Z"),
				endTime: new Date("2026-06-04T01:15:00.000Z"),
				clockOut: { notes: "Fix missed checkout" },
			},
			"Europe/Berlin",
		);

		expect(values).toEqual({
			clockInDate: "2026-06-04",
			clockInTime: "00:30",
			clockOutDate: "2026-06-04",
			clockOutTime: "03:15",
			reason: "Fix missed checkout",
		});
	});
});

describe("isValidClockRange", () => {
	it("validates clock ranges using date and time together", () => {
		expect(isValidClockRange("2026-06-04", "09:00", "2026-06-04", "17:00")).toBe(true);
		expect(isValidClockRange("2026-06-04", "17:00", "2026-06-04", "09:00")).toBe(false);
		expect(isValidClockRange("2026-06-04", "22:00", "2026-06-05", "01:00")).toBe(true);
	});
});
