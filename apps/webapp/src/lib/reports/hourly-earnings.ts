import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import type { HourlyEarningsData, RatePeriodEarnings } from "./types";

export type EarningsWorkPeriod = {
	start: Instant;
	end: Instant;
	durationMinutes: number;
};

export type EarningsRatePeriod = {
	id: string;
	rate: number;
	currency: string;
	effectiveFrom: Instant;
	effectiveTo: Instant | null;
};

export class HourlyEarningsIntegrityError extends Error {
	constructor(
		readonly code: "missing_rate" | "overlapping_rates" | "mixed_currencies",
		message: string,
	) {
		super(message);
		this.name = "HourlyEarningsIntegrityError";
	}
}

function later(left: Instant, right: Instant): Instant {
	return compareInstants(left, right) >= 0 ? left : right;
}

function earlier(left: Instant, right: Instant): Instant {
	return compareInstants(left, right) <= 0 ? left : right;
}

function elapsedMilliseconds(start: Instant, end: Instant): number {
	return Number(end.epochNanoseconds - start.epochNanoseconds) / 1_000_000;
}

function roundHours(minutes: number): number {
	return Math.round((minutes / 60) * 100) / 100;
}

function roundCurrency(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateHourlyEarningsFromIntervals(input: {
	workPeriods: EarningsWorkPeriod[];
	ratePeriods: EarningsRatePeriod[];
	rangeStart: Instant;
	rangeEndExclusive: Instant;
	timezone: string;
}): HourlyEarningsData {
	const rates = [...input.ratePeriods].sort((left, right) =>
		compareInstants(left.effectiveFrom, right.effectiveFrom),
	);
	const minutesByRate = new Map<string, number>();
	const usedRates = new Map<string, EarningsRatePeriod>();

	for (const workPeriod of input.workPeriods) {
		const clippedStart = later(workPeriod.start, input.rangeStart);
		const clippedEnd = earlier(workPeriod.end, input.rangeEndExclusive);
		if (
			compareInstants(clippedStart, clippedEnd) >= 0 ||
			workPeriod.durationMinutes <= 0
		) {
			continue;
		}

		const fullElapsedMilliseconds = elapsedMilliseconds(
			workPeriod.start,
			workPeriod.end,
		);
		if (fullElapsedMilliseconds <= 0) continue;

		let cursor = clippedStart;
		for (const ratePeriod of rates) {
			const rateEnd = ratePeriod.effectiveTo ?? input.rangeEndExclusive;
			const segmentStart = later(clippedStart, ratePeriod.effectiveFrom);
			const segmentEnd = earlier(clippedEnd, rateEnd);
			if (compareInstants(segmentStart, segmentEnd) >= 0) continue;

			if (compareInstants(segmentStart, cursor) > 0) {
				throw new HourlyEarningsIntegrityError(
					"missing_rate",
					"Hourly earnings cannot be calculated because rate history does not cover all worked time.",
				);
			}
			if (compareInstants(segmentStart, cursor) < 0) {
				throw new HourlyEarningsIntegrityError(
					"overlapping_rates",
					"Hourly earnings cannot be calculated because rate history contains overlapping rates.",
				);
			}

			const segmentMinutes =
				workPeriod.durationMinutes *
				(elapsedMilliseconds(segmentStart, segmentEnd) /
					fullElapsedMilliseconds);
			minutesByRate.set(
				ratePeriod.id,
				(minutesByRate.get(ratePeriod.id) ?? 0) + segmentMinutes,
			);
			usedRates.set(ratePeriod.id, ratePeriod);
			cursor = segmentEnd;
		}

		if (compareInstants(cursor, clippedEnd) < 0) {
			throw new HourlyEarningsIntegrityError(
				"missing_rate",
				"Hourly earnings cannot be calculated because rate history does not cover all worked time.",
			);
		}
	}

	if (minutesByRate.size === 0) {
		return {
			totalHours: 0,
			totalEarnings: 0,
			currency: "EUR",
			byRatePeriod: [],
		};
	}

	const currencies = new Set(
		[...usedRates.values()].map((rate) => rate.currency),
	);
	if (currencies.size !== 1) {
		throw new HourlyEarningsIntegrityError(
			"mixed_currencies",
			"Hourly earnings cannot be calculated across rate histories with different currencies.",
		);
	}

	const byRatePeriod: RatePeriodEarnings[] = rates.flatMap((ratePeriod) => {
		const minutes = minutesByRate.get(ratePeriod.id);
		if (!minutes) return [];
		const displayStart = later(ratePeriod.effectiveFrom, input.rangeStart);
		const displayEndExclusive = earlier(
			ratePeriod.effectiveTo ?? input.rangeEndExclusive,
			input.rangeEndExclusive,
		);
		const displayEnd = displayEndExclusive.subtract({ milliseconds: 1 });
		const earnings = roundCurrency((minutes / 60) * ratePeriod.rate);
		return [
			{
				rate: ratePeriod.rate,
				currency: ratePeriod.currency,
				periodStart: displayStart
					.toZonedDateTimeISO(input.timezone)
					.toPlainDate()
					.toString(),
				periodEnd: displayEnd
					.toZonedDateTimeISO(input.timezone)
					.toPlainDate()
					.toString(),
				hours: roundHours(minutes),
				earnings,
			},
		];
	});
	const totalMinutes = [...minutesByRate.values()].reduce(
		(sum, minutes) => sum + minutes,
		0,
	);

	return {
		totalHours: roundHours(totalMinutes),
		totalEarnings: roundCurrency(
			byRatePeriod.reduce((sum, ratePeriod) => sum + ratePeriod.earnings, 0),
		),
		currency: [...currencies][0] ?? "EUR",
		byRatePeriod,
	};
}
