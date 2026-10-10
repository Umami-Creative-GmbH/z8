import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";

/** Whether a payroll period is one whole calendar month. */
export function isWholeMonth(start: PlainDate, end: PlainDate): boolean {
	return (
		start.day === 1 &&
		end.year === start.year &&
		end.month === start.month &&
		end.day === start.daysInMonth
	);
}

/**
 * A payroll run's period as language-neutral text (#853), for stored
 * references and notification parameters, which no viewer's locale formats:
 * the month ("2026-10") when the period is one whole calendar month, else
 * both logical dates ("2026-10-01 – 2026-10-15").
 */
export function payrollPeriodText(periodStart: string, periodEnd: string): string {
	return isWholeMonth(parsePlainDate(periodStart), parsePlainDate(periodEnd))
		? periodStart.slice(0, 7)
		: `${periodStart} – ${periodEnd}`;
}
