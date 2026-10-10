import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";

/**
 * Splitting a work period across rate intervals by elapsed time (#898), the
 * convention of the hourly-earnings report (`lib/reports/hourly-earnings.ts`),
 * generalized and exact: revenue (#902) and hand-off lines (#903) price each
 * share at its own rate.
 *
 * A work period's recorded duration (already net of breaks) is apportioned to
 * each interval by that interval's share of the period's elapsed wall-clock
 * time. Shares are whole milliseconds; the largest-remainder method makes them
 * add up exactly to the recorded duration, so totals never drift.
 */

export interface ElapsedWork {
	start: Instant;
	/** Exclusive end. */
	end: Instant;
	/** The recorded duration, net of breaks. */
	durationMinutes: number;
}

/** A half-open interval `[start, end)`; null is unbounded on that side. */
export interface ElapsedInterval<T> {
	start: Instant | null;
	end: Instant | null;
	value: T;
}

export interface ElapsedShare<T> {
	/** The interval's value, or null for elapsed time no interval covers. */
	value: T | null;
	start: Instant;
	end: Instant;
	/** This share of the recorded duration, in whole milliseconds. */
	durationMs: number;
}

export class OverlappingIntervalsError extends Error {
	constructor() {
		super("Rate intervals overlap");
		this.name = "OverlappingIntervalsError";
	}
}

const later = (left: Instant, right: Instant) => (compareInstants(left, right) >= 0 ? left : right);
const earlier = (left: Instant, right: Instant) =>
	compareInstants(left, right) <= 0 ? left : right;

/** Apportions the work's recorded duration to the intervals it overlaps, in time order. */
export function splitElapsedTime<T>(
	work: ElapsedWork,
	intervals: readonly ElapsedInterval<T>[],
): ElapsedShare<T>[] {
	const durationMs = Math.round(work.durationMinutes * 60_000);
	const elapsed = work.end.epochNanoseconds - work.start.epochNanoseconds;
	if (durationMs <= 0 || elapsed <= BigInt(0)) return [];

	const sorted = [...intervals].sort((left, right) => {
		if (left.start === null) return right.start === null ? 0 : -1;
		if (right.start === null) return 1;
		return compareInstants(left.start, right.start);
	});

	const pieces: { value: T | null; start: Instant; end: Instant }[] = [];
	let cursor = work.start;
	for (const interval of sorted) {
		const start = interval.start === null ? work.start : later(work.start, interval.start);
		const end = interval.end === null ? work.end : earlier(work.end, interval.end);
		if (compareInstants(start, end) >= 0) continue;
		if (compareInstants(start, cursor) < 0) throw new OverlappingIntervalsError();
		if (compareInstants(start, cursor) > 0) pieces.push({ value: null, start: cursor, end: start });
		pieces.push({ value: interval.value, start, end });
		cursor = end;
	}
	if (compareInstants(cursor, work.end) < 0) {
		pieces.push({ value: null, start: cursor, end: work.end });
	}

	const total = BigInt(durationMs);
	const exact = pieces.map(
		(piece) => total * (piece.end.epochNanoseconds - piece.start.epochNanoseconds),
	);
	const shares = exact.map((numerator) => numerator / elapsed);
	let spare = total - shares.reduce((sum, share) => sum + share, BigInt(0));
	const byRemainder = exact
		.map((numerator, index) => ({ index, remainder: numerator % elapsed }))
		.sort((left, right) =>
			left.remainder === right.remainder
				? left.index - right.index
				: left.remainder > right.remainder
					? -1
					: 1,
		);
	for (const { index } of byRemainder) {
		if (spare <= BigInt(0)) break;
		shares[index] += BigInt(1);
		spare -= BigInt(1);
	}

	return pieces
		.map((piece, index) => ({ ...piece, durationMs: Number(shares[index]) }))
		.filter((share) => share.durationMs > 0);
}
