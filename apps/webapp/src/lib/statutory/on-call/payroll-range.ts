import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";

/** The longest payroll range whose on-call reference hours are listed at once (#1992). */
export const ON_CALL_PAYROLL_MAX_MONTHS = 3;

/**
 * True when an inclusive payroll range `startDate`–`endDate` (`YYYY-MM-DD`) reaches
 * {@link ON_CALL_PAYROLL_MAX_MONTHS} months past its start: a payroll period, never a year of
 * history. Shared by the server's refusal and the payroll card's "choose a shorter period" note.
 */
export function onCallPayrollRangeTooLong(startDate: string, endDate: string): boolean {
	const start = parsePlainDate(startDate);
	return (
		comparePlainDates(parsePlainDate(endDate), start.add({ months: ON_CALL_PAYROLL_MAX_MONTHS })) >=
		0
	);
}
