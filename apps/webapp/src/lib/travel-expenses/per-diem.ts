import { Temporal } from "temporal-polyfill";
import {
	comparePlainDates,
	type Instant,
	instantToCanonicalString,
	type PlainDate,
	parsePlainDate,
	parsePlainTimeMinute,
	type ZonedDateTime,
} from "@/lib/datetime/temporal-core";
import { parseIanaTimeZone } from "@/lib/timezone/validation";
import type { AllowanceOverrideView } from "./allowance-override";
import { type AllowancePolicyVersionRecord, effectiveVersionOn } from "./allowance-policy";
import { formatUnits, parseUnits, STORED_AMOUNT_SCALE, sumUnits } from "./money";
import {
	type AppliedPerDiemPolicy,
	PER_DIEM_MEALS,
	PER_DIEM_OVERNIGHT_ANSWERS,
	type PerDiemArea,
	type PerDiemItinerary,
	type PerDiemMeal,
	type PerDiemMealDay,
	type PerDiemMealEntry,
	type PerDiemOvernight,
	type StampedPerDiemPolicy,
} from "./per-diem.types";
import {
	isDomesticLocation,
	isOfficialFallbackRule,
	missingLocationDates,
	type PerDiemDestinationRule,
	type PerDiemLocation,
	type PerDiemLocationBasis,
	parsePerDiemLocation,
	perDiemLocationsNeeded,
	rateLocationOfDay,
	resolvePerDiemDestination,
	samePerDiemLocation,
} from "./per-diem-location";
import {
	type ForeignPerDiemTable,
	findForeignPerDiemTable,
	foreignPerDiemTableCovering,
	foreignPerDiemTableCovers,
} from "./statutory-foreign-per-diem";
import {
	findPerDiemRuleSet,
	findStatutoryPerDiemDefault,
	type PerDiemRates,
	type PerDiemRuleSet,
	perDiemRulesOn,
	validityCovers,
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
 * edition) is reported as `exceptional` with its reasons, for an audited
 * manual calculation (#610), and is never approximated. A day another report
 * already pays carries no allowance here (`claimed_in_other_report`); only
 * that day is affected.
 *
 * International trips (#611) answer per travel day where the employee was
 * (`per-diem-location.ts`); each day is priced with the amounts of the
 * location the statutory rules select, from the verified BMF table the
 * organization adopted (`statutory-foreign-per-diem.ts`). Official fallbacks
 * (Luxembourg for unlisted states, the mother country for territories,
 * Austria for whole days in flight) are calculated and marked on the day.
 */

export {
	type AppliedPerDiemPolicy,
	PER_DIEM_MEALS,
	PER_DIEM_OVERNIGHT_ANSWERS,
	type PerDiemArea,
	type PerDiemItinerary,
	type PerDiemMeal,
	type PerDiemMealDay,
	type PerDiemMealEntry,
	type PerDiemOvernight,
	type StampedPerDiemPolicy,
} from "./per-diem.types";

export const DOMESTIC_PER_DIEM_AREA: PerDiemArea = "DE";
export const PER_DIEM_AREA_PATTERN = /^[A-Z]{2}(?::[a-z0-9-]{1,40})?$/;

/** IANA zones of German local time (Büsingen am Hochrhein has its own identifier). */
export const DOMESTIC_TIME_ZONES: readonly string[] = ["Europe/Berlin", "Europe/Busingen"];

/** Travel days with meal facts; longer trips exceed three months and are exceptional anyway. */
export const MAX_PER_DIEM_DAYS = 100;
const MAX_PAYMENT_UNITS = BigInt(999_999); // 9999.99
const ZERO = BigInt(0);

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
	> & {
			/** Daily locations (#611), validated by `parsePerDiemLocation`. */
			night?: unknown;
			activityAbroad?: unknown;
		})[];
}

export type PerDiemDraftField = Exclude<keyof PerDiemItinerary, "prolongedWorkplace">;

export type PerDiemFieldError =
	| "invalid_date"
	| "invalid_time"
	| "invalid_time_zone"
	/** The clocks are put forward over this local time: it never happens on this day. */
	| "nonexistent_local_time"
	/** The clocks are put back over this local time: it happens twice on this day. */
	| "ambiguous_local_time"
	| "end_before_start"
	| "invalid_overnight"
	| "invalid_meals"
	| "invalid_payment"
	| "invalid_location";

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
		const result = zonedLocalTime(date, time, timeZone);
		return typeof result === "string" ? null : result;
	} catch {
		return null;
	}
}

/**
 * The zoned time of an entered local time, or why it has none: skipped by a
 * clock change (`nonexistent_local_time`) or repeated by one
 * (`ambiguous_local_time`). Both are refused rather than guessed.
 */
function zonedLocalTime(
	date: string,
	time: string,
	timeZone: string,
): ZonedDateTime | "nonexistent_local_time" | "ambiguous_local_time" {
	const local = Temporal.PlainDateTime.from(`${date}T${time}`);
	try {
		return local.toZonedDateTime(timeZone, { disambiguation: "reject" });
	} catch {
		// A repeated time keeps its wall-clock reading under either offset; a skipped one is shifted.
		const earlier = local.toZonedDateTime(timeZone, { disambiguation: "earlier" });
		return Temporal.PlainDateTime.compare(earlier.toPlainDateTime(), local) === 0
			? "ambiguous_local_time"
			: "nonexistent_local_time";
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

	const startResult =
		itinerary.startDate && itinerary.startTime && itinerary.startTimeZone
			? zonedLocalTime(itinerary.startDate, itinerary.startTime, itinerary.startTimeZone)
			: undefined;
	if (typeof startResult === "string") errors.startTime = startResult;
	const endResult =
		itinerary.endDate && itinerary.endTime && itinerary.endTimeZone
			? zonedLocalTime(itinerary.endDate, itinerary.endTime, itinerary.endTimeZone)
			: undefined;
	if (typeof endResult === "string") errors.endTime = endResult;
	const start = typeof startResult === "string" ? null : startResult;
	const end = typeof endResult === "string" ? null : endResult;
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
		// Daily locations (#611): stored only when answered, so domestic rows keep their shape.
		for (const field of ["night", "activityAbroad"] as const) {
			const location = parsePerDiemLocation(row[field]);
			if (location === "invalid") return { error: "invalid_location" };
			if (location) entry[field] = location;
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

export type PerDiemPolicyResolution =
	| { status: "found"; policy: AppliedPerDiemPolicy }
	/** No active version covers the date (or it has no rates for the area). */
	| { status: "no_version" };

/** Resolves the policy amounts of an allowance day in a rate area ("DE" unless given). */
export type PerDiemPolicyResolver = (date: string, area?: PerDiemArea) => PerDiemPolicyResolution;

/**
 * The verified foreign table a version's foreign rates come from: only an
 * adopted statutory default carries one, and its rates apply only to days
 * inside that table's edition (a later year needs a new version).
 */
function versionForeignTable(version: PerDiemPolicyVersion): ForeignPerDiemTable | null {
	if (version.source.kind !== "statutory_default" || !version.source.defaultKey) return null;
	const entry = findStatutoryPerDiemDefault(version.source.defaultKey);
	return entry?.foreignTableKey ? findForeignPerDiemTable(entry.foreignTableKey) : null;
}

export function perDiemPolicyResolver(
	versions: readonly PerDiemPolicyVersion[],
): PerDiemPolicyResolver {
	return (date, area = DOMESTIC_PER_DIEM_AREA) => {
		const version = effectiveVersionOn(versions, date);
		const rates = version?.rates[area];
		if (!version || !rates) return { status: "no_version" };
		if (area !== DOMESTIC_PER_DIEM_AREA) {
			const table = versionForeignTable(version);
			if (!table || !foreignPerDiemTableCovers(table, date)) return { status: "no_version" };
		}
		return {
			status: "found",
			policy: {
				policyId: version.policyId,
				versionId: version.id,
				effectiveFrom: version.effectiveFrom,
				currency: version.currency,
				source: { ...version.source },
				area,
				rates: { ...rates },
			},
		};
	};
}

export function perDiemStampResolver(stamp: StampedPerDiemPolicy): PerDiemPolicyResolver {
	return (date, area = DOMESTIC_PER_DIEM_AREA) => {
		const policy = stamp.policies.find(
			(candidate) => candidate.versionId === stamp.days[date] && candidate.area === area,
		);
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
	| "overnight_minority"
	/**
	 * The day would carry an allowance, but another report of the employee
	 * already pays a positive allowance for it: one allowance per calendar day,
	 * so this report pays none for it (see `calculatePerDiem`).
	 */
	| "claimed_in_other_report";

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
	/** Where the day's amounts come from (#611); absent on a domestic trip without daily locations. */
	location?: PerDiemDayLocation;
}

/** The location decision of one travel day (#611), frozen with the breakdown. */
export interface PerDiemDayLocation {
	/** The answer that decided the day, as entered. */
	entered: PerDiemLocation;
	basis: PerDiemLocationBasis;
	/** How the official rules map it to amounts; fallback rules are marked as such. */
	rule: PerDiemDestinationRule;
	/** The policy rate area: "DE", a country or "country:place". */
	area: PerDiemArea;
	/** The country whose amounts apply (e.g. "LU" for an unlisted state). */
	country: string;
	place: string | null;
	/** The applied entry as the official table names it. */
	label: string;
}

export type PerDiemExceptionReason =
	/** Legacy (#609): a destination abroad, before international per diem existed. */
	| "international"
	/** A daily location the official rules do not resolve (#611). */
	| "destination_not_listed"
	/** "Other", or a whole day in flight or at sea that cannot be one (first or last day). */
	| "special_location"
	/** An over-night activity without an overnight stay that involves a place abroad. */
	| "foreign_without_overnight"
	| "mixed_time_zones"
	| "foreign_time_zone"
	| "nights_at_home"
	| "multi_day_without_overnight"
	| "prolonged_workplace"
	| "rules_not_verified"
	| "majority_tie"
	/**
	 * Another report already pays allowances for days of this trip
	 * (`overlappingDays`). Alone it never makes a per diem exceptional: a
	 * calculated per diem marks those days `claimed_in_other_report`. It is
	 * added to the reasons of an otherwise exceptional per diem, so the
	 * manual calculation leaves those days out.
	 */
	| "overlapping_days";

export type PerDiemCalculation =
	| {
			status: "calculated";
			currency: string;
			/** Sum of the day amounts; "0.00" is a legitimate result. */
			amount: string;
			days: PerDiemDayBreakdown[];
			absence: { startAt: string; endAt: string; minutes: number };
			rules: {
				key: string;
				reference: string;
				version: string;
				/** The foreign table edition of the daily locations (#611); absent when all days are domestic. */
				foreignTable?: { key: string; reference: string; version: string };
			};
			policies: AppliedPerDiemPolicy[];
	  }
	/**
	 * Required facts are missing; see `perDiemMissingRequirements`.
	 * `missingLocations`: travel days whose location answers are incomplete (#611).
	 */
	| { status: "incomplete"; missingLocations?: string[] }
	/** Not covered by the supported rules: an audited manual calculation is needed (#610). */
	| {
			status: "exceptional";
			reasons: PerDiemExceptionReason[];
			overlappingDays: string[];
			missingLocations?: string[];
	  }
	/** These allowance days have no policy version: setup is needed. */
	| { status: "policy_missing"; dates: string[] }
	/** A covering version is in another currency; per diem is never converted. */
	| { status: "currency_mismatch"; policyCurrency: string };

export interface PerDiemContext {
	trip: { destinations: readonly TripDestination[] };
	reimbursementCurrency: string;
	resolvePolicy: PerDiemPolicyResolver;
	/**
	 * Days another report of the employee already pays a positive allowance for
	 * (store-provided, `loadPerDiemOverlaps`; from the stamp when comparing).
	 */
	overlappingDays?: readonly string[];
	/** The stamped rule edition; the edition covering each day otherwise. */
	rulesKey?: string;
	/** The stamped foreign table edition (#611); the edition covering the trip otherwise. */
	foreignTableKey?: string;
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
	// Destinations abroad are priced per day from the daily locations (#611), not flagged here.
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
	const covered = rules !== null && validityCovers(rules, firstDay.toString(), lastDay.toString());
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

/**
 * One allowance per calendar day: a day that would carry an allowance here
 * but that another report already pays (a positive allowance there) carries
 * none here, and the meals counting toward it reduce nothing. Only that day
 * is affected; the rest of the trip is calculated as usual.
 *
 * No "highest allowance" netting is applied. R 9.6 Abs. 2 LStR ("Soweit für
 * denselben Kalendertag Verpflegungsmehraufwendungen wegen einer
 * Auswärtstätigkeit oder wegen einer doppelten Haushaltsführung anzuerkennen
 * sind, ist jeweils nur der höchste Pauschbetrag anzusetzen") concerns a trip
 * meeting a double household (§ 9 Abs. 4a Satz 12 EStG), not two trips. For
 * two trips on one day the combined day may be worth more than either report's
 * own day (BMF 25.11.2020 Rz. 49 Beispiel 33: 28 € when the change of trips
 * keeps the employee away for 24 hours, otherwise 14 €), which neither report
 * can decide alone; the day stays visible as claimed, for an administrator's
 * override (#610) when more is owed.
 */
function withoutClaimedAllowances(
	plans: readonly DayPlan[],
	claimedDays: readonly string[],
): DayPlan[] {
	const claimedElsewhere = new Set(claimedDays);
	const claimed = new Set(
		plans
			.filter((plan) => plan.allowance !== "none" && claimedElsewhere.has(plan.date))
			.map((plan) => plan.date),
	);
	if (claimed.size === 0) return [...plans];
	return plans.map((plan) => ({
		...plan,
		...(claimed.has(plan.date)
			? { allowance: "none" as const, basis: "claimed_in_other_report" as const }
			: {}),
		mealsCountToward:
			plan.mealsCountToward && claimed.has(plan.mealsCountToward) ? null : plan.mealsCountToward,
	}));
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

	// Trips abroad answer per travel day where the employee was (#611).
	const dates = tripDays(start.toPlainDate().toString(), end.toPlainDate().toString());
	const locationsNeeded = perDiemLocationsNeeded(itinerary.meals, context.trip.destinations);
	const missingLocations = locationsNeeded ? missingLocationDates(dates, itinerary.meals) : [];

	const planned = planDays(itinerary, start, end, context);
	// Days of this trip another report already pays; an exceptional result names them for the manual calculation.
	const tripDates = new Set(dates);
	const overlappingDays = [...new Set(context.overlappingDays ?? [])]
		.filter((date) => tripDates.has(date))
		.toSorted();
	const exceptional = (reasons: readonly PerDiemExceptionReason[]): PerDiemCalculation => ({
		status: "exceptional",
		reasons: overlappingDays.length > 0 ? [...reasons, "overlapping_days"] : [...reasons],
		overlappingDays,
		...(missingLocations.length > 0 ? { missingLocations } : {}),
	});
	if ("reasons" in planned) return exceptional(planned.reasons);
	if (missingLocations.length > 0) return { status: "incomplete", missingLocations };
	const { rules } = planned;
	const plans = withoutClaimedAllowances(planned.days, overlappingDays);
	if (!mealsCover(itinerary.meals, tripDays(plans[0]?.date ?? "", plans.at(-1)?.date ?? ""))) {
		return { status: "incomplete" };
	}
	const located = locationsNeeded
		? locateDays(itinerary, dates, context)
		: { locations: null, table: null };
	if ("reasons" in located) return exceptional(located.reasons);
	const { locations, table } = located;

	const policies = new Map<string, AppliedPerDiemPolicy>();
	const policyOf = new Map<string, AppliedPerDiemPolicy>();
	const missing: string[] = [];
	for (const plan of plans) {
		if (plan.allowance === "none") continue;
		const area = locations?.get(plan.date)?.area ?? DOMESTIC_PER_DIEM_AREA;
		const resolution = context.resolvePolicy(plan.date, area);
		if (resolution.status !== "found") {
			missing.push(plan.date);
			continue;
		}
		policyOf.set(plan.date, resolution.policy);
		policies.set(`${resolution.policy.versionId}|${resolution.policy.area}`, resolution.policy);
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
		const location = locations?.get(plan.date);
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
			...(location ? { location } : {}),
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
		rules: {
			key: rules.key,
			reference: rules.reference,
			version: rules.version,
			...(table
				? { foreignTable: { key: table.key, reference: table.reference, version: table.version } }
				: {}),
		},
		policies: [...policies.values()],
	};
}

const DOMESTIC_DESTINATION = {
	area: DOMESTIC_PER_DIEM_AREA,
	country: "DE",
	place: null,
	label: "Deutschland",
	rule: "domestic",
} as const;

/**
 * The location decision of every travel day (#611), or why the rules do not
 * resolve them. `table` is the foreign table edition used, null when every
 * day is domestic.
 */
function locateDays(
	itinerary: PerDiemItinerary,
	dates: readonly string[],
	context: PerDiemContext,
):
	| { locations: Map<string, PerDiemDayLocation>; table: ForeignPerDiemTable | null }
	| { reasons: PerDiemExceptionReason[] } {
	const days = dates.map((date) => itinerary.meals.find((row) => row.date === date) ?? {});
	const entered = dates.map((_, index) => rateLocationOfDay(index, days));
	const abroad = entered.some((entry) => entry && !isDomesticLocation(entry.location));
	if (abroad && itinerary.overnight === "none") return { reasons: ["foreign_without_overnight"] };
	const table = !abroad
		? null
		: context.foreignTableKey
			? findForeignPerDiemTable(context.foreignTableKey)
			: foreignPerDiemTableCovering(dates);
	if (abroad && (!table || !dates.every((date) => foreignPerDiemTableCovers(table, date)))) {
		return { reasons: ["rules_not_verified"] };
	}
	const reasons = new Set<PerDiemExceptionReason>();
	const locations = new Map<string, PerDiemDayLocation>();
	dates.forEach((date, index) => {
		const entry = entered[index];
		if (!entry) {
			reasons.add("special_location");
			return;
		}
		const { location, basis } = entry;
		// A whole day in flight or at sea lies between the first and the last travel day.
		const interior = basis === "night" && index > 0 && index < dates.length - 1;
		if ("special" in location && location.special !== "other" && !interior) {
			reasons.add("special_location");
			return;
		}
		const resolution =
			table && !isDomesticLocation(location)
				? resolvePerDiemDestination(table, location)
				: ({ status: "resolved", ...DOMESTIC_DESTINATION } as const);
		if (resolution.status === "unsupported") {
			reasons.add(resolution.reason);
			return;
		}
		const { area, country, place, label, rule } = resolution;
		locations.set(date, { entered: location, basis, rule, area, country, place, label });
	});
	if (reasons.size > 0) return { reasons: [...reasons] };
	return { locations, table };
}

/** Official fallback rules (#610 `official_fallback`) that priced days of a calculation. */
export function perDiemFallbackRules(
	calculation: Extract<PerDiemCalculation, { status: "calculated" }>,
): PerDiemDestinationRule[] {
	const rules = calculation.days.flatMap((day) =>
		day.location && isOfficialFallbackRule(day.location.rule) ? [day.location.rule] : [],
	);
	return [...new Set(rules)];
}

/** Days of a calculation that another report already paid (`claimed_in_other_report`). */
export function perDiemClaimedDays(
	calculation: Extract<PerDiemCalculation, { status: "calculated" }>,
): string[] {
	return calculation.days
		.filter((day) => day.basis === "claimed_in_other_report")
		.map((day) => day.date);
}

/** The stamp of a calculation: its rule edition, each allowance day's version and the claimed days. */
export function perDiemStampOf(
	calculation: Extract<PerDiemCalculation, { status: "calculated" }>,
): StampedPerDiemPolicy {
	const claimedDays = perDiemClaimedDays(calculation);
	return {
		rulesKey: calculation.rules.key,
		...(calculation.rules.foreignTable
			? { foreignTableKey: calculation.rules.foreignTable.key }
			: {}),
		days: Object.fromEntries(
			calculation.days.flatMap((day) => (day.versionId ? [[day.date, day.versionId]] : [])),
		),
		...(claimedDays.length > 0 ? { claimedDays } : {}),
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
	/** Daily locations of a trip abroad are not answered for every travel day (#611). */
	| "per_diem_locations"
	/** Not covered by the supported rules; an authorized manual calculation is needed (#610). */
	| "per_diem_exceptional"
	/** No organization per diem policy covers an allowance day. */
	| "per_diem_policy_missing"
	/** The covering policy is not in the report's reimbursement currency. */
	| "per_diem_currency"
	/**
	 * The return has not passed yet (#685). An exact instant, never a calendar
	 * day, and never resolved by an allowance override.
	 */
	| "per_diem_not_returned";

/** The exact instant of the return, once the itinerary's travel times are complete and valid. */
export function perDiemReturnInstant(itinerary: PerDiemItinerary): Instant | null {
	return perDiemTravelTimes(itinerary)?.end.toInstant() ?? null;
}

/**
 * What still keeps a per diem from being submittable, in form order. Trip
 * dates are checked only when given (trip reports always give them). `now`:
 * when submission is (or would be) asked for.
 */
export function perDiemMissingRequirements(
	itinerary: PerDiemItinerary,
	calculation: PerDiemCalculation,
	trip: { startDate?: string | null; endDate?: string | null },
	now: Instant,
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
	// Exceptional itineraries need their meals too: the manual calculation (#610) uses them.
	if (
		itinerary.startDate &&
		itinerary.endDate &&
		comparePlainDates(parsePlainDate(itinerary.endDate), parsePlainDate(itinerary.startDate)) >=
			0 &&
		!mealsCover(itinerary.meals, tripDays(itinerary.startDate, itinerary.endDate))
	) {
		missing.push("per_diem_meals");
	}
	if (
		(calculation.status === "incomplete" || calculation.status === "exceptional") &&
		(calculation.missingLocations?.length ?? 0) > 0
	) {
		missing.push("per_diem_locations");
	}
	if (calculation.status === "exceptional") missing.push("per_diem_exceptional");
	if (calculation.status === "policy_missing") missing.push("per_diem_policy_missing");
	if (calculation.status === "currency_mismatch") missing.push("per_diem_currency");
	const returned = perDiemReturnInstant(itinerary);
	if (returned && Temporal.Instant.compare(returned, now) > 0)
		missing.push("per_diem_not_returned");
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
	/** An administrator's override (#610); when it applies, `amount` is its amount. */
	override?: AllowanceOverrideView | null;
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
				) &&
				// Daily locations (#611); an absent key equals an unanswered one.
				samePerDiemLocation(day.night, other.night) &&
				samePerDiemLocation(day.activityAbroad, other.activityAbroad)
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
