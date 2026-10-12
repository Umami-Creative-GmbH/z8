"use client";

import { useTranslate } from "@tolgee/react";
import { useCallback } from "react";
import type { OpeningBalanceCsvFileErrorCode } from "@/lib/work-balance/adjustments/opening-balance-csv";
import type { OpeningBalanceUploadRowErrorCode } from "@/lib/work-balance/adjustments/types";

/** Translates the bulk opening balance upload's row and file errors (#999). */
export function useOpeningBalanceUploadMessages() {
	const { t } = useTranslate();

	const rowError = useCallback(
		(code: OpeningBalanceUploadRowErrorCode): string => {
			switch (code) {
				case "employee_number_required":
					return t(
						"settings.employees.workBalance.upload.errors.employeeNumberRequired",
						"Enter the employee number.",
					);
				case "invalid_day":
					return t(
						"settings.employees.workBalance.upload.errors.invalidDay",
						"Enter the day as YYYY-MM-DD or DD.MM.YYYY.",
					);
				case "invalid_amount":
					return t(
						"settings.employees.workBalance.upload.errors.invalidAmount",
						"Enter the balance as hours and minutes, such as 12:30 or -4:15.",
					);
				case "reason_required":
					return t(
						"settings.employees.workBalance.upload.errors.reasonRequired",
						"Enter a reason.",
					);
				case "reason_too_long":
					return t(
						"settings.employees.workBalance.upload.errors.reasonTooLong",
						"Keep the reason to 1000 characters.",
					);
				case "unknown_employee":
					return t(
						"settings.employees.workBalance.upload.errors.unknownEmployee",
						"No employee has this number.",
					);
				case "ambiguous_employee":
					return t(
						"settings.employees.workBalance.upload.errors.ambiguousEmployee",
						"Several employees have this number. Give each a unique number first.",
					);
				case "out_of_scope":
					return t(
						"settings.employees.workBalance.upload.errors.outOfScope",
						"This employee is outside your payroll access.",
					);
				case "duplicate_employee":
					return t(
						"settings.employees.workBalance.upload.errors.duplicateEmployee",
						"This employee has more than one row. Keep one.",
					);
				case "future_day":
					return t(
						"settings.employees.workBalance.upload.errors.futureDay",
						"The day is after today in the employee's timezone.",
					);
				case "month_closed":
					return t(
						"settings.employees.workBalance.upload.errors.monthClosed",
						"The day is in a closed month.",
					);
				case "conflicting_payouts":
					return t(
						"settings.employees.workBalance.upload.errors.conflictingPayouts",
						"Overtime payouts are dated on or before this day:",
					);
				default:
					return t(
						"settings.employees.workBalance.upload.errors.unknown",
						"This row cannot be saved.",
					);
			}
		},
		[t],
	);

	const fileError = useCallback(
		(
			code: OpeningBalanceCsvFileErrorCode | "unreadable",
			missingColumns: string[] = [],
		): string => {
			switch (code) {
				case "missing_columns":
					return t(
						"settings.employees.workBalance.upload.fileErrors.missingColumns",
						"The file is missing these columns: {columns}.",
						{ columns: missingColumns.join(", ") },
					);
				case "no_rows":
					return t(
						"settings.employees.workBalance.upload.fileErrors.noRows",
						"The file has no rows below the header.",
					);
				case "too_many_rows":
					return t(
						"settings.employees.workBalance.upload.fileErrors.tooManyRows",
						"The file has more than 2000 rows. Split it into several uploads.",
					);
				case "file_too_large":
					return t(
						"settings.employees.workBalance.upload.fileErrors.fileTooLarge",
						"The file is too large. Split it into several uploads.",
					);
				default:
					return t(
						"settings.employees.workBalance.upload.fileErrors.unreadable",
						"The file could not be read. Save it as CSV (UTF-8) and try again.",
					);
			}
		},
		[t],
	);

	return { rowError, fileError };
}
