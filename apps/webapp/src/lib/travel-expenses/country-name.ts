/** Localized country name of an ISO 3166 code, falling back to the code. */
export function formatCountry(locale: string, code: string) {
	try {
		return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
	} catch {
		return code;
	}
}
