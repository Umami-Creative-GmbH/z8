import { parseMileageDistance } from "./mileage";
import {
	currencyFractionDigits,
	isSupportedCurrency,
	normalizeReceiptAmount,
} from "./receipt-report";

/** What an input holds: an amount in a currency (if one is chosen yet), or kilometres. */
export type NumberInputKind = { kind: "amount"; currency: string | null } | { kind: "distance" };

/** Amounts are stored at two decimals, so no input shows more. */
const STORED_FRACTION_DIGITS = 2;

function formatDecimal(locale: string, canonical: string, minDigits: number, maxDigits: number) {
	return new Intl.NumberFormat(locale, {
		// Grouped digits ("1.234,56") would no longer parse.
		useGrouping: false,
		minimumFractionDigits: minDigits,
		maximumFractionDigits: maxDigits,
	}).format(Number(canonical));
}

/**
 * How an amount or distance input shows its value on load and after it loses
 * focus (#688): in the viewer's locale, without digit grouping, an amount with
 * exactly its currency's fraction digits and a distance with up to two
 * decimals. Text that does not parse stays exactly as typed. What is shown
 * always parses back to the same stored value; a locale whose output would
 * not shows the stored value instead.
 */
export function formatNumberInput(locale: string, text: string, input: NumberInputKind): string {
	const trimmed = text.trim();
	if (!trimmed) return text;
	if (input.kind === "distance") {
		const canonical = parseMileageDistance(trimmed);
		if (!canonical) return text;
		const shown = formatDecimal(locale, canonical, 0, STORED_FRACTION_DIGITS);
		return parseMileageDistance(shown) === canonical ? shown : canonical;
	}
	const digits =
		input.currency && isSupportedCurrency(input.currency)
			? Math.min(currencyFractionDigits(input.currency), STORED_FRACTION_DIGITS)
			: STORED_FRACTION_DIGITS;
	const canonical = normalizeReceiptAmount(trimmed, digits);
	if (!canonical) return text;
	const shown = formatDecimal(locale, canonical, digits, digits);
	return normalizeReceiptAmount(shown, digits) === canonical ? shown : canonical;
}
