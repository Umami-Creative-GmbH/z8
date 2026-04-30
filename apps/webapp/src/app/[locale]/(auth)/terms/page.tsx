import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { InfoContent } from "@/components/info-content";
import { InfoHeader } from "@/components/info-header";
import { ALL_LANGUAGES } from "@/tolgee/shared";

type Props = {
	params: Promise<{ locale: string }>;
};

// Read at module load time (build time) - fully static
function getTermsContent(locale: string): string {
	const basePath = join(process.cwd(), "src", "data", "info");
	try {
		return readFileSync(join(basePath, `terms.${locale}.md`), "utf-8");
	} catch {
		// Fallback to English
		return readFileSync(join(basePath, "terms.en.md"), "utf-8");
	}
}

// Pre-load content at build time
const termsContent = {
	de: getTermsContent("de"),
	en: getTermsContent("en"),
} as const;

export default async function TermsPage({ params }: Props) {
	const { locale } = await params;

	if (!ALL_LANGUAGES.includes(locale)) {
		notFound();
	}

	const content = termsContent[locale as keyof typeof termsContent] ?? termsContent.en;

	return (
		<div className="flex max-h-[calc(100svh-12rem)] min-h-[min(42rem,calc(100svh-12rem))] flex-col overflow-hidden rounded-xl border border-border/70 bg-card/95 p-6 shadow-xl shadow-black/5 sm:p-8 dark:shadow-black/30">
			<InfoHeader
				titleDefault="Terms of Service"
				titleKey="info.terms-of-service"
				locale={locale}
			/>
			<InfoContent content={content} />
		</div>
	);
}
