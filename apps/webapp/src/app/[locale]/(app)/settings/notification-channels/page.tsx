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
	getChatInstallationsInventory,
	getDiscordNotificationChannelConfig,
	getSlackNotificationChannelConfig,
	getTeamsNotificationChannelConfig,
	updateDiscordNotificationChannelSettings,
	updateSlackNotificationChannelSettings,
	updateTeamsNotificationChannelSettings,
} from "./actions";
import { ChatInstallationInventoryPanel } from "./chat-installation-inventory-panel";
import { SlackConnectButton } from "./slack-connect-button";
import { TelegramPanel } from "./telegram-panel";

async function ChatSettingsContent() {
	const access = requireOrgAdminSettingsAccess();
	const [{ organizationId }, t, [slack, teams, discord, inventory]] = await Promise.all([
		access,
		getTranslate(),
		access.then(() =>
			Promise.all([
				getSlackNotificationChannelConfig(),
				getTeamsNotificationChannelConfig(),
				getDiscordNotificationChannelConfig(),
				getChatInstallationsInventory(),
			]),
		),
	]);
	const inventoryData = inventory.success ? inventory.data : null;
	const inventoryLoadFailed = !inventory.success;

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
						<div className="min-w-0 space-y-6">
							<ChatInstallationInventoryPanel
								provider="slack"
								channelName="Slack"
								initialInventory={inventoryData?.providers.slack ?? null}
								initialLoadFailed={inventoryLoadFailed}
							/>
							<NotificationChannelSettings
								channelName="Slack"
								config={slack.success ? slack.data : null}
								updateAction={updateSlackNotificationChannelSettings}
								connectAction={<SlackConnectButton organizationId={organizationId} />}
							/>
						</div>
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
						<div className="min-w-0 space-y-6">
							<ChatInstallationInventoryPanel
								provider="teams"
								channelName="Microsoft Teams"
								initialInventory={inventoryData?.providers.teams ?? null}
								initialLoadFailed={inventoryLoadFailed}
							/>
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
						</div>
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
					panel: (
						<div className="min-w-0 space-y-6">
							<ChatInstallationInventoryPanel
								provider="telegram"
								channelName="Telegram"
								initialInventory={inventoryData?.providers.telegram ?? null}
								initialLoadFailed={inventoryLoadFailed}
							/>
							<TelegramPanel />
						</div>
					),
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
						<div className="min-w-0 space-y-6">
							<ChatInstallationInventoryPanel
								provider="discord"
								channelName="Discord"
								initialInventory={inventoryData?.providers.discord ?? null}
								initialLoadFailed={inventoryLoadFailed}
							/>
							<DiscordChannelSettings
								config={discord.success ? discord.data : null}
								updateAction={updateDiscordNotificationChannelSettings}
								connectAction={connectDiscordBot}
								disconnectAction={disconnectDiscordBot}
							/>
						</div>
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
