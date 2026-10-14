import type { InstantRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	comparePlainDates,
	earlierInstant,
	earlierPlainDate,
	type Instant,
	laterInstant,
	laterPlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import type { TermsSpan } from "@/lib/employment-history/terms-in-force";
import {
	type WageTermsRow,
	type WageWorkPeriod,
	wagePeriodsForWork,
} from "@/lib/employment-history/wage-periods";
import type { HourlyEarningsData, RatePeriodEarnings } from "./types";

/**
 * Hourly earnings come from the confirmed employment terms in force when the
 * work was done (Organization ADR 0002): hourly terms pay their wage, fixed
 * terms and work no terms cover earn nothing.
 */

export class HourlyEarningsIntegrityError extends Error {
	constructor(
		readonly code: "missing_rate" | "mixed_currencies",
		message: string,
	) {
		super(message);
		this.name = "HourlyEarningsIntegrityError";
	}
}

/** The report range: its instants and its first and last calendar dates. */
export type EarningsRange = InstantRange & { startDate: string; endDate: string };

function elapsedMilliseconds(start: Instant, end: Instant): number {
	return Number(end.epochNanoseconds - start.epochNanoseconds) / 1_000_000;
}

function roundHours(minutes: number): number {
	return Math.round((minutes / 60) * 100) / 100;
}

function roundCurrency(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Earnings for the work in `range` under the employee's confirmed terms.
 *
 * `spans` are the employee's confirmed terms overlapping the range, in date
 * order and not clipped to it (`loadConfirmedTermsSpans`). Returns undefined
 * when no hourly terms are in force during the range.
 */
export function calculateHourlyEarningsFromTerms<T extends WageTermsRow>(input: {
	spans: readonly TermsSpan<T>[];
	workPeriods: readonly WageWorkPeriod[];
	range: EarningsRange;
}): HourlyEarningsData | undefined {
	const rangeStartDate = parsePlainDate(input.range.startDate);
	const rangeEndDate = parsePlainDate(input.range.endDate);
	const hourlySpans = input.spans.filter(
		(span) =>
			span.terms.contractType === "hourly" &&
			comparePlainDates(span.from, rangeEndDate) <= 0 &&
			(span.until === null || comparePlainDates(span.until, rangeStartDate) > 0),
	);
	if (hourlySpans.length === 0) return undefined;

	const millisecondsBySpan = new Map<TermsSpan<T>, number>();
	for (const piece of wagePeriodsForWork(input.spans, input.workPeriods)) {
		const elapsed = elapsedMilliseconds(piece.start, piece.end);
		const clippedStart = laterInstant(piece.start, input.range.start);
		const clippedEnd = earlierInstant(piece.end, input.range.endExclusive);
		if (elapsed <= 0 || piece.durationMs <= 0 || compareInstants(clippedStart, clippedEnd) >= 0) {
			continue;
		}
		if (piece.wage.kind === "missing_wage") {
			throw new HourlyEarningsIntegrityError(
				"missing_rate",
				"Hourly earnings cannot be calculated because hourly employment terms have no wage.",
			);
		}
		if (piece.wage.kind !== "hourly" || !piece.span) continue;

		const share = piece.durationMs * (elapsedMilliseconds(clippedStart, clippedEnd) / elapsed);
		millisecondsBySpan.set(piece.span, (millisecondsBySpan.get(piece.span) ?? 0) + share);
	}

	const workedSpans = hourlySpans.filter((span) => millisecondsBySpan.has(span));
	const currencies = new Set(workedSpans.map((span) => span.terms.currency));
	if (currencies.size > 1) {
		throw new HourlyEarningsIntegrityError(
			"mixed_currencies",
			"Hourly earnings cannot be calculated across employment terms with different currencies.",
		);
	}

	const byRatePeriod: RatePeriodEarnings[] = workedSpans.map((span) => {
		const minutes = (millisecondsBySpan.get(span) ?? 0) / 60_000;
		const rate = span.terms.hourlyRate ?? 0;
		const lastDay = span.until ? span.until.subtract({ days: 1 }) : rangeEndDate;
		return {
			rate,
			currency: span.terms.currency,
			periodStart: laterPlainDate(span.from, rangeStartDate).toString(),
			periodEnd: earlierPlainDate(lastDay, rangeEndDate).toString(),
			hours: roundHours(minutes),
			earnings: roundCurrency((minutes / 60) * rate),
		};
	});
	const totalMinutes = workedSpans.reduce(
		(sum, span) => sum + (millisecondsBySpan.get(span) ?? 0) / 60_000,
		0,
	);

	return {
		totalHours: roundHours(totalMinutes),
		totalEarnings: roundCurrency(byRatePeriod.reduce((sum, period) => sum + period.earnings, 0)),
		currency: [...currencies][0] ?? hourlySpans.at(-1)?.terms.currency ?? "EUR",
		byRatePeriod,
	};
}
