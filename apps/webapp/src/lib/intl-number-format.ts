const CACHE_LIMIT = 64;
const numberFormatters = new Map<string, Intl.NumberFormat>();

/** Reuses number formatters across recipients without sharing their locale or values. */
export function numberFormatter(
	locale: string,
	options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
	const key = JSON.stringify([locale, options]);
	const cached = numberFormatters.get(key);
	if (cached) return cached;
	const formatter = new Intl.NumberFormat(locale, options);
	if (numberFormatters.size >= CACHE_LIMIT) {
		const oldest = numberFormatters.keys().next().value;
		if (oldest !== undefined) numberFormatters.delete(oldest);
	}
	numberFormatters.set(key, formatter);
	return formatter;
}
