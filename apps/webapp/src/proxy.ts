import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";

export function proxy(request: NextRequest) {
  const handleI18nRouting = createMiddleware({
    locales: ALL_LANGUAGES,
    defaultLocale: DEFAULT_LANGUAGE,
    localePrefix: "always",
    localeDetection: true,
  });
  const response = handleI18nRouting(request);

  // If next-intl middleware already handled the redirect (e.g., for invalid locales),
  // return its response immediately
  if (response.status === 307 || response.status === 308) {
    return response;
  }

  const [, locale, ...segments] = request.nextUrl.pathname.split("/");
  const isLocale = ALL_LANGUAGES.includes(locale);
  if (!isLocale) {
    // This should not happen as next-intl middleware handles invalid locales,
    // but return response as fallback
    return response;
  }

  // public urls
  const publicUrls = [
    "sign-in",
    "sign-up",
    "forgot-password",
    "reset-password",
    "verify-email",
    "terms",
    "privacy",
  ];
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
