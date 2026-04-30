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
function getPrivacyContent(locale: string): string {
	const basePath = join(process.cwd(), "src", "data", "info");
	try {
		return readFileSync(join(basePath, `privacy.${locale}.md`), "utf-8");
	} catch {
		// Fallback to English
		return readFileSync(join(basePath, "privacy.en.md"), "utf-8");
	}
}

// Pre-load content at build time
const privacyContent = {
	de: getPrivacyContent("de"),
	en: getPrivacyContent("en"),
} as const;

export default async function PrivacyPage({ params }: Props) {
	const { locale } = await params;

	if (!ALL_LANGUAGES.includes(locale)) {
		notFound();
	}

	const content = privacyContent[locale as keyof typeof privacyContent] ?? privacyContent.en;

	return (
		<div className="flex max-h-[calc(100svh-12rem)] min-h-[min(42rem,calc(100svh-12rem))] flex-col overflow-hidden rounded-xl border border-border/70 bg-card/95 p-6 shadow-xl shadow-black/5 sm:p-8 dark:shadow-black/30">
			<InfoHeader titleDefault="Privacy Policy" titleKey="info.privacy-policy" locale={locale} />
			<InfoContent content={content} />
		</div>
	);
}
