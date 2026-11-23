import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	type ApprenticeReleaseDay,
	apprenticeReleaseDays,
} from "../apprenticeship/release-credits";
import { evaluateJarbschg, type JarbschgLimits } from "./jarbschg-rules";
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

	it("marks the school days of a full block-release week, where 2 h of training a week are allowed", () => {
		expect(
			youthSchoolCreditsOf([
				day("2027-03-08", "a", "vocational_school_block_week"),
				day("2027-03-15", "b", "vocational_school_block_week", 180),
				day("2027-03-16", "c", "pre_exam_day"),
			]).map((credit) => [credit.date, credit.blockReleaseWeek ?? false]),
		).toEqual([
			["2027-03-08", true],
			["2027-03-15", false],
			["2027-03-16", false],
		]);
	});

	it("counts a day at most once: a full release absorbs a school day on the same date", () => {
		expect(
			youthSchoolCreditsOf([
				day("2027-03-03", "a", "pre_exam_day"),
				day("2027-03-03", "b", "vocational_school_day"),
				day("2027-03-04", "c", "vocational_school_day", 200),
				day("2027-03-04", "d", "exam_day", 150),
			]).map((credit) => [credit.date, credit.minutes]),
		).toEqual([
			["2027-03-03", 480],
			["2027-03-04", 200],
		]);
	});

	it("never counts more than one working day on a date when judging the week", () => {
		const limits: JarbschgLimits = {
			maxDailyMinutes: 480,
			maxDailyCompensatoryMinutes: 510,
			maxWeeklyMinutes: 2400,
			maxDaysPerWeek: 5,
			minRestMinutes: 720,
			breakAfter270Minutes: 30,
			breakAfter360Minutes: 60,
			minBreakSegmentMinutes: 15,
			maxUninterruptedMinutes: 270,
			nightStartMinuteOfDay: 1200,
			nightEndMinuteOfDay: 360,
		};
		const zone = "Europe/Berlin";
		const at = (date: string, time: string) =>
			Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone).toInstant();
		// Mon, Tue and Fri 8 h of work; Wed a pre-exam day and a school day; Thu the exam.
		const breaches = evaluateJarbschg({
			timezone: zone,
			intervals: ["2027-03-01", "2027-03-02", "2027-03-05"].map((date) => ({
				ref: `shift:${date}`,
				start: at(date, "08:00"),
				end: at(date, "17:00"),
				workMinutes: 480,
				recorded: false,
			})),
			judged: { start: "2027-03-01", endExclusive: "2027-03-08" },
			isMinorOn: () => true,
			limitsOn: () => limits,
			holidays: new Set(),
			credits: [
				{ ref: "release:pre", date: "2027-03-03", minutes: 480 },
				{ ref: "release:school", date: "2027-03-03", minutes: 480 },
				{ ref: "release:exam", date: "2027-03-04", minutes: 480 },
			],
		});
		expect(breaches.map((breach) => breach.rule)).not.toContain("jarbschg_weekly_max");
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

	it("counts full days with the employee's average working day (§ 9 Abs. 2 Nr. 1, § 10 Abs. 2 Nr. 2)", () => {
		const average = { dailyMinutes: 420, weeklyMinutes: 2100 };
		expect(
			youthSchoolCreditsOf([
				{ ...day("2027-03-02", "a", "vocational_school_day"), averageWorkingTime: average },
				{ ...day("2027-03-16", "b", "pre_exam_day"), averageWorkingTime: average },
				{ ...day("2027-03-17", "c", "exam_day"), averageWorkingTime: average },
				// School time is credited as it is, whatever the average.
				{ ...day("2027-03-04", "d", "vocational_school_day", 180), averageWorkingTime: average },
			]).map((credit) => [credit.date, credit.minutes]),
		).toEqual([
			["2027-03-02", 420],
			["2027-03-16", 420],
			["2027-03-17", 420],
			["2027-03-04", 180],
		]);
	});

	it("counts a full block week with the employee's average working week (§ 9 Abs. 2 Nr. 2)", () => {
		const block = ["2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12"].map(
			(date) => ({
				...day(date, "w", "vocational_school_block_week"),
				averageWorkingTime: { dailyMinutes: 450, weeklyMinutes: 1950 },
			}),
		);
		const credits = youthSchoolCreditsOf(block);
		expect(credits.every((credit) => credit.minutes === 390)).toBe(true);
	});

	it("keeps a 35 h minor with a full school day lawful on four 8 h 15 min days", () => {
		const ZONE = "Europe/Berlin";
		const at = (date: string, time: string) =>
			Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(ZONE).toInstant();
		const limits: JarbschgLimits = {
			maxDailyMinutes: 480,
			maxDailyCompensatoryMinutes: 510,
			maxWeeklyMinutes: 2400,
			maxDaysPerWeek: 5,
			minRestMinutes: 720,
			breakAfter270Minutes: 30,
			breakAfter360Minutes: 60,
			minBreakSegmentMinutes: 15,
			maxUninterruptedMinutes: 270,
			nightStartMinuteOfDay: 1200,
			nightEndMinuteOfDay: 360,
		};
		// Monday 1 March 2027 is the full school day; Tuesday to Friday 08:00–17:15 with 60 min
		// of breaks: 8 h 15 min of work each. 7 h + 4 × 8 h 15 min = 40 h.
		const shifts = ["2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05"].map((date) => ({
			ref: `shift:${date}`,
			start: at(date, "08:00"),
			end: at(date, "17:15"),
			workMinutes: 495,
			recorded: false,
		}));
		const breaches = (average: { dailyMinutes: number; weeklyMinutes: number } | null) =>
			evaluateJarbschg({
				timezone: ZONE,
				intervals: shifts,
				judged: { start: "2027-03-01", endExclusive: "2027-03-08" },
				isMinorOn: () => true,
				limitsOn: () => limits,
				holidays: new Set(),
				credits: youthSchoolCreditsOf([
					{
						...day("2027-03-01", "school", "vocational_school_day"),
						averageWorkingTime: average,
					},
				]),
			}).map((breach) => breach.rule);

		expect(breaches({ dailyMinutes: 420, weeklyMinutes: 2100 })).toEqual([]);
		// Without a known average the school day counts 8 h: no shortened day, and 41 h a week.
		expect(breaches(null)).toContain("jarbschg_weekly_max");
	});

	it("does not flag the weekly maximum after a block ending mid-week (2–18 Mar)", () => {
		const ZONE = "Europe/Berlin";
		const at = (date: string, time: string) =>
			Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(ZONE).toInstant();
		const block = apprenticeReleaseDays([
			{
				id: "w",
				releaseKind: "vocational_school_block_week",
				startsOn: "2026-03-02",
				endsOn: "2026-03-18",
				lessonCount: null,
				schoolMinutes: 1500,
				examStartTime: null,
			},
		]);
		const credits = youthSchoolCreditsOf(block);
		// Week 3 (Mon–Wed): 3/5 of the weekly 25 h.
		expect(
			credits
				.filter((credit) => credit.date >= "2026-03-16")
				.reduce((total, credit) => total + credit.minutes, 0),
		).toBe(900);
		// Thursday and Friday back at work, 8 h each: 15 h + 16 h stays within 40 h.
		const work = ["2026-03-19", "2026-03-20"].map((date) => ({
			ref: `shift:${date}`,
			start: at(date, "08:00"),
			end: at(date, "17:00"),
			workMinutes: 480,
			recorded: false,
		}));
		const rules = evaluateJarbschg({
			timezone: ZONE,
			intervals: work,
			judged: { start: "2026-03-16", endExclusive: "2026-03-23" },
			isMinorOn: () => true,
			limitsOn: () => ({
				maxDailyMinutes: 480,
				maxDailyCompensatoryMinutes: 510,
				maxWeeklyMinutes: 2400,
				maxDaysPerWeek: 5,
				minRestMinutes: 720,
				breakAfter270Minutes: 30,
				breakAfter360Minutes: 60,
				minBreakSegmentMinutes: 15,
				maxUninterruptedMinutes: 270,
				nightStartMinuteOfDay: 1200,
				nightEndMinuteOfDay: 360,
			}),
			holidays: new Set(),
			credits,
		}).map((breach) => breach.rule);
		expect(rules).not.toContain("jarbschg_weekly_max");
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
