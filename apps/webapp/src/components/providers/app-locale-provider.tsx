"use client";

import { createContext, type ReactNode, use } from "react";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";

const AppLocaleContext = createContext<string>(DEFAULT_LANGUAGE);

/**
 * The app language from the route, for shared UI that formats dates itself.
 * Defaults to English so components also render outside the [locale] layout.
 */
export function AppLocaleProvider({ children, locale }: { children: ReactNode; locale: string }) {
	return <AppLocaleContext.Provider value={locale}>{children}</AppLocaleContext.Provider>;
}

export function useAppLocale() {
	return use(AppLocaleContext);
}
