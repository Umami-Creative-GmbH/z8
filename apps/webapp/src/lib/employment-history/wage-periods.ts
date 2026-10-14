import { type ElapsedInterval, splitElapsedTime } from "@/lib/billable-time/elapsed-split";
import {
	compareInstants,
	earlierInstant,
	type Instant,
	type PlainDate,
} from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import type { ContractType } from "@/lib/validations/employee";
import type { TermsDatesRow, TermsSpan } from "./terms-in-force";

/**
 * The wage each stretch of work earns under the confirmed terms in force.
 *
 * Terms take effect at local midnight of their first date, measured with each
 * work period's captured offsets, as for surcharge segments
 * (`docs/refs/timekeeping.md`). Within one work period the boundary between two
 * adjacent terms is the later terms' opening, at the clock-in offset ("opening
 * wins"). Terms with no successor close at local midnight of their end date at
 * the clock-out offset. Every minute belongs to exactly one set of terms or to
 * none.
 */

/** The columns of a terms row the wage depends on. */
export type WageTermsRow = TermsDatesRow & {
	contractType: ContractType;
	hourlyRate: number | null;
	currency: string;
};

/** A completed work period with the offsets captured at clock-in and clock-out. */
export type WageWorkPeriod = {
	start: Instant;
	/** Exclusive end. */
	end: Instant;
	/** The recorded duration, net of breaks. */
	durationMinutes: number;
	clockInOffsetMinutes: number;
	clockOutOffsetMinutes: number;
};

/** What a stretch of work earns. */
export type WageInForce =
	| { kind: "hourly"; rate: number; currency: string }
	/** Hourly terms that carry no wage; callers raise `missing_rate`. */
	| { kind: "missing_wage" }
	/** Fixed terms: no hourly wage is earned. */
	| { kind: "fixed" }
	/** No confirmed terms are in force. */
	| { kind: "no_terms" };

export type WagePeriod<W extends WageWorkPeriod, T extends WageTermsRow> = {
	workPeriod: W;
	/** The terms in force, or null when none are. */
	span: TermsSpan<T> | null;
	wage: WageInForce;
	start: Instant;
	end: Instant;
	/** This stretch's share of the recorded duration, in whole milliseconds. */
	durationMs: number;
};

function localMidnight(date: PlainDate, offsetMinutes: number): Instant {
	return date.toZonedDateTime({ timeZone: offsetMinutesToTimeZoneId(offsetMinutes) }).toInstant();
}

function wageOf(terms: WageTermsRow | null): WageInForce {
	if (!terms) return { kind: "no_terms" };
	if (terms.contractType !== "hourly") return { kind: "fixed" };
	if (terms.hourlyRate === null) return { kind: "missing_wage" };
	return { kind: "hourly", rate: terms.hourlyRate, currency: terms.currency };
}

/** The instants each span covers within one work period, by its captured offsets. */
function intervalsForWork<T extends WageTermsRow>(
	spans: readonly TermsSpan<T>[],
	work: WageWorkPeriod,
): ElapsedInterval<TermsSpan<T>>[] {
	const openings = spans.map((span) => localMidnight(span.from, work.clockInOffsetMinutes));
	return spans.flatMap((span, index) => {
		const start = openings[index] as Instant;
		const next = spans[index + 1];
		const nextOpening = openings[index + 1];
		let end: Instant | null;
		if (next && nextOpening && span.until?.equals(next.from)) {
			end = nextOpening;
		} else {
			end = span.until ? localMidnight(span.until, work.clockOutOffsetMinutes) : null;
			// Extreme travel must never let one span reach into the next one's opening.
			if (nextOpening) end = end ? earlierInstant(end, nextOpening) : nextOpening;
		}
		if (end && compareInstants(start, end) >= 0) return [];
		return [{ start, end, value: span }];
	});
}

/**
 * Splits each work period by the confirmed terms in force, apportioning its
 * recorded duration by elapsed share.
 *
 * `spans` must be the employee's confirmed terms in date order, as returned by
 * `confirmedTermsSpans` or the loader, and not clipped to a report range, so
 * that terms boundaries are never invented at the range edges.
 */
export function wagePeriodsForWork<W extends WageWorkPeriod, T extends WageTermsRow>(
	spans: readonly TermsSpan<T>[],
	workPeriods: readonly W[],
): WagePeriod<W, T>[] {
	return workPeriods.flatMap((workPeriod) =>
		splitElapsedTime(workPeriod, intervalsForWork(spans, workPeriod)).map((share) => ({
			workPeriod,
			span: share.value,
			wage: wageOf(share.value?.terms ?? null),
			start: share.start,
			end: share.end,
			durationMs: share.durationMs,
		})),
	);
}
