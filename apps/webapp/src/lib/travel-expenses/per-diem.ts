import { Temporal } from "temporal-polyfill";
import {
	comparePlainDates,
	instantToCanonicalString,
	type PlainDate,
	parsePlainDate,
	parsePlainTimeMinute,
	type ZonedDateTime,
} from "@/lib/datetime/temporal-core";
import { parseIanaTimeZone } from "@/lib/timezone/validation";
import {
	type AllowancePolicySource,
	type AllowancePolicyVersionRecord,
	effectiveVersionOn,
} from "./allowance-policy";
import { formatUnits, parseUnits, STORED_AMOUNT_SCALE, sumUnits } from "./money";
import {
	findPerDiemRuleSet,
	type PerDiemRates,
	type PerDiemRuleSet,
	perDiemRulesOn,
} from "./statutory-per-diem-defaults";
import type { TripDestination } from "./trip-destination";

/**
 * Domestic per diem of a trip (#609). The employee enters when they left and
 * came back (local date, time and zone), whether they stayed overnight away
 * from home, and for every travel day which meals the employer provided and
 * what they paid for them. The server derives each calendar day's eligibility
 * from the verified German rules (`statutory-per-diem-defaults.ts`), prices it
 * with the organization's per diem policy version effective that day, and
 * deducts provided meals, never below zero. Calendar days are local days in
 * the entered zone; absence is measured in real elapsed time (Temporal), so a
 * clock change or the viewer's zone never changes the result.
 *
 * Anything the rules here do not cover (travel abroad, mixed zones, nights at
 * home, longer activity at the same workplace, days outside a verified rule
 * edition, days another report already claims) is reported as `exceptional`
 * with its reasons, for an audited manual calculation (#610), and is never
 * approximated. International rates (#611) extend `PER_DIEM_AREAS` and the
 * daily itinerary (a location per day) rather than replacing this model.
 */

export const PER_DIEM_MEALS = ["breakfast", "lunch", "dinner"] as const;
export type PerDiemMeal = (typeof PER_DIEM_MEALS)[number];

/** Nights between leaving and returning: all away from home, none, or some at home. */
export const PER_DIEM_OVERNIGHT_ANSWERS = ["away", "none", "mixed"] as const;
export type PerDiemOvernight = (typeof PER_DIEM_OVERNIGHT_ANSWERS)[number];

/** Rate areas of a per diem policy version; domestic only until #611. */
export const PER_DIEM_AREAS = ["DE"] as const;
export type PerDiemArea = (typeof PER_DIEM_AREAS)[number];
export const DOMESTIC_PER_DIEM_AREA: PerDiemArea = "DE";

/** IANA zones of German local time (Büsingen am Hochrhein has its own identifier). */
export const DOMESTIC_TIME_ZONES: readonly string[] = ["Europe/Berlin", "Europe/Busingen"];

/** Travel days with meal facts; longer trips exceed three months and are exceptional anyway. */
export const MAX_PER_DIEM_DAYS = 100;
const MAX_PAYMENT_UNITS = BigInt(999_999); // 9999.99
const ZERO = BigInt(0);

export interface PerDiemMealEntry {
	/** The employer, or a third party on its behalf, provided this meal. */
	provided: boolean;
	/** What the employee paid for it (two decimals); only for a provided meal. */
	employeePayment: string | null;
}

export type PerDiemMealDay = { date: string } & Record<PerDiemMeal, PerDiemMealEntry>;

export interface PerDiemItinerary {
	/** Leaving home or the first workplace: local date, time ("HH:mm") and zone. */
	startDate: string | null;
	startTime: string | null;
	startTimeZone: string | null;
	/** Back at home or the first workplace. */
	endDate: string | null;
	endTime: string | null;
	endTimeZone: string | null;
	/** Only asked when the trip spans more than one calendar day. */
	overnight: PerDiemOvernight | null;
	/** The employee states this is a longer activity (over three months) at the same workplace. */
	prolongedWorkplace: boolean;
	/** One entry per travel day, in date order. */
	meals: PerDiemMealDay[];
}

// ---------------------------------------------------------------------------
// Draft input

export interface PerDiemDraftInput {
	startDate: string | null;
	startTime: string | null;
	startTimeZone: string | null;
	endDate: string | null;
	endTime: string | null;
	endTimeZone: string | null;
	overnight: string | null;
	prolongedWorkplace: boolean;
	meals: readonly ({ date: string } & Record<
		PerDiemMeal,
		{ provided: boolean; employeePayment: string | null }
	>)[];
}

export type PerDiemDraftField = Exclude<keyof PerDiemItinerary, "prolongedWorkplace">;

export type PerDiemFieldError =
	| "invalid_date"
	| "invalid_time"
	| "invalid_time_zone"
	| "nonexistent_local_time"
	| "end_before_start"
	| "invalid_overnight"
	| "invalid_meals"
	| "invalid_payment";

export type ParsePerDiemDraftResult =
	| { ok: true; itinerary: PerDiemItinerary }
	| { ok: false; errors: Partial<Record<PerDiemDraftField, PerDiemFieldError>> };

function blankToNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

/** The calendar days from `startDate` to `endDate`, inclusive. */
export function tripDays(startDate: string, endDate: string): string[] {
	const days: string[] = [];
	const end = parsePlainDate(endDate);
	for (
		let day = parsePlainDate(startDate);
		comparePlainDates(day, end) <= 0 && days.length <= MAX_PER_DIEM_DAYS;
		day = day.add({ days: 1 })
	) {
		days.push(day.toString());
	}
	return days;
}

/** A meal payment at two decimals ("1,8" or "1.80"); null when malformed or out of range. */
export function parseMealPayment(value: string): string | null {
	const trimmed = value.trim();
	const normalized = trimmed.includes(".") ? trimmed : trimmed.replace(",", ".");
	if (!/^\d{1,6}(?:\.\d+)?$/.test(normalized)) return null;
	const units = parseUnits(normalized, STORED_AMOUNT_SCALE);
	if (units === null || units < ZERO || units > MAX_PAYMENT_UNITS) return null;
	return formatUnits(units, STORED_AMOUNT_SCALE);
}

function zoned(date: string, time: string, timeZone: string): ZonedDateTime | null {
	try {
		return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(timeZone, {
			disambiguation: "reject",
		});
	} catch {
		return null;
	}
}

export function parsePerDiemDraft(input: PerDiemDraftInput): ParsePerDiemDraftResult {
	const errors: Partial<Record<PerDiemDraftField, PerDiemFieldError>> = {};
	const date = (field: "startDate" | "endDate") => {
		const value = blankToNull(input[field]);
		if (!value) return null;
		try {
			return parsePlainDate(value).toString();
		} catch {
			errors[field] = "invalid_date";
			return null;
		}
	};
	const time = (field: "startTime" | "endTime") => {
		const value = blankToNull(input[field]);
		if (!value) return null;
		try {
			return parsePlainTimeMinute(value).toString({ smallestUnit: "minute" });
		} catch {
			errors[field] = "invalid_time";
			return null;
		}
	};
	const zone = (field: "startTimeZone" | "endTimeZone") => {
		const value = blankToNull(input[field]);
		if (!value) return null;
		try {
			const parsed = parseIanaTimeZone(value);
			// Throws for an unknown zone.
			Temporal.Now.zonedDateTimeISO(parsed);
			return parsed;
		} catch {
			errors[field] = "invalid_time_zone";
			return null;
		}
	};
	const itinerary: PerDiemItinerary = {
		startDate: date("startDate"),
		startTime: time("startTime"),
		startTimeZone: zone("startTimeZone"),
		endDate: date("endDate"),
		endTime: time("endTime"),
		endTimeZone: zone("endTimeZone"),
		overnight: null,
		prolongedWorkplace: input.prolongedWorkplace === true,
		meals: [],
	};

	const overnight = blankToNull(input.overnight);
	if (overnight) {
		if ((PER_DIEM_OVERNIGHT_ANSWERS as readonly string[]).includes(overnight)) {
			itinerary.overnight = overnight as PerDiemOvernight;
		} else errors.overnight = "invalid_overnight";
	}

	const start =
		itinerary.startDate && itinerary.startTime && itinerary.startTimeZone
			? zoned(itinerary.startDate, itinerary.startTime, itinerary.startTimeZone)
			: undefined;
	if (start === null) errors.startTime = "nonexistent_local_time";
	const end =
		itinerary.endDate && itinerary.endTime && itinerary.endTimeZone
			? zoned(itinerary.endDate, itinerary.endTime, itinerary.endTimeZone)
			: undefined;
	if (end === null) errors.endTime = "nonexistent_local_time";
	let rangeValid = true;
	if (start && end && Temporal.Instant.compare(end.toInstant(), start.toInstant()) <= 0) {
		errors.endTime = "end_before_start";
		rangeValid = false;
	} else if (
		itinerary.startDate &&
		itinerary.endDate &&
		comparePlainDates(parsePlainDate(itinerary.endDate), parsePlainDate(itinerary.startDate)) < 0
	) {
		errors.endDate = "end_before_start";
		rangeValid = false;
	}

	const meals = parseMeals(input.meals, rangeValid ? itinerary : null);
	if ("error" in meals) errors.meals = meals.error;
	else itinerary.meals = meals.meals;

	return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, itinerary };
}

function parseMeals(
	input: PerDiemDraftInput["meals"],
	range: Pick<PerDiemItinerary, "startDate" | "endDate"> | null,
): { meals: PerDiemMealDay[] } | { error: PerDiemFieldError } {
	if (!Array.isArray(input) || input.length > MAX_PER_DIEM_DAYS + 1) {
		return { error: "invalid_meals" };
	}
	const seen = new Set<string>();
	const meals: PerDiemMealDay[] = [];
	for (const row of input) {
		let day: PlainDate;
		try {
			day = parsePlainDate(row.date);
		} catch {
			return { error: "invalid_meals" };
		}
		const key = day.toString();
		if (seen.has(key)) return { error: "invalid_meals" };
		seen.add(key);
		if (
			range?.startDate &&
			range.endDate &&
			(comparePlainDates(day, parsePlainDate(range.startDate)) < 0 ||
				comparePlainDates(day, parsePlainDate(range.endDate)) > 0)
		) {
			return { error: "invalid_meals" };
		}
		const entry = { date: key } as PerDiemMealDay;
		for (const meal of PER_DIEM_MEALS) {
			const value = row[meal];
			if (typeof value?.provided !== "boolean") return { error: "invalid_meals" };
			const payment = value.provided ? blankToNull(value.employeePayment) : null;
			const parsedPayment = payment === null ? null : parseMealPayment(payment);
			if (payment !== null && parsedPayment === null) return { error: "invalid_payment" };
			entry[meal] = { provided: value.provided, employeePayment: parsedPayment };
		}
		meals.push(entry);
	}
	return {
		meals: meals.toSorted((left, right) => (left.date < right.date ? -1 : 1)),
	};
}

// ---------------------------------------------------------------------------
// Policy

/** A per diem policy version with its rates per area. */
export interface PerDiemPolicyVersion extends AllowancePolicyVersionRecord {
	rates: Partial<Record<PerDiemArea, PerDiemRates>>;
}

/** The policy version applied to (some days of) a per diem: everything to reproduce them. */
export interface AppliedPerDiemPolicy {
	policyId: string;
	versionId: string;
	effectiveFrom: string;
	currency: string;
	source: AllowancePolicySource;
	area: PerDiemArea;
	rates: PerDiemRates;
}

export type PerDiemPolicyResolution =
	| { status: "found"; policy: AppliedPerDiemPolicy }
	/** No active version covers the date (or it has no domestic rates). */
	| { status: "no_version" };

export function perDiemPolicyResolver(
	versions: readonly PerDiemPolicyVersion[],
): (date: string) => PerDiemPolicyResolution {
	return (date) => {
		const version = effectiveVersionOn(versions, date);
		const rates = version?.rates[DOMESTIC_PER_DIEM_AREA];
		if (!version || !rates) return { status: "no_version" };
		return {
			status: "found",
			policy: {
				policyId: version.policyId,
				versionId: version.id,
				effectiveFrom: version.effectiveFrom,
				currency: version.currency,
				source: { ...version.source },
				area: DOMESTIC_PER_DIEM_AREA,
				rates: { ...rates },
			},
		};
	};
}

/**
 * What submission stamps on a per diem under the report lock: the rule
 * edition and the policy version of every allowance day. Frozen facts and
 * every later compare price from this stamp, never from today's policy.
 */
export interface StampedPerDiemPolicy {
	rulesKey: string;
	/** Policy version ID by allowance day. */
	days: Record<string, string>;
	policies: AppliedPerDiemPolicy[];
}

export function perDiemStampResolver(
	stamp: StampedPerDiemPolicy,
): (date: string) => PerDiemPolicyResolution {
	return (date) => {
		const policy = stamp.policies.find((candidate) => candidate.versionId === stamp.days[date]);
		return policy ? { status: "found", policy } : { status: "no_version" };
	};
}

// ---------------------------------------------------------------------------
// Calculation

export type PerDiemDayType =
	| "single_day"
	| "arrival"
	| "intermediate"
	| "departure"
	| "overnight_start"
	| "overnight_end";

export type PerDiemAllowance = "full_day" | "partial_day" | "none";

export type PerDiemBasis =
	/** Nr. 1: a calendar day of 24 hours away. */
	| "absence_24h"
	/** Nr. 2: arrival or departure day of a trip with an overnight stay. */
	| "travel_day_with_overnight"
	/** Nr. 3: a day without overnight stay and more than 8 hours away. */
	| "absence_over_8h"
	| "absence_8h_or_less"
	/** Nr. 3, second half: the day holding most of an over-night absence. */
	| "overnight_majority"
	| "overnight_minority";

export interface PerDiemDayBreakdown {
	date: string;
	dayType: PerDiemDayType;
	/** Real minutes away on this calendar day. */
	absenceMinutes: number;
	allowance: PerDiemAllowance;
	basis: PerDiemBasis;
	/** The allowance before meal deductions; "0.00" without one. */
	rate: string;
	/** Policy version of the allowance; null when the day has none. */
	versionId: string | null;
	/** Each meal of this day with its deduction (already reduced by the employee's payment). */
	meals: Record<PerDiemMeal, PerDiemMealEntry & { deduction: string }>;
	/** The allowance day this day's meals reduce; null when they reduce none. */
	mealsCountToward: string | null;
	/** Deductions applied to this day's allowance, at most its rate. */
	deductions: string;
	amount: string;
}

export type PerDiemExceptionReason =
	| "international"
	| "mixed_time_zones"
	| "foreign_time_zone"
	| "nights_at_home"
	| "multi_day_without_overnight"
	| "prolonged_workplace"
	| "rules_not_verified"
	| "majority_tie"
	| "overlapping_days";

export type PerDiemCalculation =
	| {
			status: "calculated";
			currency: string;
			/** Sum of the day amounts; "0.00" is a legitimate result. */
			amount: string;
			days: PerDiemDayBreakdown[];
			absence: { startAt: string; endAt: string; minutes: number };
			rules: { key: string; reference: string; version: string };
			policies: AppliedPerDiemPolicy[];
	  }
	/** Required facts are missing; see `perDiemMissingRequirements`. */
	| { status: "incomplete" }
	/** Not covered by the supported rules: an audited manual calculation is needed (#610). */
	| { status: "exceptional"; reasons: PerDiemExceptionReason[]; overlappingDays: string[] }
	/** These allowance days have no policy version: setup is needed. */
	| { status: "policy_missing"; dates: string[] }
	/** A covering version is in another currency; per diem is never converted. */
	| { status: "currency_mismatch"; policyCurrency: string };

export interface PerDiemContext {
	trip: { destinations: readonly TripDestination[] };
	reimbursementCurrency: string;
	resolvePolicy: (date: string) => PerDiemPolicyResolution;
	/** Days other reports of the employee already claim (store-provided; empty when comparing). */
	overlappingDays?: readonly string[];
	/** The stamped rule edition; the edition covering each day otherwise. */
	rulesKey?: string;
}

const MINUTE_NS = BigInt(60_000_000_000);

function minutesBetween(from: ZonedDateTime, to: ZonedDateTime): number {
	return Number((to.toInstant().epochNanoseconds - from.toInstant().epochNanoseconds) / MINUTE_NS);
}

function startOfDay(date: PlainDate, timeZone: string): ZonedDateTime {
	return date.toZonedDateTime({ timeZone });
}

interface DayPlan {
	date: string;
	dayType: PerDiemDayType;
	absenceMinutes: number;
	allowance: PerDiemAllowance;
	basis: PerDiemBasis;
	/** The allowance day this day's meals count toward. */
	mealsCountToward: string | null;
}

function threeMonthsExceeded(startDate: PlainDate, endDate: PlainDate): boolean {
	return comparePlainDates(endDate, startDate.add({ months: 3 })) > 0;
}

/** Day plans of a complete itinerary, or the exceptional reasons. */
function planDays(
	itinerary: PerDiemItinerary,
	start: ZonedDateTime,
	end: ZonedDateTime,
	context: PerDiemContext,
): { days: DayPlan[]; rules: PerDiemRuleSet } | { reasons: PerDiemExceptionReason[] } {
	const reasons: PerDiemExceptionReason[] = [];
	const zone = start.timeZoneId;
	const firstDay = start.toPlainDate();
	const lastDay = end.toPlainDate();
	const span = firstDay.until(lastDay, { largestUnit: "days" }).days;
	if (context.trip.destinations.some((destination) => destination.countryCode !== "DE")) {
		reasons.push("international");
	}
	if (end.timeZoneId !== zone) reasons.push("mixed_time_zones");
	if (!DOMESTIC_TIME_ZONES.includes(zone) || !DOMESTIC_TIME_ZONES.includes(end.timeZoneId)) {
		reasons.push("foreign_time_zone");
	}
	if (span >= 1 && itinerary.overnight === "mixed") reasons.push("nights_at_home");
	if (span >= 2 && itinerary.overnight === "none") reasons.push("multi_day_without_overnight");
	if (itinerary.prolongedWorkplace || threeMonthsExceeded(firstDay, lastDay)) {
		reasons.push("prolonged_workplace");
	}
	const rules = context.rulesKey
		? findPerDiemRuleSet(context.rulesKey)
		: perDiemRulesOn(firstDay.toString());
	const covered =
		rules !== null &&
		comparePlainDates(firstDay, parsePlainDate(rules.validFrom)) >= 0 &&
		comparePlainDates(lastDay, parsePlainDate(rules.validThrough)) <= 0;
	if (!covered) reasons.push("rules_not_verified");
	if (reasons.length > 0 || !rules) return { reasons };

	const threshold = rules.partialDayMinimumExclusiveMinutes;
	if (span === 0) {
		const minutes = minutesBetween(start, end);
		const over = minutes > threshold;
		const date = firstDay.toString();
		return {
			rules,
			days: [
				{
					date,
					dayType: "single_day",
					absenceMinutes: minutes,
					allowance: over ? "partial_day" : "none",
					basis: over ? "absence_over_8h" : "absence_8h_or_less",
					mealsCountToward: over ? date : null,
				},
			],
		};
	}
	const firstMidnight = startOfDay(firstDay.add({ days: 1 }), zone);
	const lastMidnight = startOfDay(lastDay, zone);
	if (itinerary.overnight === "none") {
		// span === 1: one activity over night without an overnight stay.
		const first = minutesBetween(start, firstMidnight);
		const second = minutesBetween(lastMidnight, end);
		const over = first + second > threshold;
		if (over && first === second) return { reasons: ["majority_tie"] };
		const allowanceDay = !over ? null : first > second ? firstDay.toString() : lastDay.toString();
		const plan = (date: string, dayType: PerDiemDayType, minutes: number): DayPlan => ({
			date,
			dayType,
			absenceMinutes: minutes,
			allowance: allowanceDay === date ? "partial_day" : "none",
			basis: !over
				? "absence_8h_or_less"
				: allowanceDay === date
					? "overnight_majority"
					: "overnight_minority",
			mealsCountToward: allowanceDay,
		});
		return {
			rules,
			days: [
				plan(firstDay.toString(), "overnight_start", first),
				plan(lastDay.toString(), "overnight_end", second),
			],
		};
	}
	// Every night away from home (Nr. 1 and 2).
	const days: DayPlan[] = [];
	for (let day = firstDay; comparePlainDates(day, lastDay) <= 0; day = day.add({ days: 1 })) {
		const date = day.toString();
		const isFirst = comparePlainDates(day, firstDay) === 0;
		const isLast = comparePlainDates(day, lastDay) === 0;
		const absenceMinutes = isFirst
			? minutesBetween(start, firstMidnight)
			: isLast
				? minutesBetween(lastMidnight, end)
				: minutesBetween(startOfDay(day, zone), startOfDay(day.add({ days: 1 }), zone));
		days.push({
			date,
			dayType: isFirst ? "arrival" : isLast ? "departure" : "intermediate",
			absenceMinutes,
			allowance: isFirst || isLast ? "partial_day" : "full_day",
			basis: isFirst || isLast ? "travel_day_with_overnight" : "absence_24h",
			mealsCountToward: date,
		});
	}
	return { rules, days };
}

function mealsCover(meals: readonly PerDiemMealDay[], days: readonly string[]): boolean {
	return meals.length === days.length && meals.every((meal, index) => meal.date === days[index]);
}

function units(value: string): bigint {
	const parsed = parseUnits(value, STORED_AMOUNT_SCALE);
	if (parsed === null) throw new RangeError(`Malformed per diem amount: ${value}`);
	return parsed;
}

function money(value: bigint): string {
	return formatUnits(value, STORED_AMOUNT_SCALE);
}

const DEDUCTION_FIELD: Record<PerDiemMeal, keyof PerDiemRates> = {
	breakfast: "breakfastDeduction",
	lunch: "lunchDeduction",
	dinner: "dinnerDeduction",
};

/** A provided meal reduces the allowance by its deduction less the employee's payment, never below 0. */
function mealDeduction(entry: PerDiemMealEntry, meal: PerDiemMeal, rates: PerDiemRates): bigint {
	if (!entry.provided) return ZERO;
	const reduced = units(rates[DEDUCTION_FIELD[meal]]) - units(entry.employeePayment ?? "0.00");
	return reduced > ZERO ? reduced : ZERO;
}

/** The complete start and end of the itinerary as zoned times, or null while incomplete. */
export function perDiemTravelTimes(
	itinerary: PerDiemItinerary,
): { start: ZonedDateTime; end: ZonedDateTime } | null {
	const { startDate, startTime, startTimeZone, endDate, endTime, endTimeZone } = itinerary;
	if (!startDate || !startTime || !startTimeZone || !endDate || !endTime || !endTimeZone) {
		return null;
	}
	const start = zoned(startDate, startTime, startTimeZone);
	const end = zoned(endDate, endTime, endTimeZone);
	if (!start || !end || Temporal.Instant.compare(end.toInstant(), start.toInstant()) <= 0) {
		return null;
	}
	return { start, end };
}

export function calculatePerDiem(
	itinerary: PerDiemItinerary,
	context: PerDiemContext,
): PerDiemCalculation {
	const times = perDiemTravelTimes(itinerary);
	if (!times || context.trip.destinations.length === 0) return { status: "incomplete" };
	const { start, end } = times;
	const multiDay = comparePlainDates(start.toPlainDate(), end.toPlainDate()) !== 0;
	if (multiDay && !itinerary.overnight) return { status: "incomplete" };

	const planned = planDays(itinerary, start, end, context);
	const overlappingDays = [...(context.overlappingDays ?? [])].toSorted();
	if ("reasons" in planned || overlappingDays.length > 0) {
		const reasons = "reasons" in planned ? [...planned.reasons] : [];
		if (overlappingDays.length > 0) reasons.push("overlapping_days");
		return { status: "exceptional", reasons, overlappingDays };
	}
	const { days: plans, rules } = planned;
	if (!mealsCover(itinerary.meals, tripDays(plans[0]?.date ?? "", plans.at(-1)?.date ?? ""))) {
		return { status: "incomplete" };
	}

	const policies = new Map<string, AppliedPerDiemPolicy>();
	const policyOf = new Map<string, AppliedPerDiemPolicy>();
	const missing: string[] = [];
	for (const plan of plans) {
		if (plan.allowance === "none") continue;
		const resolution = context.resolvePolicy(plan.date);
		if (resolution.status !== "found") {
			missing.push(plan.date);
			continue;
		}
		policyOf.set(plan.date, resolution.policy);
		policies.set(resolution.policy.versionId, resolution.policy);
	}
	if (missing.length > 0) return { status: "policy_missing", dates: missing };
	const foreign = [...policies.values()].find(
		(policy) => policy.currency !== context.reimbursementCurrency,
	);
	if (foreign) return { status: "currency_mismatch", policyCurrency: foreign.currency };

	// Deductions of every day's meals, summed per allowance day they count toward.
	const mealRows = new Map(itinerary.meals.map((row) => [row.date, row]));
	const deductionTotals = new Map<string, bigint>();
	const dayMeals = new Map<string, PerDiemDayBreakdown["meals"]>();
	for (const plan of plans) {
		const row = mealRows.get(plan.date);
		const policy = plan.mealsCountToward ? policyOf.get(plan.mealsCountToward) : undefined;
		const meals = {} as PerDiemDayBreakdown["meals"];
		let total = ZERO;
		for (const meal of PER_DIEM_MEALS) {
			const entry = row?.[meal] ?? { provided: false, employeePayment: null };
			const deduction = policy ? mealDeduction(entry, meal, policy.rates) : ZERO;
			total += deduction;
			meals[meal] = { ...entry, deduction: money(deduction) };
		}
		dayMeals.set(plan.date, meals);
		if (plan.mealsCountToward) {
			deductionTotals.set(
				plan.mealsCountToward,
				(deductionTotals.get(plan.mealsCountToward) ?? ZERO) + total,
			);
		}
	}

	const days = plans.map((plan): PerDiemDayBreakdown => {
		const policy = policyOf.get(plan.date);
		const rate = !policy
			? ZERO
			: units(plan.allowance === "full_day" ? policy.rates.fullDay : policy.rates.partialDay);
		const owed = policy ? (deductionTotals.get(plan.date) ?? ZERO) : ZERO;
		const applied = owed > rate ? rate : owed;
		return {
			date: plan.date,
			dayType: plan.dayType,
			absenceMinutes: plan.absenceMinutes,
			allowance: plan.allowance,
			basis: plan.basis,
			rate: money(rate),
			versionId: policy?.versionId ?? null,
			meals: dayMeals.get(plan.date) as PerDiemDayBreakdown["meals"],
			mealsCountToward: plan.mealsCountToward,
			deductions: money(applied),
			amount: money(rate - applied),
		};
	});

	return {
		status: "calculated",
		currency: context.reimbursementCurrency,
		amount: money(sumUnits(days.map((day) => units(day.amount)))),
		days,
		absence: {
			startAt: instantToCanonicalString(start.toInstant()),
			endAt: instantToCanonicalString(end.toInstant()),
			minutes: minutesBetween(start, end),
		},
		rules: { key: rules.key, reference: rules.reference, version: rules.version },
		policies: [...policies.values()],
	};
}

/** The stamp of a calculation: its rule edition and each allowance day's version. */
export function perDiemStampOf(
	calculation: Extract<PerDiemCalculation, { status: "calculated" }>,
): StampedPerDiemPolicy {
	return {
		rulesKey: calculation.rules.key,
		days: Object.fromEntries(
			calculation.days.flatMap((day) => (day.versionId ? [[day.date, day.versionId]] : [])),
		),
		policies: calculation.policies.map((policy) => structuredClone(policy)),
	};
}

// ---------------------------------------------------------------------------
// Requirements and views

export type PerDiemRequirement =
	| "per_diem_start"
	| "per_diem_end"
	| "per_diem_overnight"
	| "per_diem_trip_dates"
	| "per_diem_meals"
	/** Not covered by the supported rules; an authorized manual calculation is needed (#610). */
	| "per_diem_exceptional"
	/** No organization per diem policy covers an allowance day. */
	| "per_diem_policy_missing"
	/** The covering policy is not in the report's reimbursement currency. */
	| "per_diem_currency";

/**
 * What still keeps a per diem from being submittable, in form order. Trip
 * dates are checked only when given (trip reports always give them).
 */
export function perDiemMissingRequirements(
	itinerary: PerDiemItinerary,
	calculation: PerDiemCalculation,
	trip: { startDate?: string | null; endDate?: string | null },
): PerDiemRequirement[] {
	const missing: PerDiemRequirement[] = [];
	if (!itinerary.startDate || !itinerary.startTime || !itinerary.startTimeZone) {
		missing.push("per_diem_start");
	}
	if (!itinerary.endDate || !itinerary.endTime || !itinerary.endTimeZone) {
		missing.push("per_diem_end");
	}
	const multiDay =
		itinerary.startDate !== null &&
		itinerary.endDate !== null &&
		itinerary.startDate !== itinerary.endDate;
	if (multiDay && !itinerary.overnight) missing.push("per_diem_overnight");
	if (
		(trip.startDate !== undefined || trip.endDate !== undefined) &&
		(!trip.startDate ||
			!trip.endDate ||
			trip.startDate !== itinerary.startDate ||
			trip.endDate !== itinerary.endDate)
	) {
		missing.push("per_diem_trip_dates");
	}
	if (
		itinerary.startDate &&
		itinerary.endDate &&
		calculation.status !== "exceptional" &&
		comparePlainDates(parsePlainDate(itinerary.endDate), parsePlainDate(itinerary.startDate)) >=
			0 &&
		!mealsCover(itinerary.meals, tripDays(itinerary.startDate, itinerary.endDate))
	) {
		missing.push("per_diem_meals");
	}
	if (calculation.status === "exceptional") missing.push("per_diem_exceptional");
	if (calculation.status === "policy_missing") missing.push("per_diem_policy_missing");
	if (calculation.status === "currency_mismatch") missing.push("per_diem_currency");
	return missing;
}

/** The per diem facts of a report item as the editor and the totals see them. */
export interface PerDiemItemView {
	itinerary: PerDiemItinerary;
	/** The server's calculation; null when not calculated in this response. */
	calculation: PerDiemCalculation | null;
	/** The calculated amount and its currency ("0.00" counts); null until calculated. */
	amount: string | null;
	currency: string | null;
}

export function perDiemItemView(
	itinerary: PerDiemItinerary,
	calculation: PerDiemCalculation | null,
): PerDiemItemView {
	const calculated = calculation?.status === "calculated" ? calculation : null;
	return {
		itinerary,
		calculation,
		amount: calculated?.amount ?? null,
		currency: calculated?.currency ?? null,
	};
}

const ITINERARY_FIELDS = [
	"startDate",
	"startTime",
	"startTimeZone",
	"endDate",
	"endTime",
	"endTimeZone",
	"overnight",
	"prolongedWorkplace",
] as const satisfies readonly (keyof PerDiemItinerary)[];

/** Whether two itineraries hold the same facts (meal order and JSON key order aside). */
export function samePerDiemItinerary(left: PerDiemItinerary, right: PerDiemItinerary): boolean {
	if (!ITINERARY_FIELDS.every((field) => left[field] === right[field])) return false;
	const byDate = new Map(right.meals.map((day) => [day.date, day]));
	return (
		left.meals.length === right.meals.length &&
		left.meals.every((day) => {
			const other = byDate.get(day.date);
			return (
				other !== undefined &&
				PER_DIEM_MEALS.every(
					(meal) =>
						day[meal].provided === other[meal].provided &&
						day[meal].employeePayment === other[meal].employeePayment,
				)
			);
		})
	);
}

/** An empty itinerary in the trip's zone. */
export function emptyPerDiemItinerary(timeZone: string | null): PerDiemItinerary {
	return {
		startDate: null,
		startTime: null,
		startTimeZone: timeZone,
		endDate: null,
		endTime: null,
		endTimeZone: timeZone,
		overnight: null,
		prolongedWorkplace: false,
		meals: [],
	};
}
