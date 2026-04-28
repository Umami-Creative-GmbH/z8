import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/locales";
import { variantMetadata, variantTranslationCopy } from "@/i18n/variant-copy";
import { DesignS1Client } from "./design-s1-client";

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return variantMetadata(locale, "s-1");
}

export default async function DesignS1({ params }: PageProps) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	return <DesignS1Client locale={locale} translationCopy={variantTranslationCopy("s-1")} />;
}
