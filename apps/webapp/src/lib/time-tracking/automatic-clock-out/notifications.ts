import {
	fillNotificationTemplate,
	notificationParam,
} from "@/lib/notifications/notification-params";
import type { CreateNotificationParams, NotificationChannel } from "@/lib/notifications/types";
import { NOTIFICATION_CHANNELS } from "@/lib/notifications/types";
import type { AutoClockOutDecision } from "./types";

export function planAutoClockOutChannels(
	preferences: Record<NotificationChannel, boolean>,
): NotificationChannel[] {
	return NOTIFICATION_CHANNELS.filter((channel) => channel === "in_app" || preferences[channel]);
}

/**
 * The notice stores English text (the fallback, also sent to webhooks) and keys whose
 * typed params every channel formats in the recipient language when it delivers (#1149).
 * The cutoff is the clock-out entry's time, so it is shown at that entry's stored offset.
 */
export function buildAutoClockOutNotification(input: {
	decision: AutoClockOutDecision;
	recipientUserId: string;
	/** The automatic clock-out `time_entry`'s stored UTC offset. */
	endUtcOffsetMinutes: number;
}): CreateNotificationParams {
	const { decision: d, recipientUserId, endUtcOffsetMinutes } = input;
	const titleDefault = "Automatically clocked out";
	const messageDefault =
		"You were automatically clocked out after {duration} minutes of uninterrupted work at {cutoff} ({timezone}) because your organization's time limit was reached.";
	const breakMessageDefault =
		"You were automatically clocked out at the start of your break at {cutoff} ({timezone}) because the break was not ended within your organization's time limit of {duration} minutes.";
	const params = {
		duration: String(d.settings.maxUninterruptedMinutes),
		// A forgotten break in progress ended the work at its start (#861).
		cutoff: notificationParam.entryInstant(d.closesAt ?? d.cutoff, endUtcOffsetMinutes),
		timezone: d.timezone,
	};
	const i18n = d.closesAt
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
			};
	return {
		userId: recipientUserId,
		organizationId: d.organizationId,
		type: "automatic_clock_out",
		title: titleDefault,
		message: fillNotificationTemplate(i18n.messageDefault, params),
		entityType: "work_period",
		entityId: d.workPeriodId,
		actionUrl: `/calendar/${d.employeeId}?date=${d.start.toZonedDateTimeISO(d.timezone).toPlainDate()}`,
		idempotencyKey: `automatic-clock-out:${d.operationId}:${recipientUserId}`,
		metadata: { operationId: d.operationId, i18n },
	};
}
