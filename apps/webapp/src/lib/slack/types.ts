/**
 * Slack Integration Types
 *
 * Slack-specific types and re-exports of shared bot platform types.
 */

import type { Block, KnownBlock } from "@slack/web-api";

// Re-export shared types
export type {
	ApprovalCardData,
	ApprovalResolvedData,
	BotCommand,
	BotCommandContext,
	BotCommandResponse,
	DailyDigestData,
	PlatformConfig,
} from "@/lib/bot-platform/types";

// ============================================
// RESOLVED TYPES
// ============================================

export interface ResolvedSlackBot {
	organizationId: string;
	botAccessToken: string;
	slackTeamId: string;
	slackTeamName: string | null;
	botUserId: string | null;
	setupStatus: string;
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

export interface ResolvedSlackUser {
	userId: string;
	employeeId: string;
	organizationId: string;
	slackUserId: string;
	slackTeamId: string;
	slackUsername: string | null;
}

// ============================================
// SLACK EVENT TYPES
// ============================================

export interface SlackSlashCommandPayload {
	token: string;
	team_id: string;
	team_domain?: string;
	channel_id: string;
	channel_name?: string;
	user_id: string;
	user_name?: string;
	command: string;
	text: string;
	response_url: string;
	trigger_id: string;
}

export interface SlackEventCallback {
	type: "event_callback";
	token: string;
	team_id: string;
	event: SlackEvent;
}

export interface SlackEvent {
	type: string;
	channel?: string;
	user?: string;
	text?: string;
	ts?: string;
	channel_type?: string;
}

export interface SlackInteractionPayload {
	type: "block_actions" | "view_submission";
	user: { id: string; username?: string; name?: string };
	team: { id: string; domain?: string };
	channel?: { id: string; name?: string };
	message?: { ts: string };
	actions?: Array<{
		action_id: string;
		value?: string;
		type: string;
	}>;
}

export type SlackBlock = Block | KnownBlock;
