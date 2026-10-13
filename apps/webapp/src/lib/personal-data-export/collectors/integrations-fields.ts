/**
 * The README's explanation of every part and field of the Integrations
 * category (#811, #1172). See "Field guide" in `../collector.ts`.
 */

import type { PersonalDataFieldGuide } from "../collector";

export const integrationsFieldGuide: PersonalDataFieldGuide = (t) => {
	const isActive = () =>
		t(
			"personalDataExport.readme.fields.integrations.shared.isActive",
			"Whether the connection is in use.",
		);

	return {
		calendar_connections: {
			summary: t(
				"personalDataExport.readme.fields.integrations.calendarConnections.summary",
				"The calendars you connected to the app. Access tokens are never included.",
			),
			fields: {
				provider: t(
					"personalDataExport.readme.fields.integrations.calendarConnections.provider",
					"The calendar service, for example google, microsoft365 or icloud.",
				),
				account: t(
					"personalDataExport.readme.fields.integrations.calendarConnections.account",
					"Your account at the calendar service.",
				),
				calendar_id: t(
					"personalDataExport.readme.fields.integrations.calendarConnections.calendarId",
					"The calendar the app uses in that account.",
				),
				is_active: isActive(),
				push_enabled: t(
					"personalDataExport.readme.fields.integrations.calendarConnections.pushEnabled",
					"Whether the app adds your absences to that calendar.",
				),
				conflict_detection_enabled: t(
					"personalDataExport.readme.fields.integrations.calendarConnections.conflictDetectionEnabled",
					"Whether the app checks that calendar for conflicting appointments.",
				),
				last_sync_at: t(
					"personalDataExport.readme.fields.integrations.calendarConnections.lastSyncAt",
					"When the app last synchronized with the calendar (UTC).",
				),
				created_at: t(
					"personalDataExport.readme.fields.integrations.calendarConnections.createdAt",
					"When you connected the calendar (UTC).",
				),
				updated_at: t(
					"personalDataExport.readme.fields.integrations.calendarConnections.updatedAt",
					"When the connection was last changed (UTC).",
				),
			},
		},
		ics_feeds: {
			summary: t(
				"personalDataExport.readme.fields.integrations.icsFeeds.summary",
				"Your calendar feed links, which let a calendar app subscribe to your absences. The secret link itself is never included.",
			),
			fields: {
				is_active: t(
					"personalDataExport.readme.fields.integrations.icsFeeds.isActive",
					"Whether the link still works.",
				),
				include_approved: t(
					"personalDataExport.readme.fields.integrations.icsFeeds.includeApproved",
					"Whether the feed shows approved absences.",
				),
				include_pending: t(
					"personalDataExport.readme.fields.integrations.icsFeeds.includePending",
					"Whether the feed shows absences still waiting for approval.",
				),
				created_at: t(
					"personalDataExport.readme.fields.integrations.icsFeeds.createdAt",
					"When the link was created (UTC).",
				),
				last_used_at: t(
					"personalDataExport.readme.fields.integrations.icsFeeds.lastUsedAt",
					"When a calendar app last read the feed (UTC).",
				),
				revoked_at: t(
					"personalDataExport.readme.fields.integrations.icsFeeds.revokedAt",
					"When the link was switched off (UTC).",
				),
			},
		},
		chat_accounts: {
			summary: t(
				"personalDataExport.readme.fields.integrations.chatAccounts.summary",
				"Your chat accounts linked to the app, so you can use it from Slack, Microsoft Teams, Telegram or Discord.",
			),
			fields: {
				platform: t(
					"personalDataExport.readme.fields.integrations.chatAccounts.platform",
					"The chat service: slack, teams, telegram or discord.",
				),
				account_id: t(
					"personalDataExport.readme.fields.integrations.chatAccounts.accountId",
					"Your account's ID at the chat service.",
				),
				username: t(
					"personalDataExport.readme.fields.integrations.chatAccounts.username",
					"Your user name at the chat service.",
				),
				display_name: t(
					"personalDataExport.readme.fields.integrations.chatAccounts.displayName",
					"Your display name at the chat service.",
				),
				email: t(
					"personalDataExport.readme.fields.integrations.chatAccounts.email",
					"Your email address at the chat service, where it provides one.",
				),
				workspace_id: t(
					"personalDataExport.readme.fields.integrations.chatAccounts.workspaceId",
					"The ID of the workspace or tenant your account belongs to, where the service has one.",
				),
				is_active: t(
					"personalDataExport.readme.fields.integrations.chatAccounts.isActive",
					"Whether the link is in use.",
				),
				linked_at: t(
					"personalDataExport.readme.fields.integrations.chatAccounts.linkedAt",
					"When you linked the account (UTC).",
				),
				last_seen_at: t(
					"personalDataExport.readme.fields.integrations.chatAccounts.lastSeenAt",
					"When you last used the app through the account (UTC).",
				),
			},
		},
		kiosk_pin: {
			summary: t(
				"personalDataExport.readme.fields.integrations.kioskPin.summary",
				"Whether you have a PIN for clocking in at a kiosk terminal. The PIN itself is never stored readably and is not included.",
			),
			fields: {
				pin_set: t(
					"personalDataExport.readme.fields.integrations.kioskPin.pinSet",
					"Whether a kiosk PIN is set for you.",
				),
				set_at: t(
					"personalDataExport.readme.fields.integrations.kioskPin.setAt",
					"When the PIN was last set (UTC).",
				),
				set_by: t(
					"personalDataExport.readme.fields.integrations.kioskPin.setBy",
					"Who set the PIN.",
				),
			},
		},
	};
};
