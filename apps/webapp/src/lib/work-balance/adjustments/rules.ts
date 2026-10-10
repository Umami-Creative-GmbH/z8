import { comparePlainDates, type PlainDate } from "@/lib/datetime/temporal-core";
import type { BalanceAdjustmentErrorCode } from "./types";

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
}): Extract<
	BalanceAdjustmentErrorCode,
	"amount_not_positive" | "future_day" | "exceeds_balance"
> | null {
	if (!(input.amountMinutes > 0)) return "amount_not_positive";
	if (comparePlainDates(input.day, input.today) > 0) return "future_day";
	if (input.amountMinutes > input.balanceAtEndOfDayMinutes) return "exceeds_balance";
	return null;
}
