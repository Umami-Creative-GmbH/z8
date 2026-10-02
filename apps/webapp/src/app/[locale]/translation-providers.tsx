"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
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
				{children}
			</NextIntlClientProvider>
		</TolgeeNextProvider>
	);
}
