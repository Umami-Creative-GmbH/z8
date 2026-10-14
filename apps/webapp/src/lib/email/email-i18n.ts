// Mailer only: the email copy and its catalog never reach a route or the client.
import "server-only";

import { createLogger } from "@/lib/logger";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE, loadNamespaces, TolgeeBase } from "@/tolgee/shared";

/** ICU params for email copy: text, never a `Date` (format dates before translating). */
export type EmailTranslationParams = Record<string, string | number | bigint>;

/**
 * Tolgee's `t` for email copy. Every key lives under `emails.*` (the `emails`
 * namespace) and needs a static English default the extractor can read.
 */
export type EmailTranslate = (
	key: string,
	defaultValue: string,
	params?: EmailTranslationParams,
) => string;

export interface EmailTranslator {
	/** The language the email is written in, for `<html lang>` and formatting. */
	locale: string;
	t: EmailTranslate;
}

const logger = createLogger("EmailI18n");

async function createTranslator(
	locale: string,
	staticData: Awaited<ReturnType<typeof loadNamespaces>>,
): Promise<EmailTranslate> {
	const tolgee = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
		language: locale,
		staticData,
	});
	await tolgee.run();
	return (key, defaultValue, params) => tolgee.t({ key, defaultValue, params });
}

/**
 * The `emails` namespace translator in `locale` (the recipient language, see
 * `resolveRecipientNotificationLocale`), usable outside a request. A language Z8
 * does not offer becomes `en`; when the catalog cannot be loaded every text falls
 * back to its English default.
 */
export async function loadEmailTranslator(locale: string): Promise<EmailTranslator> {
	const language = ALL_LANGUAGES.includes(locale) ? locale : DEFAULT_LANGUAGE;
	try {
		const staticData = await loadNamespaces(language, ["emails"]);
		return { locale: language, t: await createTranslator(language, staticData) };
	} catch (error) {
		logger.warn({ err: error, locale: language }, "Falling back to default email copy");
		return { locale: language, t: await createTranslator(language, { [language]: {} }) };
	}
}
