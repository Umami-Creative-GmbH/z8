import { Suspense } from "react";
import { ChatCapabilityDisclosureCard } from "@/components/settings/chat-capability-disclosure-card";
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
import { getDiscordLifecycleState } from "./discord-lifecycle-actions";
import { DiscordLifecycleSection } from "./discord-lifecycle-section";
import { getSlackRecoveryState } from "./recovery-actions";
import { SlackPrepareTestSection } from "./slack-prepare-test-section";
import { SlackRecoverySection } from "./slack-recovery-section";
import { getSlackCandidateSetup } from "./slack-setup-actions";
import {
	getProviderCapabilityDisclosure,
	getSlackSwitchImpactPreview,
} from "./slack-switch-actions";
import { SlackSwitchReviewSection } from "./slack-switch-review-section";
import { TeamsPrepareTestSection } from "./teams-prepare-test-section";
import { getTeamsCandidateSetup } from "./teams-setup-actions";
import { getTeamsSwitchImpactPreview } from "./teams-switch-actions";
import { TeamsSwitchReviewSection } from "./teams-switch-review-section";
import { getTelegramLifecycleState } from "./telegram-lifecycle-actions";
import { TelegramLifecycleSection } from "./telegram-lifecycle-section";
import { TelegramPanel } from "./telegram-panel";

function dataOrNull<T>(result: { success: true; data: T } | { success: false }) {
	return result.success ? result.data : null;
}

async function ChatSettingsContent() {
	const access = requireOrgAdminSettingsAccess();
	const [
		{ organizationId },
		t,
		[
			slack,
			teams,
			discord,
			inventory,
			slackCandidate,
			teamsCandidate,
			slackSwitchPreview,
			teamsSwitchPreview,
			slackRecovery,
			telegramLifecycle,
			slackCapabilities,
			teamsCapabilities,
			telegramCapabilities,
			discordCapabilities,
			discordLifecycle,
		],
	] = await Promise.all([
		access,
		getTranslate(),
		access.then(() =>
			Promise.all([
				getSlackNotificationChannelConfig(),
				getTeamsNotificationChannelConfig(),
				getDiscordNotificationChannelConfig(),
				getChatInstallationsInventory(),
				getSlackCandidateSetup(),
				getTeamsCandidateSetup(),
				getSlackSwitchImpactPreview(),
				getTeamsSwitchImpactPreview(),
				getSlackRecoveryState(),
				getTelegramLifecycleState(),
				getProviderCapabilityDisclosure({ provider: "slack" }),
				getProviderCapabilityDisclosure({ provider: "teams" }),
				getProviderCapabilityDisclosure({ provider: "telegram" }),
				getProviderCapabilityDisclosure({ provider: "discord" }),
				getDiscordLifecycleState(),
			]),
		),
	]);
	const inventoryData = dataOrNull(inventory);
	const inventoryLoadFailed = !inventory.success;
	const slackCandidateData = dataOrNull(slackCandidate);
	const teamsCandidateData = dataOrNull(teamsCandidate);
	const slackSwitchPreviewData = dataOrNull(slackSwitchPreview);
	const teamsSwitchPreviewData = dataOrNull(teamsSwitchPreview);
	const slackRecoveryData = dataOrNull(slackRecovery);
	const telegramLifecycleData = dataOrNull(telegramLifecycle);
	const discordLifecycleData = dataOrNull(discordLifecycle);

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
							<ChatCapabilityDisclosureCard
								channelName="Slack"
								disclosure={dataOrNull(slackCapabilities)}
							/>
							<SlackPrepareTestSection initialSetup={slackCandidateData} />
							<SlackSwitchReviewSection initialPreview={slackSwitchPreviewData} />
							<SlackRecoverySection initialState={slackRecoveryData} />
							<NotificationChannelSettings
								channelName="Slack"
								config={dataOrNull(slack)}
								updateAction={updateSlackNotificationChannelSettings}
								connectAction={
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.notifications.slack.orgOwnedConnectHint",
											"Prepare, verify, and switch to your organization-owned Slack app using the setup workflow above.",
										)}
									</p>
								}
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
							<ChatCapabilityDisclosureCard
								channelName="Microsoft Teams"
								disclosure={dataOrNull(teamsCapabilities)}
							/>
							<TeamsPrepareTestSection initialSetup={teamsCandidateData} />
							<TeamsSwitchReviewSection initialPreview={teamsSwitchPreviewData} />
							<NotificationChannelSettings
								channelName="Microsoft Teams"
								config={dataOrNull(teams)}
								updateAction={updateTeamsNotificationChannelSettings}
								connectAction={
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.teamsSwitch.orgOwnedConnectHint",
											"Prepare, verify, and switch to your single-tenant organization-owned Microsoft Teams app using the workflow above.",
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
							<ChatCapabilityDisclosureCard
								channelName="Telegram"
								disclosure={dataOrNull(telegramCapabilities)}
							/>
							<TelegramLifecycleSection initialState={telegramLifecycleData} />
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
							<ChatCapabilityDisclosureCard
								channelName="Discord"
								disclosure={dataOrNull(discordCapabilities)}
							/>
							<DiscordLifecycleSection initialState={discordLifecycleData} />
							<DiscordChannelSettings
								config={dataOrNull(discord)}
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
