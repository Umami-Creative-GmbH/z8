import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	clipAbsenceDayRange,
	countAbsenceDays,
	type IsWorkingDay,
	mondayToFriday,
} from "./absence-days";
import { workingDaysFrom } from "./working-days";

const closure = {
	id: "closure",
	name: "Closure",
	categoryId: "company",
	startDate: new Date("2026-12-24T00:00:00Z"),
	endDate: new Date("2026-12-25T00:00:00Z"),
};

const withHolidays = (...holidays: (typeof closure)[]) =>
	workingDaysFrom({ assignments: [], holidays });

const range = (
	startDate: string,
	startPeriod: "full_day" | "am" | "pm",
	endDate: string,
	endPeriod: "full_day" | "am" | "pm",
) => ({ startDate, startPeriod, endDate, endPeriod });

const mondayToThursday: IsWorkingDay = (day) => day.dayOfWeek <= 4;
const mondayToSaturday: IsWorkingDay = (day) => day.dayOfWeek <= 6;

describe("countAbsenceDays", () => {
	it("excludes both endpoints of midnight holiday ranges and weekends", () => {
		expect(
			countAbsenceDays(
				range("2026-12-23", "full_day", "2026-12-28", "full_day"),
				withHolidays(closure),
			),
		).toBe(2);
	});

	it("preserves half days on working endpoints without charging holiday endpoints", () => {
		expect(
			countAbsenceDays(range("2026-12-23", "pm", "2026-12-24", "am"), withHolidays(closure)),
		).toBe(0.5);
		expect(
			countAbsenceDays(range("2026-12-24", "pm", "2026-12-28", "am"), withHolidays(closure)),
		).toBe(0.5);
	});

	it("does not subtract duplicated holidays more than once", () => {
		expect(
			countAbsenceDays(
				range("2026-12-23", "full_day", "2026-12-28", "full_day"),
				withHolidays(closure, closure),
			),
		).toBe(2);
	});

	it("counts a single working day inclusively", () => {
		expect(countAbsenceDays(range("2026-12-28", "am", "2026-12-28", "am"), mondayToFriday)).toBe(
			0.5,
		);
	});

	it("counts only the employee's working days", () => {
		// Monday 12 October to Friday 16 October 2026.
		expect(
			countAbsenceDays(range("2026-10-12", "full_day", "2026-10-16", "full_day"), mondayToThursday),
		).toBe(4);
		expect(
			countAbsenceDays(range("2026-10-17", "full_day", "2026-10-17", "full_day"), mondayToSaturday),
		).toBe(1);
	});

	it("counts an afternoon start as half on a working day and nothing on a non-working day", () => {
		// Thursday 15 October is a working day, Friday 16 October is not.
		expect(countAbsenceDays(range("2026-10-15", "pm", "2026-10-15", "pm"), mondayToThursday)).toBe(
			0.5,
		);
		expect(
			countAbsenceDays(range("2026-10-16", "pm", "2026-10-19", "full_day"), mondayToThursday),
		).toBe(1);
		expect(countAbsenceDays(range("2026-10-16", "pm", "2026-10-16", "pm"), mondayToThursday)).toBe(
			0,
		);
	});

	it("asks about each calendar day of the range exactly once", () => {
		const asked: string[] = [];
		countAbsenceDays(range("2026-10-30", "full_day", "2026-11-02", "full_day"), (day) => {
			asked.push(day.toString());
			return true;
		});
		expect(asked).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
	});

	it("rejects an end before the start", () => {
		expect(() =>
			countAbsenceDays(range("2026-10-16", "full_day", "2026-10-15", "full_day"), mondayToFriday),
		).toThrow("Start date must be before or equal to end date");
	});
});

describe("mondayToFriday", () => {
	it("works Monday to Friday", () => {
		const week = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
		for (const day of week) expect(mondayToFriday(Temporal.PlainDate.from(day))).toBe(true);
		expect(mondayToFriday(Temporal.PlainDate.from("2026-10-17"))).toBe(false);
		expect(mondayToFriday(Temporal.PlainDate.from("2026-10-18"))).toBe(false);
	});
});

describe("clipAbsenceDayRange", () => {
	const october = { startDate: "2026-10-01", endDate: "2026-10-31" };

	it("keeps a range inside the window, halves included", () => {
		expect(clipAbsenceDayRange(range("2026-10-12", "pm", "2026-10-16", "am"), october)).toEqual(
			range("2026-10-12", "pm", "2026-10-16", "am"),
		);
	});

	it("cuts the ends outside the window to full days", () => {
		expect(clipAbsenceDayRange(range("2026-09-30", "pm", "2026-11-02", "am"), october)).toEqual(
			range("2026-10-01", "full_day", "2026-10-31", "full_day"),
		);
	});

	it("returns null for a range outside the window", () => {
		expect(
			clipAbsenceDayRange(range("2026-11-02", "full_day", "2026-11-03", "full_day"), october),
		).toBeNull();
	});
});
