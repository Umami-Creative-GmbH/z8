/**
 * Euro cents as a complete currency amount in the UI locale: "€4" and "€1.50"
 * in English, "4 €" and "1,50 €" in German. Whole euros show no decimals and
 * anything else shows two, like `formatEuroAmount`.
 *
 * Use it only where the surrounding copy does not already carry the euro sign.
 * Catalog strings such as "€{price}/seat/mo" embed the sign and take
 * `formatEuroAmount` instead, so the sign is never doubled.
 */
export function formatEuroCurrency(cents: number, locale: string): string {
	const fractionDigits = cents % 100 === 0 ? 0 : 2;
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency: "EUR",
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	}).format(cents / 100);
}
