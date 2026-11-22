import { Suspense } from "react";
import { DiscordChannelSettings } from "@/components/settings/discord-channel-settings";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";

import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import {
	connectDiscordBot,
	disconnectDiscordBot,
	getDiscordNotificationChannelConfig,
	getSlackNotificationChannelConfig,
	getTeamsNotificationChannelConfig,
	updateDiscordNotificationChannelSettings,
	updateSlackNotificationChannelSettings,
	updateTeamsNotificationChannelSettings,
} from "./actions";
import { SlackConnectButton } from "./slack-connect-button";
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
			title={t("settings.navigation.chat-integrations.title", "Chat Integrations")}
			defaultTab="slack"
			tabs={[
				{
					value: "slack",
					label: t("settings.slack.title", "Slack"),
					description: t(
						"settings.notifications.slack.description",
						"Configure Slack notifications for your organization.",
					),
					measure: true,
					panel: (
						<NotificationChannelSettings
							channelName="Slack"
							config={slack.success ? slack.data : null}
							updateAction={updateSlackNotificationChannelSettings}
							connectAction={<SlackConnectButton organizationId={organizationId} />}
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
					measure: true,
					panel: (
						<NotificationChannelSettings
							channelName="Microsoft Teams"
							config={teams.success ? teams.data : null}
							updateAction={updateTeamsNotificationChannelSettings}
							connectAction={
								<p className="text-sm">
									{t(
										"settings.notifications.teams.setupInstructions",
										"To connect Microsoft Teams, add the Z8 app to your Microsoft 365 tenant. The Z8 bot then sends a setup link that an organization admin opens to link the tenant to this organization.",
									)}
								</p>
							}
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
					measure: true,
					panel: <TelegramPanel />,
				},
				{
					value: "discord",
					label: t("settings.discord.title", "Discord"),
					description: t(
						"settings.notifications.discord.description",
						"Configure Discord notifications for your organization.",
					),
					measure: true,
					panel: (
						<DiscordChannelSettings
							config={discord.success ? discord.data : null}
							updateAction={updateDiscordNotificationChannelSettings}
							connectAction={connectDiscordBot}
							disconnectAction={disconnectDiscordBot}
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
