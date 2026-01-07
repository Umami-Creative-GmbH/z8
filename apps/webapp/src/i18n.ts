import { getRequestConfig } from "next-intl/server";
import { ALL_LANGUAGES } from "./tolgee/shared";

export default getRequestConfig(async ({ requestLocale }) => {
	// This typically corresponds to the `[locale]` segment
	let locale = await requestLocale;

	// Ensure that a valid locale is used
	if (!locale || !ALL_LANGUAGES.includes(locale as any)) {
		locale = "de";
	}

	return {
		locale,
		messages: {},
	};
});
