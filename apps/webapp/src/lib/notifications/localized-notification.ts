import { DateTime } from "luxon";
import type { NotificationWithMeta } from "./types";

type TranslationParam = string | number | bigint | boolean | Date | null | undefined;
type Translate = (
	key: string,
	defaultValue: string,
	params?: Record<string, TranslationParam>,
) => string;

type NotificationMetadata = {
	managerRecorded?: boolean;
	managerName?: string;
	startDate?: string;
	endDate?: string;
	absenceType?: string;
	categoryName?: string;
	i18n?: {
		titleKey?: string;
		titleDefault?: string;
		messageKey?: string;
		messageDefault?: string;
		params?: Record<string, TranslationParam>;
	};
};

const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const RelativeTimeFormat = Intl.RelativeTimeFormat;

function getRelativeTimeFormatter(locale: string) {
	const cachedFormatter = relativeTimeFormatters.get(locale);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = new RelativeTimeFormat(locale, { numeric: "auto" });
	relativeTimeFormatters.set(locale, formatter);
	return formatter;
}

const titleKeys: Record<string, { key: string; defaultValue: string }> = {
	"Absence recorded": {
		key: "common:notifications.content.absenceRecorded.title",
		defaultValue: "Absence recorded",
	},
	"Absence request submitted": {
		key: "common:notifications.content.absenceRequestSubmitted.title",
		defaultValue: "Absence request submitted",
	},
	"New absence request": {
		key: "common:notifications.content.newAbsenceRequest.title",
		defaultValue: "New absence request",
	},
	"Absence request approved": {
		key: "common:notifications.content.absenceRequestApproved.title",
		defaultValue: "Absence request approved",
	},
	"Absence request rejected": {
		key: "common:notifications.content.absenceRequestRejected.title",
		defaultValue: "Absence request rejected",
	},
};

function parseMetadata(metadata: NotificationWithMeta["metadata"]): NotificationMetadata {
	if (!metadata || typeof metadata !== "string") {
		return {};
	}

	try {
		return JSON.parse(metadata) as NotificationMetadata;
	} catch {
		return {};
	}
}

function formatDateRange(
	startDate: string | undefined,
	endDate: string | undefined,
	locale: string,
) {
	if (!startDate) {
		return "";
	}

	const start = DateTime.fromISO(startDate).setLocale(locale).toLocaleString({
		month: "short",
		day: "numeric",
	});
	const end = DateTime.fromISO(endDate || startDate)
		.setLocale(locale)
		.toLocaleString({
			month: "short",
			day: "numeric",
		});

	return start === end ? start : `${start} - ${end}`;
}

export function getLocalizedNotificationContent(
	notification: NotificationWithMeta,
	t: Translate,
	locale: string,
): { title: string; message: string; timeAgo: string } {
	const metadata = parseMetadata(notification.metadata);
	const titleKey = titleKeys[notification.title];
	const title = metadata.i18n?.titleKey
		? t(metadata.i18n.titleKey, metadata.i18n.titleDefault ?? notification.title)
		: titleKey
			? t(titleKey.key, titleKey.defaultValue)
			: notification.title;
	let message = metadata.i18n?.messageKey
		? t(
				metadata.i18n.messageKey,
				metadata.i18n.messageDefault ?? notification.message,
				metadata.i18n.params,
			)
		: notification.message;

	if (metadata.managerRecorded) {
		message = t(
			"common:notifications.content.absenceRecorded.message",
			"{managerName} recorded {absenceType} for {dateRange} on your behalf.",
			{
				managerName: metadata.managerName || t("common:common.unknown", "Unknown"),
				absenceType:
					metadata.absenceType || metadata.categoryName || t("common:nav.absences", "Absences"),
				dateRange: formatDateRange(metadata.startDate, metadata.endDate, locale),
			},
		);
	}

	return {
		title,
		message,
		timeAgo: getLocalizedTimeAgo(notification.createdAt, locale, t),
	};
}

export function getLocalizedTimeAgo(
	createdAt: NotificationWithMeta["createdAt"],
	locale: string,
	t: Translate,
): string {
	const created =
		typeof createdAt === "string" ? DateTime.fromISO(createdAt) : DateTime.fromJSDate(createdAt);
	const diff = created.diffNow(["months", "weeks", "days", "hours", "minutes", "seconds"]);
	const absolute = diff.negate();

	if (absolute.as("seconds") < 60) {
		return t("common:notifications.time.justNow", "just now");
	}

	const units = ["months", "weeks", "days", "hours", "minutes"] as const;
	const unit = units.find((candidate) => Math.floor(absolute.get(candidate)) > 0) || "minutes";
	const value = -Math.floor(absolute.get(unit));

	return getRelativeTimeFormatter(locale).format(value, unit);
}
