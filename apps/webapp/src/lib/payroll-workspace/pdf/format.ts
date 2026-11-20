import { Temporal } from "temporal-polyfill";
import {
	formatInstant,
	formatPlainDate,
	localeDefaultTimeFormat,
} from "@/lib/datetime/temporal-format";

/** Locale formatting of the payroll PDF's figures and calendar dates. */
export interface PayrollPdfFormat {
	/** Minutes as hours with two decimals, e.g. "8.00 h" / "8,00 h". */
	hours: (minutes: number) => string;
	/** Already rounded hours, e.g. the summary's worked hours, in the same form. */
	hoursValue: (hours: number) => string;
	/** Signed hours with two decimals, e.g. "-14.50 h". */
	difference: (minutes: number) => string;
	/** A signed change with up to two decimals, e.g. "+1.5 h". */
	change: (minutes: number) => string;
	/** Days with up to two decimals, e.g. "0.5". */
	days: (days: number) => string;
	/** A calendar date as itself, never shifted by a zone, e.g. "3.11.2026". */
	date: (date: string) => string;
	/** The short weekday of a calendar date, e.g. "Tue". */
	weekday: (date: string) => string;
	/** An ISO instant in UTC, e.g. "Nov 7, 2026, 12:00 PM UTC". */
	instantUtc: (instant: string) => string;
}

export function payrollPdfFormat(locale: string): PayrollPdfFormat {
	const hours = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	const difference = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
		signDisplay: "exceptZero",
	});
	const change = new Intl.NumberFormat(locale, {
		maximumFractionDigits: 2,
		signDisplay: "exceptZero",
	});
	const days = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
	const timeFormat = localeDefaultTimeFormat(locale);

	return {
		hours: (minutes) => pdfSafe(`${hours.format(roundHours(minutes / 60))} h`),
		hoursValue: (value) => pdfSafe(`${hours.format(value)} h`),
		difference: (minutes) => pdfSafe(`${difference.format(roundHours(minutes / 60))} h`),
		change: (minutes) => pdfSafe(`${change.format(minutes / 60)} h`),
		days: (value) => pdfSafe(days.format(value)),
		date: (date) => pdfSafe(formatPlainDate(Temporal.PlainDate.from(date), locale, "dateShort")),
		weekday: (date) =>
			pdfSafe(formatPlainDate(Temporal.PlainDate.from(date), locale, "weekdayShort")),
		instantUtc: (instant) =>
			pdfSafe(
				`${formatInstant(
					Temporal.Instant.from(instant),
					{ locale, timezone: "UTC", timeFormat },
					"dateTimeMedium",
				)} UTC`,
			),
	};
}

/** Rounded as the summary rounds worked hours, so a sheet's total equals the summary's. */
function roundHours(hours: number): number {
	return Math.round(hours * 100) / 100;
}

/**
 * The PDF's standard Helvetica font has no minus sign or narrow spaces, which some
 * locales format numbers and dates with; use their plain equivalents.
 */
export function pdfSafe(text: string): string {
	return text.replace(/−/g, "-").replace(/[  ]/g, " ");
}
