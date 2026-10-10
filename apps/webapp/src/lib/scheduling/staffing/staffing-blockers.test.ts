import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import {
	type AbsenceRange,
	absenceOverlapsShift,
	findStaffingBlocker,
	intervalsOverlap,
} from "./staffing-blockers";

const BERLIN = "Europe/Berlin";

function shift(date: string, startTime: string, endTime: string, timezone = BERLIN) {
	return shiftInterval({ date: parsePlainDate(date), startTime, endTime }, timezone);
}

function absence(
	startDate: string,
	startPeriod: AbsenceRange["startPeriod"],
	endDate = startDate,
	endPeriod: AbsenceRange["endPeriod"] = startPeriod,
): AbsenceRange {
	return { startDate, startPeriod, endDate, endPeriod };
}

describe("absenceOverlapsShift", () => {
	it("blocks an afternoon shift but not a morning shift with a pm half day", () => {
		const pm = absence("2026-10-09", "pm");

		expect(absenceOverlapsShift(pm, shift("2026-10-09", "13:00", "17:00"), BERLIN)).toBe(true);
		expect(absenceOverlapsShift(pm, shift("2026-10-09", "08:00", "12:00"), BERLIN)).toBe(false);
		expect(absenceOverlapsShift(pm, shift("2026-10-09", "08:00", "12:01"), BERLIN)).toBe(true);
	});

	it("blocks a morning shift but not an afternoon shift with an am half day", () => {
		const am = absence("2026-10-09", "am");

		expect(absenceOverlapsShift(am, shift("2026-10-09", "08:00", "12:00"), BERLIN)).toBe(true);
		expect(absenceOverlapsShift(am, shift("2026-10-09", "12:00", "18:00"), BERLIN)).toBe(false);
	});

	it("reads the half days as wall-clock times in the organization's zone", () => {
		const pm = absence("2026-10-09", "pm");
		// 09:00-11:30 in New York is 13:00-15:30 UTC: a morning shift there, an afternoon in UTC.
		const morningInNewYork = shift("2026-10-09", "09:00", "11:30", "America/New_York");

		expect(absenceOverlapsShift(pm, morningInNewYork, "America/New_York")).toBe(false);
		expect(absenceOverlapsShift(pm, morningInNewYork, "UTC")).toBe(true);
	});

	it("covers the whole day for a full day and for am to pm on one day", () => {
		expect(
			absenceOverlapsShift(
				absence("2026-10-09", "full_day"),
				shift("2026-10-09", "20:00", "23:00"),
				BERLIN,
			),
		).toBe(true);
		expect(
			absenceOverlapsShift(
				absence("2026-10-09", "am", "2026-10-09", "pm"),
				shift("2026-10-09", "06:00", "08:00"),
				BERLIN,
			),
		).toBe(true);
	});

	it("starts a multi-day absence at noon for pm and ends it at noon for am", () => {
		const range = absence("2026-10-09", "pm", "2026-10-11", "am");

		expect(absenceOverlapsShift(range, shift("2026-10-09", "08:00", "12:00"), BERLIN)).toBe(false);
		expect(absenceOverlapsShift(range, shift("2026-10-10", "08:00", "12:00"), BERLIN)).toBe(true);
		expect(absenceOverlapsShift(range, shift("2026-10-11", "08:00", "11:00"), BERLIN)).toBe(true);
		expect(absenceOverlapsShift(range, shift("2026-10-11", "13:00", "17:00"), BERLIN)).toBe(false);
	});

	it("blocks a shift past midnight that runs into an absence on the next day", () => {
		const nextDay = absence("2026-10-10", "full_day");

		expect(absenceOverlapsShift(nextDay, shift("2026-10-09", "22:00", "06:00"), BERLIN)).toBe(true);
		expect(absenceOverlapsShift(nextDay, shift("2026-10-09", "14:00", "22:00"), BERLIN)).toBe(
			false,
		);
	});

	it("ignores absences on other days", () => {
		expect(
			absenceOverlapsShift(
				absence("2026-10-08", "full_day"),
				shift("2026-10-09", "08:00", "16:00"),
				BERLIN,
			),
		).toBe(false);
	});
});

describe("intervalsOverlap", () => {
	it("finds a shift past midnight overlapping the next day's early shift", () => {
		expect(
			intervalsOverlap(
				shift("2026-10-08", "22:00", "06:00"),
				shift("2026-10-09", "05:00", "13:00"),
			),
		).toBe(true);
	});

	it("does not treat back-to-back shifts as overlapping", () => {
		expect(
			intervalsOverlap(
				shift("2026-10-08", "22:00", "06:00"),
				shift("2026-10-09", "06:00", "14:00"),
			),
		).toBe(false);
	});
});

describe("findStaffingBlocker", () => {
	const target = shift("2026-10-09", "08:00", "16:00");
	const base = {
		isActive: true,
		employmentCoverage: null,
		shiftDate: parsePlainDate("2026-10-09"),
		timezone: BERLIN,
		shift: target,
		approvedAbsences: [],
		otherShifts: [],
	};

	it("returns null for an available employee", () => {
		expect(findStaffingBlocker(base)).toBeNull();
	});

	it("blocks an inactive employee", () => {
		expect(findStaffingBlocker({ ...base, isActive: false })).toBe("notEmployed");
	});

	it("blocks an employee whose employment ended before the shift date", () => {
		expect(
			findStaffingBlocker({
				...base,
				employmentCoverage: [
					{ startedAt: null, endedAt: Temporal.Instant.from("2026-10-08T22:00:00Z") },
				],
			}),
		).toBe("notEmployed");
	});

	it("keeps an employee still employed on the shift date", () => {
		expect(
			findStaffingBlocker({
				...base,
				employmentCoverage: [
					{ startedAt: null, endedAt: Temporal.Instant.from("2026-10-09T10:00:00Z") },
				],
			}),
		).toBeNull();
	});

	it("blocks an approved absence covering the shift", () => {
		expect(findStaffingBlocker({ ...base, approvedAbsences: [absence("2026-10-09", "am")] })).toBe(
			"approvedAbsence",
		);
	});

	it("blocks an overlapping shift", () => {
		expect(
			findStaffingBlocker({ ...base, otherShifts: [shift("2026-10-08", "22:00", "09:00")] }),
		).toBe("overlappingShift");
	});
});
