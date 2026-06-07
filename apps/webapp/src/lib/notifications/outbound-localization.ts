import { createLogger } from "@/lib/logger";
import { loadNamespaces, type Namespace, TolgeeBase } from "@/tolgee/shared";
import { resolveRecipientNotificationLocale } from "./recipient-locale";

type TranslationParam = string | number | bigint | Date;

interface NotificationI18nMetadata {
	titleKey?: string;
	titleDefault?: string;
	messageKey?: string;
	messageDefault?: string;
	params?: Record<string, TranslationParam>;
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

function isTranslationParam(value: unknown): value is TranslationParam {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "bigint" ||
		value instanceof Date
	);
}

function sanitizeParams(params: unknown): Record<string, TranslationParam> | undefined {
	if (!isRecord(params)) return undefined;

	const sanitized: Record<string, TranslationParam> = {};
	for (const [key, value] of Object.entries(params)) {
		if (isTranslationParam(value)) {
			sanitized[key] = value;
		}
	}

	return sanitized;
}

function sanitizeI18nMetadata(i18n: unknown): NotificationI18nMetadata | undefined {
	if (!isRecord(i18n)) return undefined;

	const sanitized: NotificationI18nMetadata = {};
	if (typeof i18n.titleKey === "string") sanitized.titleKey = i18n.titleKey;
	if (typeof i18n.titleDefault === "string") sanitized.titleDefault = i18n.titleDefault;
	if (typeof i18n.messageKey === "string") sanitized.messageKey = i18n.messageKey;
	if (typeof i18n.messageDefault === "string") sanitized.messageDefault = i18n.messageDefault;

	const params = sanitizeParams(i18n.params);
	if (params) sanitized.params = params;

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

export async function localizeOutboundNotification({
	userId,
	organizationId,
	title,
	message,
	metadata,
}: LocalizeOutboundNotificationParams): Promise<LocalizedOutboundNotification> {
	let locale = FALLBACK_LOCALE;
	try {
		locale = await resolveRecipientNotificationLocale({ userId, organizationId });
	} catch (error) {
		logger.warn(
			{ err: error, userId, organizationId, locale: FALLBACK_LOCALE },
			"Failed to resolve recipient notification locale",
		);
		return { locale: FALLBACK_LOCALE, title, message };
	}

	const i18n = parseMetadata(metadata).i18n;

	if (!i18n?.titleKey && !i18n?.messageKey) {
		return { locale, title, message };
	}

	try {
		const staticData = await loadNamespaces(locale, NOTIFICATION_NAMESPACES);
		const tolgee = TolgeeBase().init({ language: locale, staticData });
		await tolgee.run();

		return {
			locale,
			title: i18n.titleKey
				? tolgee.t({
						key: i18n.titleKey,
						defaultValue: i18n.titleDefault ?? title,
						params: i18n.params,
					})
				: title,
			message: i18n.messageKey
				? tolgee.t({
						key: i18n.messageKey,
						defaultValue: i18n.messageDefault ?? message,
						params: i18n.params,
					})
				: message,
		};
	} catch (error) {
		logger.warn(
			{ err: error, userId, organizationId, locale },
			"Failed to localize outbound notification",
		);
		return { locale, title, message };
	}
}
