/**
 * Telegram Integration
 *
 * Main export for the Telegram bot module.
 */

// API
export { deleteWebhook, editMessageText, getMe, sendMessage, setMyCommands, setWebhook } from "./api";
// Approval handling
export {
	handleApprovalCallback,
	sendApprovalMessageToManager,
} from "./approval-handler";
// Bot config
export {
	getAllActiveBotConfigs,
	getBotConfigByOrganization,
	isTelegramEnabledForOrganization,
	resolveBotByWebhookSecret,
} from "./bot-config";
// Bot handler
export { handleTelegramUpdate } from "./bot-handler";
// Conversation management
export {
	deactivateConversation,
	getChatIdForUser,
	getOrganizationPrivateConversations,
	saveConversation,
} from "./conversation-manager";

// Notification triggers
export {
	triggerTelegramApprovalNotification,
	triggerTelegramApprovalResolutionNotification,
} from "./notification-trigger";
// Types
export * from "./types";
// User management
export {
	claimLinkCode,
	generateLinkCode,
	resolveTelegramUser,
	unlinkTelegramUser,
} from "./user-resolver";
