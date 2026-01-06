import type { TolgeeStaticData } from "@tolgee/react";
import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, Suspense } from "react";
import { TolgeeNextProvider } from "@/tolgee/client";
import { ALL_LANGUAGES, TolgeeBase } from "@/tolgee/shared";
import "../globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

// Cache the translation loading function using "use cache" directive
// Note: We use TolgeeBase directly with explicit locale to avoid getLocale() which uses headers()
async function loadTranslations(locale: string): Promise<TolgeeStaticData> {
  "use cache";
  // Create Tolgee instance with explicit locale (from route params) to avoid headers() access
  const tolgee = TolgeeBase().init({
    observerOptions: {
      fullKeyEncode: true,
    },
    language: locale,
  });
  return (await tolgee.loadRequired()) as unknown as TolgeeStaticData;
}

// Generate static params for all locales to enable static generation
export async function generateStaticParams() {
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

// Component for translated meta tags (title, description, keywords)
// This component is cached and does NOT access dynamic headers
async function TranslatedMeta({ locale }: { locale: string }) {
  "use cache";

  // Reuse the cached translation data - this is efficient because loadTranslations is cached
  const staticData = await loadTranslations(locale);

  // Initialize a local Tolgee instance to resolve keys without using headers()
  const tolgee = TolgeeBase().init({
    observerOptions: {
      fullKeyEncode: true,
    },
    language: locale,
    staticData,
  });

  // Ensure Tolgee is ready
  await tolgee.run();

  const t = tolgee.t;

  return (
    <>
      <title>{t("meta.title", "z8 - time app")}</title>
      <meta
        content={t("meta.description", "z8 - time app")}
        name="description"
      />
      <meta
        content={t("meta.keywords", "z8, time, app, productivity")}
        name="keywords"
      />
    </>
  );
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  return (
    <html lang={locale}>
      <head>
        <meta charSet="UTF-8" />
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
          <TranslatedMeta locale={locale} />
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
