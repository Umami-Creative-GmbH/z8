/**
 * Which shifts recorded work belongs to, for the Minijob monitor (#1989). Matching every work
 * period against every shift of the employee is quadratic over the 34 months the monitor loads;
 * only shifts that start shortly before the work ends can match, so each work period looks at
 * those alone (binary search over the shifts sorted by start).
 */
import type { Instant } from "@/lib/datetime/temporal-core";
import { compareInstants } from "@/lib/datetime/temporal-core";
import {
	SHIFT_WORK_ASSOCIATION_LEAD_MINUTES,
	type ShiftInterval,
	workMatchesShift,
} from "@/lib/scheduling/shift-occasion";

export interface MatchableWork {
	readonly start: Instant;
	/** Null while the clock-in is open: it runs up to now. */
	readonly end: Instant | null;
}

/**
 * Whether work belongs to a shift: it matches the shift (`workMatchesShift`) or overlaps it — an
 * open clock-in up to now. One clock-in over back-to-back shifts belongs to each of them, so
 * none of them is counted on top of it.
 */
export function workBelongsToShift(
	shift: ShiftInterval,
	work: MatchableWork,
	now: Instant,
): boolean {
	if (workMatchesShift(shift, work)) return true;
	const workEnd = work.end ?? now;
	return compareInstants(work.start, shift.end) < 0 && compareInstants(workEnd, shift.start) > 0;
}

const LEAD_MS = SHIFT_WORK_ASSOCIATION_LEAD_MINUTES * 60_000;

/**
 * The shifts each work period belongs to (`workBelongsToShift`), earliest start first; work
 * without a shift is absent. Same result as testing every pair.
 */
export function matchWorkToShifts<
	S extends { readonly interval: ShiftInterval },
	W extends MatchableWork,
>(shifts: readonly S[], works: readonly W[], now: Instant): Map<W, S[]> {
	const sorted = shifts
		.map((shift) => ({
			shift,
			startMs: shift.interval.start.epochMilliseconds,
			endMs: shift.interval.end.epochMilliseconds,
		}))
		.sort((a, b) => a.startMs - b.startMs);
	const longestMs = sorted.reduce((max, s) => Math.max(max, s.endMs - s.startMs), 0);
	/** Index of the first shift starting after `ms`. */
	const firstAfter = (ms: number): number => {
		let low = 0;
		let high = sorted.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (sorted[mid].startMs <= ms) low = mid + 1;
			else high = mid;
		}
		return low;
	};

	const matches = new Map<W, S[]>();
	for (const work of works) {
		const startMs = work.start.epochMilliseconds;
		const endMs = (work.end ?? now).epochMilliseconds;
		// A matching shift ends after the work starts, so it starts after `start - longest`; and
		// it starts at most two hours after the work starts, or before the work ends.
		const from = firstAfter(startMs - longestMs);
		const until = firstAfter(Math.max(startMs + LEAD_MS, endMs));
		const found: S[] = [];
		for (let index = from; index < until; index++) {
			const { shift } = sorted[index];
			if (workBelongsToShift(shift.interval, work, now)) found.push(shift);
		}
		if (found.length > 0) matches.set(work, found);
	}
	return matches;
}

/**
 * Splits work over several shifts (one clock-in over back-to-back shifts) at each later shift's
 * start, so every part counts with its own shift — in its month, at its day's wage. An early
 * clock-in counts with the first shift, a late clock-out with the last. The parts add up to the
 * work's minutes: when they fall short of the clock (deducted breaks), later parts get less.
 *
 * @param shifts the shifts the work belongs to, earliest start first (`matchWorkToShifts`).
 */
export function splitWorkAtShiftStarts<S extends { readonly interval: ShiftInterval }>(
	work: MatchableWork & { readonly minutes: number },
	shifts: readonly S[],
	now: Instant,
): { shift: S; minutes: number }[] {
	const workEnd = work.end ?? now;
	let remaining = work.minutes;
	return shifts.map((shift, index) => {
		const next = shifts[index + 1];
		if (!next) return { shift, minutes: Math.max(0, remaining) };
		const from =
			index === 0 || compareInstants(work.start, shift.interval.start) > 0
				? work.start
				: shift.interval.start;
		const until = compareInstants(workEnd, next.interval.start) < 0 ? workEnd : next.interval.start;
		const span = Math.max(0, Math.round(from.until(until).total("minutes")));
		const minutes = Math.min(span, remaining);
		remaining -= minutes;
		return { shift, minutes };
	});
}
