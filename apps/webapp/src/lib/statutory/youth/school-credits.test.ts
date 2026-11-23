import { describe, expect, it } from "vitest";
import {
	type ApprenticeReleaseDay,
	apprenticeReleaseDays,
} from "../apprenticeship/release-credits";
import { youthSchoolCreditsOf } from "./school-credits";

const day = (
	date: string,
	releaseId: string,
	releaseKind: ApprenticeReleaseDay["releaseKind"],
	minutes: number | null = null,
): ApprenticeReleaseDay => ({
	date,
	releaseId,
	releaseKind,
	credit: minutes === null ? "full_day" : "school_minutes",
	minutes,
});

describe("youthSchoolCreditsOf (§§ 9 Abs. 2, 10 Abs. 2 JArbSchG)", () => {
	it("counts a full school day, an exam day and the day before it as 8 h", () => {
		expect(
			youthSchoolCreditsOf([
				day("2027-03-02", "a", "vocational_school_day"),
				day("2027-03-16", "b", "pre_exam_day"),
				day("2027-03-17", "c", "exam_day"),
			]).map((credit) => [credit.date, credit.minutes]),
		).toEqual([
			["2027-03-02", 480],
			["2027-03-16", 480],
			["2027-03-17", 480],
		]);
	});

	it("counts other school days with their school time including breaks", () => {
		expect(youthSchoolCreditsOf([day("2027-03-04", "a", "vocational_school_day", 180)])).toEqual([
			{ ref: "release:a", date: "2027-03-04", minutes: 180 },
		]);
	});

	it("counts 40 h in each week of a two-week block, whatever range is read", () => {
		const block = apprenticeReleaseDays([
			{
				id: "w",
				releaseKind: "vocational_school_block_week",
				startsOn: "2027-03-01",
				endsOn: "2027-03-12",
				lessonCount: null,
				schoolMinutes: 1500,
			},
		]);
		const all = youthSchoolCreditsOf(block);
		const weekTotal = (monday: string, sunday: string) =>
			all
				.filter((credit) => credit.date >= monday && credit.date <= sunday)
				.reduce((total, credit) => total + credit.minutes, 0);
		expect(weekTotal("2027-03-01", "2027-03-07")).toBe(2400);
		expect(weekTotal("2027-03-08", "2027-03-14")).toBe(2400);
		// Reading only part of the block (as a clock-out does) credits each day the same.
		const firstWeek = youthSchoolCreditsOf(block.filter((day) => day.date < "2027-03-08"));
		expect(firstWeek).toEqual(all.filter((credit) => credit.date < "2027-03-08"));
	});

	it("counts a full block week as 40 h over its days", () => {
		const block = ["2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12"].map(
			(date) => day(date, "w", "vocational_school_block_week"),
		);
		const credits = youthSchoolCreditsOf(block);
		expect(credits.reduce((total, credit) => total + credit.minutes, 0)).toBe(2400);
		expect(credits.every((credit) => credit.minutes === 480)).toBe(true);
	});
});
