import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	type ContractorTermsPeriod,
	type ContractorWork,
	priceContractorWork,
	unitsToDecimal,
} from "./pricing";
import type { ContractorCompensation, DayUnitRule } from "./terms";

const EMPLOYEE = "11111111-1111-4111-8111-111111111111";
const PERIOD = "22222222-2222-4222-8222-222222222222";

const day = (value: string) => Temporal.PlainDate.from(value);
const instant = (value: string) => Temporal.Instant.from(value);

let workCounter = 0;
function work(input: {
	start: string;
	end: string;
	minutes?: number;
	offset?: number;
	id?: string;
	employeeId?: string;
}): ContractorWork {
	const startedAt = instant(input.start);
	const endedAt = instant(input.end);
	workCounter += 1;
	return {
		id: input.id ?? `work-${workCounter}`,
		employeeId: input.employeeId ?? EMPLOYEE,
		startedAt,
		endedAt,
		startOffsetMinutes: input.offset ?? 0,
		durationMinutes:
			input.minutes ?? Number(endedAt.since(startedAt).total({ unit: "minutes" })),
	};
}

function daily(rateMinor: number, dayUnitRule: DayUnitRule, currency = "EUR"): ContractorCompensation {
	return { basis: "daily", currency, rateMinor: BigInt(rateMinor), dayUnitRule };
}

function hourly(rateMinor: number, currency = "EUR"): ContractorCompensation {
	return { basis: "hourly", currency, rateMinor: BigInt(rateMinor) };
}

function terms(
	compensation: ContractorCompensation,
	from = "2026-01-01",
	to: string | null = null,
	id = `terms-${from}`,
): ContractorTermsPeriod {
	return {
		id,
		employeeId: EMPLOYEE,
		employmentPeriodId: PERIOD,
		from: day(from),
		to: to === null ? null : day(to),
		compensation,
	};
}

/** A day's billed units as a four-decimal string, and its amount in minor units. */
function summary(result: ReturnType<typeof priceContractorWork>) {
	return result.days.map((entry) => ({
		date: entry.date.toString(),
		workedMinutes: entry.workedMs / 60_000,
		units: entry.pricing.kind === "priced" ? unitsToDecimal(entry.pricing.units, 4) : null,
		amountMinor: entry.pricing.kind === "priced" ? entry.pricing.amountMinor : null,
	}));
}

describe("daily rate: any work is a full day", () => {
	const rule: DayUnitRule = { kind: "any_work_full_day" };

	it("bills 1.0 day for a single minute and for a long day alike", () => {
		const result = priceContractorWork({
			work: [
				work({ start: "2026-03-02T09:00:00Z", end: "2026-03-02T09:01:00Z" }),
				work({ start: "2026-03-03T08:00:00Z", end: "2026-03-03T19:00:00Z" }),
			],
			terms: [terms(daily(65_000, rule))],
		});

		expect(summary(result)).toEqual([
			{ date: "2026-03-02", workedMinutes: 1, units: "1.0000", amountMinor: BigInt(65_000) },
			{ date: "2026-03-03", workedMinutes: 660, units: "1.0000", amountMinor: BigInt(65_000) },
		]);
		expect(result.totals).toEqual([
			expect.objectContaining({
				employeeId: EMPLOYEE,
				currency: "EUR",
				amountMinor: BigInt(130_000),
			}),
		]);
		expect(unitsToDecimal(result.totals[0].dayUnits, 2)).toBe("2.00");
	});

	it("counts several work periods on one local day once", () => {
		const result = priceContractorWork({
			work: [
				work({ start: "2026-03-02T08:00:00Z", end: "2026-03-02T10:00:00Z" }),
				work({ start: "2026-03-02T13:00:00Z", end: "2026-03-02T15:00:00Z" }),
			],
			terms: [terms(daily(65_000, rule))],
		});

		expect(summary(result)).toEqual([
			{ date: "2026-03-02", workedMinutes: 240, units: "1.0000", amountMinor: BigInt(65_000) },
		]);
	});
});

describe("daily rate: half and full days", () => {
	const rule: DayUnitRule = { kind: "half_and_full_day", halfDayThresholdMinutes: 240 };

	it("bills a half day up to and including the threshold and a full day above it", () => {
		const result = priceContractorWork({
			work: [
				work({ start: "2026-03-02T09:00:00Z", end: "2026-03-02T09:01:00Z" }),
				work({ start: "2026-03-03T09:00:00Z", end: "2026-03-03T13:00:00Z" }),
				work({ start: "2026-03-04T09:00:00Z", end: "2026-03-04T13:01:00Z" }),
			],
			terms: [terms(daily(60_000, rule))],
		});

		expect(summary(result)).toEqual([
			{ date: "2026-03-02", workedMinutes: 1, units: "0.5000", amountMinor: BigInt(30_000) },
			{ date: "2026-03-03", workedMinutes: 240, units: "0.5000", amountMinor: BigInt(30_000) },
			{ date: "2026-03-04", workedMinutes: 241, units: "1.0000", amountMinor: BigInt(60_000) },
		]);
	});

	it("honours a configured threshold", () => {
		const result = priceContractorWork({
			work: [work({ start: "2026-03-02T09:00:00Z", end: "2026-03-02T12:00:00Z" })],
			terms: [terms(daily(60_000, { kind: "half_and_full_day", halfDayThresholdMinutes: 120 }))],
		});

		expect(summary(result)[0].units).toBe("1.0000");
	});

	it("rounds a half day of an odd rate half up to the minor unit", () => {
		const result = priceContractorWork({
			work: [work({ start: "2026-03-02T09:00:00Z", end: "2026-03-02T10:00:00Z" })],
			terms: [terms(daily(60_001, rule))],
		});

		expect(summary(result)[0].amountMinor).toBe(BigInt(30_001));
	});
});

describe("daily rate: prorated by a standard day", () => {
	const capped: DayUnitRule = {
		kind: "prorated_by_standard_day",
		standardDayMinutes: 480,
		capAtOneDay: true,
	};
	const uncapped: DayUnitRule = { ...capped, capAtOneDay: false };

	it("prorates below the standard day and caps at 1.0 day when capped", () => {
		const result = priceContractorWork({
			work: [
				work({ start: "2026-03-02T09:00:00Z", end: "2026-03-02T15:00:00Z" }),
				work({ start: "2026-03-03T08:00:00Z", end: "2026-03-03T16:00:00Z" }),
				work({ start: "2026-03-04T07:00:00Z", end: "2026-03-04T17:00:00Z" }),
			],
			terms: [terms(daily(80_000, capped))],
		});

		expect(summary(result)).toEqual([
			{ date: "2026-03-02", workedMinutes: 360, units: "0.7500", amountMinor: BigInt(60_000) },
			{ date: "2026-03-03", workedMinutes: 480, units: "1.0000", amountMinor: BigInt(80_000) },
			{ date: "2026-03-04", workedMinutes: 600, units: "1.0000", amountMinor: BigInt(80_000) },
		]);
	});

	it("bills beyond 1.0 day when not capped", () => {
		const result = priceContractorWork({
			work: [work({ start: "2026-03-04T07:00:00Z", end: "2026-03-04T17:00:00Z" })],
			terms: [terms(daily(80_000, uncapped))],
		});

		expect(summary(result)).toEqual([
			{ date: "2026-03-04", workedMinutes: 600, units: "1.2500", amountMinor: BigInt(100_000) },
		]);
	});

	it("keeps units exact and rounds the amount once", () => {
		// 100 of 480 minutes is 5/24 day; 5/24 × 700.00 = 145.8333… → 145.83.
		const result = priceContractorWork({
			work: [work({ start: "2026-03-02T09:00:00Z", end: "2026-03-02T10:40:00Z" })],
			terms: [terms(daily(70_000, capped))],
		});

		const [only] = result.days;
		expect(only.pricing).toMatchObject({
			kind: "priced",
			units: { unit: "day", numerator: BigInt(5), denominator: BigInt(24) },
			amountMinor: BigInt(14_583),
		});
	});
});

describe("hourly rate", () => {
	it("bills worked hours at the rate, net of breaks", () => {
		const result = priceContractorWork({
			// 9:00–17:30 with a 30-minute break: 8 hours.
			work: [work({ start: "2026-03-02T09:00:00Z", end: "2026-03-02T17:30:00Z", minutes: 480 })],
			terms: [terms(hourly(9_550))],
		});

		expect(summary(result)).toEqual([
			{ date: "2026-03-02", workedMinutes: 480, units: "8.0000", amountMinor: BigInt(76_400) },
		]);
		expect(unitsToDecimal(result.totals[0].hourUnits, 2)).toBe("8.00");
	});

	it("applies a renegotiated rate from its effective date without repricing earlier days", () => {
		const result = priceContractorWork({
			work: [
				work({ start: "2026-03-31T09:00:00Z", end: "2026-03-31T11:00:00Z" }),
				work({ start: "2026-04-01T09:00:00Z", end: "2026-04-01T11:00:00Z" }),
			],
			terms: [
				terms(hourly(9_000), "2026-01-01", "2026-04-01"),
				terms(hourly(10_000), "2026-04-01"),
			],
		});

		expect(summary(result).map((entry) => entry.amountMinor)).toEqual([
			BigInt(18_000),
			BigInt(20_000),
		]);
		expect(result.totals[0].amountMinor).toBe(BigInt(38_000));
		expect(unitsToDecimal(result.totals[0].hourUnits, 2)).toBe("4.00");
	});

	it("switches from an hourly to a daily basis on the effective date", () => {
		const result = priceContractorWork({
			work: [
				work({ start: "2026-03-31T09:00:00Z", end: "2026-03-31T12:00:00Z" }),
				work({ start: "2026-04-01T09:00:00Z", end: "2026-04-01T12:00:00Z" }),
			],
			terms: [
				terms(hourly(9_000), "2026-01-01", "2026-04-01"),
				terms(daily(60_000, { kind: "any_work_full_day" }), "2026-04-01"),
			],
		});

		expect(summary(result)).toEqual([
			{ date: "2026-03-31", workedMinutes: 180, units: "3.0000", amountMinor: BigInt(27_000) },
			{ date: "2026-04-01", workedMinutes: 180, units: "1.0000", amountMinor: BigInt(60_000) },
		]);
		expect(result.totals[0]).toMatchObject({ amountMinor: BigInt(87_000) });
		expect(unitsToDecimal(result.totals[0].hourUnits, 2)).toBe("3.00");
		expect(unitsToDecimal(result.totals[0].dayUnits, 2)).toBe("1.00");
	});
});

describe("local days, midnight and time zones", () => {
	const halfDay: DayUnitRule = { kind: "half_and_full_day", halfDayThresholdMinutes: 240 };

	it("groups work by the day at its captured offset, not by the UTC day", () => {
		// 23:30–01:30 UTC is 00:30–02:30 on 3 March in Berlin (+01:00).
		const result = priceContractorWork({
			work: [work({ start: "2026-03-02T23:30:00Z", end: "2026-03-03T01:30:00Z", offset: 60 })],
			terms: [terms(daily(60_000, { kind: "any_work_full_day" }))],
		});

		expect(summary(result).map((entry) => entry.date)).toEqual(["2026-03-03"]);
	});

	it("splits work across local midnight into two billed days", () => {
		// 20:00–04:00 local (+02:00): 4 h on each local day, so two half days.
		const result = priceContractorWork({
			work: [work({ start: "2026-06-01T18:00:00Z", end: "2026-06-02T02:00:00Z", offset: 120 })],
			terms: [terms(daily(60_000, halfDay))],
		});

		expect(summary(result)).toEqual([
			{ date: "2026-06-01", workedMinutes: 240, units: "0.5000", amountMinor: BigInt(30_000) },
			{ date: "2026-06-02", workedMinutes: 240, units: "0.5000", amountMinor: BigInt(30_000) },
		]);
	});

	it("uses each work period's own offset when a contractor travels", () => {
		// The same UTC evening: in New York (-04:00) it is still 1 June, in Berlin already 2 June.
		const result = priceContractorWork({
			work: [
				work({ start: "2026-06-01T23:00:00Z", end: "2026-06-02T01:00:00Z", offset: -240 }),
				work({ start: "2026-06-02T00:30:00Z", end: "2026-06-02T01:30:00Z", offset: 120 }),
			],
			terms: [terms(daily(60_000, { kind: "any_work_full_day" }))],
		});

		expect(summary(result).map((entry) => [entry.date, entry.workedMinutes])).toEqual([
			["2026-06-01", 120],
			["2026-06-02", 60],
		]);
	});

	it("prices each side of midnight by the terms of its own day", () => {
		const result = priceContractorWork({
			work: [work({ start: "2026-03-31T22:00:00Z", end: "2026-04-01T02:00:00Z" })],
			terms: [
				terms(hourly(9_000), "2026-01-01", "2026-04-01"),
				terms(hourly(10_000), "2026-04-01"),
			],
		});

		expect(summary(result)).toEqual([
			{ date: "2026-03-31", workedMinutes: 120, units: "2.0000", amountMinor: BigInt(18_000) },
			{ date: "2026-04-01", workedMinutes: 120, units: "2.0000", amountMinor: BigInt(20_000) },
		]);
	});

	it("prices only the days inside the range, including a part of work across its edge", () => {
		const result = priceContractorWork({
			work: [
				work({ start: "2026-03-31T22:00:00Z", end: "2026-04-01T02:00:00Z" }),
				work({ start: "2026-04-02T09:00:00Z", end: "2026-04-02T10:00:00Z" }),
			],
			terms: [terms(hourly(10_000))],
			range: { fromDay: day("2026-04-01"), toDay: day("2026-04-01") },
		});

		expect(summary(result)).toEqual([
			{ date: "2026-04-01", workedMinutes: 120, units: "2.0000", amountMinor: BigInt(20_000) },
		]);
	});
});

describe("allocating a day's amount across its work", () => {
	it("splits a daily rate over same-day projects by duration and sums exactly to the day", () => {
		const result = priceContractorWork({
			work: [
				work({ id: "a", start: "2026-03-02T08:00:00Z", end: "2026-03-02T09:00:00Z" }),
				work({ id: "b", start: "2026-03-02T10:00:00Z", end: "2026-03-02T11:00:00Z" }),
				work({ id: "c", start: "2026-03-02T12:00:00Z", end: "2026-03-02T13:00:00Z" }),
			],
			terms: [terms(daily(10_000, { kind: "any_work_full_day" }))],
		});

		const [only] = result.days;
		if (only.pricing.kind !== "priced") throw new Error("expected priced");
		// 100.00 / 3: 33.34 + 33.33 + 33.33, the spare cent to the earliest.
		expect(only.pricing.allocations).toEqual([
			{ workId: "a", durationMs: 3_600_000, amountMinor: BigInt(3_334) },
			{ workId: "b", durationMs: 3_600_000, amountMinor: BigInt(3_333) },
			{ workId: "c", durationMs: 3_600_000, amountMinor: BigInt(3_333) },
		]);
	});

	it("allocates in proportion to duration", () => {
		const result = priceContractorWork({
			work: [
				work({ id: "long", start: "2026-03-02T08:00:00Z", end: "2026-03-02T14:00:00Z" }),
				work({ id: "short", start: "2026-03-02T15:00:00Z", end: "2026-03-02T17:00:00Z" }),
			],
			terms: [terms(daily(80_000, { kind: "any_work_full_day" }))],
		});

		const [only] = result.days;
		expect(only.pricing.kind === "priced" && only.pricing.allocations).toEqual([
			{ workId: "long", durationMs: 21_600_000, amountMinor: BigInt(60_000) },
			{ workId: "short", durationMs: 7_200_000, amountMinor: BigInt(20_000) },
		]);
	});
});

describe("days without terms", () => {
	it("leaves them unpriced, never priced at zero", () => {
		const result = priceContractorWork({
			work: [
				work({ start: "2026-02-27T09:00:00Z", end: "2026-02-27T11:00:00Z" }),
				work({ start: "2026-03-02T09:00:00Z", end: "2026-03-02T11:00:00Z" }),
			],
			terms: [terms(hourly(10_000), "2026-03-01")],
		});

		expect(result.days.map((entry) => entry.pricing.kind)).toEqual(["unpriced", "priced"]);
		expect(result.unpriced).toEqual([{ employeeId: EMPLOYEE, workedMs: 7_200_000, days: 1 }]);
		expect(result.totals[0].amountMinor).toBe(BigInt(20_000));
	});

	it("ignores another contractor's terms", () => {
		const result = priceContractorWork({
			work: [
				work({
					employeeId: "other",
					start: "2026-03-02T09:00:00Z",
					end: "2026-03-02T11:00:00Z",
				}),
			],
			terms: [terms(hourly(10_000))],
		});

		expect(result.days[0].pricing.kind).toBe("unpriced");
	});

	it("prefers the later engagement on a day two engagements share", () => {
		const result = priceContractorWork({
			work: [work({ start: "2026-04-01T09:00:00Z", end: "2026-04-01T10:00:00Z" })],
			terms: [
				terms(hourly(9_000), "2026-01-01", "2026-04-02", "old"),
				terms(hourly(12_000), "2026-04-01", null, "new"),
			],
		});

		expect(result.days[0].pricing).toMatchObject({ termsId: "new", amountMinor: BigInt(12_000) });
	});
});

describe("currencies", () => {
	it("prices in the terms' currency and totals each currency apart", () => {
		const result = priceContractorWork({
			work: [
				work({ start: "2026-03-31T09:00:00Z", end: "2026-03-31T10:00:00Z" }),
				work({ start: "2026-04-01T09:00:00Z", end: "2026-04-01T10:00:00Z" }),
			],
			terms: [
				terms(hourly(9_000, "EUR"), "2026-01-01", "2026-04-01"),
				terms(hourly(12_000, "JPY"), "2026-04-01"),
			],
		});

		expect(result.totals.map((total) => [total.currency, total.amountMinor])).toEqual([
			["EUR", BigInt(9_000)],
			["JPY", BigInt(12_000)],
		]);
	});
});
