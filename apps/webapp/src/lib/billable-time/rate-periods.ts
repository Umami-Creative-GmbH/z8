import { Temporal } from "temporal-polyfill";

/**
 * Effective-dated rate periods (#898 billable rates, #899 cost rates).
 *
 * A rate series (one rate level and target, or one employee's cost rate) is a
 * list of half-open calendar-date periods `[from, to)`; `to: null` is open.
 * Periods of one series never overlap; the database enforces it with an
 * EXCLUDE constraint, and this planner keeps every change inside that rule.
 *
 * A change is a step at a date, like a price list:
 * - `set` a value from a date: the period in effect at that date is closed
 *   there (or changes its value when it starts on that date) and the new value
 *   runs until that period's old end. Without a period in effect (backdating
 *   before the first rate, or a gap) it runs until the next period starts, or
 *   stays open. Later changes are never overwritten.
 * - `end` from a date: no value from that date until the next change. A
 *   period ended on its own first day is removed.
 *
 * Dates are the rate's calendar dates. Which instant a date starts at is the
 * reader's business (the employee-local day of the work start for billable
 * work, see `applicable-rate.ts`).
 */

export interface RatePeriod<V> {
	id: string;
	from: Temporal.PlainDate;
	/** Exclusive end; null while the period is open. */
	to: Temporal.PlainDate | null;
	value: V;
}

export type RatePeriodChange<V> =
	| { kind: "set"; from: Temporal.PlainDate; value: V }
	| { kind: "end"; from: Temporal.PlainDate };

/** One write, in the order that keeps the series free of overlaps at every statement. */
export type RatePeriodStep<V> =
	| { kind: "shorten"; id: string; to: Temporal.PlainDate }
	| { kind: "delete"; id: string }
	| { kind: "update_value"; id: string; value: V }
	| { kind: "insert"; from: Temporal.PlainDate; to: Temporal.PlainDate | null; value: V };

export interface RatePeriodPlan<V> {
	steps: RatePeriodStep<V>[];
	/** The period in effect at the change date before the change, for the audit trail. */
	previous: { id: string; value: V } | null;
}

export class OverlappingRatePeriodsError extends Error {
	constructor() {
		super("Rate periods of one series overlap");
		this.name = "OverlappingRatePeriodsError";
	}
}

const compare = Temporal.PlainDate.compare;

function contains<V>(period: RatePeriod<V>, date: Temporal.PlainDate): boolean {
	return compare(period.from, date) <= 0 && (period.to === null || compare(date, period.to) < 0);
}

function sortedWithoutOverlaps<V>(periods: readonly RatePeriod<V>[]): RatePeriod<V>[] {
	const sorted = [...periods].sort((left, right) => compare(left.from, right.from));
	for (let index = 1; index < sorted.length; index += 1) {
		const before = sorted[index - 1];
		if (before.to === null || compare(sorted[index].from, before.to) < 0) {
			throw new OverlappingRatePeriodsError();
		}
	}
	return sorted;
}

/**
 * Plans one change to a rate series. Pure: the caller loads the series under a
 * lock and applies the steps in order (see `applyRatePeriodChange`).
 */
export function planRatePeriodChange<V>(
	periods: readonly RatePeriod<V>[],
	change: RatePeriodChange<V>,
	equals: (left: V, right: V) => boolean = Object.is,
): RatePeriodPlan<V> {
	const sorted = sortedWithoutOverlaps(periods);
	const current = sorted.find((period) => contains(period, change.from)) ?? null;
	const previous = current ? { id: current.id, value: current.value } : null;

	if (change.kind === "end") {
		if (!current) return { steps: [], previous };
		return {
			steps:
				compare(current.from, change.from) === 0
					? [{ kind: "delete", id: current.id }]
					: [{ kind: "shorten", id: current.id, to: change.from }],
			previous,
		};
	}

	if (current) {
		if (equals(current.value, change.value)) return { steps: [], previous };
		if (compare(current.from, change.from) === 0) {
			return { steps: [{ kind: "update_value", id: current.id, value: change.value }], previous };
		}
		return {
			steps: [
				{ kind: "shorten", id: current.id, to: change.from },
				{ kind: "insert", from: change.from, to: current.to, value: change.value },
			],
			previous,
		};
	}

	const next = sorted.find((period) => compare(period.from, change.from) > 0) ?? null;
	return {
		steps: [{ kind: "insert", from: change.from, to: next?.from ?? null, value: change.value }],
		previous,
	};
}

/** Storage of one rate series inside the caller's transaction. */
export interface RatePeriodStore<V> {
	/** Serializes writers of this series and returns its periods. */
	lockAndLoad(): Promise<RatePeriod<V>[]>;
	shorten(id: string, to: Temporal.PlainDate): Promise<void>;
	remove(id: string): Promise<void>;
	updateValue(id: string, value: V): Promise<void>;
	/** Returns the new period's id. */
	insert(from: Temporal.PlainDate, to: Temporal.PlainDate | null, value: V): Promise<string>;
}

export interface AppliedRatePeriodChange<V> {
	plan: RatePeriodPlan<V>;
	/** The id of the period that now holds the change: inserted, re-valued, or ended. */
	periodId: string | null;
	changed: boolean;
}

/** Loads a series under its lock, plans the change and applies its steps in order. */
export async function applyRatePeriodChange<V>(
	store: RatePeriodStore<V>,
	change: RatePeriodChange<V>,
	equals?: (left: V, right: V) => boolean,
): Promise<AppliedRatePeriodChange<V>> {
	const plan = planRatePeriodChange(await store.lockAndLoad(), change, equals);
	let periodId: string | null = plan.previous?.id ?? null;
	// Shorten or remove the predecessor before inserting its successor; the exclusion constraint rejects overlap.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const step of plan.steps) {
		switch (step.kind) {
			case "shorten":
				await store.shorten(step.id, step.to);
				break;
			case "delete":
				await store.remove(step.id);
				break;
			case "update_value":
				await store.updateValue(step.id, step.value);
				break;
			case "insert":
				periodId = await store.insert(step.from, step.to, step.value);
				break;
		}
	}
	return { plan, periodId, changed: plan.steps.length > 0 };
}
