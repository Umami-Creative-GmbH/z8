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
import { TelegramPanel } from "./telegram-panel";

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
			slackRecovery,
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
				getSlackRecoveryState(),
				getProviderCapabilityDisclosure({ provider: "slack" }),
				getProviderCapabilityDisclosure({ provider: "teams" }),
				getProviderCapabilityDisclosure({ provider: "telegram" }),
				getProviderCapabilityDisclosure({ provider: "discord" }),
				getDiscordLifecycleState(),
			]),
		),
	]);
	const inventoryData = inventory.success ? inventory.data : null;
	const inventoryLoadFailed = !inventory.success;
	const slackCandidateData = slackCandidate.success ? slackCandidate.data : null;
	const teamsCandidateData = teamsCandidate.success ? teamsCandidate.data : null;
	const slackSwitchPreviewData = slackSwitchPreview.success ? slackSwitchPreview.data : null;
	const slackRecoveryData = slackRecovery.success ? slackRecovery.data : null;
	const discordLifecycleData = discordLifecycle.success ? discordLifecycle.data : null;

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
								disclosure={slackCapabilities.success ? slackCapabilities.data : null}
							/>
							<SlackPrepareTestSection initialSetup={slackCandidateData} />
							<SlackSwitchReviewSection initialPreview={slackSwitchPreviewData} />
							<SlackRecoverySection initialState={slackRecoveryData} />
							<NotificationChannelSettings
								channelName="Slack"
								config={slack.success ? slack.data : null}
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
								disclosure={teamsCapabilities.success ? teamsCapabilities.data : null}
							/>
							<TeamsPrepareTestSection initialSetup={teamsCandidateData} />
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
							<ChatCapabilityDisclosureCard
								channelName="Telegram"
								disclosure={telegramCapabilities.success ? telegramCapabilities.data : null}
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
							<ChatCapabilityDisclosureCard
								channelName="Discord"
								disclosure={discordCapabilities.success ? discordCapabilities.data : null}
							/>
							<DiscordLifecycleSection initialState={discordLifecycleData} />
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
