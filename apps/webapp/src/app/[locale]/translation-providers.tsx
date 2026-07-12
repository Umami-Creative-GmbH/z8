"use client";

import type { TolgeeStaticData } from "@tolgee/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { TolgeeNextProvider } from "@/tolgee/client";

export function TranslationProviders({
	children,
	locale,
	records,
}: {
	children: ReactNode;
	locale: string;
	records: TolgeeStaticData;
}) {
	return (
		<TolgeeNextProvider language={locale} staticData={records}>
			<NextIntlClientProvider locale={locale} messages={{ locale }}>
				{children}
			</NextIntlClientProvider>
		</TolgeeNextProvider>
	);
}
