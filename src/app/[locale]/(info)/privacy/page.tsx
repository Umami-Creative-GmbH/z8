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
async function getPrivacyContent(locale: string): Promise<string> {
  "use cache";
  try {
    const filePath = join(
      process.cwd(),
      "public",
      "info",
      `privacy.${locale}.md`
    );
    const content = await readFile(filePath, "utf-8");
    return content;
  } catch {
    // Fallback to English if locale file doesn't exist
    if (locale !== "en") {
      const filePath = join(process.cwd(), "public", "info", "privacy.en.md");
      const content = await readFile(filePath, "utf-8");
      return content;
    }
    throw new Error("Privacy content not found");
  }
}

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;

  if (!ALL_LANGUAGES.includes(locale)) {
    notFound();
  }

  const content = await getPrivacyContent(locale);

  return (
    <div className="flex h-full flex-col">
      <InfoHeader
        titleDefault="Privacy Policy"
        titleKey="info.privacy-policy"
      />
      <InfoContent content={content} />
    </div>
  );
}
