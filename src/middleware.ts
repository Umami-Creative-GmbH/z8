import createMiddleware from "next-intl/middleware";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";

import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const handleI18nRouting = createMiddleware({
    locales: ALL_LANGUAGES,
    defaultLocale: DEFAULT_LANGUAGE,
    localePrefix: "always",
    localeDetection: true,
  });
  const response = handleI18nRouting(request);

  const [, locale, ...segments] = request.nextUrl.pathname.split("/");
  const isLocale = ALL_LANGUAGES.includes(locale);
  if (!isLocale) return response;

  // public urls
  const publicUrls = ["sign-in", "sign-up", "forgot-password", "reset-password", "verify-email"];
  if (segments.some((segment) => publicUrls.includes(segment))) {
    return NextResponse.next();
  }

  // check auth
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skip all paths that should not be internationalized
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
