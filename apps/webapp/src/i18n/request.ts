import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
	let locale = await requestLocale;

	// Validate the locale against our routing config
	if (!locale || !routing.locales.includes(locale as any)) {
		locale = routing.defaultLocale;
	}

	return {
		locale,
		// Tolgee handles translations; next-intl only needs locale for routing.
		// Provide a minimal messages object to suppress next-intl warnings.
		messages: { locale },
	};
});
