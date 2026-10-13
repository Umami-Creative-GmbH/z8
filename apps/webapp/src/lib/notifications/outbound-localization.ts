import { createLogger } from "@/lib/logger";
import { loadNamespaces, type Namespace, TolgeeBase } from "@/tolgee/shared";
import { type FormattedNotificationParam, formatNotificationParams } from "./notification-params";
import { resolveRecipientNotificationLocale } from "./recipient-locale";

type TranslationParam = FormattedNotificationParam;

interface NotificationI18nMetadata {
	titleKey?: string;
	titleDefault?: string;
	messageKey?: string;
	messageDefault?: string;
	/** Raw params, typed ones included; formatted once the locale is known. */
	params?: Record<string, unknown>;
}

interface NotificationMetadata {
	i18n?: NotificationI18nMetadata;
}

interface LocalizeOutboundNotificationParams {
	userId: string;
	organizationId: string;
	title: string;
	message: string;
	metadata?: Record<string, unknown> | string | null;
	locale?: string;
	/** The recipient's hour cycle for typed time params; the locale's own otherwise. */
	timeFormat?: "12h" | "24h";
}

interface LocalizedOutboundNotification {
	locale: string;
	title: string;
	message: string;
}

const logger = createLogger("OutboundNotificationLocalization");
const NOTIFICATION_NAMESPACES = ["common"] satisfies Namespace[];
const FALLBACK_LOCALE = "en";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeI18nMetadata(i18n: unknown): NotificationI18nMetadata | undefined {
	if (!isRecord(i18n)) return undefined;

	const sanitized: NotificationI18nMetadata = {};
	if (typeof i18n.titleKey === "string") sanitized.titleKey = i18n.titleKey;
	if (typeof i18n.titleDefault === "string") sanitized.titleDefault = i18n.titleDefault;
	if (typeof i18n.messageKey === "string") sanitized.messageKey = i18n.messageKey;
	if (typeof i18n.messageDefault === "string") sanitized.messageDefault = i18n.messageDefault;

	if (isRecord(i18n.params)) sanitized.params = i18n.params;

	return sanitized;
}

function parseMetadata(
	metadata: LocalizeOutboundNotificationParams["metadata"],
): NotificationMetadata {
	if (!metadata) return {};

	let parsed: unknown = metadata;
	if (typeof metadata === "string") {
		try {
			parsed = JSON.parse(metadata) as unknown;
		} catch {
			return {};
		}
	}

	if (!isRecord(parsed)) return {};

	const i18n = sanitizeI18nMetadata(parsed.i18n);
	return i18n ? { i18n } : {};
}

export type NotificationTranslate = (
	key: string,
	defaultValue: string,
	params?: Record<string, TranslationParam>,
) => string;

/** Tolgee's `t` for notification texts (`common` namespace) in `locale`. */
async function loadNotificationTranslator(locale: string): Promise<NotificationTranslate> {
	const staticData = await loadNamespaces(locale, NOTIFICATION_NAMESPACES);
	const tolgee = TolgeeBase().init({ language: locale, staticData });
	await tolgee.run();
	return (key, defaultValue, params) => tolgee.t({ key, defaultValue, params });
}

/**
 * Notification texts in the recipient's notification locale. When the locale
 * or the catalog cannot be loaded, every text falls back to its default.
 */
export async function recipientNotificationTranslator({
	userId,
	organizationId,
}: {
	userId: string;
	organizationId?: string | null;
}): Promise<NotificationTranslate> {
	try {
		const locale = await resolveRecipientNotificationLocale({ userId, organizationId });
		return await loadNotificationTranslator(locale);
	} catch (error) {
		logger.warn(
			{ err: error, userId, organizationId },
			"Falling back to default notification text",
		);
		return (_key, defaultValue) => defaultValue;
	}
}

/**
 * The recipient's notification language, for callers that format typed params
 * themselves (email override variables). `en` when it cannot be resolved.
 */
export async function resolveOutboundNotificationLocale({
	userId,
	organizationId,
}: {
	userId: string;
	organizationId?: string | null;
}): Promise<string> {
	try {
		return await resolveRecipientNotificationLocale({ userId, organizationId });
	} catch (error) {
		logger.warn(
			{ err: error, userId, organizationId, locale: FALLBACK_LOCALE },
			"Failed to resolve recipient notification locale",
		);
		return FALLBACK_LOCALE;
	}
}

/** The chat channels' "View in Z8" link text, in the recipient language. */
function actionLabel(t: NotificationTranslate): string {
	return t("notifications.channels.viewInZ8", "View in Z8");
}

/**
 * The notification's title and message in the recipient language, rendered from
 * `metadata.i18n`. A notification without translation keys keeps its stored text.
 * `withActionLabel` adds the "View in Z8" link text of the chat channels, from
 * the same catalog load.
 */
export async function localizeOutboundNotification(
	params: LocalizeOutboundNotificationParams & { withActionLabel: true },
): Promise<LocalizedOutboundNotification & { actionLabel: string }>;
export async function localizeOutboundNotification(
	params: LocalizeOutboundNotificationParams & { withActionLabel?: boolean },
): Promise<LocalizedOutboundNotification & { actionLabel?: string }>;
export async function localizeOutboundNotification({
	userId,
	organizationId,
	locale,
	timeFormat,
	title,
	message,
	metadata,
	withActionLabel = false,
}: LocalizeOutboundNotificationParams & { withActionLabel?: boolean }): Promise<
	LocalizedOutboundNotification & { actionLabel?: string }
> {
	const fallback = (fallbackLocale: string) => ({
		locale: fallbackLocale,
		title,
		message,
		...(withActionLabel ? { actionLabel: actionLabel((_key, defaultValue) => defaultValue) } : {}),
	});

	let resolvedLocale = locale ?? FALLBACK_LOCALE;
	try {
		if (!locale) {
			resolvedLocale = await resolveRecipientNotificationLocale({ userId, organizationId });
		}
	} catch (error) {
		logger.warn(
			{ err: error, userId, organizationId, locale: FALLBACK_LOCALE },
			"Failed to resolve recipient notification locale",
		);
		return fallback(FALLBACK_LOCALE);
	}

	const i18n = parseMetadata(metadata).i18n;
	const hasKeys = Boolean(i18n?.titleKey || i18n?.messageKey);

	if (!hasKeys && !withActionLabel) {
		return fallback(resolvedLocale);
	}

	try {
		const t = await loadNotificationTranslator(resolvedLocale);
		// Typed params become text in the recipient language first: ICU never sees a Date (#1149).
		const params = i18n?.params
			? formatNotificationParams(i18n.params, { locale: resolvedLocale, timeFormat })
			: undefined;

		return {
			locale: resolvedLocale,
			title: i18n?.titleKey ? t(i18n.titleKey, i18n.titleDefault ?? title, params) : title,
			message: i18n?.messageKey
				? t(i18n.messageKey, i18n.messageDefault ?? message, params)
				: message,
			...(withActionLabel ? { actionLabel: actionLabel(t) } : {}),
		};
	} catch (error) {
		logger.warn(
			{ err: error, userId, organizationId, locale: resolvedLocale },
			"Failed to localize outbound notification",
		);
		return fallback(resolvedLocale);
	}
}
