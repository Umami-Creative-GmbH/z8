import { describe, expect, it } from "vitest";
import {
	fromStoredCompensation,
	parseContractorCompensation,
	sameCompensation,
	toStoredCompensation,
} from "./terms";

describe("reading entered contractor terms", () => {
	it("reads an hourly rate in minor units and leaves the day-unit rule out", () => {
		expect(
			parseContractorCompensation({
				basis: "hourly",
				rateAmount: "95,50",
				currency: "eur",
				dayUnitRule: "any_work_full_day",
			}),
		).toEqual({
			ok: true,
			compensation: { basis: "hourly", currency: "EUR", rateMinor: BigInt(9_550) },
		});
	});

	it("requires a day-unit rule for a daily rate", () => {
		expect(
			parseContractorCompensation({ basis: "daily", rateAmount: "650", currency: "EUR" }),
		).toEqual({ ok: false, reason: "invalid_day_unit_rule" });
	});

	it("defaults the half-day threshold to 240 and the standard day to 480 minutes, capped", () => {
		const half = parseContractorCompensation({
			basis: "daily",
			rateAmount: "650",
			currency: "EUR",
			dayUnitRule: "half_and_full_day",
		});
		const prorated = parseContractorCompensation({
			basis: "daily",
			rateAmount: "650",
			currency: "EUR",
			dayUnitRule: "prorated_by_standard_day",
		});

		expect(half.ok && half.compensation).toMatchObject({
			dayUnitRule: { kind: "half_and_full_day", halfDayThresholdMinutes: 240 },
		});
		expect(prorated.ok && prorated.compensation).toMatchObject({
			dayUnitRule: { kind: "prorated_by_standard_day", standardDayMinutes: 480, capAtOneDay: true },
		});
	});

	it.each([0, 1441, 12.5])("refuses %s threshold minutes", (minutes) => {
		expect(
			parseContractorCompensation({
				basis: "daily",
				rateAmount: "650",
				currency: "EUR",
				dayUnitRule: "half_and_full_day",
				halfDayThresholdMinutes: minutes,
			}),
		).toEqual({ ok: false, reason: "invalid_half_day_threshold" });
	});

	it.each([0, 1441])("refuses a standard day of %s minutes", (minutes) => {
		expect(
			parseContractorCompensation({
				basis: "daily",
				rateAmount: "650",
				currency: "EUR",
				dayUnitRule: "prorated_by_standard_day",
				standardDayMinutes: minutes,
			}),
		).toEqual({ ok: false, reason: "invalid_standard_day" });
	});

	it.each([
		["0", "rate_not_positive"],
		["-5", "rate_not_positive"],
		["abc", "invalid_rate"],
		["1000000", "rate_too_large"],
		["10.005", "rate_too_precise"],
	])("refuses the rate %s", (rateAmount, reason) => {
		expect(parseContractorCompensation({ basis: "hourly", rateAmount, currency: "EUR" })).toEqual({
			ok: false,
			reason,
		});
	});

	it("follows the currency's minor units: whole yen, three-digit dinar", () => {
		expect(
			parseContractorCompensation({ basis: "hourly", rateAmount: "5000.5", currency: "JPY" }),
		).toEqual({ ok: false, reason: "rate_too_precise" });
		expect(
			parseContractorCompensation({ basis: "hourly", rateAmount: "12.345", currency: "KWD" }),
		).toMatchObject({ ok: true, compensation: { rateMinor: BigInt(12_345) } });
	});

	it("refuses a code that is not an ISO 4217 currency", () => {
		expect(
			parseContractorCompensation({ basis: "hourly", rateAmount: "10", currency: "EURO" }),
		).toEqual({ ok: false, reason: "invalid_currency" });
		expect(
			parseContractorCompensation({ basis: "hourly", rateAmount: "10", currency: "XYZ" }),
		).toEqual({ ok: false, reason: "invalid_currency" });
	});
});

describe("stored contractor terms", () => {
	it("round-trips through the table's columns", () => {
		const parsed = parseContractorCompensation({
			basis: "daily",
			rateAmount: "650.5",
			currency: "EUR",
			dayUnitRule: "prorated_by_standard_day",
			standardDayMinutes: 450,
			capAtOneDay: false,
		});
		if (!parsed.ok) throw new Error(parsed.reason);

		const stored = toStoredCompensation(parsed.compensation);
		expect(stored).toEqual({
			compensationBasis: "daily",
			rateAmount: "650.50",
			currency: "EUR",
			dayUnitRule: "prorated_by_standard_day",
			halfDayThresholdMinutes: null,
			standardDayMinutes: 450,
			capAtOneDay: false,
		});
		// numeric(12, 3) reads back with three decimals.
		const read = fromStoredCompensation({ ...stored, rateAmount: "650.500" });
		expect(sameCompensation(read, parsed.compensation)).toBe(true);
	});
});
