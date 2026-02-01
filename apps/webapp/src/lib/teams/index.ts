/**
 * Microsoft Teams Integration
 *
 * Main export for the Teams module.
 */

// Bot and messaging
export { getBotAdapter, sendProactiveMessage, sendAdaptiveCard, updateMessage, isBotConfigured } from "./bot-adapter";
export { handleBotActivity } from "./bot-handler";
export { handleApprovalAction, sendApprovalCardToManager } from "./approval-handler";
export { triggerApprovalNotification, triggerApprovalResolutionNotification } from "./notification-trigger";

// Resolution
export {
	resolveTenant,
	getTenantConfigByOrganization,
	updateTenantServiceUrl,
	isTeamsEnabledForOrganization,
	getAllActiveTenants,
} from "./tenant-resolver";
export {
	resolveTeamsUser,
	getTeamsMapping,
	deactivateTeamsMapping,
	getOrganizationTeamsMappings,
} from "./user-resolver";

// Conversation management
export {
	saveConversationReference,
	getConversationReferenceForUser,
	getStoredConversation,
	deactivateConversation,
	getOrganizationPersonalConversations,
} from "./conversation-manager";

// Commands
export { initializeCommands, executeCommand, parseCommand } from "./commands";

// Cards
export {
	buildApprovalCard,
	buildApprovalCardWithInvoke,
	buildResolvedApprovalCard,
	buildDailyDigestCard,
	buildDailyDigestText,
} from "./cards";

// Types
export * from "./types";
