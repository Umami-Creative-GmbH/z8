import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { type Instant, parsePlainDate, type PlainDate } from "@/lib/datetime/temporal-core";
import {
	evaluateJarbschg,
	type JarbschgLimits,
	plannedShiftWorkMinutes,
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
		workMinutes: plannedShiftWorkMinutes(gross),
		recorded: false,
	};
}

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
		minorUntil?: string;
		holidays?: string[];
	} = {},
) {
	const adultFrom = options.minorUntil ? parsePlainDate(options.minorUntil) : null;
	return evaluateJarbschg({
		timezone: ZONE,
		intervals,
		judged: options.judged ?? { start: "2026-03-02", endExclusive: "2026-03-09" },
		isMinorOn: (day: PlainDate) =>
			adultFrom === null || Temporal.PlainDate.compare(day, adultFrom) < 0,
		limitsOn: () => LIMITS,
		holidays: new Set(options.holidays ?? []),
	});
}

const rules = (breaches: ReturnType<typeof evaluate>) => breaches.map((breach) => breach.rule);

describe("plannedShiftWorkMinutes", () => {
	it("assumes the statutory minimum youth break is taken within a planned shift", () => {
		expect(plannedShiftWorkMinutes(240)).toBe(240);
		expect(plannedShiftWorkMinutes(285)).toBe(270);
		expect(plannedShiftWorkMinutes(330)).toBe(300);
		expect(plannedShiftWorkMinutes(400)).toBe(360);
		expect(plannedShiftWorkMinutes(540)).toBe(480);
		expect(plannedShiftWorkMinutes(600)).toBe(540);
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
});
