import { describe, expect, it } from "vitest";
import {
	conversionRequirements,
	convertPolicyAmount,
	convertToReimbursement,
	type ItemConversion,
	isReimbursementCurrencySupported,
	MAX_RATE_EVIDENCE_LENGTH,
	manualRateDateProblem,
	normalizeRate,
	parseCardChargeAmount,
	parseManualRateInput,
} from "../currency-conversion";

const cardCharge: ItemConversion = {
	basis: "card_charge",
	sourceCurrency: "USD",
	targetCurrency: "EUR",
	chargedAmount: "92.17",
	evidenceReceiptId: "receipt-1",
};

function manualRate(rate: { base: string; quote: string; value: string }): ItemConversion {
	return {
		basis: "manual_rate",
		sourceCurrency: "USD",
		targetCurrency: "EUR",
		rate,
		rateDate: "2026-09-12",
		reason: "Bank statement rate of the travel card",
		evidence: "Card statement 2026-09, line 14",
		authorizedBy: { employeeId: "admin-1", name: "Alex Admin" },
		authorizedAt: "2026-09-20T08:00:00Z",
	};
}

const usd = { amount: "100.00", currency: "USD" };

describe("receipt conversion contract", () => {
	it("uses a receipt in the reimbursement currency as it is", () => {
		expect(convertToReimbursement({ amount: "89.90", currency: "EUR" }, "EUR", null)).toEqual({
			kind: "same_currency",
		});
	});

	it("never guesses a rate for a foreign receipt without a conversion", () => {
		expect(convertToReimbursement(usd, "EUR", null)).toEqual({ kind: "missing" });
		expect(conversionRequirements(usd, "EUR", null)).toEqual(["conversion_missing"]);
	});

	it("reimburses the evidenced card charge exactly, without rounding", () => {
		expect(convertToReimbursement(usd, "EUR", cardCharge)).toEqual({
			kind: "converted",
			units: BigInt(9217),
			reimbursement: { amount: "92.17", currency: "EUR" },
			applied: { basis: "card_charge", evidenceReceiptId: "receipt-1" },
		});
		expect(conversionRequirements(usd, "EUR", cardCharge)).toEqual([]);
	});

	it("requires the card charge evidence while still showing its result", () => {
		const unevidenced = { ...cardCharge, evidenceReceiptId: null };
		expect(convertToReimbursement(usd, "EUR", unevidenced)).toMatchObject({
			kind: "converted",
			reimbursement: { amount: "92.17", currency: "EUR" },
		});
		expect(conversionRequirements(usd, "EUR", unevidenced)).toEqual(["conversion_evidence"]);
	});

	it("multiplies by a rate quoted per unit of the receipt currency, rounding half up once", () => {
		// 123.45 × 0.9215 = 113.759175 → 113.76
		const result = convertToReimbursement(
			{ amount: "123.45", currency: "USD" },
			"EUR",
			manualRate({ base: "USD", quote: "EUR", value: "0.9215" }),
		);
		expect(result).toMatchObject({
			kind: "converted",
			units: BigInt(11376),
			reimbursement: { amount: "113.76", currency: "EUR" },
			applied: {
				basis: "manual_rate",
				rate: { base: "USD", quote: "EUR", value: "0.9215" },
				rateDate: "2026-09-12",
				reason: "Bank statement rate of the travel card",
				evidence: "Card statement 2026-09, line 14",
				authorizedBy: { employeeId: "admin-1", name: "Alex Admin" },
				authorizedAt: "2026-09-20T08:00:00Z",
				rounding: { mode: "half_up", minorUnitDigits: 2 },
			},
		});
		// 0.25 × 0.1 = 0.025 → 0.03 (half up, not half even)
		expect(
			convertToReimbursement(
				{ amount: "0.25", currency: "USD" },
				"EUR",
				manualRate({ base: "USD", quote: "EUR", value: "0.1" }),
			),
		).toMatchObject({ reimbursement: { amount: "0.03" } });
	});

	it("divides by a rate quoted the other way round (1 EUR = x USD)", () => {
		// 100 / 1.0850 = 92.1658… → 92.17
		expect(
			convertToReimbursement(
				usd,
				"EUR",
				manualRate({ base: "EUR", quote: "USD", value: "1.0850" }),
			),
		).toMatchObject({ kind: "converted", reimbursement: { amount: "92.17", currency: "EUR" } });
	});

	it("rounds to the reimbursement currency's minor units and stores two decimals", () => {
		const yen: ItemConversion = {
			...manualRate({ base: "USD", quote: "JPY", value: "149.555" }),
			targetCurrency: "JPY",
		};
		// 100 × 149.555 = 14955.5 → 14956 yen, stored as "14956.00"
		expect(convertToReimbursement(usd, "JPY", yen)).toMatchObject({
			reimbursement: { amount: "14956.00", currency: "JPY" },
			applied: { rounding: { mode: "half_up", minorUnitDigits: 0 } },
		});
	});

	it("treats a conversion recorded for another currency pair as missing", () => {
		// The receipt currency changed after the charge was recorded.
		expect(
			convertToReimbursement({ amount: "100.00", currency: "GBP" }, "EUR", cardCharge),
		).toEqual({ kind: "missing" });
		// A rate that does not quote the receipt's currency pair is never applied.
		expect(
			convertToReimbursement(usd, "EUR", manualRate({ base: "GBP", quote: "EUR", value: "1.1" })),
		).toEqual({ kind: "missing" });
	});

	it("refuses a reimbursement currency whose minor units cannot be stored", () => {
		const dinar = { ...cardCharge, targetCurrency: "KWD", chargedAmount: "30.00" };
		expect(convertToReimbursement(usd, "KWD", dinar)).toEqual({
			kind: "unsupported",
			reason: "reimbursement_currency",
		});
		expect(conversionRequirements(usd, "KWD", dinar)).toEqual(["conversion_unsupported"]);
	});

	it("never turns a positive receipt into a zero reimbursement", () => {
		expect(
			convertToReimbursement(
				{ amount: "0.01", currency: "USD" },
				"EUR",
				manualRate({ base: "USD", quote: "EUR", value: "0.4" }),
			),
		).toEqual({ kind: "unsupported", reason: "result_out_of_range" });
	});

	it("leaves an incomplete amount to the amount requirement", () => {
		expect(conversionRequirements({ amount: null, currency: "USD" }, "EUR", null)).toEqual([]);
	});
});

describe("policy-currency conversion contract", () => {
	it("uses a policy amount in the reimbursement currency as it is", () => {
		expect(convertPolicyAmount({ amount: "0.30", currency: "EUR" }, "EUR")).toEqual({
			kind: "same_currency",
			amount: "0.30",
		});
	});

	it("refuses a policy amount in another currency instead of inventing a rate", () => {
		expect(convertPolicyAmount({ amount: "0.30", currency: "CHF" }, "EUR")).toEqual({
			kind: "unsupported",
			reason: "policy_currency",
		});
	});
});

describe("isReimbursementCurrencySupported", () => {
	it("allows currencies whose minor units fit two stored decimals", () => {
		expect(["EUR", "CHF", "USD", "JPY"].map(isReimbursementCurrencySupported)).toEqual([
			true,
			true,
			true,
			true,
		]);
	});

	it("refuses three-decimal currencies, unknown and malformed codes", () => {
		expect(["KWD", "BHD", "XYZ", "eur", "EURO"].map(isReimbursementCurrencySupported)).toEqual([
			false,
			false,
			false,
			false,
			false,
		]);
	});
});

describe("normalizeRate", () => {
	it("drops the stored padding but keeps every significant digit", () => {
		expect(normalizeRate("0.9215000000")).toBe("0.9215");
		expect(normalizeRate("150.0000000000")).toBe("150");
		expect(normalizeRate("0")).toBeNull();
	});
});

describe("parseCardChargeAmount", () => {
	it("accepts a positive charge with the reimbursement currency's precision", () => {
		expect(parseCardChargeAmount("92.1", "EUR")).toBe("92.10");
		expect(parseCardChargeAmount("14956", "JPY")).toBe("14956.00");
	});

	it("accepts a decimal comma like the other amount fields", () => {
		expect(parseCardChargeAmount("257,30", "EUR")).toBe("257.30");
		expect(parseCardChargeAmount(" 92,1 ", "EUR")).toBe("92.10");
	});

	it("refuses zero, negative, oversized, over-precise and malformed charges", () => {
		for (const value of [
			"0",
			"-1.00",
			"1000000000.00",
			"92.171",
			"92,171",
			"1.234,50",
			"abc",
			"",
		]) {
			expect(parseCardChargeAmount(value, "EUR")).toBeNull();
		}
		expect(parseCardChargeAmount("14956.5", "JPY")).toBeNull();
		expect(parseCardChargeAmount("30.000", "KWD")).toBeNull();
	});
});

describe("parseManualRateInput", () => {
	const pair = { sourceCurrency: "USD", targetCurrency: "EUR" };
	const expenseDate = "2026-09-14";
	const valid = {
		base: "USD",
		quote: "EUR",
		rate: "0.9215",
		rateDate: "2026-09-12",
		reason: "  Bank statement rate  ",
		evidence: "  Card statement 2026-09, line 14  ",
	};
	const parse = (input: typeof valid, date: string | null = expenseDate) =>
		parseManualRateInput(input, pair, date);

	it("normalizes a rate quoted for the receipt's pair in either direction", () => {
		expect(parse(valid)).toEqual({
			ok: true,
			value: {
				rate: { base: "USD", quote: "EUR", value: "0.9215" },
				rateDate: "2026-09-12",
				reason: "Bank statement rate",
				evidence: "Card statement 2026-09, line 14",
			},
		});
		expect(parse({ ...valid, base: "EUR", quote: "USD", rate: "1.085" })).toEqual(
			expect.objectContaining({ ok: true }),
		);
	});

	it("accepts a rate entered with a decimal comma", () => {
		expect(parse({ ...valid, rate: "0,9215" })).toEqual(
			expect.objectContaining({
				ok: true,
				value: expect.objectContaining({
					rate: { base: "USD", quote: "EUR", value: "0.9215" },
				}),
			}),
		);
	});

	it("refuses another pair, a bad rate, a bad date and a missing reason", () => {
		expect(parse({ ...valid, base: "GBP" })).toEqual({
			ok: false,
			errors: { pair: "invalid_pair" },
		});
		expect(parse({ ...valid, base: "EUR", quote: "EUR" })).toEqual({
			ok: false,
			errors: { pair: "invalid_pair" },
		});
		for (const rate of ["0", "-0.9", "0.12345678901", "1e3", "1234567890123"]) {
			expect(parse({ ...valid, rate })).toEqual({
				ok: false,
				errors: { rate: "invalid_rate" },
			});
		}
		expect(parse({ ...valid, rateDate: "2026-02-30" })).toEqual({
			ok: false,
			errors: { rateDate: "invalid_date" },
		});
		expect(parse({ ...valid, reason: " " })).toEqual({
			ok: false,
			errors: { reason: "required" },
		});
		expect(parse({ ...valid, reason: "x".repeat(501) })).toEqual({
			ok: false,
			errors: { reason: "too_long" },
		});
	});

	it("requires an evidence reference for the rate", () => {
		expect(parse({ ...valid, evidence: "  " })).toEqual({
			ok: false,
			errors: { evidence: "required" },
		});
		expect(parse({ ...valid, evidence: "x".repeat(MAX_RATE_EVIDENCE_LENGTH + 1) })).toEqual({
			ok: false,
			errors: { evidence: "too_long" },
		});
		expect(parse({ ...valid, evidence: "x".repeat(MAX_RATE_EVIDENCE_LENGTH) })).toMatchObject({
			ok: true,
		});
	});

	it("accepts a rate dated on the expense date or up to 31 days before it", () => {
		for (const rateDate of ["2026-09-14", "2026-09-01", "2026-08-14"]) {
			expect(parse({ ...valid, rateDate })).toMatchObject({ ok: true, value: { rateDate } });
		}
	});

	it("refuses a rate dated after the expense, too long before it, or without an expense date", () => {
		expect(parse({ ...valid, rateDate: "2026-09-15" })).toEqual({
			ok: false,
			errors: { rateDate: "after_expense_date" },
		});
		expect(parse({ ...valid, rateDate: "2026-08-13" })).toEqual({
			ok: false,
			errors: { rateDate: "too_early" },
		});
		expect(parse(valid, null)).toEqual({
			ok: false,
			errors: { rateDate: "expense_date_missing" },
		});
	});
});

describe("manualRateDateProblem", () => {
	it("compares zoneless calendar dates across month and year ends", () => {
		expect(manualRateDateProblem("2025-12-31", "2026-01-01")).toBeNull();
		expect(manualRateDateProblem("2026-01-31", "2026-03-03")).toBeNull();
		expect(manualRateDateProblem("2026-01-30", "2026-03-03")).toBe("too_early");
		expect(manualRateDateProblem("2026-03-04", "2026-03-03")).toBe("after_expense_date");
		expect(manualRateDateProblem("not-a-date", "2026-03-03")).toBe("too_early");
	});
});

describe("conversionRequirements for an authorized rate", () => {
	const rate = manualRate({ base: "USD", quote: "EUR", value: "0.9215" });

	it("keeps counting a rate whose date fits the expense date", () => {
		expect(conversionRequirements({ ...usd, expenseDate: "2026-09-14" }, "EUR", rate)).toEqual([]);
	});

	it("asks for a new rate once the expense date moved away from the rate date", () => {
		for (const expenseDate of ["2026-09-11", "2026-10-14"]) {
			expect(conversionRequirements({ ...usd, expenseDate }, "EUR", rate)).toEqual([
				"conversion_rate_date",
			]);
		}
	});

	it("leaves a missing expense date to the expense date requirement", () => {
		expect(conversionRequirements({ ...usd, expenseDate: null }, "EUR", rate)).toEqual([]);
	});
});
