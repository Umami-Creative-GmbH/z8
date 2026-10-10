import { parsePlainDate } from "@/lib/datetime/temporal-core";

/**
 * A payroll run's period as language-neutral text (#853), for stored
 * references and notification parameters, which no viewer's locale formats:
 * the month ("2026-10") when the period is one whole calendar month, else
 * both logical dates ("2026-10-01 – 2026-10-15").
 */
export function payrollPeriodText(periodStart: string, periodEnd: string): string {
	const start = parsePlainDate(periodStart);
	const end = parsePlainDate(periodEnd);
	const wholeMonth =
		start.day === 1 &&
		end.year === start.year &&
		end.month === start.month &&
		end.day === start.daysInMonth;
	return wholeMonth ? periodStart.slice(0, 7) : `${periodStart} – ${periodEnd}`;
}
