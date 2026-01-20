import { createServerInstance } from "@tolgee/react/server";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";
import { DOMAIN_HEADERS } from "@/proxy";
import { getNamespacesForRoute, loadNamespaces, TolgeeBase } from "./shared";

export const { getTolgee, getTranslate, T } = createServerInstance({
	getLocale,
	createTolgee: async (language) => {
		// Get current pathname to determine which namespaces to load
		const headersList = await headers();
		const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || "/";
		const pathnameWithoutLocale = pathname.replace(new RegExp(`^/${language}`), "") || "/";

		// Load namespaces for the current route
		const namespaces = getNamespacesForRoute(pathnameWithoutLocale);
		const staticData = await loadNamespaces(language, namespaces);

		return TolgeeBase().init({
			observerOptions: {
				fullKeyEncode: false,
			},
			language,
			staticData,
		});
	},
});
