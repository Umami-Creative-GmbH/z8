import type { CreateNotificationParams, NotificationChannel } from "@/lib/notifications/types";
import { NOTIFICATION_CHANNELS } from "@/lib/notifications/types";
import type { AutoClockOutDecision } from "./types";

export function planAutoClockOutChannels(
	preferences: Record<NotificationChannel, boolean>,
): NotificationChannel[] {
	return NOTIFICATION_CHANNELS.filter((channel) => channel === "in_app" || preferences[channel]);
}

export function buildAutoClockOutNotification(input: {
	decision: AutoClockOutDecision;
	recipientUserId: string;
	locale: string;
}): CreateNotificationParams {
	const { decision: d, recipientUserId, locale } = input;
	// A forgotten break in progress ended the work at its start (#861).
	const cutoff = (d.closesAt ?? d.cutoff).toLocaleString(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: d.timezone,
	});
	const duration = String(d.settings.maxUninterruptedMinutes);
	const titleDefault = "Automatically clocked out";
	const messageDefault =
		"You were automatically clocked out after {duration} minutes of uninterrupted work at {cutoff} ({timezone}) because your organization's time limit was reached.";
	const breakMessageDefault =
		"You were automatically clocked out at the start of your break at {cutoff} ({timezone}) because the break was not ended within your organization's time limit of {duration} minutes.";
	const german = locale.toLowerCase().startsWith("de");
	const messageTemplate = d.closesAt
		? german
			? "Du wurdest zu Beginn deiner Pause am {cutoff} ({timezone}) automatisch ausgestempelt, weil die Pause nicht innerhalb des Zeitlimits deiner Organisation von {duration} Minuten beendet wurde."
			: breakMessageDefault
		: german
			? "Du wurdest nach {duration} Minuten ununterbrochener Arbeit am {cutoff} ({timezone}) automatisch ausgestempelt, weil das Zeitlimit deiner Organisation erreicht wurde."
			: messageDefault;
	const params = { duration, cutoff, timezone: d.timezone };
	return {
		userId: recipientUserId,
		organizationId: d.organizationId,
		type: "automatic_clock_out",
		title: german ? "Automatisch ausgestempelt" : titleDefault,
		message: messageTemplate.replace(
			/\{(duration|cutoff|timezone)\}/g,
			(_, key: keyof typeof params) => params[key],
		),
		entityType: "work_period",
		entityId: d.workPeriodId,
		actionUrl: `/calendar/${d.employeeId}?date=${d.start.toZonedDateTimeISO(d.timezone).toPlainDate()}`,
		idempotencyKey: `automatic-clock-out:${d.operationId}:${recipientUserId}`,
		metadata: {
			operationId: d.operationId,
			i18n: d.closesAt
				? {
						titleKey: "common:notifications.content.automaticClockOut.title",
						titleDefault,
						messageKey: "common:notifications.content.automaticClockOut.breakMessage",
						messageDefault: breakMessageDefault,
						params,
					}
				: {
						titleKey: "common:notifications.content.automaticClockOut.title",
						titleDefault,
						messageKey: "common:notifications.content.automaticClockOut.message",
						messageDefault,
						params,
					},
		},
	};
}
