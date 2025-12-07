import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { cache, type ReactNode, Suspense } from "react";
import { TolgeeNextProvider } from "@/tolgee/client";
import { getTolgee, getTranslate } from "@/tolgee/server";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import "../globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

// Cache the translation loading function using React.cache
const loadTranslations = cache(async (locale: string) => {
  const tolgee = await getTolgee();
  return (await tolgee.loadRequired()) as any;
});

// Cache the getTranslate function to avoid duplicate async calls
const getCachedTranslate = cache(async () => await getTranslate());

// Generate static params for all locales to enable static generation
export function generateStaticParams() {
  return ALL_LANGUAGES.map((locale) => ({ locale }));
}

// Separate component for loading translations to wrap in Suspense
async function TranslationProvider({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const records = await loadTranslations(locale);
  return (
    <TolgeeNextProvider language={locale} staticData={records}>
      {children}
    </TolgeeNextProvider>
  );
}

// Separate component for head content that uses async translations
async function HeadContent() {
  const t = await getCachedTranslate();
  return (
    <>
      <meta charSet="UTF-8" />
      <meta content="width=device-width, initial-scale=1.0" name="viewport" />
      <meta
        content={t("meta.description", "z8 - time app")}
        name="description"
      />
      <meta content="Umami Creative GmbH" name="author" />
      <meta
        content={t("meta.keywords", "z8, time, app, productivity")}
        name="keywords"
      />
      <meta content="#000000" name="theme-color" />
      <link href="/favicon.ico" rel="icon" sizes="any" type="image/x-icon" />
      <link
        href="/apple-touch-icon.png"
        rel="apple-touch-icon"
        sizes="180x180"
      />
      <link
        href="/favicon-32x32.png"
        rel="icon"
        sizes="32x32"
        type="image/png"
      />
      <link
        href="/favicon-16x16.png"
        rel="icon"
        sizes="16x16"
        type="image/png"
      />
      <link href="/site.webmanifest" rel="manifest" />
      <link color="#000000" href="/safari-pinned-tab.svg" rel="mask-icon" />
      <meta content="#000000" name="msapplication-TileColor" />
      <title>{t("meta.title", "z8 - time app")}</title>
      <meta content="z8" name="apple-mobile-web-app-title" />
      <meta content="z8" name="application-name" />
      <meta content="yes" name="mobile-web-app-capable" />
      <meta content="yes" name="apple-mobile-web-app-capable" />
      <meta content="default" name="apple-mobile-web-app-status-bar-style" />
    </>
  );
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!ALL_LANGUAGES.includes(locale)) {
    notFound();
  }

  return (
    <html lang={locale}>
      <head>
        <Suspense fallback={<title>z8 - time app</title>}>
          <HeadContent />
        </Suspense>
      </head>
      <body>
        <Suspense
          fallback={
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                minHeight: "100vh",
              }}
            >
              <div>Loading...</div>
            </div>
          }
        >
          <TranslationProvider locale={locale}>
            <NextIntlClientProvider locale={locale} messages={{}}>
              <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
            </NextIntlClientProvider>
          </TranslationProvider>
        </Suspense>
      </body>
    </html>
  );
}
