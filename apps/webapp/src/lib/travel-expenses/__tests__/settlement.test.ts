import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { latestCalendarDate } from "../future-dates";
import {
	computeSettlement,
	type EntitlementComponent,
	parseSettlementCommand,
	planSettlementEntry,
	type SettlementEntryAmount,
} from "../settlement";

const approved = (amount: string, currency = "EUR"): EntitlementComponent => ({
	kind: "approved_submission",
	id: `revision-${amount}-${currency}`,
	currency,
	amount,
});
const reimbursed = (amount: string, currency = "EUR"): SettlementEntryAmount => ({
	kind: "reimbursement",
	amount,
	currency,
});
const recovered = (amount: string, currency = "EUR"): SettlementEntryAmount => ({
	kind: "recovery",
	amount,
	currency,
});

describe("computeSettlement", () => {
	it("shows the whole approved employee-paid entitlement as outstanding before any money is recorded", () => {
		expect(computeSettlement({ entitlement: [approved("329.90")], entries: [] })).toEqual({
			state: "outstanding",
			currencies: [
				{
					currency: "EUR",
					entitlement: "329.90",
					reimbursed: "0.00",
					recovered: "0.00",
					balance: "329.90",
					state: "outstanding",
				},
			],
		});
	});

	it("settles exactly to zero after reimbursements that add up to the entitlement", () => {
		const summary = computeSettlement({
			entitlement: [approved("100.10")],
			entries: [reimbursed("0.10"), reimbursed("100.00")],
		});
		expect(summary.state).toBe("settled");
		expect(summary.currencies[0]).toMatchObject({ reimbursed: "100.10", balance: "0.00" });
	});

	it("applies a signed approved adjustment and shows the resulting overpayment without clamping (spec EUR 500 → 450)", () => {
		const adjustment: EntitlementComponent = {
			kind: "approved_adjustment",
			id: "adjustment-1",
			currency: "EUR",
			amount: "-50.00",
		};
		const overpaid = computeSettlement({
			entitlement: [approved("500.00"), adjustment],
			entries: [reimbursed("500.00")],
		});
		expect(overpaid.state).toBe("overpaid");
		expect(overpaid.currencies[0]).toEqual({
			currency: "EUR",
			entitlement: "450.00",
			reimbursed: "500.00",
			recovered: "0.00",
			balance: "-50.00",
			state: "overpaid",
		});

		const afterRecovery = computeSettlement({
			entitlement: [approved("500.00"), adjustment],
			entries: [reimbursed("500.00"), recovered("50.00")],
		});
		expect(afterRecovery.state).toBe("settled");
		expect(afterRecovery.currencies[0]).toMatchObject({ recovered: "50.00", balance: "0.00" });
	});

	it("never sums unlike currencies: each currency keeps its own balance", () => {
		const summary = computeSettlement({
			entitlement: [approved("10.00", "EUR"), approved("1500.00", "JPY")],
			entries: [reimbursed("10.00", "EUR")],
		});
		expect(
			summary.currencies.map(({ currency, balance, state }) => [currency, balance, state]),
		).toEqual([
			["EUR", "0.00", "settled"],
			["JPY", "1500.00", "outstanding"],
		]);
		expect(summary.state).toBe("outstanding");
	});

	it("reports mixed when one currency is outstanding and another overpaid", () => {
		const summary = computeSettlement({
			entitlement: [approved("10.00", "EUR"), approved("5.00", "CHF")],
			entries: [reimbursed("7.00", "CHF")],
		});
		expect(summary.state).toBe("mixed");
	});

	it("is settled with nothing approved and nothing recorded", () => {
		expect(computeSettlement({ entitlement: [], entries: [] })).toEqual({
			state: "settled",
			currencies: [],
		});
	});

	it("refuses stored amounts that are not exact two-decimal values", () => {
		expect(() => computeSettlement({ entitlement: [approved("1.005")], entries: [] })).toThrow(
			RangeError,
		);
		expect(() =>
			computeSettlement({ entitlement: [approved("5.00")], entries: [reimbursed("-1.00")] }),
		).toThrow(RangeError);
	});
});

describe("parseSettlementCommand", () => {
	const valid = {
		kind: "reimbursement",
		amount: "120.5",
		currency: "EUR",
		occurredOn: "2026-10-01",
		reference: "  SEPA 2026-10-01 / 4711 ",
		note: "",
	};

	it("normalizes a valid reimbursement", () => {
		expect(parseSettlementCommand(valid, { latestDate: "2026-10-06" })).toEqual({
			ok: true,
			command: {
				kind: "reimbursement",
				amount: "120.50",
				currency: "EUR",
				occurredOn: "2026-10-01",
				reference: "SEPA 2026-10-01 / 4711",
				note: null,
			},
		});
	});

	it("reports every invalid field", () => {
		const result = parseSettlementCommand(
			{
				kind: "payout",
				amount: "0",
				currency: "euro",
				occurredOn: "2026-02-30",
				reference: "   ",
				note: "x".repeat(1001),
			},
			{ latestDate: "2026-10-06" },
		);
		expect(result).toEqual({
			ok: false,
			errors: [
				{ field: "kind", code: "invalid" },
				{ field: "amount", code: "invalid" },
				{ field: "currency", code: "invalid" },
				{ field: "occurredOn", code: "invalid" },
				{ field: "reference", code: "required" },
				{ field: "note", code: "too_long" },
			],
		});
	});

	it("refuses more precision than the currency has and dates after the latest calendar date", () => {
		const result = parseSettlementCommand(
			{ ...valid, amount: "1500.50", currency: "JPY", occurredOn: "2026-10-07" },
			{ latestDate: "2026-10-06" },
		);
		expect(result).toEqual({
			ok: false,
			errors: [
				{ field: "amount", code: "precision" },
				{ field: "occurredOn", code: "future" },
			],
		});
	});

	it("refuses amounts beyond the stored range and over-long references", () => {
		const result = parseSettlementCommand(
			{ ...valid, amount: "1000000000.00", reference: "r".repeat(201) },
			{ latestDate: "2026-10-06" },
		);
		expect(result).toEqual({
			ok: false,
			errors: [
				{ field: "amount", code: "invalid" },
				{ field: "reference", code: "too_long" },
			],
		});
	});

	it("knows the latest calendar date anywhere on earth for an instant", () => {
		// 2026-10-06T11:00Z is already 2026-10-07 in UTC+14.
		expect(latestCalendarDate(parseInstant("2026-10-06T09:00:00Z"))).toBe("2026-10-06");
		expect(latestCalendarDate(parseInstant("2026-10-06T11:00:00Z"))).toBe("2026-10-07");
	});
});

describe("planSettlementEntry", () => {
	const outstanding = computeSettlement({
		entitlement: [approved("500.00")],
		entries: [reimbursed("200.00")],
	});
	const command = (kind: "reimbursement" | "recovery", amount: string, currency = "EUR") => ({
		kind,
		amount,
		currency,
		occurredOn: "2026-10-01",
		reference: "ref",
		note: null,
	});

	it("records a reimbursement up to the outstanding balance against the balance finance saw", () => {
		expect(
			planSettlementEntry(outstanding, command("reimbursement", "300.00"), {
				currency: "EUR",
				amount: "300.00",
			}),
		).toEqual({ ok: true, balanceBefore: "300.00", balanceAfter: "0.00" });
		expect(
			planSettlementEntry(outstanding, command("reimbursement", "120.00"), {
				currency: "EUR",
				amount: "300.00",
			}),
		).toEqual({ ok: true, balanceBefore: "300.00", balanceAfter: "180.00" });
	});

	it("refuses a command based on a balance that has changed since it was shown", () => {
		expect(
			planSettlementEntry(outstanding, command("reimbursement", "300.00"), {
				currency: "EUR",
				amount: "500.00",
			}),
		).toEqual({ ok: false, reason: "stale_balance", balance: "300.00" });
	});

	it("refuses another currency, more than outstanding, and anything when nothing is outstanding", () => {
		const expected = { currency: "EUR", amount: "300.00" };
		expect(
			planSettlementEntry(outstanding, command("reimbursement", "1.00", "USD"), expected),
		).toEqual({ ok: false, reason: "currency_mismatch", balance: "300.00" });
		expect(planSettlementEntry(outstanding, command("reimbursement", "300.01"), expected)).toEqual({
			ok: false,
			reason: "exceeds_outstanding",
			balance: "300.00",
		});
		const settled = computeSettlement({
			entitlement: [approved("5.00")],
			entries: [reimbursed("5.00")],
		});
		expect(
			planSettlementEntry(settled, command("reimbursement", "1.00"), {
				currency: "EUR",
				amount: "0.00",
			}),
		).toEqual({ ok: false, reason: "nothing_outstanding", balance: "0.00" });
	});

	it("records a recovery only against an overpayment and never beyond it", () => {
		const overpaid = computeSettlement({
			entitlement: [
				approved("500.00"),
				{ kind: "approved_adjustment", id: "a", currency: "EUR", amount: "-50.00" },
			],
			entries: [reimbursed("500.00")],
		});
		const expected = { currency: "EUR", amount: "-50.00" };
		expect(planSettlementEntry(overpaid, command("recovery", "50.00"), expected)).toEqual({
			ok: true,
			balanceBefore: "-50.00",
			balanceAfter: "0.00",
		});
		expect(planSettlementEntry(overpaid, command("recovery", "50.01"), expected)).toEqual({
			ok: false,
			reason: "exceeds_overpayment",
			balance: "-50.00",
		});
		expect(
			planSettlementEntry(outstanding, command("recovery", "1.00"), {
				currency: "EUR",
				amount: "300.00",
			}),
		).toEqual({ ok: false, reason: "no_overpayment", balance: "300.00" });
	});

	it("in full (#754): records only an entry that leaves the whole account reimbursed", () => {
		const expected = { currency: "EUR", amount: "300.00" };
		expect(
			planSettlementEntry(outstanding, command("reimbursement", "300.00"), expected, {
				inFull: true,
			}),
		).toEqual({ ok: true, balanceBefore: "300.00", balanceAfter: "0.00" });
		expect(
			planSettlementEntry(outstanding, command("reimbursement", "120.00"), expected, {
				inFull: true,
			}),
		).toEqual({ ok: false, reason: "not_in_full", balance: "300.00" });
		// EUR is outstanding, but CHF was overpaid: the account needs review first.
		const mixed = computeSettlement({
			entitlement: [approved("300.00"), approved("10.00", "CHF")],
			entries: [reimbursed("15.00", "CHF")],
		});
		expect(mixed.state).toBe("mixed");
		expect(
			planSettlementEntry(mixed, command("reimbursement", "300.00"), expected, { inFull: true }),
		).toEqual({ ok: false, reason: "not_in_full", balance: "300.00" });
		// Without the option, the outstanding currency line can still be paid on its own.
		expect(planSettlementEntry(mixed, command("reimbursement", "300.00"), expected)).toEqual({
			ok: true,
			balanceBefore: "300.00",
			balanceAfter: "0.00",
		});
	});
});
