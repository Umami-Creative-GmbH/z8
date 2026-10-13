import { eq } from "drizzle-orm";

import { db } from "@/db";
import { organizationNotificationSettings, userSettings } from "@/db/schema";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";

interface ResolveRecipientNotificationLocaleParams {
	/**
	 * The recipient's Z8 user. Leave it out (or pass null) for a recipient without
	 * a user: only the organization's default language then counts.
	 */
	userId?: string | null;
	/** The organization the message belongs to. Without one, only the user's own language counts. */
	organizationId?: string | null;
}

function isSupportedLanguage(value: string | null | undefined): value is string {
	return typeof value === "string" && ALL_LANGUAGES.includes(value);
}

/**
 * The recipient language of every outbound message: the recipient's saved
 * language, then the organization's default language, then `en`. Only
 * languages in `ALL_LANGUAGES` count.
 */
export async function resolveRecipientNotificationLocale({
	userId,
	organizationId,
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
