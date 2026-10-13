import { eq } from "drizzle-orm";

import { db } from "@/db";
import { organizationNotificationSettings, userSettings } from "@/db/schema";
import { pickShareLocale } from "@/lib/projects/report-share/http";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";

/** The cookie the app's language switcher and locale routing keep the page language in. */
const PAGE_LANGUAGE_COOKIE = "NEXT_LOCALE";

interface ResolveRecipientNotificationLocaleParams {
	/**
	 * The recipient's Z8 user. Leave it out (or pass null) for a recipient without
	 * a user: only the organization's default language then counts.
	 */
	userId?: string | null;
	/** The organization the message belongs to. Without one, only the user's own language counts. */
	organizationId?: string | null;
	/**
	 * The request that triggered the message, for its page language (the
	 * `NEXT_LOCALE` cookie, then Accept-Language). Only the verification and
	 * password-reset emails pass it; it ranks after the saved language and before
	 * the organization's default.
	 */
	request?: Request | null;
}

function isSupportedLanguage(value: string | null | undefined): value is string {
	return typeof value === "string" && ALL_LANGUAGES.includes(value);
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
		try {
			return decodeURIComponent(part.slice(separator + 1).trim());
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * The language of the page a request came from: its `NEXT_LOCALE` cookie, then
 * its Accept-Language header. Null when neither names a language Z8 offers.
 */
export function pageLanguageFromRequest(request: Request | null | undefined): string | null {
	if (!request) return null;
	const cookieLanguage = cookieValue(request.headers.get("cookie"), PAGE_LANGUAGE_COOKIE);
	if (isSupportedLanguage(cookieLanguage)) return cookieLanguage;
	return pickShareLocale(request.headers.get("accept-language"), ALL_LANGUAGES);
}

/**
 * The recipient language of every outbound message: the recipient's saved
 * language, then (verification and password reset only) the page language of
 * the request, then the organization's default language, then `en`. Only
 * languages in `ALL_LANGUAGES` count.
 */
export async function resolveRecipientNotificationLocale({
	userId,
	organizationId,
	request,
}: ResolveRecipientNotificationLocaleParams): Promise<string> {
	if (userId) {
		const settings = await db.query.userSettings.findFirst({
			where: eq(userSettings.userId, userId),
			columns: { locale: true },
		});

		if (isSupportedLanguage(settings?.locale)) {
			return settings.locale;
		}
	}
	const pageLanguage = pageLanguageFromRequest(request);
	if (pageLanguage) return pageLanguage;
	if (!organizationId) return DEFAULT_LANGUAGE;

	return resolveOrganizationNotificationLocale(organizationId);
}

/** The organization's notification language, for messages not tied to one recipient's choice. */
export async function resolveOrganizationNotificationLocale(
	organizationId: string,
): Promise<string> {
	const organizationSettings = await db.query.organizationNotificationSettings.findFirst({
		where: eq(organizationNotificationSettings.organizationId, organizationId),
		columns: { defaultLanguage: true },
	});

	if (isSupportedLanguage(organizationSettings?.defaultLanguage)) {
		return organizationSettings.defaultLanguage;
	}

	return DEFAULT_LANGUAGE;
}
