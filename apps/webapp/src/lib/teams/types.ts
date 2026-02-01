/**
 * Microsoft Teams Integration Types
 *
 * Type definitions for the Teams bot and ChatOps features.
 */

import type { ConversationReference } from "botbuilder";

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

// ============================================
// BOT COMMAND TYPES
// ============================================

/**
 * Bot command context passed to handlers
 */
export interface BotCommandContext {
	organizationId: string;
	employeeId: string;
	userId: string;
	teamsUserId: string;
	tenant: ResolvedTenant;
	args: string[];
}

/**
 * Bot command definition
 */
export interface BotCommand {
	/** Command name (e.g., "clockedin") */
	name: string;
	/** Alternative names that trigger this command */
	aliases?: string[];
	/** Help text shown in /help */
	description: string;
	/** Usage example */
	usage: string;
	/** Whether user must be linked to Z8 account */
	requiresAuth: boolean;
	/** Handler function */
	handler: (ctx: BotCommandContext) => Promise<BotCommandResponse>;
}

/**
 * Response from a bot command
 */
export interface BotCommandResponse {
	/** Response type */
	type: "text" | "card";
	/** Plain text response (for type: "text" or as fallback) */
	text: string;
	/** Adaptive Card payload (for type: "card") */
	// biome-ignore lint/suspicious/noExplicitAny: Adaptive Cards are flexible JSON
	card?: any;
}

// ============================================
// APPROVAL CARD TYPES
// ============================================

/**
 * Data for building an approval Adaptive Card
 */
export interface ApprovalCardData {
	approvalId: string;
	entityType: "absence_entry" | "time_entry";
	requesterName: string;
	requesterEmail?: string;
	reason?: string;
	createdAt: Date;
	// Absence-specific
	absenceCategory?: string;
	startDate?: string;
	endDate?: string;
	days?: number;
	// Time correction-specific
	originalTime?: string;
	correctedTime?: string;
}

/**
 * Data for resolved approval card (after action)
 */
export interface ApprovalCardResolvedData {
	action: "approved" | "rejected";
	approverName: string;
	resolvedAt: Date;
}

// ============================================
// DAILY DIGEST TYPES
// ============================================

/**
 * Data for building a daily digest Adaptive Card
 */
export interface DailyDigestData {
	date: Date;
	timezone: string;
	pendingApprovals: number;
	employeesOut: Array<{
		name: string;
		category: string;
		returnDate: string;
	}>;
	employeesClockedIn: Array<{
		name: string;
		clockedInAt: string;
		durationSoFar: string;
	}>;
	// Operations Console Additions
	coverageGaps?: Array<{
		subareaName: string;
		locationName: string;
		timeSlot: string;
		scheduled: number;
		actual: number;
		shortage: number;
	}>;
	openShiftsToday?: number;
	openShiftsTomorrow?: number;
	compliancePending?: number;
}

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
