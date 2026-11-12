import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import { formatClosedMonthLabel } from "@/lib/time-tracking/closed-months/month-label";
import type { BalanceAdjustmentErrorCode } from "@/lib/work-balance/adjustments/types";

/**
 * Balance adjustments' own texts for `actionErrorMessage`; a `month_closed`
 * refusal names the closed month (in `locale`) when the failure carries it.
 */
export function balanceAdjustmentRefusals(locale: string) {
	return {
		not_permitted: [
			"settings.employees.workBalance.errors.notPermitted",
			"Only organization owners and admins, and payroll staff for the employees their payroll access covers, can record or cancel balance adjustments.",
		],
		employee_not_found: [
			"settings.employees.workBalance.errors.employeeNotFound",
			"Employee not found.",
		],
		adjustment_not_found: [
			"settings.employees.workBalance.errors.adjustmentNotFound",
			"This adjustment no longer exists for this employee.",
		],
		reason_required: ["settings.employees.workBalance.errors.reasonRequired", "Enter a reason."],
		amount_not_positive: [
			"settings.employees.workBalance.errors.amountNotPositive",
			"Enter a payout of more than zero.",
		],
		future_day: [
			"settings.employees.workBalance.errors.futureDay",
			"The day cannot be after today in the employee's timezone.",
		],
		exceeds_balance: [
			"settings.employees.workBalance.errors.exceedsBalance",
			"The payout is more than the employee's work balance at the end of that day.",
		],
		already_cancelled: [
			"settings.employees.workBalance.errors.alreadyCancelled",
			"This adjustment is already cancelled.",
		],
		before_opening_balance: [
			"settings.employees.workBalance.errors.beforeOpeningBalance",
			"The payout must be dated after the day of the opening balance in effect.",
		],
		conflicting_payouts: [
			"settings.employees.workBalance.errors.conflictingPayouts",
			"Overtime payouts are dated on or before this day. Cancel them first or choose an earlier day.",
		],
		exceeds_later_balance: [
			"settings.employees.workBalance.errors.exceedsLaterBalance",
			"The payout would leave the work balance below zero after a later overtime payout. Cancel that payout first or record less.",
		],
		month_closed: (t, failure) =>
			failure.closedMonth
				? t(
						"settings.employees.workBalance.errors.monthClosedNamed",
						"{month} is closed. It must be reopened before adjustments dated in it can be recorded or cancelled.",
						{ month: formatClosedMonthLabel(failure.closedMonth, locale) },
					)
				: t("settings.employees.workBalance.errors.monthClosed", "The day is in a closed month."),
		invalid_input: [
			"settings.employees.workBalance.errors.invalidInput",
			"Check the day, the hours and minutes, and the reason.",
		],
	} satisfies RefusalMessages<Exclude<BalanceAdjustmentErrorCode, "failed">>;
}

/** The balance adjustment dialogs' fallback for anything else. */
export const BALANCE_ADJUSTMENT_FAILED = [
	"settings.employees.workBalance.errors.failed",
	"The work balance could not be updated. Try again.",
] as const;
