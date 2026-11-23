/**
 * JArbSchG youth working-time rules (#1993), pure. One evaluator judges planned shifts
 * (Scheduling, Staffing) and recorded work (clock-out compliance) alike, so both surfaces agree.
 *
 * Days are local calendar days in the given zone; a piece of work belongs to the day it starts
 * on, and compliance weeks start on Monday (ADR 0012). Limits come from the statutory baselines
 * in force on each day (`de_jarbschg_*`); a day without baselines is not judged.
 */
import { Temporal } from "temporal-polyfill";
import {
	compareInstants,
	type Instant,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";

export const jarbschgRules = [
	"jarbschg_daily_max",
	"jarbschg_weekly_max",
	"jarbschg_days_per_week",
	"jarbschg_rest_period",
	"jarbschg_uninterrupted",
	"jarbschg_break",
	"jarbschg_night_work",
	"jarbschg_saturday_work",
	"jarbschg_sunday_work",
	"jarbschg_holiday_work",
] as const;
export type JarbschgRule = (typeof jarbschgRules)[number];

/**
 * Rules a statutory sector exception may lift (§§ 14 Abs. 2–7, 16 Abs. 2, 17 Abs. 2, 18 Abs. 2
 * JArbSchG): night, Saturday, Sunday and holiday work. The others are hard limits.
 */
export const jarbschgSectorExceptionRules: ReadonlySet<JarbschgRule> = new Set([
	"jarbschg_night_work",
	"jarbschg_saturday_work",
	"jarbschg_sunday_work",
	"jarbschg_holiday_work",
]);

export function isJarbschgRule(value: string): value is JarbschgRule {
	return (jarbschgRules as readonly string[]).includes(value);
}

/** The legal reference of each rule, shown with its finding and violation. */
export const jarbschgLegalReference: Record<JarbschgRule, string> = {
	jarbschg_daily_max: "§ 8 Abs. 1, 2a JArbSchG",
	jarbschg_weekly_max: "§ 8 Abs. 1 JArbSchG",
	jarbschg_days_per_week: "§ 15 JArbSchG",
	jarbschg_rest_period: "§ 13 JArbSchG",
	jarbschg_uninterrupted: "§ 11 Abs. 2 JArbSchG",
	jarbschg_break: "§ 11 Abs. 1 JArbSchG",
	jarbschg_night_work: "§ 14 JArbSchG",
	jarbschg_saturday_work: "§ 16 JArbSchG",
	jarbschg_sunday_work: "§ 17 JArbSchG",
	jarbschg_holiday_work: "§ 18 JArbSchG",
};

export interface JarbschgLimits {
	readonly maxDailyMinutes: number;
	readonly maxDailyCompensatoryMinutes: number;
	readonly maxWeeklyMinutes: number;
	readonly maxDaysPerWeek: number;
	readonly minRestMinutes: number;
	/** Break due after more than 4.5 h of work (§ 11 Abs. 1 Nr. 1). */
	readonly breakAfter270Minutes: number;
	/** Break due after more than 6 h of work (§ 11 Abs. 1 Nr. 2). */
	readonly breakAfter360Minutes: number;
	readonly minBreakSegmentMinutes: number;
	readonly maxUninterruptedMinutes: number;
	readonly nightStartMinuteOfDay: number;
	readonly nightEndMinuteOfDay: number;
}

/** The work thresholds named by the break baselines `de_jarbschg_break_after_270/360_minutes`. */
const FIRST_BREAK_AFTER_MINUTES = 270;
const SECOND_BREAK_AFTER_MINUTES = 360;

export interface YouthWorkInterval {
	/** What the work is: `shift:<id>`, `proposed:<date>` or `work:<id>`. */
	readonly ref: string;
	readonly start: Instant;
	readonly end: Instant;
	/** Working minutes, breaks excluded. */
	readonly workMinutes: number;
	/** Recorded work; only recorded work is judged for breaks and uninterrupted stretches. */
	readonly recorded: boolean;
	/** For recorded work: the planned shift it belongs to, whose sector exception covers it. */
	readonly plannedShift?: {
		readonly ref: string;
		readonly start: Instant;
		readonly end: Instant;
	};
}

export interface JarbschgBreach {
	readonly rule: JarbschgRule;
	/** The interval the breach is attributed to. */
	readonly ref: string;
	/** Local start day of that interval, `YYYY-MM-DD`. */
	readonly day: string;
	readonly actual: number;
	readonly limit: number;
	readonly unit: "minutes" | "days";
}

export interface JarbschgEvaluationInput {
	readonly timezone: string;
	readonly intervals: readonly YouthWorkInterval[];
	/** Local days that get breaches, `[start, endExclusive)`; earlier days only count toward totals. */
	readonly judged: { readonly start: string; readonly endExclusive: string };
	readonly isMinorOn: (day: PlainDate) => boolean;
	readonly limitsOn: (day: PlainDate) => JarbschgLimits | null;
	/** Local public holiday dates, `YYYY-MM-DD`. */
	readonly holidays: ReadonlySet<string>;
}

/**
 * The working minutes of a planned shift. Shifts carry wall times only, so the minimum youth
 * break (§ 11) is assumed to be taken: the most work that fits in `grossMinutes` with its break.
 */
export function plannedShiftWorkMinutes(
	grossMinutes: number,
	breaks: { readonly first: number; readonly second: number } = { first: 30, second: 60 },
): number {
	const gross = Math.max(0, Math.round(grossMinutes));
	if (gross <= FIRST_BREAK_AFTER_MINUTES) return gross;
	if (gross <= FIRST_BREAK_AFTER_MINUTES + breaks.first) return FIRST_BREAK_AFTER_MINUTES;
	if (gross <= SECOND_BREAK_AFTER_MINUTES + breaks.first) return gross - breaks.first;
	if (gross <= SECOND_BREAK_AFTER_MINUTES + breaks.second) return SECOND_BREAK_AFTER_MINUTES;
	return gross - breaks.second;
}

interface LocatedInterval extends YouthWorkInterval {
	readonly day: PlainDate;
	readonly dayKey: string;
	readonly weekKey: string;
}

const minutesBetween = (from: Instant, to: Instant) =>
	Math.round(from.until(to).total({ unit: "minutes" }));

const elapsedMinutes = (interval: YouthWorkInterval) => minutesBetween(interval.start, interval.end);

function mondayOf(day: PlainDate): PlainDate {
	return day.subtract({ days: day.dayOfWeek - 1 });
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		groups.set(k, [...(groups.get(k) ?? []), item]);
	}
	return groups;
}

/** Minutes of `interval` inside the local night `[nightStart, nightEnd)` of any day it touches. */
function nightOverlapMinutes(
	interval: YouthWorkInterval,
	timezone: string,
	limits: JarbschgLimits,
): number {
	const firstDay = interval.start.toZonedDateTimeISO(timezone).toPlainDate().subtract({ days: 1 });
	const lastDay = interval.end.toZonedDateTimeISO(timezone).toPlainDate();
	const at = (day: PlainDate, minuteOfDay: number) =>
		day
			.toZonedDateTime({
				timeZone: timezone,
				plainTime: Temporal.PlainTime.from({
					hour: Math.floor(minuteOfDay / 60),
					minute: minuteOfDay % 60,
				}),
			})
			.toInstant();
	let overlap = 0;
	for (
		let day = firstDay;
		Temporal.PlainDate.compare(day, lastDay) <= 0;
		day = day.add({ days: 1 })
	) {
		const nightStart = at(day, limits.nightStartMinuteOfDay);
		const nightEnd = at(day.add({ days: 1 }), limits.nightEndMinuteOfDay);
		const from = compareInstants(interval.start, nightStart) > 0 ? interval.start : nightStart;
		const to = compareInstants(interval.end, nightEnd) < 0 ? interval.end : nightEnd;
		if (compareInstants(from, to) < 0) overlap += minutesBetween(from, to);
	}
	return overlap;
}

/** Breaches of the JArbSchG working-time rules on the judged days the employee is a minor. */
export function evaluateJarbschg(input: JarbschgEvaluationInput): JarbschgBreach[] {
	const judgedStart = parsePlainDate(input.judged.start);
	const judgedEnd = parsePlainDate(input.judged.endExclusive);
	const located: LocatedInterval[] = input.intervals
		.map((interval) => {
			const day = interval.start.toZonedDateTimeISO(input.timezone).toPlainDate();
			return {
				...interval,
				day,
				dayKey: day.toString(),
				weekKey: mondayOf(day).toString(),
			};
		})
		.sort((left, right) => compareInstants(left.start, right.start));

	const breaches: JarbschgBreach[] = [];
	const limitsCache = new Map<string, JarbschgLimits | null>();
	const limitsOf = (day: LocatedInterval) => {
		if (!limitsCache.has(day.dayKey)) limitsCache.set(day.dayKey, input.limitsOn(day.day));
		return limitsCache.get(day.dayKey) ?? null;
	};
	/** Limits when the interval's day is judged and youth rules apply on it, else null. */
	const judgedLimits = (interval: LocatedInterval) =>
		Temporal.PlainDate.compare(interval.day, judgedStart) >= 0 &&
		Temporal.PlainDate.compare(interval.day, judgedEnd) < 0 &&
		input.isMinorOn(interval.day)
			? limitsOf(interval)
			: null;
	const breach = (
		rule: JarbschgRule,
		interval: LocatedInterval,
		actual: number,
		limit: number,
		unit: JarbschgBreach["unit"] = "minutes",
	) => breaches.push({ rule, ref: interval.ref, day: interval.dayKey, actual, limit, unit });

	const byDay = groupBy(located, (interval) => interval.dayKey);
	const dayMinutes = (dayKey: string) =>
		(byDay.get(dayKey) ?? []).reduce((total, interval) => total + interval.workMinutes, 0);

	for (const [, weekIntervals] of groupBy(located, (interval) => interval.weekKey)) {
		const monday = mondayOf(weekIntervals[0].day);
		const weekTotal = weekIntervals.reduce((total, interval) => total + interval.workMinutes, 0);
		const workedDays = [...new Set(weekIntervals.map((interval) => interval.dayKey))];

		// § 8 Abs. 1 / 2a: 8 h a day, 8.5 h when another working day (Mon–Fri) is shortened.
		for (const dayKey of workedDays) {
			const dayIntervals = byDay.get(dayKey) ?? [];
			const limits = judgedLimits(dayIntervals[0]);
			if (!limits) continue;
			const total = dayMinutes(dayKey);
			if (total <= limits.maxDailyMinutes) continue;
			const shortenedElsewhere = [0, 1, 2, 3, 4]
				.map((offset) => monday.add({ days: offset }).toString())
				.some((other) => other !== dayKey && dayMinutes(other) < limits.maxDailyMinutes);
			const limit =
				total <= limits.maxDailyCompensatoryMinutes && !shortenedElsewhere
					? limits.maxDailyMinutes
					: limits.maxDailyCompensatoryMinutes;
			if (total <= limit) continue;
			let running = 0;
			for (const interval of dayIntervals) {
				running += interval.workMinutes;
				if (running > limit) breach("jarbschg_daily_max", interval, total, limit);
			}
		}

		// § 8 Abs. 1: 40 h a week; every piece of work beyond the cap is attributed.
		let running = 0;
		for (const interval of weekIntervals) {
			running += interval.workMinutes;
			const limits = judgedLimits(interval);
			if (limits && running > limits.maxWeeklyMinutes) {
				breach("jarbschg_weekly_max", interval, weekTotal, limits.maxWeeklyMinutes);
			}
		}

		// § 15: five working days a week.
		workedDays.forEach((dayKey, index) => {
			for (const interval of byDay.get(dayKey) ?? []) {
				const limits = judgedLimits(interval);
				if (limits && index >= limits.maxDaysPerWeek) {
					breach(
						"jarbschg_days_per_week",
						interval,
						workedDays.length,
						limits.maxDaysPerWeek,
						"days",
					);
				}
			}
		});
	}

	let previousEnd: Instant | null = null;
	for (const [dayKey, dayIntervals] of byDay) {
		const first = dayIntervals[0];
		const limits = judgedLimits(first);

		// § 13: 12 h uninterrupted free time after the end of the daily work.
		if (limits && previousEnd) {
			const rest = minutesBetween(previousEnd, first.start);
			if (rest < limits.minRestMinutes) {
				breach("jarbschg_rest_period", first, Math.max(0, rest), limits.minRestMinutes);
			}
		}
		for (const interval of dayIntervals) {
			if (!previousEnd || compareInstants(interval.end, previousEnd) > 0) {
				previousEnd = interval.end;
			}
		}
		if (!limits) continue;

		// § 11: breaks and uninterrupted work, judged on recorded work only.
		const recorded = dayIntervals.filter((interval) => interval.recorded);
		if (recorded.length > 0) {
			let breakMinutes = 0;
			let blockStart = recorded[0];
			let blockHasInnerBreak = false;
			const closeBlock = (last: LocatedInterval) => {
				const length = minutesBetween(blockStart.start, last.end);
				if (!blockHasInnerBreak && length > limits.maxUninterruptedMinutes) {
					breach("jarbschg_uninterrupted", last, length, limits.maxUninterruptedMinutes);
				}
			};
			recorded.forEach((interval, index) => {
				const innerBreak = elapsedMinutes(interval) - interval.workMinutes;
				if (innerBreak >= limits.minBreakSegmentMinutes) {
					breakMinutes += innerBreak;
					blockHasInnerBreak = true;
				}
				const next = recorded[index + 1];
				const gap = next ? minutesBetween(interval.end, next.start) : 0;
				if (!next || gap >= limits.minBreakSegmentMinutes) {
					closeBlock(interval);
					if (next) {
						breakMinutes += gap;
						blockStart = next;
						blockHasInnerBreak = false;
					}
				}
			});
			const worked = recorded.reduce((total, interval) => total + interval.workMinutes, 0);
			const required =
				worked > SECOND_BREAK_AFTER_MINUTES
					? limits.breakAfter360Minutes
					: worked > FIRST_BREAK_AFTER_MINUTES
						? limits.breakAfter270Minutes
						: 0;
			if (breakMinutes < required) {
				breach("jarbschg_break", recorded[recorded.length - 1], breakMinutes, required);
			}
		}

		for (const interval of dayIntervals) {
			// § 14: no work between 20:00 and 06:00.
			const night = nightOverlapMinutes(interval, input.timezone, limits);
			if (night > 0) breach("jarbschg_night_work", interval, night, 0);
			// §§ 16–18: no work on Saturdays, Sundays or public holidays.
			if (interval.day.dayOfWeek === 6) breach("jarbschg_saturday_work", interval, 1, 0, "days");
			if (interval.day.dayOfWeek === 7) breach("jarbschg_sunday_work", interval, 1, 0, "days");
			if (input.holidays.has(dayKey)) breach("jarbschg_holiday_work", interval, 1, 0, "days");
		}
	}

	const startOf = new Map(located.map((interval) => [interval.ref, interval.start]));
	const ruleOrder = (rule: JarbschgRule) => jarbschgRules.indexOf(rule);
	return breaches.sort(
		(left, right) =>
			left.day.localeCompare(right.day) ||
			compareInstants(startOf.get(left.ref) as Instant, startOf.get(right.ref) as Instant) ||
			ruleOrder(left.rule) - ruleOrder(right.rule),
	);
}
