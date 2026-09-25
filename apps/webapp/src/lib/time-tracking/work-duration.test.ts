import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { deriveWorkDurationMinutes, WorkIntervalError } from "./work-duration";

const start = parseInstant("2026-07-22T08:00:00Z");

function minutesAfter(duration: {
	minutes?: number;
	seconds?: number;
	milliseconds?: number;
	nanoseconds?: number;
}) {
	return deriveWorkDurationMinutes(start, start.add(duration));
}

describe("deriveWorkDurationMinutes", () => {
	it("rounds exact UTC elapsed time to the nearest minute, half up", () => {
		expect(minutesAfter({ minutes: 60, seconds: 40 })).toBe(61);
		expect(minutesAfter({ minutes: 60, seconds: 29, milliseconds: 999 })).toBe(60);
		expect(minutesAfter({ minutes: 60, seconds: 30 })).toBe(61);
		expect(minutesAfter({ seconds: 30 })).toBe(1);
	});

	it("keeps positive work that rounds to zero minutes", () => {
		expect(minutesAfter({ seconds: 29 })).toBe(0);
		expect(minutesAfter({ nanoseconds: 1 })).toBe(0);
	});

	it("rounds each segment on its own", () => {
		expect(minutesAfter({ seconds: 40 }) + minutesAfter({ seconds: 40 })).toBe(2);
	});

	it("does not lose precision on long intervals", () => {
		expect(minutesAfter({ minutes: 60 * 24 * 400, seconds: 29, nanoseconds: 999_999_999 })).toBe(
			60 * 24 * 400 + 0,
		);
		expect(minutesAfter({ minutes: 60 * 24 * 400, seconds: 30 })).toBe(60 * 24 * 400 + 1);
	});

	it("rejects equal or reversed endpoints", () => {
		expect(() => deriveWorkDurationMinutes(start, start)).toThrow(WorkIntervalError);
		expect(() => deriveWorkDurationMinutes(start, start.subtract({ seconds: 1 }))).toThrow(
			WorkIntervalError,
		);
	});
});
