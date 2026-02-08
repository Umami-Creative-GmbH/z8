/**
 * Discord Integration
 *
 * Main export for the Discord bot module.
 */

// API
export { createDM, editMessage, getApplicationInfo, sendMessage } from "./api";
// Approval handling
export {
	handleApprovalButtonClick,
	sendApprovalMessageToManager,
} from "./approval-handler";
// Bot config
export {
	getAllActiveBotConfigs,
	getBotConfigByOrganization,
	isDiscordEnabledForOrganization,
	resolveBotByWebhookSecret,
} from "./bot-config";
// Bot handler
export { handleDiscordInteraction } from "./bot-handler";
// Conversation management
export {
	deactivateConversation,
	getChannelIdForUser,
	getOrCreateDMChannel,
	getOrganizationConversations,
	saveConversation,
} from "./conversation-manager";
// Notification triggers
export {
	triggerDiscordApprovalNotification,
	triggerDiscordApprovalResolutionNotification,
} from "./notification-trigger";
// Slash commands
export { registerDiscordSlashCommands } from "./slash-commands";
// Types
export * from "./types";
// User management
export {
	claimLinkCode,
	generateLinkCode,
	resolveDiscordUser,
	unlinkDiscordUser,
} from "./user-resolver";
