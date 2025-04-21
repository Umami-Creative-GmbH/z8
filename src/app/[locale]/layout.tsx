import React, { ReactNode } from "react";
import { notFound } from "next/navigation";
import { TolgeeNextProvider } from "@/tolgee/client";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import { getTolgee } from "@/tolgee/server";
import "../globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!ALL_LANGUAGES.includes(locale)) {
    notFound();
  }
  const tolgee = await getTolgee();
  const records = (await tolgee.loadRequired()) as any;

  return (
    <html lang={locale}>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="z8 - time app" />
        <meta name="author" content="Umami Creative GmbH" />
        <meta name="keywords" content="z8, time, app, productivity" />
        <meta name="theme-color" content="#000000" />
        <link rel="icon" href="/favicon.ico" sizes="any" type="image/x-icon" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/favicon-16x16.png" sizes="16x16" type="image/png" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#000000" />
        <meta name="msapplication-TileColor" content="#000000" />
        <title>z8 - time app</title>
        <meta name="apple-mobile-web-app-title" content="z8" />
        <meta name="application-name" content="z8" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body>
        <TolgeeNextProvider language={locale} staticData={records}>
          <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
        </TolgeeNextProvider>
      </body>
    </html>
  );
}
