import { fillNotificationTemplate, type NotificationParamValue } from "./notification-params";

/**
 * Title and message copy of one notification variant: translation keys, each next to its
 * static English default so the Tolgee extractor reads both.
 */
export interface NotificationCopy {
	titleKey: string;
	titleDefault: string;
	messageKey: string;
	messageDefault: string;
}

/**
 * The notification's `metadata.i18n` for `copy`, and its stored English title and
 * message (the fallback, also used by webhooks) filled from the same params. Typed
 * params (dates, times, durations, money) are formatted per recipient (#1149).
 */
export function translatedContent(
	copy: NotificationCopy,
	params: Record<string, NotificationParamValue>,
) {
	return {
		title: copy.titleDefault,
		message: fillNotificationTemplate(copy.messageDefault, params),
		i18n: {
			titleKey: copy.titleKey,
			titleDefault: copy.titleDefault,
			messageKey: copy.messageKey,
			messageDefault: copy.messageDefault,
			params,
		},
	};
}
