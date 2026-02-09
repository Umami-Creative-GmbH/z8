/**
 * Slack Integration
 *
 * Main export for the Slack bot module.
 */

// API
export { authTest, exchangeOAuthCode, openConversation, postMessage, updateMessage } from "./api";
// Approval handling
export { handleApprovalAction, sendApprovalMessageToManager } from "./approval-handler";
// Bot config
export {
	getAllActiveBotConfigs,
	getBotConfigByOrganization,
	getBotConfigByTeamId,
	isSlackEnabledForOrganization,
} from "./bot-config";
// Bot handler
export { handleEvent, handleInteraction, handleSlashCommand } from "./bot-handler";
// Conversation management
export {
	deactivateConversation,
	getChannelIdForUser,
	getOrganizationPrivateConversations,
	saveConversation,
} from "./conversation-manager";
// Notification triggers
export {
	triggerSlackApprovalNotification,
	triggerSlackApprovalResolutionNotification,
} from "./notification-trigger";
// Signature verification
export { verifySlackSignature } from "./signature";
// Types
export * from "./types";
// User management
export {
	claimLinkCode,
	generateLinkCode,
	resolveSlackUser,
	unlinkSlackUser,
} from "./user-resolver";
