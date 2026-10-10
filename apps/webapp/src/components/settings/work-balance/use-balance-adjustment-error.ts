"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import { useCallback } from "react";
import { formatClosedMonthLabel } from "@/lib/time-tracking/closed-months/month-label";
import type { BalanceAdjustmentErrorCode } from "@/lib/work-balance/adjustments/types";

/**
 * Translates a balance adjustment refusal code for a toast; a `month_closed`
 * refusal names the closed month when it is known.
 */
export function useBalanceAdjustmentErrorMessage() {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	return useCallback(
		(
			code: BalanceAdjustmentErrorCode | null,
			details: { closedMonth?: string | null } = {},
		): string => {
			switch (code) {
				case "not_permitted":
					return t(
						"settings.employees.workBalance.errors.notPermitted",
						"Only organization owners and admins, and payroll staff for the employees their payroll access covers, can record or cancel balance adjustments.",
					);
				case "employee_not_found":
					return t("settings.employees.workBalance.errors.employeeNotFound", "Employee not found.");
				case "adjustment_not_found":
					return t(
						"settings.employees.workBalance.errors.adjustmentNotFound",
						"This adjustment no longer exists for this employee.",
					);
				case "reason_required":
					return t("settings.employees.workBalance.errors.reasonRequired", "Enter a reason.");
				case "amount_not_positive":
					return t(
						"settings.employees.workBalance.errors.amountNotPositive",
						"Enter a payout of more than zero.",
					);
				case "future_day":
					return t(
						"settings.employees.workBalance.errors.futureDay",
						"The day cannot be after today in the employee's timezone.",
					);
				case "exceeds_balance":
					return t(
						"settings.employees.workBalance.errors.exceedsBalance",
						"The payout is more than the employee's work balance at the end of that day.",
					);
				case "already_cancelled":
					return t(
						"settings.employees.workBalance.errors.alreadyCancelled",
						"This adjustment is already cancelled.",
					);
				case "before_opening_balance":
					return t(
						"settings.employees.workBalance.errors.beforeOpeningBalance",
						"The payout must be dated after the day of the opening balance in effect.",
					);
				case "conflicting_payouts":
					return t(
						"settings.employees.workBalance.errors.conflictingPayouts",
						"Overtime payouts are dated on or before this day. Cancel them first or choose an earlier day.",
					);
				case "exceeds_later_balance":
					return t(
						"settings.employees.workBalance.errors.exceedsLaterBalance",
						"The payout would leave the work balance below zero after a later overtime payout. Cancel that payout first or record less.",
					);
				case "month_closed":
					return details.closedMonth
						? t(
								"settings.employees.workBalance.errors.monthClosedNamed",
								"{month} is closed. It must be reopened before adjustments dated in it can be recorded or cancelled.",
								{ month: formatClosedMonthLabel(details.closedMonth, locale) },
							)
						: t(
								"settings.employees.workBalance.errors.monthClosed",
								"The day is in a closed month.",
							);
				case "invalid_input":
					return t(
						"settings.employees.workBalance.errors.invalidInput",
						"Check the day, the hours and minutes, and the reason.",
					);
				default:
					return t(
						"settings.employees.workBalance.errors.failed",
						"The work balance could not be updated. Try again.",
					);
			}
		},
		[t, locale],
	);
}
