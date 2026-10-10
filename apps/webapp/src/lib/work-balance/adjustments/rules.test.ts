import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	openingBalanceMinutes,
	payoutMinutes,
	refuseOpeningBalance,
	refuseOvertimePayout,
} from "./rules";

const today = parsePlainDate("2026-10-10");

describe("opening balance amount (#997)", () => {
	it("turns a sign, hours and minutes into signed minutes, zero included", () => {
		expect(openingBalanceMinutes({ negative: false, hours: 14, minutes: 0 })).toBe(840);
		expect(openingBalanceMinutes({ negative: true, hours: 0, minutes: 30 })).toBe(-30);
		expect(openingBalanceMinutes({ negative: true, hours: 20, minutes: 30 })).toBe(-1230);
		expect(openingBalanceMinutes({ negative: false, hours: 0, minutes: 0 })).toBe(0);
		expect(openingBalanceMinutes({ negative: true, hours: 0, minutes: 0 })).toBe(0);
	});

	it("rejects amounts that are not whole hours and minutes under an hour", () => {
		expect(openingBalanceMinutes({ negative: false, hours: -1, minutes: 0 })).toBeNull();
		expect(openingBalanceMinutes({ negative: false, hours: 1, minutes: 60 })).toBeNull();
		expect(openingBalanceMinutes({ negative: true, hours: 1.5, minutes: 0 })).toBeNull();
		expect(openingBalanceMinutes({ negative: false, hours: Number.NaN, minutes: 0 })).toBeNull();
	});
});

describe("refusing an opening balance (#997)", () => {
	const payout = (day: string) => ({ id: `payout-${day}`, day, minutes: -60 });

	it("accepts a day up to today when every payout is after it", () => {
		expect(
			refuseOpeningBalance({
				day: parsePlainDate("2026-10-08"),
				today,
				uncancelledPayouts: [payout("2026-10-09")],
			}),
		).toBeNull();
		expect(refuseOpeningBalance({ day: today, today, uncancelledPayouts: [] })).toBeNull();
		expect(
			refuseOpeningBalance({
				day: parsePlainDate("2025-10-31"),
				today,
				uncancelledPayouts: [],
			}),
		).toBeNull();
	});

	it("refuses a day after today", () => {
		expect(
			refuseOpeningBalance({
				day: parsePlainDate("2026-10-11"),
				today,
				uncancelledPayouts: [],
			}),
		).toEqual({ code: "future_day" });
	});

	it("refuses a day on or after the day of uncancelled payouts and lists them", () => {
		expect(
			refuseOpeningBalance({
				day: parsePlainDate("2026-10-01"),
				today,
				uncancelledPayouts: [payout("2026-09-30"), payout("2026-10-01"), payout("2026-10-05")],
			}),
		).toEqual({
			code: "conflicting_payouts",
			conflictingPayouts: [payout("2026-09-30"), payout("2026-10-01")],
		});
	});

	it("refuses a day in a closed month", () => {
		expect(
			refuseOpeningBalance({
				day: parsePlainDate("2026-09-30"),
				today,
				uncancelledPayouts: [],
				dayInClosedMonth: true,
			}),
		).toEqual({ code: "month_closed" });
	});
});

describe("overtime payout amount", () => {
	it("turns hours and minutes into minutes", () => {
		expect(payoutMinutes({ hours: 5, minutes: 0 })).toBe(300);
		expect(payoutMinutes({ hours: 0, minutes: 45 })).toBe(45);
		expect(payoutMinutes({ hours: 2, minutes: 30 })).toBe(150);
	});

	it("rejects amounts that are not whole hours and minutes under an hour", () => {
		expect(payoutMinutes({ hours: -1, minutes: 0 })).toBeNull();
		expect(payoutMinutes({ hours: 1, minutes: 60 })).toBeNull();
		expect(payoutMinutes({ hours: 1.5, minutes: 0 })).toBeNull();
		expect(payoutMinutes({ hours: Number.NaN, minutes: 0 })).toBeNull();
	});
});

describe("refusing an overtime payout", () => {
	it("accepts a payout up to the balance at the end of its day", () => {
		expect(
			refuseOvertimePayout({
				amountMinutes: 300,
				day: parsePlainDate("2026-10-01"),
				today,
				balanceAtEndOfDayMinutes: 720,
			}),
		).toBeNull();
		expect(
			refuseOvertimePayout({
				amountMinutes: 720,
				day: today,
				today,
				balanceAtEndOfDayMinutes: 720,
			}),
		).toBeNull();
	});

	it("refuses a payout of zero or less", () => {
		for (const amountMinutes of [0, -30]) {
			expect(
				refuseOvertimePayout({
					amountMinutes,
					day: today,
					today,
					balanceAtEndOfDayMinutes: 720,
				}),
			).toBe("amount_not_positive");
		}
	});

	it("refuses a payout dated after today", () => {
		expect(
			refuseOvertimePayout({
				amountMinutes: 60,
				day: parsePlainDate("2026-10-11"),
				today,
				balanceAtEndOfDayMinutes: 720,
			}),
		).toBe("future_day");
	});

	it("refuses a payout on or before the day of the opening balance in effect (#997)", () => {
		const openingBalanceDay = parsePlainDate("2026-10-01");
		for (const day of ["2026-09-15", "2026-10-01"]) {
			expect(
				refuseOvertimePayout({
					amountMinutes: 60,
					day: parsePlainDate(day),
					today,
					balanceAtEndOfDayMinutes: 720,
					openingBalanceDay,
				}),
			).toBe("before_opening_balance");
		}
		expect(
			refuseOvertimePayout({
				amountMinutes: 60,
				day: parsePlainDate("2026-10-02"),
				today,
				balanceAtEndOfDayMinutes: 720,
				openingBalanceDay,
			}),
		).toBeNull();
	});

	it("refuses a payout of more than the balance at the end of its day", () => {
		expect(
			refuseOvertimePayout({
				amountMinutes: 1200,
				day: today,
				today,
				balanceAtEndOfDayMinutes: 720,
			}),
		).toBe("exceeds_balance");
		expect(
			refuseOvertimePayout({
				amountMinutes: 1,
				day: today,
				today,
				balanceAtEndOfDayMinutes: -60,
			}),
		).toBe("exceeds_balance");
	});
});
