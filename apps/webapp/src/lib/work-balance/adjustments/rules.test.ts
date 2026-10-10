import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { payoutMinutes, refuseOvertimePayout } from "./rules";

const today = parsePlainDate("2026-10-10");

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
