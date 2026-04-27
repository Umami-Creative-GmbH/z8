import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/locales";

export function generateStaticParams() {
	return [{ locale: "de" }, { locale: "en" }];
}

export default async function LocaleLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;

	if (!isLocale(locale)) {
		notFound();
	}

	return <div data-locale={locale satisfies Locale}>{children}</div>;
}
