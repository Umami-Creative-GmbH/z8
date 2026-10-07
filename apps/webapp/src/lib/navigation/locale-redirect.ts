import "server-only";

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

/**
 * Server redirect that keeps the request's route locale.
 *
 * A bare `redirect("/settings")` drops the locale prefix, so the proxy picks one from the
 * browser language and the user's chosen locale is lost (#691). Routing uses
 * `localePrefix: "always"`, so the target is always `/<locale><href>`.
 * Use as `return redirectWithLocale(href)` so TypeScript narrows after the call.
 */
export async function redirectWithLocale(href: `/${string}`): Promise<never> {
	const locale = await getLocale();

	redirect(href === "/" ? `/${locale}` : `/${locale}${href}`);
}
