/**
 * Microsoft Teams Integration
 *
 * Main export for the Teams module.
 */

export { handleApprovalAction, sendApprovalCardToManager } from "./approval-handler";
// Bot and messaging
export {
	evictTeamsInstallationBotAdapter,
	getBotAdapter,
	getTeamsInstallationBotAdapter,
	isBotConfigured,
	resolveTeamsOutboundTransportForOrganization,
	sendAdaptiveCard,
	sendProactiveMessage,
	sendTeamsProactiveTestMessage,
	type TeamsInstallationBotAdapterConfig,
	type TeamsOutboundTransport,
	type TeamsOutboundTransportResolution,
	updateMessage,
} from "./bot-adapter";
export { handleBotActivity, handleBotActivityForTenant } from "./bot-handler";
// Cards
export {
	buildApprovalCard,
	buildApprovalCardWithInvoke,
	buildDailyDigestCard,
	buildDailyDigestText,
	buildResolvedApprovalCard,
} from "./cards";
// Commands
export { executeCommand, initializeCommands, parseCommand } from "./commands";
// Conversation management
export {
	deactivateConversation,
	getConversationReferenceForUser,
	getOrganizationPersonalConversations,
	getStoredConversation,
	saveConversationReference,
} from "./conversation-manager";
export { triggerApprovalNotification } from "./notification-trigger";
// Resolution
export {
	getAllActiveTenants,
	getTenantConfigByOrganization,
	isTeamsEnabledForOrganization,
	resolveTenant,
	updateTenantServiceUrl,
} from "./tenant-resolver";
// Types
export * from "./types";
export {
	deactivateTeamsMapping,
	getOrganizationTeamsMappings,
	getTeamsMapping,
	resolveTeamsUser,
} from "./user-resolver";
