import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { type Instant, parsePlainDate, type PlainDate } from "@/lib/datetime/temporal-core";
import {
	evaluateJarbschg,
	type JarbschgLimits,
	plannedShiftWorkMinutes,
	type YouthCreditedTime,
	type YouthWorkInterval,
} from "./jarbschg-rules";

const ZONE = "Europe/Berlin";

/** The seeded DE baselines (#1988). */
const LIMITS: JarbschgLimits = {
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

function at(date: string, time: string): Instant {
	return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(ZONE).toInstant();
}

let counter = 0;
/** A planned shift of wall times on `date` (end at or before start = next day). */
function shift(date: string, start: string, end: string): YouthWorkInterval {
	const startAt = at(date, start);
	let endAt = at(date, end);
	if (Temporal.Instant.compare(endAt, startAt) <= 0) {
		endAt = at(parsePlainDate(date).add({ days: 1 }).toString(), end);
	}
	const gross = startAt.until(endAt).total({ unit: "minutes" });
	counter += 1;
	return {
		ref: `shift:${counter}`,
		start: startAt,
		end: endAt,
		workMinutes: plannedShiftWorkMinutes(gross, BREAKS),
		recorded: false,
	};
}

const BREAKS = { first: LIMITS.breakAfter270Minutes, second: LIMITS.breakAfter360Minutes };

/** Recorded work without inner breaks. */
function work(date: string, start: string, end: string): YouthWorkInterval {
	const planned = shift(date, start, end);
	return {
		...planned,
		ref: planned.ref.replace("shift:", "work:"),
		workMinutes: planned.start.until(planned.end).total({ unit: "minutes" }),
		recorded: true,
	};
}

function evaluate(
	intervals: YouthWorkInterval[],
	options: {
		judged?: { start: string; endExclusive: string };
		report?: "judged_days" | "touching_judged_days";
		minorUntil?: string;
		holidays?: string[];
		credits?: YouthCreditedTime[];
	} = {},
) {
	const adultFrom = options.minorUntil ? parsePlainDate(options.minorUntil) : null;
	return evaluateJarbschg({
		timezone: ZONE,
		intervals,
		credits: options.credits,
		judged: options.judged ?? { start: "2026-03-02", endExclusive: "2026-03-09" },
		report: options.report,
		isMinorOn: (day: PlainDate) =>
			adultFrom === null || Temporal.PlainDate.compare(day, adultFrom) < 0,
		limitsOn: () => LIMITS,
		holidays: new Set(options.holidays ?? []),
	});
}

const rules = (breaches: ReturnType<typeof evaluate>) => breaches.map((breach) => breach.rule);

describe("plannedShiftWorkMinutes", () => {
	it("assumes the statutory minimum youth break is taken within a planned shift", () => {
		expect(plannedShiftWorkMinutes(240, BREAKS)).toBe(240);
		expect(plannedShiftWorkMinutes(285, BREAKS)).toBe(270);
		expect(plannedShiftWorkMinutes(330, BREAKS)).toBe(300);
		expect(plannedShiftWorkMinutes(400, BREAKS)).toBe(360);
		expect(plannedShiftWorkMinutes(540, BREAKS)).toBe(480);
		expect(plannedShiftWorkMinutes(600, BREAKS)).toBe(540);
	});

	it("deducts the break baselines in force, not fixed 30 / 60 minutes", () => {
		const breaks = { first: 20, second: 45 };
		expect(plannedShiftWorkMinutes(300, breaks)).toBe(280);
		expect(plannedShiftWorkMinutes(540, breaks)).toBe(495);
	});
});

describe("evaluateJarbschg", () => {
	it("accepts a lawful youth week: five 8 h days 08:00–17:00 with a 1 h break", () => {
		const week = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"];
		expect(evaluate(week.map((day) => shift(day, "08:00", "17:00")))).toEqual([]);
	});

	it("flags more than 8.5 h on a day", () => {
		const breaches = evaluate([shift("2026-03-02", "07:00", "17:00")]);
		expect(breaches).toEqual([
			expect.objectContaining({
				rule: "jarbschg_daily_max",
				day: "2026-03-02",
				actual: 540,
				limit: 510,
				unit: "minutes",
			}),
		]);
	});

	it("allows 8.5 h when another working day of the week is shortened, else flags it", () => {
		const compensated = evaluate([
			shift("2026-03-02", "08:00", "17:30"),
			shift("2026-03-03", "08:00", "15:00"),
			shift("2026-03-04", "08:00", "17:00"),
			shift("2026-03-05", "08:00", "17:00"),
			shift("2026-03-06", "08:00", "17:00"),
		]);
		expect(compensated).toEqual([]);

		const uncompensated = evaluate(
			["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"].map((day) =>
				shift(day, "08:00", "17:30"),
			),
		);
		expect(rules(uncompensated).filter((rule) => rule === "jarbschg_daily_max")).toHaveLength(5);
		expect(uncompensated).toContainEqual(
			expect.objectContaining({ rule: "jarbschg_daily_max", actual: 510, limit: 480 }),
		);
		expect(uncompensated).toContainEqual(
			expect.objectContaining({
				rule: "jarbschg_weekly_max",
				day: "2026-03-06",
				actual: 2550,
				limit: 2400,
			}),
		);
	});

	it("flags a sixth working day and the work beyond 40 h on it", () => {
		const breaches = evaluate(
			["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07"].map(
				(day) => shift(day, "09:00", "13:00"),
			),
		);
		expect(breaches).toContainEqual(
			expect.objectContaining({
				rule: "jarbschg_days_per_week",
				day: "2026-03-07",
				actual: 6,
				limit: 5,
				unit: "days",
			}),
		);
		expect(breaches).toContainEqual(
			expect.objectContaining({ rule: "jarbschg_saturday_work", day: "2026-03-07" }),
		);
	});

	it("flags less than 12 h of rest between working days", () => {
		const breaches = evaluate([
			shift("2026-03-02", "10:00", "19:00"),
			shift("2026-03-03", "06:00", "14:00"),
		]);
		expect(breaches).toEqual([
			expect.objectContaining({
				rule: "jarbschg_rest_period",
				day: "2026-03-03",
				actual: 660,
				limit: 720,
			}),
		]);
	});

	it("flags night work between 20:00 and 06:00 local time", () => {
		const breaches = evaluate([shift("2026-03-02", "13:00", "21:00")]);
		expect(breaches).toEqual([
			expect.objectContaining({ rule: "jarbschg_night_work", day: "2026-03-02", actual: 60 }),
		]);
		expect(rules(evaluate([shift("2026-03-03", "05:30", "12:00")]))).toEqual([
			"jarbschg_night_work",
		]);
	});

	it("flags Sunday and public holiday work", () => {
		expect(rules(evaluate([shift("2026-03-08", "09:00", "13:00")]))).toEqual([
			"jarbschg_sunday_work",
		]);
		expect(
			rules(evaluate([shift("2026-03-04", "09:00", "13:00")], { holidays: ["2026-03-04"] })),
		).toEqual(["jarbschg_holiday_work"]);
	});

	it("flags work on 24 and 31 December after 14:00 as prohibited holiday work (§ 18 Abs. 1)", () => {
		const december = { judged: { start: "2026-12-21", endExclusive: "2027-01-04" } };
		// Thursday 24 December: the morning is lawful, the afternoon is not, and no exception lifts it.
		expect(rules(evaluate([shift("2026-12-24", "09:00", "13:30")], december))).toEqual([]);
		expect(rules(evaluate([shift("2026-12-24", "12:00", "16:00")], december))).toEqual([
			"jarbschg_holiday_prohibited",
		]);
		expect(rules(evaluate([work("2026-12-31", "13:00", "15:00")], december))).toEqual([
			"jarbschg_holiday_prohibited",
		]);
		// Any other day's afternoon is a working day like any other.
		expect(rules(evaluate([shift("2026-12-23", "12:00", "16:00")], december))).toEqual([]);
	});

	it("measures prohibited holiday work in minutes, so longer work on the day is a deeper breach", () => {
		const december = { judged: { start: "2026-12-21", endExclusive: "2027-01-04" } };
		const prohibited = (interval: YouthWorkInterval) =>
			evaluate([interval], december).find(
				(breach) => breach.rule === "jarbschg_holiday_prohibited",
			);
		// 24 December: only the work after 14:00 is prohibited.
		expect(prohibited(shift("2026-12-24", "10:00", "15:00"))).toMatchObject({
			actual: 60,
			limit: 0,
			unit: "minutes",
		});
		expect(prohibited(shift("2026-12-24", "10:00", "19:00"))).toMatchObject({
			actual: 300,
			unit: "minutes",
		});
		// 25 December: the whole day; overnight from 24 December, both parts count.
		expect(prohibited(shift("2026-12-25", "09:00", "13:00"))?.actual).toBe(240);
		expect(prohibited(shift("2026-12-24", "22:00", "02:00"))?.actual).toBe(240);
	});

	it("flags work on 25 December, 1 January, Easter Sunday and 1 May as prohibited (§ 18 Abs. 2)", () => {
		const judged = (day: string) => ({
			judged: { start: day, endExclusive: parsePlainDate(day).add({ days: 1 }).toString() },
		});
		// Friday 25 December and Friday 1 January, also when the holiday calendar lists them.
		expect(
			rules(
				evaluate([shift("2026-12-25", "09:00", "13:00")], {
					...judged("2026-12-25"),
					holidays: ["2026-12-25"],
				}),
			),
		).toEqual(["jarbschg_holiday_prohibited"]);
		expect(rules(evaluate([shift("2027-01-01", "09:00", "13:00")], judged("2027-01-01")))).toEqual([
			"jarbschg_holiday_prohibited",
		]);
		// Saturday 1 May 2027.
		expect(
			rules(
				evaluate([shift("2027-05-01", "09:00", "13:00")], {
					...judged("2027-05-01"),
					holidays: ["2027-05-01"],
				}),
			),
		).toEqual(["jarbschg_saturday_work", "jarbschg_holiday_prohibited"]);
		// Easter Sunday is computed: 28 March 2027 and 16 April 2028, listed by the calendar or not.
		expect(rules(evaluate([shift("2027-03-28", "09:00", "13:00")], judged("2027-03-28")))).toEqual([
			"jarbschg_sunday_work",
			"jarbschg_holiday_prohibited",
		]);
		expect(rules(evaluate([shift("2028-04-16", "09:00", "13:00")], judged("2028-04-16")))).toEqual([
			"jarbschg_sunday_work",
			"jarbschg_holiday_prohibited",
		]);
		// Easter Monday is an ordinary statutory holiday.
		expect(
			rules(
				evaluate([shift("2027-03-29", "09:00", "13:00")], {
					...judged("2027-03-29"),
					holidays: ["2027-03-29"],
				}),
			),
		).toEqual(["jarbschg_holiday_work"]);
	});

	it("judges breaks and uninterrupted work only on recorded work", () => {
		// 6.5 h worked with a 20 min break: 60 min are due after more than 6 h.
		const breaches = evaluate([
			work("2026-03-02", "08:00", "12:40"),
			work("2026-03-02", "13:00", "14:50"),
		]);
		expect(breaches).toEqual([
			expect.objectContaining({ rule: "jarbschg_uninterrupted", actual: 280, limit: 270 }),
			expect.objectContaining({ rule: "jarbschg_break", actual: 20, limit: 60 }),
		]);
		// Gaps under 15 min are no break segment.
		const short = evaluate([
			work("2026-03-03", "08:00", "11:00"),
			work("2026-03-03", "11:10", "13:00"),
		]);
		expect(rules(short)).toEqual(["jarbschg_uninterrupted", "jarbschg_break"]);
	});

	it("reports nothing on lookback days, but counts them toward the week", () => {
		const breaches = evaluate(
			["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"].map((day) =>
				shift(day, "08:00", "17:30"),
			),
			{ judged: { start: "2026-03-06", endExclusive: "2026-03-07" } },
		);
		expect(breaches.every((breach) => breach.day === "2026-03-06")).toBe(true);
		expect(rules(breaches)).toContain("jarbschg_weekly_max");
	});

	it("allows 8.5 h days only while the week stays within 40 h", () => {
		// Mon–Thu 8.5 h + Fri 7.5 h = 41.5 h: Friday is shortened, but the week is too long.
		const breaches = evaluate([
			...["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"].map((day) =>
				shift(day, "08:00", "17:30"),
			),
			shift("2026-03-06", "08:00", "16:30"),
		]);
		const daily = breaches.filter((breach) => breach.rule === "jarbschg_daily_max");
		expect(daily.map((breach) => [breach.day, breach.actual, breach.limit])).toEqual([
			["2026-03-02", 510, 480],
			["2026-03-03", 510, 480],
			["2026-03-04", 510, 480],
			["2026-03-05", 510, 480],
		]);
	});

	it("reports the 8 h limit for a too-long day when no other day is shortened", () => {
		// A 9 h day and four 8 h days: nothing compensates, so the limit is 480, not 510.
		const breaches = evaluate([
			shift("2026-03-02", "07:00", "17:00"),
			...["2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"].map((day) =>
				shift(day, "08:00", "17:00"),
			),
		]);
		expect(breaches).toContainEqual(
			expect.objectContaining({
				rule: "jarbschg_daily_max",
				day: "2026-03-02",
				actual: 540,
				limit: 480,
			}),
		);
	});

	it("measures uninterrupted work by worked minutes, not by wall-clock span", () => {
		// 2 h + 2.5 h around a 10 min pause: 4 h 40 min span, but only 4.5 h worked.
		expect(
			evaluate([work("2026-03-02", "08:00", "10:00"), work("2026-03-02", "10:10", "12:40")]),
		).toEqual([]);
	});

	it("does not carry an earlier break across a short pause into a long stretch", () => {
		// 08:00–11:15 with a 15 min break inside, a 5 min pause, then 4 h 40 min without a break.
		const withInnerBreak: YouthWorkInterval = {
			...work("2026-03-02", "08:00", "11:15"),
			workMinutes: 180,
		};
		const breaches = evaluate([withInnerBreak, work("2026-03-02", "11:20", "16:00")]);
		expect(breaches).toContainEqual(
			expect.objectContaining({ rule: "jarbschg_uninterrupted", actual: 280, limit: 270 }),
		);
	});

	it("flags Saturday, Sunday and holiday work of overnight intervals", () => {
		expect(rules(evaluate([shift("2026-03-06", "18:00", "01:00")]))).toEqual([
			"jarbschg_night_work",
			"jarbschg_saturday_work",
		]);
		expect(rules(evaluate([shift("2026-03-07", "19:00", "01:00")]))).toEqual([
			"jarbschg_night_work",
			"jarbschg_saturday_work",
			"jarbschg_sunday_work",
		]);
		expect(
			rules(evaluate([shift("2026-03-03", "18:00", "01:00")], { holidays: ["2026-03-04"] })),
		).toEqual(["jarbschg_night_work", "jarbschg_holiday_work"]);
		// Ending exactly at midnight does not touch the next day.
		expect(rules(evaluate([shift("2026-03-06", "16:00", "00:00")]))).toEqual([
			"jarbschg_night_work",
		]);
	});

	describe("reporting breaches a judged day causes on other days", () => {
		const monday = { start: "2026-03-02", endExclusive: "2026-03-03" };

		it("reports the rest period a Monday shift cuts short on Tuesday", () => {
			const intervals = [
				shift("2026-03-02", "14:00", "20:00"),
				shift("2026-03-03", "06:00", "12:00"),
			];
			expect(evaluate(intervals, { judged: monday })).toEqual([]);
			expect(evaluate(intervals, { judged: monday, report: "touching_judged_days" })).toEqual([
				expect.objectContaining({ rule: "jarbschg_rest_period", day: "2026-03-03", actual: 600 }),
			]);
		});

		it("reports the weekly maximum and sixth day a Monday shift causes later in the week", () => {
			// Monday 9 h on top of Tue–Sat 36 h over five days.
			const intervals = [
				shift("2026-03-02", "07:00", "17:00"),
				...["2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07"].map((day) =>
					shift(day, "08:00", "16:12"),
				),
			];
			const breaches = evaluate(intervals, { judged: monday, report: "touching_judged_days" });
			expect(breaches).toContainEqual(
				expect.objectContaining({ rule: "jarbschg_weekly_max", day: "2026-03-07", actual: 2700 }),
			);
			expect(breaches).toContainEqual(
				expect.objectContaining({ rule: "jarbschg_days_per_week", day: "2026-03-07", actual: 6 }),
			);
			// Saturday work does not depend on Monday.
			expect(rules(breaches)).not.toContain("jarbschg_saturday_work");
		});

		it("does not report breaches on other days that the judged day does not affect", () => {
			const intervals = [
				shift("2026-03-02", "08:00", "12:00"),
				shift("2026-03-04", "07:00", "18:00"),
			];
			expect(evaluate(intervals, { judged: monday, report: "touching_judged_days" })).toEqual([]);
		});
	});

	it("applies adult rules from the exact 18th birthday", () => {
		const intervals = [
			shift("2026-03-04", "13:00", "22:00"),
			shift("2026-03-05", "13:00", "22:00"),
		];
		const breaches = evaluate(intervals, { minorUntil: "2026-03-05" });
		expect(breaches.map((breach) => [breach.rule, breach.day])).toEqual([
			["jarbschg_night_work", "2026-03-04"],
		]);
	});

	describe("school and exam time counts as working time (§§ 9 Abs. 2, 10 Abs. 2)", () => {
		const school = (date: string, minutes: number): YouthCreditedTime => ({
			ref: `release:${date}`,
			date,
			minutes,
		});

		it("a full school day counts 8 h and a working day: five 8 h shifts break the week", () => {
			const shifts = ["2026-03-02", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07"].map(
				(day) => shift(day, "08:00", "17:00"),
			);
			const breaches = evaluate(shifts, { credits: [school("2026-03-03", 480)] });
			expect(breaches.filter((breach) => breach.day === "2026-03-07").map((b) => b.rule)).toEqual(
				expect.arrayContaining(["jarbschg_weekly_max", "jarbschg_days_per_week"]),
			);
			expect(breaches).toContainEqual(
				expect.objectContaining({ rule: "jarbschg_weekly_max", actual: 2880, limit: 2400 }),
			);
		});

		it("four lessons (3 h) and an 8 h shift on the same day break the daily maximum", () => {
			const breaches = evaluate([shift("2026-03-03", "08:00", "17:00")], {
				credits: [school("2026-03-03", 180)],
			});
			expect(breaches).toEqual([
				expect.objectContaining({ rule: "jarbschg_daily_max", day: "2026-03-03", actual: 660 }),
			]);
		});

		it("a block week counts 40 h: any extra shift breaks the week", () => {
			const block = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"].map(
				(day) => school(day, 480),
			);
			const breaches = evaluate([shift("2026-03-04", "17:00", "19:00")], { credits: block });
			expect(rules(breaches)).toContain("jarbschg_weekly_max");
		});

		it("credited time alone is never a breach", () => {
			expect(evaluate([], { credits: [school("2026-03-03", 480)] })).toEqual([]);
		});
	});

	it("stops judging night and weekend work at midnight before the 18th birthday", () => {
		// Saturday 18:00 → Sunday 02:00; Sunday is the 18th birthday.
		const breaches = evaluate([shift("2026-03-07", "18:00", "02:00")], {
			minorUntil: "2026-03-08",
		});
		expect(breaches.map((breach) => [breach.rule, breach.actual])).toEqual([
			["jarbschg_night_work", 240],
			["jarbschg_saturday_work", 1],
		]);
	});

	it("does not flag a holiday that falls on the 18th birthday after overnight work", () => {
		const breaches = evaluate([shift("2026-03-04", "18:00", "02:00")], {
			minorUntil: "2026-03-05",
			holidays: ["2026-03-05"],
		});
		expect(breaches.map((breach) => [breach.rule, breach.actual])).toEqual([
			["jarbschg_night_work", 240],
		]);
	});
});
