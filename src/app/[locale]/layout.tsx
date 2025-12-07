"use cache";

import type { TolgeeStaticData } from "@tolgee/react";
import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, Suspense } from "react";
import { TolgeeNextProvider } from "@/tolgee/client";
import { getTolgee, getTranslate } from "@/tolgee/server";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import "../globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

// Cache the translation loading function using "use cache" directive
// Note: locale parameter is required for cache key differentiation per locale
async function loadTranslations(_locale: string): Promise<TolgeeStaticData> {
  "use cache";
  // Locale is used implicitly for cache key, getTolgee gets it from context
  const tolgee = await getTolgee();
  return (await tolgee.loadRequired()) as unknown as TolgeeStaticData;
}

// Cache the getTranslate function to avoid duplicate async calls
async function getCachedTranslate() {
  "use cache";
  return await getTranslate();
}

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

// Component for translated title only
async function TranslatedTitle() {
  const t = await getCachedTranslate();
  return <title>{t("meta.title", "z8 - time app")}</title>;
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  return (
    <html lang={locale}>
      <head>
        <meta charSet="UTF-8" />
        <meta content="width=device-width, initial-scale=1.0" name="viewport" />
        <meta content="Umami Creative GmbH" name="author" />
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
        <meta content="z8" name="apple-mobile-web-app-title" />
        <meta content="z8" name="application-name" />
        <meta content="yes" name="mobile-web-app-capable" />
        <meta content="yes" name="apple-mobile-web-app-capable" />
        <meta content="default" name="apple-mobile-web-app-status-bar-style" />
        <Suspense fallback={<title>z8 - time app</title>}>
          <TranslatedTitle />
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
