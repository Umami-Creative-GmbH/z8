import { createServerInstance } from "@tolgee/react/server";
import { getLocale } from "next-intl/server";
import { loadRouteTranslations } from "./load-translations";
import { TolgeeBase } from "./shared";

export const { getTolgee, getTranslate, T } = createServerInstance({
	getLocale,
	createTolgee: async (language) => {
		const staticData = await loadRouteTranslations(language);

		return TolgeeBase().init({
			observerOptions: {
				fullKeyEncode: false,
			},
			language,
			staticData,
		});
	},
});
