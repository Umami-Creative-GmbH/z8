import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { confirmedTermsSpans } from "./terms-in-force";
import { type WageTermsRow, type WageWorkPeriod, wagePeriodsForWork } from "./wage-periods";

type Row = WageTermsRow & { id: string };

const utcMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

function terms(
	id: string,
	validFrom: string,
	validUntil: string | null,
	contract: { contractType: Row["contractType"]; hourlyRate: number | null },
): Row {
	return {
		id,
		validFrom: utcMidnight(validFrom),
		validUntil: validUntil ? utcMidnight(validUntil) : null,
		reviewState: "confirmed",
		currency: "EUR",
		...contract,
	};
}

function work(
	start: string,
	end: string,
	clockInOffsetMinutes: number,
	clockOutOffsetMinutes = clockInOffsetMinutes,
): WageWorkPeriod {
	const startInstant = parseInstant(start);
	const endInstant = parseInstant(end);
	return {
		start: startInstant,
		end: endInstant,
		durationMinutes: Number(endInstant.since(startInstant).total("minutes")),
		clockInOffsetMinutes,
		clockOutOffsetMinutes,
	};
}

function summarize(rows: Row[], workPeriods: WageWorkPeriod[], timezone: string) {
	return wagePeriodsForWork(confirmedTermsSpans(rows, timezone), workPeriods).map((piece) => ({
		terms: piece.span?.terms.id ?? null,
		wage: piece.wage,
		start: piece.start.toString(),
		end: piece.end.toString(),
		minutes: piece.durationMs / 60_000,
	}));
}

const hourly = (hourlyRate: number | null) => ({ contractType: "hourly" as const, hourlyRate });
const fixed = { contractType: "fixed" as const, hourlyRate: null };

describe("wagePeriodsForWork", () => {
	it("splits a Berlin night shift at local midnight of the wage change", () => {
		const rows = [
			terms("old", "2026-01-01", "2026-03-10", hourly(20)),
			terms("new", "2026-03-10", null, hourly(25)),
		];
		// 22:00 on 9 March to 02:00 on 10 March, Berlin winter time (UTC+1).
		const shift = work("2026-03-09T21:00:00Z", "2026-03-10T01:00:00Z", 60);

		expect(summarize(rows, [shift], "Europe/Berlin")).toEqual([
			{
				terms: "old",
				wage: { kind: "hourly", rate: 20, currency: "EUR" },
				start: "2026-03-09T21:00:00Z",
				end: "2026-03-09T23:00:00Z",
				minutes: 120,
			},
			{
				terms: "new",
				wage: { kind: "hourly", rate: 25, currency: "EUR" },
				start: "2026-03-09T23:00:00Z",
				end: "2026-03-10T01:00:00Z",
				minutes: 120,
			},
		]);
	});

	it("splits a New York night shift at local midnight of the wage change", () => {
		const rows = [
			terms("old", "2026-01-01", "2026-02-10", hourly(20)),
			terms("new", "2026-02-10", null, hourly(25)),
		];
		// 22:00 on 9 February to 02:00 on 10 February, New York (UTC-5).
		const shift = work("2026-02-10T03:00:00Z", "2026-02-10T07:00:00Z", -300);

		expect(
			summarize(rows, [shift], "America/New_York").map(({ terms, minutes, end }) => ({
				terms,
				minutes,
				end,
			})),
		).toEqual([
			{ terms: "old", minutes: 120, end: "2026-02-10T05:00:00Z" },
			{ terms: "new", minutes: 120, end: "2026-02-10T07:00:00Z" },
		]);
	});

	it("opens the later terms at the clock-in offset when the offsets differ", () => {
		const rows = [
			terms("old", "2026-01-01", "2026-03-29", hourly(20)),
			terms("new", "2026-03-29", null, hourly(25)),
		];
		// Berlin switches to summer time overnight: in at 22:00 (UTC+1), out at 06:00 (UTC+2).
		const shift = work("2026-03-28T21:00:00Z", "2026-03-29T04:00:00Z", 60, 120);

		expect(
			summarize(rows, [shift], "Europe/Berlin").map(({ terms, minutes }) => ({ terms, minutes })),
		).toEqual([
			{ terms: "old", minutes: 120 },
			{ terms: "new", minutes: 300 },
		]);
	});

	it("closes terms with no successor at the clock-out offset", () => {
		const rows = [terms("last", "2026-01-01", "2026-02-10", hourly(20))];
		// In at 20:00 in Berlin (UTC+1), out at 01:00 the next day in New York (UTC-5).
		const shift = work("2026-02-09T19:00:00Z", "2026-02-10T06:00:00Z", 60, -300);

		expect(
			summarize(rows, [shift], "Europe/Berlin").map(({ terms, wage, minutes }) => ({
				terms,
				wage,
				minutes,
			})),
		).toEqual([
			{ terms: "last", wage: { kind: "hourly", rate: 20, currency: "EUR" }, minutes: 600 },
			{ terms: null, wage: { kind: "no_terms" }, minutes: 60 },
		]);
	});

	it("reports work under fixed terms as earning no wage", () => {
		const rows = [
			terms("hourly", "2026-01-01", "2026-03-15", hourly(20)),
			terms("fixed", "2026-03-15", null, fixed),
		];
		const shift = work("2026-03-14T21:00:00Z", "2026-03-15T01:00:00Z", 60);

		expect(
			summarize(rows, [shift], "Europe/Berlin").map(({ terms, wage, minutes }) => ({
				terms,
				wage,
				minutes,
			})),
		).toEqual([
			{ terms: "hourly", wage: { kind: "hourly", rate: 20, currency: "EUR" }, minutes: 120 },
			{ terms: "fixed", wage: { kind: "fixed" }, minutes: 120 },
		]);
	});

	it("reports hourly work whose terms carry no wage", () => {
		const rows = [terms("unpaid", "2026-01-01", null, hourly(null))];
		const shift = work("2026-03-02T08:00:00Z", "2026-03-02T12:00:00Z", 60);

		expect(
			summarize(rows, [shift], "Europe/Berlin").map(({ terms, wage, minutes }) => ({
				terms,
				wage,
				minutes,
			})),
		).toEqual([{ terms: "unpaid", wage: { kind: "missing_wage" }, minutes: 240 }]);
	});

	it("apportions the recorded duration, net of breaks, by elapsed share", () => {
		const rows = [
			terms("old", "2026-01-01", "2026-03-10", hourly(20)),
			terms("new", "2026-03-10", null, hourly(25)),
		];
		const shift = {
			...work("2026-03-09T21:00:00Z", "2026-03-10T01:00:00Z", 60),
			durationMinutes: 180,
		};

		expect(summarize(rows, [shift], "Europe/Berlin").map(({ minutes }) => minutes)).toEqual([
			90, 90,
		]);
	});
});
