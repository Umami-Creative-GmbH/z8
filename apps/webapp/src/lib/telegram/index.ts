/**
 * Telegram Integration
 *
 * Main export for the Telegram bot module.
 */

// API
export {
	deleteWebhook,
	deleteWebhookWithOutcome,
	editMessageText,
	getMe,
	getMeWithOutcome,
	getWebhookInfo,
	getWebhookInfoWithOutcome,
	sendMessage,
	setMyCommands,
	setMyCommandsWithOutcome,
	setWebhook,
	setWebhookWithOutcome,
} from "./api";
// Approval handling
export { handleApprovalCallback, sendApprovalMessageToManager } from "./approval-handler";
// Bot config
export {
	getAllActiveBotConfigs,
	getBotConfigByOrganization,
	isTelegramEnabledForOrganization,
	resolveBotByWebhookSecret,
	resolveLegacyTelegramWebhookBot,
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
export { triggerTelegramApprovalNotification } from "./notification-trigger";
// Types
export * from "./types";
// User management
export {
	claimLinkCode,
	generateLinkCode,
	resolveTelegramUser,
	unlinkTelegramUser,
} from "./user-resolver";
