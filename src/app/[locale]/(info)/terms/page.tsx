import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { ALL_LANGUAGES } from "@/tolgee/shared";

type Props = {
  params: Promise<{ locale: string }>;
};

async function getTermsContent(locale: string): Promise<string> {
  try {
    const filePath = join(
      process.cwd(),
      "public",
      "info",
      `terms.${locale}.md`
    );
    const content = await readFile(filePath, "utf-8");
    return content;
  } catch {
    // Fallback to English if locale file doesn't exist
    if (locale !== "en") {
      const filePath = join(process.cwd(), "public", "info", "terms.en.md");
      const content = await readFile(filePath, "utf-8");
      return content;
    }
    throw new Error("Terms content not found");
  }
}

export default async function TermsPage({ params }: Props) {
  const { locale } = await params;

  if (!ALL_LANGUAGES.includes(locale)) {
    notFound();
  }

  const t = await getTranslate();
  const content = await getTermsContent(locale);

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-30 flex shrink-0 items-center gap-4 pb-6">
        <Button asChild size="icon" variant="ghost">
          <Link href="/sign-in">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">
              {t("info.back-to-login", "Back to login")}
            </span>
          </Link>
        </Button>
        <div className="flex flex-1 flex-col items-center text-center">
          <h1 className="font-bold text-2xl">z8</h1>
          <p className="text-balance text-muted-foreground">
            {t("info.terms-of-service", "Terms of Service")}
          </p>
        </div>
        <div className="w-10" />
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="prose prose-slate dark:prose-invert max-w-none">
          <Streamdown>{content}</Streamdown>
        </div>
      </div>
    </div>
  );
}
