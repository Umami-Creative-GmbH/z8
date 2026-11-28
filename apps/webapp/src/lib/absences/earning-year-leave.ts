/**
 * Earning-year leave (#2080, spec #2057): vacation days keep the leave year and the vacation policy
 * they were earned under, so the earning policy's designation decides whether they may lapse.
 *
 * This module is pure. The year-end writer (`vacation-carryover.ts`), the balance reader
 * (`vacation-calculator.ts`) and the expiry job all describe a year's leave as `EarningYearLeave`
 * items and use the one charge order below, so they agree on which days are used and unused.
 */
import { Temporal } from "temporal-polyfill";
import type { EarningYearLeavePortion, LeaveExpiryRules } from "@/db/schema/vacation";

/** HR's designation of an earning policy; undefined when the policy is unclassified. */
export interface LeaveExpiryClassification {
	expiryRules: LeaveExpiryRules;
	extraDaysSeparateTerms: boolean;
}

/**
 * How expiry treats a piece of earning-year leave:
 * - `unclassified`: the earning policy has no designation; the days stay outstanding.
 * - `german_protection`: German leave-expiry rules; the policy's cap and deadline alone never
 *   establish lapse (later tickets add notice- and illness-based expiry).
 * - `policy_terms`: HR chose the policy's own terms; cap, permission and deadline apply.
 * - `separate_terms`: extra contractual days for which HR recorded separate terms; they follow the
 *   policy's cap, permission and deadline.
 */
export type LeaveProtection =
	| "unclassified"
	| "german_protection"
	| "policy_terms"
	| "separate_terms";

export function leaveProtection(
	portion: EarningYearLeavePortion,
	classification: LeaveExpiryClassification | undefined,
): LeaveProtection {
	if (!classification) return "unclassified";
	if (classification.expiryRules === "policy_terms") return "policy_terms";
	return portion === "extra" && classification.extraDaysSeparateTerms
		? "separate_terms"
		: "german_protection";
}

/** Whether the policy's configured deadline establishes this leave's expiry. */
export function establishesExpiry(protection: LeaveProtection): boolean {
	return protection === "policy_terms" || protection === "separate_terms";
}

/** One earning year's (or portion's) leave available in a vacation year. */
export interface EarningYearLeave {
	/** The stored row id, or a synthetic key for the vacation year's own allowance. */
	key: string;
	earningYear: number;
	earningPolicyId: string | null;
	portion: EarningYearLeavePortion;
	protection: LeaveProtection;
	/** Days still available to charge: carried days minus days already expired. */
	capacity: number;
	/** The policy's frozen deadline (last valid instant); applies only where established. */
	configuredExpiry: Temporal.Instant | null;
}

/** Absence days charged on one organization-local calendar day (`YYYY-MM-DD`). */
export interface LeaveCharge {
	date: string;
	days: number;
}

/** The deadline that applies to this leave, or null when none is established. */
export function establishedExpiry(leave: EarningYearLeave): Temporal.Instant | null {
	return establishesExpiry(leave.protection) ? leave.configuredExpiry : null;
}

const PORTION_ORDER: Record<EarningYearLeavePortion, number> = {
	extra: 0,
	all: 1,
	statutory: 2,
};

/**
 * Absences CONTEXT charge order: the earliest established expiry first, then leave without an
 * established expiry; equal dates and undated leave use the older leave year first. Within one
 * year, separately termed extra days go before statutory days.
 */
export function compareChargeOrder(left: EarningYearLeave, right: EarningYearLeave): number {
	const leftExpiry = establishedExpiry(left);
	const rightExpiry = establishedExpiry(right);
	if (leftExpiry && !rightExpiry) return -1;
	if (!leftExpiry && rightExpiry) return 1;
	if (leftExpiry && rightExpiry) {
		const byExpiry = Temporal.Instant.compare(leftExpiry, rightExpiry);
		if (byExpiry !== 0) return byExpiry;
	}
	return (
		left.earningYear - right.earningYear ||
		PORTION_ORDER[left.portion] - PORTION_ORDER[right.portion] ||
		left.key.localeCompare(right.key)
	);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Charges absence days, day by day, to the leave in charge order. A day after an established
 * deadline (in the deadline's organization-local date) can never use that leave. Days beyond every
 * capacity stay `unallocated` (overdrawn).
 */
export function allocateLeaveCharges(
	leave: readonly EarningYearLeave[],
	charges: readonly LeaveCharge[],
	timezone: string,
): { used: Map<string, number>; unallocated: number } {
	const ordered = leave.toSorted(compareChargeOrder);
	const lastDay = new Map(
		ordered.map((item) => {
			const expiry = establishedExpiry(item);
			return [
				item.key,
				expiry ? expiry.toZonedDateTimeISO(timezone).toPlainDate().toString() : null,
			];
		}),
	);
	const used = new Map<string, number>();
	let unallocated = 0;
	for (const charge of charges.toSorted((a, b) => a.date.localeCompare(b.date))) {
		let open = charge.days;
		for (const item of ordered) {
			if (open <= 0) break;
			const deadline = lastDay.get(item.key);
			if (deadline && charge.date > deadline) continue;
			const free = round2(item.capacity - (used.get(item.key) ?? 0));
			if (free <= 0) continue;
			const take = Math.min(free, open);
			used.set(item.key, round2((used.get(item.key) ?? 0) + take));
			open = round2(open - take);
		}
		unallocated = round2(unallocated + open);
	}
	return { used, unallocated };
}

/** The carried part of one leave item at year-end. */
export interface CarriedLeave {
	key: string;
	earningYear: number;
	earningPolicyId: string | null;
	portion: EarningYearLeavePortion;
	days: number;
	/** Days the policy's cap or disallowed carryover removed at year-end. */
	forfeitedDays: number;
	configuredExpiry: Temporal.Instant | null;
}

/**
 * Year-end for one employee: each leave item's unused days carry into the next year under their own
 * earning year and policy. Only leave governed by the policy terms (`policy_terms`,
 * `separate_terms`) is subject to the source policy's permission and cap, and leave whose
 * established deadline ends within the source year lapses through the expiry job instead.
 * Protected leave carries in full. The source year's own leave takes `receivingExpiry`; older leave
 * keeps its frozen deadline.
 */
export function planYearEndCarryover(input: {
	sourceYear: number;
	leave: readonly EarningYearLeave[];
	/** Days of each item already charged with settled usage. */
	used: ReadonlyMap<string, number>;
	/** The source year's last instant in the organization timezone. */
	yearEnd: Temporal.Instant;
	allowCarryover: boolean;
	maxCarryoverDays: number | null;
	receivingExpiry: Temporal.Instant | null;
}): { carried: CarriedLeave[]; remaining: number; applied: number; capped: boolean } {
	const unused = input.leave.toSorted(compareChargeOrder).flatMap((item) => {
		const expiry = establishedExpiry(item);
		if (expiry && Temporal.Instant.compare(expiry, input.yearEnd) <= 0) return [];
		const days = round2(Math.max(0, item.capacity - (input.used.get(item.key) ?? 0)));
		return [{ item, days }];
	});
	const governed = unused.filter(({ item }) => establishesExpiry(item.protection));
	const governedDays = governed.reduce((sum, row) => sum + row.days, 0);
	const keep = !input.allowCarryover
		? 0
		: input.maxCarryoverDays === null
			? governedDays
			: Math.min(governedDays, input.maxCarryoverDays);
	// The cap removes the leave that would be charged last.
	let toForfeit = round2(governedDays - keep);
	const forfeited = new Map<string, number>();
	for (const { item, days } of governed.toReversed()) {
		if (toForfeit <= 0) break;
		const cut = Math.min(days, toForfeit);
		forfeited.set(item.key, cut);
		toForfeit = round2(toForfeit - cut);
	}
	const carried = unused
		.map(({ item, days }) => {
			const forfeitedDays = forfeited.get(item.key) ?? 0;
			return {
				key: item.key,
				earningYear: item.earningYear,
				earningPolicyId: item.earningPolicyId,
				portion: item.portion,
				days: round2(days - forfeitedDays),
				forfeitedDays,
				configuredExpiry:
					item.earningYear === input.sourceYear ? input.receivingExpiry : item.configuredExpiry,
			};
		})
		.filter((row) => row.days > 0 || row.forfeitedDays > 0)
		.toSorted(
			(a, b) =>
				a.earningYear - b.earningYear || PORTION_ORDER[a.portion] - PORTION_ORDER[b.portion],
		);
	const remaining = round2(unused.reduce((sum, row) => sum + row.days, 0));
	const applied = round2(carried.reduce((sum, row) => sum + row.days, 0));
	return {
		carried,
		remaining,
		applied,
		capped: input.allowCarryover && round2(governedDays - keep) > 0,
	};
}

/**
 * The vacation days of each organization-local calendar day of a year, from absences of the given
 * statuses. `countDays` counts one absence clipped to one day.
 */
export function chargesByDay<T extends { startDate: string; endDate: string }>(
	absences: readonly T[],
	year: number,
	countDay: (absence: T, date: string) => number,
): LeaveCharge[] {
	const first = `${year}-01-01`;
	const last = `${year}-12-31`;
	const byDay = new Map<string, number>();
	for (const absence of absences) {
		const start = Temporal.PlainDate.from(absence.startDate > first ? absence.startDate : first);
		const end = Temporal.PlainDate.from(absence.endDate < last ? absence.endDate : last);
		for (let day = start; Temporal.PlainDate.compare(day, end) <= 0; day = day.add({ days: 1 })) {
			const date = day.toString();
			const days = countDay(absence, date);
			if (days > 0) byDay.set(date, round2((byDay.get(date) ?? 0) + days));
		}
	}
	return [...byDay].map(([date, days]) => ({ date, days }));
}
