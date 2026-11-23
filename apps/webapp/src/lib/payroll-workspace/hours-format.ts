/**
 * Hour figures of the payroll workspace, its blockers and the payroll PDF, in the app's
 * locale (never the browser's). One formatter for every payroll view, so the same
 * minutes read the same everywhere.
 */
export interface PayrollHoursFormat {
	/** Minutes as hours, e.g. "7.5" or "7,5" ("7.50" / "7,50" with two decimals). */
	minutes: (minutes: number) => string;
	/** Hours already computed, such as the summary's worked hours, in the same form. */
	hours: (hours: number) => string;
	/** Minutes as signed hours, e.g. "+1.5" or "-8"; zero has no sign. */
	signedMinutes: (minutes: number) => string;
}

export function payrollHoursFormat(
	locale: string,
	options: {
		/** `"two"` always shows two decimals (the PDF, the status strip); otherwise up to two. */
		decimals?: "up_to_two" | "two";
	} = {},
): PayrollHoursFormat {
	const minimumFractionDigits = options.decimals === "two" ? 2 : 0;
	const plain = new Intl.NumberFormat(locale, {
		minimumFractionDigits,
		maximumFractionDigits: 2,
	});
	const signed = new Intl.NumberFormat(locale, {
		minimumFractionDigits,
		maximumFractionDigits: 2,
		signDisplay: "exceptZero",
	});
	return {
		minutes: (minutes) => plain.format(roundHours(minutes / 60)),
		hours: (hours) => plain.format(roundHours(hours)),
		signedMinutes: (minutes) => signed.format(roundHours(minutes / 60)),
	};
}

/** Rounded to hundredths as the summary rounds worked hours, so every total agrees. */
function roundHours(hours: number): number {
	return Math.round(hours * 100) / 100;
}
