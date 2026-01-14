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
		<div className="flex h-full flex-col">
			<InfoHeader titleDefault="Privacy Policy" titleKey="info.privacy-policy" locale={locale} />
			<InfoContent content={content} />
		</div>
	);
}
