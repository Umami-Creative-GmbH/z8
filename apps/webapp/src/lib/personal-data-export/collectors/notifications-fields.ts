/**
 * The README's explanation of every part and field of the Notifications
 * category (#811, #1172). See "Field guide" in `../collector.ts`.
 */

import type { PersonalDataFieldGuide } from "../collector";

export const notificationsFieldGuide: PersonalDataFieldGuide = (t) => ({
	notifications: {
		summary: t(
			"personalDataExport.readme.fields.notifications.notifications.summary",
			"The notifications you received in the app, exactly as you received them.",
		),
		fields: {
			type: t(
				"personalDataExport.readme.fields.notifications.notifications.type",
				"What the notification is about, for example approval_request_submitted.",
			),
			title: t(
				"personalDataExport.readme.fields.notifications.notifications.title",
				"The notification's title.",
			),
			message: t(
				"personalDataExport.readme.fields.notifications.notifications.message",
				"The notification's text.",
			),
			entity_type: t(
				"personalDataExport.readme.fields.notifications.notifications.entityType",
				"The kind of record the notification refers to, for example an absence.",
			),
			entity_id: t(
				"personalDataExport.readme.fields.notifications.notifications.entityId",
				"The ID of that record.",
			),
			action_url: t(
				"personalDataExport.readme.fields.notifications.notifications.actionUrl",
				"The page in the app the notification links to.",
			),
			is_read: t(
				"personalDataExport.readme.fields.notifications.notifications.isRead",
				"Whether you have read the notification.",
			),
			read_at: t(
				"personalDataExport.readme.fields.notifications.notifications.readAt",
				"When you read it (UTC).",
			),
			metadata: t(
				"personalDataExport.readme.fields.notifications.notifications.metadata",
				"Further details the notification carried, as JSON.",
			),
			created_at: t(
				"personalDataExport.readme.fields.notifications.notifications.createdAt",
				"When you received the notification (UTC).",
			),
		},
	},
});
