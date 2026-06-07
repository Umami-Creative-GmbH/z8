import { eq } from "drizzle-orm";

import { db } from "@/db";
import { organizationNotificationSettings, userSettings } from "@/db/schema";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";

interface ResolveRecipientNotificationLocaleParams {
	userId: string;
	organizationId: string;
}

function isSupportedLanguage(value: string | null | undefined): value is string {
	return typeof value === "string" && ALL_LANGUAGES.includes(value);
}

export async function resolveRecipientNotificationLocale({
	userId,
	organizationId,
}: ResolveRecipientNotificationLocaleParams): Promise<string> {
	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: { locale: true },
	});

	if (isSupportedLanguage(settings?.locale)) {
		return settings.locale;
	}

	const organizationSettings = await db.query.organizationNotificationSettings.findFirst({
		where: eq(organizationNotificationSettings.organizationId, organizationId),
		columns: { defaultLanguage: true },
	});

	if (isSupportedLanguage(organizationSettings?.defaultLanguage)) {
		return organizationSettings.defaultLanguage;
	}

	return DEFAULT_LANGUAGE;
}
