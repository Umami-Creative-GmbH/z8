import { createServerInstance } from "@tolgee/react/server";
import { getLocale } from "next-intl/server";
import { ALL_NAMESPACES, loadNamespaces, TolgeeBase } from "./shared";

export const { getTolgee, getTranslate, T } = createServerInstance({
	getLocale,
	createTolgee: async (language) => {
		const staticData = await loadNamespaces(language, ALL_NAMESPACES);

		return TolgeeBase().init({
			observerOptions: {
				fullKeyEncode: false,
			},
			language,
			staticData,
		});
	},
});
