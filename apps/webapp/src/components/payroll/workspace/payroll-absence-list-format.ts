export interface PayrollAbsenceListFormat {
	date: (date: string) => string;
	days: (days: number) => string;
}

export function payrollAbsenceListFormat(locale: string): PayrollAbsenceListFormat {
	// A calendar date shown as itself: formatted at UTC midnight in UTC, never the viewer's zone.
	const date = new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
	const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
	return {
		date: (value) => date.format(new Date(`${value}T00:00:00Z`)),
		days: (value) => {
			const full = Math.floor(value);
			const half = value - full >= 0.5;
			if (!half) return whole.format(full);
			return full === 0 ? "½" : `${whole.format(full)}½`;
		},
	};
}
