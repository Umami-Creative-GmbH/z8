import { comparePlainDates, type PlainDate } from "@/lib/datetime/temporal-core";
import type { BalanceAdjustmentErrorCode, ConflictingPayout } from "./types";

/**
 * Hours and minutes as entered, in minutes; null unless both are whole numbers
 * and the minutes stay under an hour.
 */
export function payoutMinutes(input: { hours: number; minutes: number }): number | null {
	const { hours, minutes } = input;
	if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
	if (hours < 0 || minutes < 0 || minutes > 59) return null;
	return hours * 60 + minutes;
}

/**
 * Why an overtime payout may not be recorded, or null when it may (#993). The
 * amount must be positive, its day no later than today in the employee's
 * timezone, and the amount no more than the work balance at the end of its day
 * as computed now. Later corrections to work may still leave the balance
 * negative; that is accepted.
 */
export function refuseOvertimePayout(input: {
	amountMinutes: number;
	day: PlainDate;
	today: PlainDate;
	balanceAtEndOfDayMinutes: number;
	/**
	 * The day of the opening balance in effect (#997): a payout on or before it
	 * would no longer count, so it is refused (ADR-0008).
	 */
	openingBalanceDay?: PlainDate | null;
}): Extract<
	BalanceAdjustmentErrorCode,
	"amount_not_positive" | "future_day" | "before_opening_balance" | "exceeds_balance"
> | null {
	if (!(input.amountMinutes > 0)) return "amount_not_positive";
	if (comparePlainDates(input.day, input.today) > 0) return "future_day";
	if (input.openingBalanceDay && comparePlainDates(input.day, input.openingBalanceDay) <= 0) {
		return "before_opening_balance";
	}
	if (input.amountMinutes > input.balanceAtEndOfDayMinutes) return "exceeds_balance";
	return null;
}

/**
 * An opening balance as entered, in signed minutes (#997): positive, negative
 * or zero. Null unless the hours and minutes are whole numbers and the minutes
 * stay under an hour.
 */
export function openingBalanceMinutes(input: {
	negative: boolean;
	hours: number;
	minutes: number;
}): number | null {
	const magnitude = payoutMinutes(input);
	if (magnitude === null) return null;
	return input.negative && magnitude !== 0 ? -magnitude : magnitude;
}

/**
 * Why an opening balance may not be set on `day`, or null when it may (#997,
 * ADR-0008). Its day is no later than today in the employee's timezone, and it
 * may not be on or after the day of an uncancelled overtime payout, because the
 * opening balance replaces everything through its day and such a payout would
 * quietly stop counting; those payouts are listed. A day in a closed month is refused
 * too (ADR-0004). The amount may be positive, negative or zero.
 *
 * The single-record rule: the employee page and the bulk upload (#999) both
 * apply it, through `checkOpeningBalance` in the store.
 */
export function refuseOpeningBalance(input: {
	day: PlainDate;
	today: PlainDate;
	/** The employee's uncancelled overtime payouts, of any day. */
	uncancelledPayouts: readonly ConflictingPayout[];
	dayInClosedMonth?: boolean;
}):
	| { code: "future_day" | "month_closed" }
	| { code: "conflicting_payouts"; conflictingPayouts: ConflictingPayout[] }
	| null {
	if (comparePlainDates(input.day, input.today) > 0) return { code: "future_day" };
	if (input.dayInClosedMonth) return { code: "month_closed" };
	const day = input.day.toString();
	const conflictingPayouts = input.uncancelledPayouts.filter((payout) => payout.day <= day);
	if (conflictingPayouts.length > 0) return { code: "conflicting_payouts", conflictingPayouts };
	return null;
}
