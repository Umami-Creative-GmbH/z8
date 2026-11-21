import type {
	PayrollPeriodDay,
	PayrollPeriodDayAbsence,
	PayrollPeriodEmployee,
} from "@/lib/payroll-period/types";
import { payrollHoursFormat } from "@/lib/payroll-workspace/hours-format";
import type { PayrollTranslate } from "./state";

export interface PayrollDaysFormat {
	hours: (minutes: number) => string;
	difference: (minutes: number) => string;
	weekday: (date: string) => string;
	dayOfMonth: (date: string) => string;
	/** For example "Tuesday, 10 November 2026". */
	longDate: (date: string) => string;
	/** For example "10 Nov". */
	shortDate: (date: string) => string;
}

export function payrollDaysFormat(locale: string): PayrollDaysFormat {
	const hours = payrollHoursFormat(locale);
	const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
	const day = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" });
	const longDate = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });
	const shortDate = new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	});
	// A calendar date shown as itself: formatted at UTC midnight in UTC, never the viewer's zone.
	const asDate = (date: string) => new Date(`${date}T00:00:00Z`);
	return {
		hours: hours.minutes,
		difference: hours.signedMinutes,
		weekday: (date) => weekday.format(asDate(date)),
		dayOfMonth: (date) => day.format(asDate(date)),
		longDate: (date) => longDate.format(asDate(date)),
		shortDate: (date) => shortDate.format(asDate(date)),
	};
}

/** Whether the day lies after the last working day of an employee who left (#1894). */
export function isAfterDeparture(employee: PayrollPeriodEmployee, date: string): boolean {
	return employee.departure ? date > employee.departure.lastWorkingDay : false;
}

/** The cell's full meaning as text, for the tooltip and assistive technology. */
export function dayTitle(
	day: PayrollPeriodDay,
	format: PayrollDaysFormat,
	t: PayrollTranslate,
	afterDeparture = false,
): string {
	const parts = [
		format.longDate(day.date),
		t("payroll.days.cell.worked", "Worked {hours} h", { hours: format.hours(day.creditedMinutes) }),
	];
	if (afterDeparture) {
		parts.push(t("payroll.days.cell.afterDeparture", "After the last working day"));
	}
	if (day.requiredMinutes !== null) {
		parts.push(
			t("payroll.days.cell.required", "Required {hours} h", {
				hours: format.hours(day.requiredMinutes),
			}),
			t("payroll.days.cell.difference", "Difference {hours} h", {
				hours: format.difference(day.differenceMinutes ?? 0),
			}),
		);
	}
	for (const absence of day.absences) {
		parts.push(
			[
				absence.categoryName,
				absencePeriodLabel(absence.period, t),
				absence.approvalState === "pending" ? t("payroll.days.cell.pending", "pending") : null,
			]
				.filter(Boolean)
				.join(" · "),
		);
	}
	if (day.holiday) {
		parts.push(t("payroll.days.cell.holiday", "Holiday: {name}", { name: day.holiday.name }));
	}
	if (day.settlement?.state === "settled") {
		parts.push(t("payroll.days.cell.settled", "Settled"));
	}
	if (day.settlement?.state === "changed_since_settled") {
		parts.push(settledChangeText(day.settlement.change, format, t));
	}
	return parts.join("\n");
}

/** "Changed since settled: +1.5 h, absence changed" (#1897). */
export function settledChangeText(
	change: { creditedMinutesDifference: number; absencesChanged: boolean },
	format: Pick<PayrollDaysFormat, "difference">,
	t: PayrollTranslate,
): string {
	const details = [
		change.creditedMinutesDifference !== 0
			? t("payroll.days.cell.changedHours", "{hours} h", {
					hours: format.difference(change.creditedMinutesDifference),
				})
			: null,
		change.absencesChanged ? t("payroll.days.cell.changedAbsence", "absence changed") : null,
	].filter(Boolean);
	return t("payroll.days.cell.changedSinceSettled", "Changed since settled: {details}", {
		details: details.join(", "),
	});
}

export function absencePeriodLabel(
	period: PayrollPeriodDayAbsence["period"],
	t: PayrollTranslate,
): string | null {
	switch (period) {
		case "am":
			return t("payroll.days.cell.am", "AM");
		case "pm":
			return t("payroll.days.cell.pm", "PM");
		case "partial_day":
			return t("payroll.days.cell.partialDay", "Part of the day");
		default:
			return null;
	}
}
