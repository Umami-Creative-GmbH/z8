import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	appliedConversion,
	conversionRequirements,
	convertToReimbursement,
	type ItemConversion,
} from "../currency-conversion";
import { receiptReportTotals } from "../receipt-report";
import { pickReferencePublication, resolveReferenceRate } from "../reference-rate";
import { referenceRateConversion, referenceRateReloadNeeded } from "../reference-rate-conversion";

/** #608: an applied reference rate prices a foreign expense like a documented rate. */

const source = {
	provider: "ecb" as const,
	publicationId: "pub-2026-04-02",
	publicationVersion: 1,
	contentSha256: "f".repeat(64),
	retrievedAt: "2026-04-02T15:00:00Z",
	policyApprovedAt: "2026-03-01T09:00:00Z",
};

const usdTaxi: ItemConversion = {
	basis: "reference_rate",
	sourceCurrency: "USD",
	targetCurrency: "EUR",
	rate: { base: "EUR", quote: "USD", value: "1.1525" },
	rateDate: "2026-04-02",
	expenseDate: "2026-04-05",
	source,
};

describe("referenceRateReloadNeeded", () => {
	const loaded = { expenseDate: "2026-04-05", currency: "USD" };
	it("reloads once a saved date or currency changes the rate lookup", () => {
		expect(referenceRateReloadNeeded("ecb", loaded, { ...loaded, expenseDate: "2026-04-07" })).toBe(
			true,
		);
		expect(referenceRateReloadNeeded("ecb", loaded, { ...loaded, currency: "GBP" })).toBe(true);
	});
	it("does not reload for other edits or without an approved source", () => {
		expect(referenceRateReloadNeeded("ecb", loaded, { ...loaded })).toBe(false);
		expect(referenceRateReloadNeeded(null, loaded, { ...loaded, currency: "GBP" })).toBe(false);
	});
});

describe("reference-rate conversion", () => {
	it("divides by a published EUR rate, rounding once half up, and keeps the publication", () => {
		// 100.00 / 1.1525 = 86.7678…
		const outcome = convertToReimbursement({ amount: "100.00", currency: "USD" }, "EUR", usdTaxi);
		expect(outcome).toEqual({
			kind: "converted",
			units: BigInt(8677),
			reimbursement: { amount: "86.77", currency: "EUR" },
			applied: {
				basis: "reference_rate",
				rate: { base: "EUR", quote: "USD", value: "1.1525" },
				rateDate: "2026-04-02",
				expenseDate: "2026-04-05",
				source,
				rounding: { mode: "half_up", minorUnitDigits: 2 },
			},
		});
		expect(conversionRequirements({ amount: "100.00", currency: "USD" }, "EUR", usdTaxi)).toEqual(
			[],
		);
	});

	it("multiplies when the reimbursement currency is the quoted one", () => {
		const eurToChf: ItemConversion = {
			...usdTaxi,
			sourceCurrency: "EUR",
			targetCurrency: "CHF",
			rate: { base: "EUR", quote: "CHF", value: "0.9242" },
		};
		expect(
			appliedConversion({ amount: "100.00", currency: "EUR" }, "CHF", eurToChf)?.reimbursement,
		).toEqual({ amount: "92.42", currency: "CHF" });
	});

	it("does not apply to another currency pair", () => {
		expect(convertToReimbursement({ amount: "100.00", currency: "GBP" }, "EUR", usdTaxi)).toEqual({
			kind: "missing",
		});
	});

	it("counts the converted amount in the report totals", () => {
		const totals = receiptReportTotals(
			[{ amount: "100.00", currency: "USD", paidBy: "employee", conversion: usdTaxi }],
			"EUR",
		);
		expect(totals).toMatchObject({ reimbursable: "86.77", excludedItemCount: 0 });
	});

	it("builds the item conversion from a resolved publication and the approved policy", () => {
		const publication = {
			id: "pub-2026-04-02",
			provider: "ecb" as const,
			publicationDate: "2026-04-02",
			version: 1,
			rates: { USD: "1.1525", CHF: "0.9213" },
			contentSha256: "f".repeat(64),
			retrievedAt: "2026-04-02T15:00:00Z",
		};
		const resolution = resolveReferenceRate({
			expenseDate: "2026-04-05",
			sourceCurrency: "USD",
			targetCurrency: "EUR",
			...pickReferencePublication([publication], "2026-04-05"),
			coverage: { historyFrom: "2026-01-01", latestSuccessAt: "2026-04-07T15:00:00Z" },
			now: Temporal.Instant.from("2026-04-07T15:00:00Z"),
		});
		if (resolution.status !== "applied") throw new Error("expected an applied rate");
		expect(
			referenceRateConversion(resolution, {
				sourceCurrency: "USD",
				targetCurrency: "EUR",
				expenseDate: "2026-04-05",
				policyApprovedAt: "2026-03-01T09:00:00Z",
			}),
		).toEqual(usdTaxi);
	});
});
