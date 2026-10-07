import type { AllowancePolicySource } from "./allowance-policy.types";
import type { PerDiemLocationFacts } from "./per-diem-location.types";

/**
 * The itinerary and policy stamp of a per diem (#609, #611). Kept free of
 * runtime imports: the database schema references these, and every runtime
 * image that loads the schema would otherwise need the per diem calculation's
 * dependencies. `per-diem.ts` re-exports them (and `PerDiemRates` is also
 * re-exported by `statutory-per-diem-defaults.ts`).
 */

export const PER_DIEM_MEALS = ["breakfast", "lunch", "dinner"] as const;
export type PerDiemMeal = (typeof PER_DIEM_MEALS)[number];

/** Nights between leaving and returning: all away from home, none, or some at home. */
export const PER_DIEM_OVERNIGHT_ANSWERS = ["away", "none", "mixed"] as const;
export type PerDiemOvernight = (typeof PER_DIEM_OVERNIGHT_ANSWERS)[number];

/**
 * Rate area of a per diem policy version: "DE" (domestic), a country of a
 * foreign table ("FR") or a place it lists ("FR:paris", #611).
 */
export type PerDiemArea = string;

export interface PerDiemMealEntry {
	/** The employer, or a third party on its behalf, provided this meal. */
	provided: boolean;
	/** What the employee paid for it (two decimals); only for a provided meal. */
	employeePayment: string | null;
}

/**
 * One travel day of the itinerary: its meals and, on trips abroad (#611), its
 * location answers. The location keys are present only when answered.
 */
export type PerDiemMealDay = { date: string } & Record<PerDiemMeal, PerDiemMealEntry> &
	PerDiemLocationFacts;

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

/** Amounts of one area (domestic: "DE") in a per diem policy version, at two decimals. */
export interface PerDiemRates {
	/** Calendar day of 24 hours' absence. */
	fullDay: string;
	/** Arrival/departure day with overnight stay, or a day of more than 8 hours. */
	partialDay: string;
	/** Reductions for a meal the employer (or a third party on its behalf) provided. */
	breakfastDeduction: string;
	lunchDeduction: string;
	dinnerDeduction: string;
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

/**
 * What submission stamps on a per diem under the report lock: the rule
 * edition and the policy version of every allowance day. Frozen facts and
 * every later compare price from this stamp, never from today's policy.
 */
export interface StampedPerDiemPolicy {
	rulesKey: string;
	/** The foreign table edition that resolved the daily locations (#611); absent when domestic. */
	foreignTableKey?: string;
	/** Policy version ID by allowance day. */
	days: Record<string, string>;
	/**
	 * Days another report already paid at submission (`claimed_in_other_report`);
	 * absent when none, so older stamps reproduce unchanged.
	 */
	claimedDays?: string[];
	/** One entry per applied version and rate area. */
	policies: AppliedPerDiemPolicy[];
}
