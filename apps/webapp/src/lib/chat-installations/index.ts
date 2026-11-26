export {
	type AcquireOwnershipClaimResult,
	acquireExternalOwnershipClaim,
	backfillAllLegacyChatInstallations,
	backfillOrganizationChatInstallations,
} from "./backfill";
export {
	checkSwitchEligibility,
	getOrganizationChatInstallationsInventory,
	getProviderChatInstallationInventory,
	listInstallationConversations,
	listLegacyTeamsTenantsForOrganization,
	resolveActiveChatInstallation,
	upsertInstallationConversation,
} from "./inventory";
export {
	buildBlockerFromInstallation,
	buildLegacyReceiverScope,
	deriveProviderConnectionState,
	detectTeamsTenantSettingsDisagreements,
	extractTelegramNumericBotId,
	isKnownLegacySetupStatus,
	isValidDiscordSnowflake,
	isValidGuid,
	type LegacyReceiverScopeInput,
} from "./legacy-analysis";
export * from "./types";
