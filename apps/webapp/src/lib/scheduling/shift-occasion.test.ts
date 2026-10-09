import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { shiftInterval, workMatchesShift } from "./shift-occasion";

const at = parseInstant;

describe("shiftInterval", () => {
	it("reads the shift's wall-clock times in the given timezone", () => {
		const interval = shiftInterval(
			{ date: "2026-04-28", startTime: "08:00", endTime: "16:00" },
			"Europe/Berlin",
		);
		expect(interval.start.toString()).toBe("2026-04-28T06:00:00Z");
		expect(interval.end.toString()).toBe("2026-04-28T14:00:00Z");
	});

	it("ends an overnight shift on the next day", () => {
		const interval = shiftInterval(
			{ date: "2026-04-28", startTime: "22:00", endTime: "06:00" },
			"America/New_York",
		);
		expect(interval.start.toString()).toBe("2026-04-29T02:00:00Z");
		expect(interval.end.toString()).toBe("2026-04-29T10:00:00Z");
	});

	it("moves a start inside a spring-forward gap to the first valid instant", () => {
		const interval = shiftInterval(
			{ date: "2026-03-29", startTime: "02:30", endTime: "10:00" },
			"Europe/Berlin",
		);
		expect(interval.start.toString()).toBe("2026-03-29T01:30:00Z");
		expect(interval.end.toString()).toBe("2026-03-29T08:00:00Z");
	});
});

describe("workMatchesShift", () => {
	const shift = { start: at("2026-04-28T08:00:00Z"), end: at("2026-04-28T16:00:00Z") };

	it("matches work started up to two hours before the shift start", () => {
		expect(workMatchesShift(shift, { start: at("2026-04-28T06:00:00Z"), end: null })).toBe(true);
		expect(workMatchesShift(shift, { start: at("2026-04-28T07:30:00Z"), end: null })).toBe(true);
		expect(workMatchesShift(shift, { start: at("2026-04-28T05:59:00Z"), end: null })).toBe(false);
	});

	it("matches work started before the shift end only", () => {
		expect(workMatchesShift(shift, { start: at("2026-04-28T15:59:00Z"), end: null })).toBe(true);
		expect(workMatchesShift(shift, { start: at("2026-04-28T16:00:00Z"), end: null })).toBe(false);
	});

	it("does not match work that ended by the shift start", () => {
		expect(
			workMatchesShift(shift, {
				start: at("2026-04-28T06:30:00Z"),
				end: at("2026-04-28T08:00:00Z"),
			}),
		).toBe(false);
		expect(
			workMatchesShift(shift, {
				start: at("2026-04-28T06:30:00Z"),
				end: at("2026-04-28T08:01:00Z"),
			}),
		).toBe(true);
	});
});
