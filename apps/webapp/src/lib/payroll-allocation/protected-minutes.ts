import {
	type InstantRange,
	localDayRange,
} from "@/lib/datetime/temporal-boundaries";
import type { Instant } from "@/lib/datetime/temporal-core";

/**
 * Shared payroll credit rule for completed work (#260 §5).
 *
 * Stored minutes are protected: a segment fully inside a payroll window contributes its stored
 * minutes, never re-rounded endpoint time. A segment crossing a window boundary is split by
 * cumulative UTC-proportional allocation, so adjacent windows always sum to the stored total
 * regardless of which window is computed first:
 *
 *   C(t) = roundHalfUp(M * clamp(t - s, 0, e - s) / (e - s)),  credit[a, b) = C(b) - C(a)
 *
 * Payroll workspace totals and payroll exports must both use this module.
 */

const ZERO = BigInt(0);
const TWO = BigInt(2);
const NANOSECONDS_PER_MINUTE = BigInt(60_000_000_000);

/**
 * Historical writers rounded elapsed time in different ways (floor, ceil, half-up), so stored
 * minutes may legitimately differ from exact elapsed time by up to a minute. A larger gap means
 * the stored duration does not describe the recorded interval as continuous work (for example a
 * deducted break of unknown location), so a boundary split cannot be derived from it.
 */
const HISTORICAL_ROUNDING_TOLERANCE_NS = NANOSECONDS_PER_MINUTE;

export interface ProtectedWorkSegment {
	startAt: Instant;
	endAt: Instant;
	storedMinutes: number | null;
}

export type ProtectedMinuteBlockReason =
	/** Endpoints are reversed, so the segment has no valid interval meaning. */
	| "invalid_endpoints"
	/** The completed segment has no stored minutes to protect. */
	| "missing_stored_minutes"
	/** Stored minutes and endpoints disagree beyond rounding, e.g. an unlocated break. */
	| "unresolved_interval";

export type ProtectedMinuteAllocation =
	| { status: "outside" }
	| { status: "allocated"; minutes: number; overlap: InstantRange }
	| { status: "blocked"; reason: ProtectedMinuteBlockReason };

/**
 * Employee-local payroll window covering `startDate` through `endDate` inclusive, as a half-open
 * UTC instant range. Adjacent windows share their boundary instant, which is what makes
 * cumulative allocation conserve minutes across them.
 */
export function employeePayrollWindow(
	startDate: string,
	endDate: string,
	timezone: string,
): InstantRange {
	return {
		start: localDayRange(startDate, timezone).start,
		endExclusive: localDayRange(endDate, timezone).endExclusive,
	};
}

export function allocateProtectedMinutes(
	segment: ProtectedWorkSegment,
	window: InstantRange,
): ProtectedMinuteAllocation {
	const start = segment.startAt.epochNanoseconds;
	const end = segment.endAt.epochNanoseconds;
	const windowStart = window.start.epochNanoseconds;
	const windowEnd = window.endExclusive.epochNanoseconds;

	if (end < start) return { status: "blocked", reason: "invalid_endpoints" };

	const overlaps =
		start === end
			? windowStart <= start && start < windowEnd
			: start < windowEnd && end > windowStart;
	if (!overlaps) return { status: "outside" };

	const storedMinutes = segment.storedMinutes;
	if (
		storedMinutes === null ||
		!Number.isSafeInteger(storedMinutes) ||
		storedMinutes < 0
	) {
		return { status: "blocked", reason: "missing_stored_minutes" };
	}

	const overlap: InstantRange = {
		start: start > windowStart ? segment.startAt : window.start,
		endExclusive: end < windowEnd ? segment.endAt : window.endExclusive,
	};

	if (windowStart <= start && end <= windowEnd) {
		return { status: "allocated", minutes: storedMinutes, overlap };
	}

	const elapsed = end - start;
	const stored = BigInt(storedMinutes);
	const discrepancy = stored * NANOSECONDS_PER_MINUTE - elapsed;
	if (
		discrepancy > HISTORICAL_ROUNDING_TOLERANCE_NS ||
		-discrepancy > HISTORICAL_ROUNDING_TOLERANCE_NS
	) {
		return { status: "blocked", reason: "unresolved_interval" };
	}

	const cumulativeMinutes = (boundary: bigint) => {
		const progressed =
			boundary <= start ? ZERO : boundary >= end ? elapsed : boundary - start;
		// Half-up rounding of stored * progressed / elapsed in exact integer arithmetic.
		return (TWO * stored * progressed + elapsed) / (TWO * elapsed);
	};

	return {
		status: "allocated",
		minutes: Number(
			cumulativeMinutes(windowEnd) - cumulativeMinutes(windowStart),
		),
		overlap,
	};
}
