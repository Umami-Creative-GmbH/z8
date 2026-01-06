import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { InfoContent } from "@/components/info-content";
import { InfoHeader } from "@/components/info-header";
import { ALL_LANGUAGES } from "@/tolgee/shared";

type Props = {
	params: Promise<{ locale: string }>;
};

// Cache the content fetching function using "use cache" directive
async function getTermsContent(locale: string): Promise<string> {
	"use cache";
	try {
		const filePath = join(process.cwd(), "public", "info", `terms.${locale}.md`);
		const content = await readFile(filePath, "utf-8");
		return content;
	} catch {
		// Fallback to English if locale file doesn't exist
		if (locale !== "en") {
			try {
				const filePath = join(process.cwd(), "public", "info", "terms.en.md");
				const content = await readFile(filePath, "utf-8");
				return content;
			} catch {
				throw new Error("Terms content not found");
			}
		}
		throw new Error("Terms content not found");
	}
}

export default async function TermsPage({ params }: Props) {
	const { locale } = await params;

	if (!ALL_LANGUAGES.includes(locale)) {
		notFound();
	}

	const content = await getTermsContent(locale);

	return (
		<div className="flex h-full flex-col">
			<InfoHeader
				titleDefault="Terms of Service"
				titleKey="info.terms-of-service"
				locale={locale}
			/>
			<InfoContent content={content} />
		</div>
	);
}
