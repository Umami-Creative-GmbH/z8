import { defineRouting } from "next-intl/routing";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";

export const routing = defineRouting({
	locales: ALL_LANGUAGES,
	defaultLocale: DEFAULT_LANGUAGE,
	localePrefix: "always",
});
