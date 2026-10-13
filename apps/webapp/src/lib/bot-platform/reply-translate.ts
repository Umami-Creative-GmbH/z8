import { type BotTranslateFn, getBotTranslate, getUserLocale } from "./i18n";

/**
 * A bot reply's translator in the recipient language: the linked user's own
 * language, or the organization's default for someone not linked to a Z8 user
 * yet (`userId: null`). The language comes along for commands that format with it.
 */
export async function getReplyTranslate(input: {
	userId: string | null;
	organizationId: string;
}): Promise<{ locale: string; t: BotTranslateFn }> {
	const locale = await getUserLocale(input);
	return { locale, t: await getBotTranslate(locale) };
}
