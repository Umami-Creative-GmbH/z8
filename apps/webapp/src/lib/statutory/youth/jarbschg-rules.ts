/**
 * JArbSchG youth working-time rules (#1993), pure. One evaluator judges planned shifts
 * (Scheduling, Staffing) and recorded work (clock-out compliance) alike, so both surfaces agree.
 *
 * Days are local calendar days in the given zone; a piece of work belongs to the day it starts
 * on, and compliance weeks start on Monday (ADR 0012). Limits come from the statutory baselines
 * in force on each day (`de_jarbschg_*`); a day without baselines is not judged.
 */
import { Temporal } from "temporal-polyfill";
import { compareInstants, type Instant, type PlainDate } from "@/lib/datetime/temporal-core";

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

/** § 18 Abs. 1 JArbSchG: on 24 and 31 December minors may not work after 14:00. */
const EVE_CUTOFF = Temporal.PlainTime.from("14:00");

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
	/** Completed recorded work; only it is judged for breaks and uninterrupted stretches. */
	readonly recorded: boolean;
	/** An open clock-in, counted until now or the end of its shift; never blocks publication. */
	readonly inProgress?: boolean;
	/**
	 * For work and the rest of a partly worked shift: the planned shift it belongs to. A sector
	 * exception acknowledged for that shift covers the work inside the shift's bounds only.
	 */
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
	/**
	 * Night, Saturday, Sunday and holiday breaches of work that belongs to a planned shift: how much
	 * of the breach lies outside the shift's bounds (night minutes, or flagged days the shift does
	 * not touch). Zero when the work stays within the shift.
	 */
	readonly outsidePlannedShift?: number;
}

export interface JarbschgEvaluationInput {
	readonly timezone: string;
	readonly intervals: readonly YouthWorkInterval[];
	/** Local days being judged, `[start, endExclusive)`; other days count toward totals. */
	readonly judged: { readonly start: string; readonly endExclusive: string };
	/**
	 * `judged_days` (default) reports breaches attributed to a judged day. `touching_judged_days`
	 * also reports breaches attributed to other days that work on a judged day helps cause: the
	 * rest period before the next day, and the weekly total, sixth working day and 8.5 h
	 * compensation later in the compliance week. Planning a shift uses it, so a proposal sees what
	 * it breaks on its neighbouring days.
	 */
	readonly report?: "judged_days" | "touching_judged_days";
	readonly isMinorOn: (day: PlainDate) => boolean;
	readonly limitsOn: (day: PlainDate) => JarbschgLimits | null;
	/** Local public holiday dates, `YYYY-MM-DD`. */
	readonly holidays: ReadonlySet<string>;
	/**
	 * School and exam time credited as working time (§§ 9 Abs. 2, 10 Abs. 2 JArbSchG). It counts
	 * toward the day and week and makes its day a working day; breaches are attributed to work.
	 */
	readonly credits?: readonly YouthCreditedTime[];
}

/** Working time credited on a local day without recorded or planned work. */
export interface YouthCreditedTime {
	/** What is credited, e.g. `release:<id>`. */
	readonly ref: string;
	/** Local day, `YYYY-MM-DD`. */
	readonly date: string;
	readonly minutes: number;
}

/**
 * The working minutes of a planned shift. Shifts carry wall times only, so the minimum youth
 * break (§ 11) is assumed to be taken: the most work that fits in `grossMinutes` with its break.
 */
export function plannedShiftWorkMinutes(
	grossMinutes: number,
	/** The break baselines in force (`de_jarbschg_break_after_270/360_minutes`). */
	breaks: { readonly first: number; readonly second: number },
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

const elapsedMinutes = (interval: YouthWorkInterval) =>
	minutesBetween(interval.start, interval.end);

function mondayOf(day: PlainDate): PlainDate {
	return day.subtract({ days: day.dayOfWeek - 1 });
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const group = groups.get(k);
		if (group) group.push(item);
		else groups.set(k, [item]);
	}
	return groups;
}

/** Local days an interval touches: its start day through the day of its last minute. */
function daysTouched(interval: Span, timezone: string): PlainDate[] {
	const first = interval.start.toZonedDateTimeISO(timezone).toPlainDate();
	const lastMoment =
		compareInstants(interval.end, interval.start) > 0
			? interval.end.subtract({ nanoseconds: 1 })
			: interval.start;
	const last = lastMoment.toZonedDateTimeISO(timezone).toPlainDate();
	const days: PlainDate[] = [];
	for (let day = first; Temporal.PlainDate.compare(day, last) <= 0; day = day.add({ days: 1 })) {
		days.push(day);
	}
	return days;
}

type Span = { readonly start: Instant; readonly end: Instant };

/** The parts of `span` before and after `bounds`. */
function partsOutside(span: Span, bounds: Span): Span[] {
	const parts: Span[] = [];
	if (compareInstants(span.start, bounds.start) < 0) {
		parts.push({
			start: span.start,
			end: compareInstants(span.end, bounds.start) < 0 ? span.end : bounds.start,
		});
	}
	if (compareInstants(span.end, bounds.end) > 0) {
		parts.push({
			start: compareInstants(span.start, bounds.end) > 0 ? span.start : bounds.end,
			end: span.end,
		});
	}
	return parts;
}

/** Minutes of `interval` inside the local night `[nightStart, nightEnd)` of any day it touches. */
function nightOverlapMinutes(interval: Span, timezone: string, limits: JarbschgLimits): number {
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
	const isJudged = (dayKey: string) =>
		dayKey >= input.judged.start && dayKey < input.judged.endExclusive;
	const touching = input.report === "touching_judged_days";
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

	/** Each breach with the local days whose work it depends on. */
	const found: { readonly breach: JarbschgBreach; readonly involves: readonly string[] }[] = [];
	const limitsCache = new Map<string, JarbschgLimits | null>();
	/** Limits on the interval's day when youth rules apply on it, else null. */
	const youthLimits = (interval: LocatedInterval) => {
		if (!input.isMinorOn(interval.day)) return null;
		if (!limitsCache.has(interval.dayKey)) {
			limitsCache.set(interval.dayKey, input.limitsOn(interval.day));
		}
		return limitsCache.get(interval.dayKey) ?? null;
	};
	const breach = (
		rule: JarbschgRule,
		interval: LocatedInterval,
		actual: number,
		limit: number,
		unit: JarbschgBreach["unit"] = "minutes",
		involves: readonly string[] = [interval.dayKey],
	) =>
		found.push({
			breach: { rule, ref: interval.ref, day: interval.dayKey, actual, limit, unit },
			involves,
		});

	/** The part of work starting on a minor's day that lies before their 18th birthday. */
	const minorPartOf = (span: Span): Span => {
		for (const day of daysTouched(span, input.timezone).slice(1)) {
			if (input.isMinorOn(day)) continue;
			const adultFrom = day.toZonedDateTime({ timeZone: input.timezone }).toInstant();
			return compareInstants(adultFrom, span.end) < 0
				? { start: span.start, end: adultFrom }
				: span;
		}
		return span;
	};

	const byDay = groupBy(located, (interval) => interval.dayKey);
	/** Credited school and exam minutes per local day. */
	const creditOn = new Map<string, number>();
	for (const credit of input.credits ?? []) {
		if (credit.minutes <= 0) continue;
		creditOn.set(credit.date, (creditOn.get(credit.date) ?? 0) + credit.minutes);
	}
	const dayMinutes = (dayKey: string) =>
		(creditOn.get(dayKey) ?? 0) +
		(byDay.get(dayKey) ?? []).reduce((total, interval) => total + interval.workMinutes, 0);

	for (const weekIntervals of groupBy(located, (interval) => interval.weekKey).values()) {
		const monday = mondayOf(weekIntervals[0].day);
		const weekDays = Array.from({ length: 7 }, (_, offset) =>
			monday.add({ days: offset }).toString(),
		);
		// Credited days are working days (§ 15) whose time counts toward the day and week (§ 8).
		const creditedDays = weekDays.filter((dayKey) => creditOn.has(dayKey));
		const weekCredit = creditedDays.reduce(
			(total, dayKey) => total + (creditOn.get(dayKey) ?? 0),
			0,
		);
		const weekTotal =
			weekCredit + weekIntervals.reduce((total, interval) => total + interval.workMinutes, 0);
		const workDays = new Set(weekIntervals.map((interval) => interval.dayKey));
		const workedDays = weekDays.filter((dayKey) => workDays.has(dayKey) || creditOn.has(dayKey));

		// § 8 Abs. 1 / 2a: 8 h a day; 8.5 h only when other working days (Mon–Fri) of the week are
		// shortened below 8 h so that the week stays within 40 h.
		for (const dayKey of workDays) {
			const dayIntervals = byDay.get(dayKey) ?? [];
			const limits = youthLimits(dayIntervals[0]);
			if (!limits) continue;
			const total = dayMinutes(dayKey);
			if (total <= limits.maxDailyMinutes) continue;
			const shortenedElsewhere = [0, 1, 2, 3, 4]
				.map((offset) => monday.add({ days: offset }).toString())
				.some((other) => other !== dayKey && dayMinutes(other) < limits.maxDailyMinutes);
			const compensated = shortenedElsewhere && weekTotal <= limits.maxWeeklyMinutes;
			const limit = compensated ? limits.maxDailyCompensatoryMinutes : limits.maxDailyMinutes;
			if (total <= limit) continue;
			// Within the 8.5 h allowance the verdict depends on the rest of the week.
			const involves = total <= limits.maxDailyCompensatoryMinutes ? workedDays : [dayKey];
			// School time comes first: the work on top of it breaks the limit.
			let running = creditOn.get(dayKey) ?? 0;
			for (const interval of dayIntervals) {
				running += interval.workMinutes;
				if (running > limit) {
					breach("jarbschg_daily_max", interval, total, limit, "minutes", involves);
				}
			}
		}

		// § 8 Abs. 1: 40 h a week; every piece of work beyond the cap is attributed.
		// Credited school time is fixed, so it counts first and the work on top of it breaks the cap.
		let running = weekCredit;
		const daysSoFar: string[] = [...creditedDays];
		for (const interval of weekIntervals) {
			running += interval.workMinutes;
			if (!daysSoFar.includes(interval.dayKey)) daysSoFar.push(interval.dayKey);
			const limits = youthLimits(interval);
			if (limits && running > limits.maxWeeklyMinutes) {
				breach(
					"jarbschg_weekly_max",
					interval,
					weekTotal,
					limits.maxWeeklyMinutes,
					"minutes",
					daysSoFar.slice(),
				);
			}
		}

		// § 15: five working days a week.
		workedDays.forEach((dayKey, index) => {
			for (const interval of byDay.get(dayKey) ?? []) {
				const limits = youthLimits(interval);
				if (limits && index >= limits.maxDaysPerWeek) {
					breach(
						"jarbschg_days_per_week",
						interval,
						workedDays.length,
						limits.maxDaysPerWeek,
						"days",
						workedDays.slice(0, index + 1),
					);
				}
			}
		});
	}

	let previous: { readonly end: Instant; readonly dayKey: string } | null = null;
	for (const [dayKey, dayIntervals] of byDay) {
		const first = dayIntervals[0];
		const limits = youthLimits(first);

		// § 13: 12 h uninterrupted free time after the end of the daily work.
		if (limits && previous) {
			const rest = minutesBetween(previous.end, first.start);
			if (rest < limits.minRestMinutes) {
				breach("jarbschg_rest_period", first, Math.max(0, rest), limits.minRestMinutes, "minutes", [
					previous.dayKey,
					dayKey,
				]);
			}
		}
		for (const interval of dayIntervals) {
			if (!previous || compareInstants(interval.end, previous.end) > 0) {
				previous = { end: interval.end, dayKey };
			}
		}
		if (!limits) continue;

		// § 11: breaks and uninterrupted work, judged on recorded work only.
		const recorded = dayIntervals.filter((interval) => interval.recorded);
		if (recorded.length > 0) {
			let breakMinutes = 0;
			// Worked minutes since the last break segment, and the longest such stretch of the block.
			let stretch = 0;
			let longest = 0;
			recorded.forEach((interval, index) => {
				const innerBreak = elapsedMinutes(interval) - interval.workMinutes;
				if (innerBreak >= limits.minBreakSegmentMinutes) {
					breakMinutes += innerBreak;
					// Where the break fell is not recorded: assume as late as keeps the stretch lawful.
					const before = Math.min(
						interval.workMinutes,
						Math.max(0, limits.maxUninterruptedMinutes - stretch),
					);
					longest = Math.max(longest, stretch + before);
					stretch = interval.workMinutes - before;
				} else {
					stretch += interval.workMinutes;
				}
				longest = Math.max(longest, stretch);
				const next = recorded[index + 1];
				const gap = next ? minutesBetween(interval.end, next.start) : 0;
				if (!next || gap >= limits.minBreakSegmentMinutes) {
					if (longest > limits.maxUninterruptedMinutes) {
						breach("jarbschg_uninterrupted", interval, longest, limits.maxUninterruptedMinutes);
					}
					breakMinutes += gap;
					stretch = 0;
					longest = 0;
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
			const shift = interval.plannedShift;
			// Overnight work into the 18th birthday is a minor's work only until midnight.
			const minorSpan = minorPartOf(interval);
			const sector = (
				rule: JarbschgRule,
				actual: number,
				unit: JarbschgBreach["unit"],
				outside: number,
			) =>
				found.push({
					breach: {
						rule,
						ref: interval.ref,
						day: interval.dayKey,
						actual,
						limit: 0,
						unit,
						...(shift ? { outsidePlannedShift: outside } : {}),
					},
					involves: [interval.dayKey],
				});
			// § 14: no work between 20:00 and 06:00.
			const night = nightOverlapMinutes(minorSpan, input.timezone, limits);
			if (night > 0) {
				const outside = shift
					? partsOutside(minorSpan, shift).reduce(
							(total, part) => total + nightOverlapMinutes(part, input.timezone, limits),
							0,
						)
					: 0;
				sector("jarbschg_night_work", night, "minutes", outside);
			}
			// §§ 16–18: no work on Saturdays, Sundays or public holidays, overnight work included.
			const touched = daysTouched(minorSpan, input.timezone);
			const shiftDays = shift
				? new Set(daysTouched(shift, input.timezone).map((day) => day.toString()))
				: new Set<string>();
			const flagged = (matches: (day: PlainDate) => boolean) => {
				const days = touched.filter(matches);
				return {
					any: days.length > 0,
					outside: days.filter((day) => !shiftDays.has(day.toString())).length,
				};
			};
			const saturday = flagged((day) => day.dayOfWeek === 6);
			if (saturday.any) sector("jarbschg_saturday_work", 1, "days", saturday.outside);
			const sunday = flagged((day) => day.dayOfWeek === 7);
			if (sunday.any) sector("jarbschg_sunday_work", 1, "days", sunday.outside);
			const holiday = flagged((day) => input.holidays.has(day.toString()));
			// § 18 Abs. 1: on 24 and 31 December no work after 14:00.
			const eves = touched.filter(
				(day) =>
					day.month === 12 &&
					(day.day === 24 || day.day === 31) &&
					!input.holidays.has(day.toString()),
			);
			const afterEveCutoff = (span: Span) =>
				eves.filter((day) => {
					const cutoff = day
						.toZonedDateTime({ timeZone: input.timezone, plainTime: EVE_CUTOFF })
						.toInstant();
					const midnight = day.add({ days: 1 }).toZonedDateTime({ timeZone: input.timezone }).toInstant();
					const from = compareInstants(span.start, cutoff) > 0 ? span.start : cutoff;
					const to = compareInstants(span.end, midnight) < 0 ? span.end : midnight;
					return compareInstants(from, to) < 0;
				}).length;
			const eveDays = afterEveCutoff(minorSpan);
			const eveOutside = shift
				? partsOutside(minorSpan, shift).reduce((total, part) => total + afterEveCutoff(part), 0)
				: 0;
			if (holiday.any || eveDays > 0) {
				sector("jarbschg_holiday_work", 1, "days", holiday.outside + eveOutside);
			}
		}
	}

	const startOf = new Map(located.map((interval) => [interval.ref, interval.start]));
	const ruleOrder = (rule: JarbschgRule) => jarbschgRules.indexOf(rule);
	return found
		.filter(
			({ breach: { day }, involves }) => isJudged(day) || (touching && involves.some(isJudged)),
		)
		.map(({ breach: reported }) => reported)
		.sort(
			(left, right) =>
				left.day.localeCompare(right.day) ||
				compareInstants(startOf.get(left.ref) as Instant, startOf.get(right.ref) as Instant) ||
				ruleOrder(left.rule) - ruleOrder(right.rule),
		);
}
