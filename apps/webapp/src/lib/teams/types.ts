/**
 * Microsoft Teams Integration Types
 *
 * Type definitions for the Teams bot and ChatOps features.
 * Shared types are re-exported from @/lib/bot-platform/types.
 */

import type { ConversationReference } from "botbuilder";

// Re-export shared bot-platform types for backward compatibility
export type {
	BotPlatform,
	PlatformConfig,
	BotCommandContext,
	BotCommand,
	BotCommandResponse,
	DailyDigestData,
	ApprovalCardData,
	ApprovalResolvedData,
} from "@/lib/bot-platform/types";
import type { ApprovalResolvedData } from "@/lib/bot-platform/types";
/** @deprecated Use ApprovalResolvedData instead */
export type ApprovalCardResolvedData = ApprovalResolvedData;

// ============================================
// TENANT & USER TYPES
// ============================================

/**
 * Resolved tenant configuration for a Teams interaction
 */
export interface ResolvedTenant {
	tenantId: string;
	tenantName: string | null;
	organizationId: string;
	setupStatus: string;
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
	serviceUrl: string | null;
}

/**
 * Resolved user from Teams interaction
 */
export interface ResolvedTeamsUser {
	userId: string;
	employeeId: string;
	organizationId: string;
	teamsUserId: string;
	teamsEmail: string;
	teamsTenantId: string;
	isNewMapping: boolean;
}

/**
 * Result of tenant resolution
 */
export type TenantResolutionResult =
	| { status: "configured"; tenant: ResolvedTenant }
	| { status: "unconfigured"; tenantId: string }
	| { status: "not_found"; tenantId: string };

/**
 * Result of user resolution
 */
export type UserResolutionResult =
	| { status: "found"; user: ResolvedTeamsUser }
	| { status: "not_linked"; teamsUserId: string; teamsEmail: string | null }
	| { status: "no_employee"; userId: string };

// BOT COMMAND TYPES - see @/lib/bot-platform/types for shared definitions

// APPROVAL CARD TYPES - see @/lib/bot-platform/types for shared definitions

// DAILY DIGEST TYPES - see @/lib/bot-platform/types for shared definitions

// ============================================
// PROACTIVE MESSAGING TYPES
// ============================================

/**
 * Stored conversation reference for proactive messaging
 */
export interface StoredConversation {
	id: string;
	userId: string | null;
	organizationId: string;
	conversationReference: ConversationReference;
	teamsConversationId: string;
	teamsServiceUrl: string;
	teamsTenantId: string;
	conversationType: "personal" | "channel" | "groupChat";
	isActive: boolean;
	lastUsedAt: Date | null;
}

// ============================================
// ESCALATION TYPES
// ============================================

/**
 * Pending approval that may need escalation
 */
export interface PendingApprovalForEscalation {
	approvalRequestId: string;
	organizationId: string;
	approverId: string;
	approverUserId: string;
	requestedByName: string;
	entityType: string;
	createdAt: Date;
	ageHours: number;
}

/**
 * Result of escalation processing
 */
export interface EscalationResult {
	approvalRequestId: string;
	escalatedTo: string;
	success: boolean;
	error?: string;
}

// ============================================
// SETUP TYPES
// ============================================

/**
 * Payload for tenant setup link
 */
export interface TenantSetupPayload {
	tenantId: string;
	tenantName?: string;
	timestamp: number;
	signature: string;
}

/**
 * Request to link a tenant to an organization
 */
export interface LinkTenantRequest {
	tenantId: string;
	organizationId: string;
	configuredByUserId: string;
	tenantName?: string;
	serviceUrl?: string;
}

// ============================================
// ERROR TYPES
// ============================================

/**
 * Teams-specific error
 */
export class TeamsError extends Error {
	constructor(
		message: string,
		public readonly code: TeamsErrorCode,
		public readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "TeamsError";
	}
}

export type TeamsErrorCode =
	| "TENANT_NOT_CONFIGURED"
	| "USER_NOT_LINKED"
	| "EMPLOYEE_NOT_FOUND"
	| "APPROVAL_NOT_FOUND"
	| "APPROVAL_ALREADY_RESOLVED"
	| "NOT_AUTHORIZED"
	| "BOT_ERROR"
	| "CARD_UPDATE_FAILED"
	| "PROACTIVE_MESSAGE_FAILED";
