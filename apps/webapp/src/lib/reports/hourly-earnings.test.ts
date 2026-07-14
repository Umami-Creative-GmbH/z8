import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	calculateHourlyEarningsFromIntervals,
	type HourlyEarningsIntegrityError,
} from "./hourly-earnings";

const rangeStart = parseInstant("2026-01-01T00:00:00Z");
const rangeEndExclusive = parseInstant("2026-02-01T00:00:00Z");

function rate(
	id: string,
	hourlyRate: number,
	effectiveFrom: string,
	effectiveTo: string | null,
	currency = "EUR",
) {
	return {
		id,
		rate: hourlyRate,
		currency,
		effectiveFrom: parseInstant(effectiveFrom),
		effectiveTo: effectiveTo ? parseInstant(effectiveTo) : null,
	};
}

describe("calculateHourlyEarningsFromIntervals", () => {
	it("allocates actual worked minutes across a rate boundary", () => {
		const result = calculateHourlyEarningsFromIntervals({
			workPeriods: [
				{
					start: parseInstant("2026-01-15T22:00:00Z"),
					end: parseInstant("2026-01-16T02:00:00Z"),
					durationMinutes: 240,
				},
			],
			ratePeriods: [
				rate("old", 20, "2025-01-01T00:00:00Z", "2026-01-16T00:00:00Z"),
				rate("new", 30, "2026-01-16T00:00:00Z", null),
			],
			rangeStart,
			rangeEndExclusive,
			timezone: "UTC",
		});

		expect(result.byRatePeriod).toEqual([
			expect.objectContaining({ rate: 20, hours: 2, earnings: 40 }),
			expect.objectContaining({ rate: 30, hours: 2, earnings: 60 }),
		]);
		expect(result.totalEarnings).toBe(100);
	});

	it("uses canonical duration when a period was adjusted", () => {
		const result = calculateHourlyEarningsFromIntervals({
			workPeriods: [
				{
					start: parseInstant("2026-01-10T08:00:00Z"),
					end: parseInstant("2026-01-10T16:00:00Z"),
					durationMinutes: 420,
				},
			],
			ratePeriods: [rate("rate", 24, "2025-01-01T00:00:00Z", null)],
			rangeStart,
			rangeEndExclusive,
			timezone: "Europe/Berlin",
		});

		expect(result.totalHours).toBe(7);
		expect(result.totalEarnings).toBe(168);
	});

	it.each([
		{
			name: "missing coverage",
			rates: [rate("late", 20, "2026-01-10T10:00:00Z", null)],
			code: "missing_rate",
		},
		{
			name: "overlapping coverage",
			rates: [
				rate("one", 20, "2025-01-01T00:00:00Z", "2026-01-10T12:00:00Z"),
				rate("two", 30, "2026-01-10T10:00:00Z", null),
			],
			code: "overlapping_rates",
		},
	])("rejects $name", ({ rates, code }) => {
		expect(() =>
			calculateHourlyEarningsFromIntervals({
				workPeriods: [
					{
						start: parseInstant("2026-01-10T08:00:00Z"),
						end: parseInstant("2026-01-10T14:00:00Z"),
						durationMinutes: 360,
					},
				],
				ratePeriods: rates,
				rangeStart,
				rangeEndExclusive,
				timezone: "UTC",
			}),
		).toThrow(
			expect.objectContaining<Partial<HourlyEarningsIntegrityError>>({ code }),
		);
	});

	it("rejects currencies mixed across worked intervals", () => {
		expect(() =>
			calculateHourlyEarningsFromIntervals({
				workPeriods: [
					{
						start: parseInstant("2026-01-15T22:00:00Z"),
						end: parseInstant("2026-01-16T02:00:00Z"),
						durationMinutes: 240,
					},
				],
				ratePeriods: [
					rate("eur", 20, "2025-01-01T00:00:00Z", "2026-01-16T00:00:00Z"),
					rate("usd", 30, "2026-01-16T00:00:00Z", null, "USD"),
				],
				rangeStart,
				rangeEndExclusive,
				timezone: "UTC",
			}),
		).toThrow(expect.objectContaining({ code: "mixed_currencies" }));
	});
});
