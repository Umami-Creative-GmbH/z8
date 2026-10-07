"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { AppLocaleProvider } from "@/components/providers/app-locale-provider";
import type { CatalogSlice } from "@/tolgee/catalog-slices";
import { TolgeeNextProvider } from "@/tolgee/client";

export function TranslationProviders({
	children,
	locale,
	slice,
}: {
	children: ReactNode;
	locale: string;
	slice: CatalogSlice;
}) {
	return (
		<TolgeeNextProvider slice={slice}>
			<NextIntlClientProvider locale={locale} messages={{ locale }}>
				<AppLocaleProvider locale={locale}>{children}</AppLocaleProvider>
			</NextIntlClientProvider>
		</TolgeeNextProvider>
	);
}
