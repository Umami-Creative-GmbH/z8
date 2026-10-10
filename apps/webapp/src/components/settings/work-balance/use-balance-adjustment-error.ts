"use client";

import { useTranslate } from "@tolgee/react";
import { useCallback } from "react";
import type { BalanceAdjustmentErrorCode } from "@/lib/work-balance/adjustments/types";

/** Translates a balance adjustment refusal code for a toast. */
export function useBalanceAdjustmentErrorMessage() {
	const { t } = useTranslate();
	return useCallback(
		(code: BalanceAdjustmentErrorCode | null): string => {
			switch (code) {
				case "not_permitted":
					return t(
						"settings.employees.workBalance.errors.notPermitted",
						"Only organization owners and admins can record or cancel balance adjustments.",
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
		[t],
	);
}
