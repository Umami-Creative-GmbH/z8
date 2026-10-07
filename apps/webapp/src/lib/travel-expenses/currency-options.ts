/** A currency a select offers: "EUR – Euro", found by its code or its name. */
export interface CurrencyOption {
	code: string;
	name: string;
	keywords: string[];
}

function currencyOption(names: Intl.DisplayNames, code: string): CurrencyOption {
	const name = names.of(code);
	return name && name !== code
		? { code, name: `${code} – ${name}`, keywords: [code, name] }
		: { code, name: code, keywords: [code] };
}

/**
 * The currencies a currency select offers (#688): every runtime currency the
 * given server rule accepts, named in the viewer's locale and sorted by code.
 * A stored value the rule no longer accepts is still listed so it shows; the
 * server stays the authority on what can be saved.
 */
export function currencyOptions(
	locale: string,
	accepts: (code: string) => boolean,
	stored?: string | null,
): CurrencyOption[] {
	const names = new Intl.DisplayNames([locale], { type: "currency" });
	const codes = Intl.supportedValuesOf("currency").filter(accepts);
	if (stored && !codes.includes(stored)) codes.push(stored);
	return codes.sort().map((code) => currencyOption(names, code));
}
