import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { confirmedTermsSpans } from "@/lib/employment-history/terms-in-force";
import type { WageTermsRow, WageWorkPeriod } from "@/lib/employment-history/wage-periods";
import {
	calculateHourlyEarningsFromTerms,
	type HourlyEarningsIntegrityError,
} from "./hourly-earnings";
import { resolveReportDateRange } from "./report-date-range";

const utcMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

function terms(
	validFrom: string,
	validUntil: string | null,
	contract: Pick<WageTermsRow, "contractType" | "hourlyRate"> & { currency?: string },
): WageTermsRow {
	return {
		validFrom: utcMidnight(validFrom),
		validUntil: validUntil ? utcMidnight(validUntil) : null,
		reviewState: "confirmed",
		currency: "EUR",
		...contract,
	};
}

const hourly = (hourlyRate: number | null, currency = "EUR") => ({
	contractType: "hourly" as const,
	hourlyRate,
	currency,
});
const fixed = { contractType: "fixed" as const, hourlyRate: null };

function work(
	start: string,
	end: string,
	offsetMinutes: number,
	durationMinutes?: number,
): WageWorkPeriod {
	const startInstant = parseInstant(start);
	const endInstant = parseInstant(end);
	return {
		start: startInstant,
		end: endInstant,
		durationMinutes: durationMinutes ?? Number(endInstant.since(startInstant).total("minutes")),
		clockInOffsetMinutes: offsetMinutes,
		clockOutOffsetMinutes: offsetMinutes,
	};
}

function earnings(input: {
	rows: WageTermsRow[];
	workPeriods: WageWorkPeriod[];
	startDate: string;
	endDate: string;
	timezone: string;
}) {
	return calculateHourlyEarningsFromTerms({
		spans: confirmedTermsSpans(input.rows, input.timezone),
		workPeriods: input.workPeriods,
		range: resolveReportDateRange(input.startDate, input.endDate, input.timezone),
	});
}

const january = { startDate: "2026-01-01", endDate: "2026-01-31", timezone: "Europe/Berlin" };

describe("calculateHourlyEarningsFromTerms", () => {
	it("pays a Berlin 22:00 to 02:00 shift 2 h at each wage when the wage changes that night", () => {
		const result = earnings({
			...january,
			rows: [terms("2025-06-01", "2026-01-16", hourly(20)), terms("2026-01-16", null, hourly(30))],
			// 22:00 on 15 January to 02:00 on 16 January, Berlin time (UTC+1).
			workPeriods: [work("2026-01-15T21:00:00Z", "2026-01-16T01:00:00Z", 60)],
		});

		expect(result?.byRatePeriod).toEqual([
			{
				rate: 20,
				currency: "EUR",
				periodStart: "2026-01-01",
				periodEnd: "2026-01-15",
				hours: 2,
				earnings: 40,
			},
			{
				rate: 30,
				currency: "EUR",
				periodStart: "2026-01-16",
				periodEnd: "2026-01-31",
				hours: 2,
				earnings: 60,
			},
		]);
		expect(result).toMatchObject({ totalHours: 4, totalEarnings: 100, currency: "EUR" });
	});

	it("pays work up to the 14th when the employee switched from hourly to fixed on the 15th", () => {
		const result = earnings({
			startDate: "2026-03-01",
			endDate: "2026-03-31",
			timezone: "Europe/Berlin",
			rows: [terms("2026-01-01", "2026-03-15", hourly(25)), terms("2026-03-15", null, fixed)],
			workPeriods: [
				work("2026-03-14T07:00:00Z", "2026-03-14T15:00:00Z", 60),
				work("2026-03-16T07:00:00Z", "2026-03-16T15:00:00Z", 60),
			],
		});

		expect(result).toEqual({
			totalHours: 8,
			totalEarnings: 200,
			currency: "EUR",
			byRatePeriod: [
				{
					rate: 25,
					currency: "EUR",
					periodStart: "2026-03-01",
					periodEnd: "2026-03-14",
					hours: 8,
					earnings: 200,
				},
			],
		});
	});

	it("reports no earnings when no hourly terms are in force during the range", () => {
		const result = earnings({
			...january,
			rows: [terms("2025-01-01", null, fixed)],
			workPeriods: [work("2026-01-10T07:00:00Z", "2026-01-10T15:00:00Z", 60)],
		});

		expect(result).toBeUndefined();
	});

	it("reports zero earnings for hourly terms without work", () => {
		const result = earnings({
			...january,
			rows: [terms("2025-01-01", null, hourly(20))],
			workPeriods: [],
		});

		expect(result).toEqual({ totalHours: 0, totalEarnings: 0, currency: "EUR", byRatePeriod: [] });
	});

	it("earns nothing for work no confirmed terms cover", () => {
		const result = earnings({
			...january,
			rows: [terms("2026-01-20", null, hourly(20))],
			workPeriods: [
				work("2026-01-10T07:00:00Z", "2026-01-10T15:00:00Z", 60),
				work("2026-01-21T07:00:00Z", "2026-01-21T09:00:00Z", 60),
			],
		});

		expect(result).toMatchObject({ totalHours: 2, totalEarnings: 40 });
	});

	it("uses the recorded duration, net of breaks", () => {
		const result = earnings({
			...january,
			rows: [terms("2025-01-01", null, hourly(24))],
			workPeriods: [work("2026-01-10T07:00:00Z", "2026-01-10T15:00:00Z", 60, 420)],
		});

		expect(result).toMatchObject({ totalHours: 7, totalEarnings: 168 });
	});

	it("counts only the part of a shift inside the report range", () => {
		const result = earnings({
			...january,
			rows: [terms("2025-01-01", null, hourly(10))],
			// 22:00 on 31 January to 02:00 on 1 February, Berlin time.
			workPeriods: [work("2026-01-31T21:00:00Z", "2026-02-01T01:00:00Z", 60)],
		});

		expect(result).toMatchObject({ totalHours: 2, totalEarnings: 20 });
	});

	it("rejects hourly work under terms that carry no wage", () => {
		expect(() =>
			earnings({
				...january,
				rows: [terms("2025-01-01", null, hourly(null))],
				workPeriods: [work("2026-01-10T07:00:00Z", "2026-01-10T15:00:00Z", 60)],
			}),
		).toThrow(
			expect.objectContaining<Partial<HourlyEarningsIntegrityError>>({ code: "missing_rate" }),
		);
	});

	it("rejects currencies mixed across worked terms", () => {
		expect(() =>
			earnings({
				...january,
				rows: [
					terms("2025-01-01", "2026-01-16", hourly(20)),
					terms("2026-01-16", null, hourly(30, "USD")),
				],
				workPeriods: [work("2026-01-15T21:00:00Z", "2026-01-16T01:00:00Z", 60)],
			}),
		).toThrow(
			expect.objectContaining<Partial<HourlyEarningsIntegrityError>>({
				code: "mixed_currencies",
			}),
		);
	});
});
