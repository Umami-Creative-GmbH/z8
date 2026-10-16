import { Suspense } from "react";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";

import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import {
	getDiscordNotificationChannelConfig,
	getSlackNotificationChannelConfig,
	getTeamsNotificationChannelConfig,
	updateDiscordNotificationChannelSettings,
	updateSlackNotificationChannelSettings,
	updateTeamsNotificationChannelSettings,
} from "./actions";
import { TelegramPanel } from "./telegram-panel";

async function ChatSettingsContent() {
	const access = requireOrgAdminSettingsAccess();
	const [{ organizationId }, t, [slack, teams, discord]] = await Promise.all([
		access,
		getTranslate(),
		access.then(() =>
			Promise.all([
				getSlackNotificationChannelConfig(),
				getTeamsNotificationChannelConfig(),
				getDiscordNotificationChannelConfig(),
			]),
		),
	]);
	return (
		<SettingsTabbedPage
			key={organizationId}
			title={t(
				"settings.navigation.chat-integrations.title",
				"Chat Integrations",
			)}
			defaultTab="slack"
			tabs={[
				{
					value: "slack",
					label: t("settings.slack.title", "Slack"),
					description: t(
						"settings.notifications.slack.description",
						"Configure Slack notifications for your organization.",
					),
					panel: (
						<NotificationChannelSettings
							channelName="Slack"
							description={t(
								"settings.notifications.slack.description",
								"Configure Slack notifications for your organization.",
							)}
							config={slack.success ? slack.data : null}
							updateAction={updateSlackNotificationChannelSettings}
						/>
					),
				},
				{
					value: "teams",
					label: t("settings.teamsNotifications.title", "Microsoft Teams"),
					description: t(
						"settings.notifications.teams.description",
						"Configure Microsoft Teams notifications for your organization.",
					),
					panel: (
						<NotificationChannelSettings
							channelName="Microsoft Teams"
							description={t(
								"settings.notifications.teams.description",
								"Configure Microsoft Teams notifications for your organization.",
							)}
							config={teams.success ? teams.data : null}
							updateAction={updateTeamsNotificationChannelSettings}
						/>
					),
				},
				{
					value: "telegram",
					label: t("settings.telegram.title", "Telegram"),
					description: t(
						"settings.telegram.description",
						"Configure Telegram bot integration for notifications and commands",
					),
					panel: <TelegramPanel />,
				},
				{
					value: "discord",
					label: t("settings.discord.title", "Discord"),
					description: t(
						"settings.notifications.discord.description",
						"Configure Discord notifications for your organization.",
					),
					panel: (
						<NotificationChannelSettings
							channelName="Discord"
							description={t(
								"settings.notifications.discord.description",
								"Configure Discord notifications for your organization.",
							)}
							config={discord.success ? discord.data : null}
							updateAction={updateDiscordNotificationChannelSettings}
						/>
					),
				},
			]}
		/>
	);
}
export default function ChatSettingsPage() {
	return (
		<Suspense
			fallback={
				<SettingsPageSkeleton
					label={{
						labelKey: "settings.loading",
						labelDefault: "Loading settings",
					}}
				/>
			}
		>
			<ChatSettingsContent />
		</Suspense>
	);
}
