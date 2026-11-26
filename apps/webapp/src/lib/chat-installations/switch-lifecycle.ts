import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db as defaultDb } from "@/db";
import { member } from "@/db/auth-schema";
import {
	type ChatConversationReachabilityStatus,
	type ChatInstallationProvider,
	type ChatInstallationStatus,
	type ChatVerificationState,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationCredentialRevision,
	chatInstallationMemberLink,
	chatInstallationSwitchControl,
	chatProviderSettings,
	discordBotConfig,
	employee,
	slackUserMapping,
	slackWorkspaceConfig,
	teamsTenantConfig,
	teamsUserMapping,
	telegramBotConfig,
} from "@/db/schema";
import {
	countOutstandingApprovalWorkByInstallation,
	type InstallationOutstandingApprovalCounts,
} from "@/lib/approvals/delivery/installation-origin";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { dateFromInstant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { createLogger } from "@/lib/logger";
import { deleteOrgSecret } from "@/lib/vault";
import { backfillOrganizationChatInstallations } from "./backfill";
import {
	countInFlightDurableDispatches,
	type InFlightDurableDispatchCounts,
} from "./durable-dispatch";
import { checkSwitchEligibility } from "./inventory";
import {
	buildVerifiedExternalScope,
	reuseVerifiedExternalIdentity,
	verifyEligibleChatLinkMember,
} from "./member-links";
import {
	computeSlackCandidateSetupStatus,
	SLACK_VERIFICATION_FRESHNESS_MS,
	type SlackCandidateInstallationRecord,
} from "./slack-setup";
import type { ChatEffectiveSettings, ChatMigrationBlocker } from "./types";

const logger = createLogger("ChatInstallationSwitchLifecycle");

/**
 * Maximum retirement window (30 days in UTC) during which a retiring chat installation
 * may continue servicing approval cards it originally sent (#2045 / ADR 0003).
 */
export const CHAT_INSTALLATION_RETIREMENT_DAYS = 30;
export const CHAT_INSTALLATION_RETIREMENT_HOURS = CHAT_INSTALLATION_RETIREMENT_DAYS * 24;

export type ChatSwitchDb = Pick<
	typeof defaultDb,
	"select" | "selectDistinct" | "insert" | "update" | "delete" | "execute" | "transaction" | "query"
>;

export interface ChatSwitchAuditEvent {
	action: AuditAction;
	actorId: string;
	organizationId: string;
	targetId: string;
	metadata: Record<string, unknown>;
}

export interface ChatSwitchLifecycleDeps {
	db?: ChatSwitchDb;
	now?: () => Date;
	syncLegacy?: boolean;
	verificationTtlMs?: number;
	recordAudit?: (event: ChatSwitchAuditEvent) => Promise<void>;
	deleteSecret?: (organizationId: string, key: string) => Promise<void>;
	countOutstandingApprovalWork?: (
		organizationId: string,
		installationId: string,
		dbClient: ChatSwitchDb,
	) => Promise<InstallationOutstandingApprovalCounts>;
	countInFlightDurable?: (
		organizationId: string,
		provider: ChatInstallationProvider,
		installationId: string | null,
		dbClient: ChatSwitchDb,
	) => Promise<InFlightDurableDispatchCounts>;
}

export interface SwitchMaterialCounts {
	totalActiveEmployees: number;
	verifiedReachableEmployees: number;
	actionNeededEmployees: number;
	unknownReachabilityEmployees: number;
	carryForwardIdentityEmployees: number;
	outstandingApprovalCards: number;
	outstandingApprovalWork: number;
	pendingLegacyApprovalCards: number;
	inFlightDurableDispatches: number;
	uncertainDurableDispatches: number;
}

export interface SwitchImpactDigestInput {
	organizationId: string;
	provider: ChatInstallationProvider;
	currentInstallationIds: readonly string[];
	currentCredentialRevisionIds: readonly string[];
	candidateInstallationId: string | null;
	candidateCredentialRevisionId: string | null;
	affectedLegacyIds: readonly string[];
	materialCounts: SwitchMaterialCounts;
}

export interface EmployeeSwitchReachabilitySummary {
	totalActiveEmployees: number;
	verifiedReachableEmployees: number;
	actionNeededEmployees: number;
	unknownReachabilityEmployees: number;
	carryForwardIdentityEmployees: number;
	unreadyEmployees: number;
}

export interface SwitchInstallationPreviewItem {
	id: string;
	status: ChatInstallationStatus;
	credentialSource: "organization_owned" | "deployment_managed";
	externalAppId: string | null;
	externalBotId: string | null;
	externalBotUsername: string | null;
	externalDisplayName: string | null;
	externalSpaceId: string | null;
	externalSpaceName: string | null;
	activeCredentialRevisionId: string | null;
	legacyTable: string | null;
	legacyRecordId: string | null;
	verificationState: ChatVerificationState;
	lastVerifiedAt: string | null;
}

export interface RetiringInstallationPreviewItem {
	id: string;
	credentialSource: "organization_owned" | "deployment_managed";
	externalAppId: string | null;
	externalDisplayName: string | null;
	externalSpaceName: string | null;
	retirementDeadlineAt: string | null;
	openCanonicalCards: number;
	openLegacyOwnerCards: number;
	outstandingRefreshWork: number;
	pendingLegacyCards: number;
	totalOutstandingCardsAndWork: number;
}

export interface ChatSwitchImpactPreview {
	organizationId: string;
	provider: ChatInstallationProvider;
	generatedAt: string;
	switchControlEnabled: boolean;
	blockers: ChatMigrationBlocker[];
	hasHardBlockers: boolean;
	currentInstallations: SwitchInstallationPreviewItem[];
	primaryCurrentInstallationId: string | null;
	primaryCurrentCredentialRevisionId: string | null;
	candidateInstallation: SwitchInstallationPreviewItem | null;
	candidateReady: boolean;
	candidateVerificationState: ChatVerificationState | null;
	retiringInstallations: RetiringInstallationPreviewItem[];
	employeeImpact: EmployeeSwitchReachabilitySummary;
	approvalImpact: {
		openCanonicalCards: number;
		openLegacyOwnerCards: number;
		outstandingDeliveryWork: number;
		outstandingRefreshWork: number;
		uncertainApprovalWork: number;
		pendingLegacyCards: number;
		totalOutstanding: number;
	};
	inFlightNotificationImpact: InFlightDurableDispatchCounts;
	effectiveSettings: ChatEffectiveSettings;
	requiresUnreadyAcknowledgement: boolean;
	canConfirm: boolean;
	impactDigest: string;
}

export type ChatSwitchRefusalCode =
	| "switch_not_enabled"
	| "migration_blocked"
	| "candidate_not_found"
	| "already_switched"
	| "candidate_not_ready"
	| "candidate_verification_expired"
	| "impact_changed"
	| "unready_acknowledgement_required";

export interface ConfirmChatInstallationSwitchInput {
	organizationId: string;
	provider: ChatInstallationProvider;
	actorUserId: string;
	candidateInstallationId: string;
	reviewedCurrentInstallationId: string | null;
	reviewedCurrentInstallationIds?: readonly string[];
	reviewedCurrentCredentialRevisionId: string | null;
	reviewedCandidateCredentialRevisionId: string | null;
	reviewedImpactDigest: string;
	acknowledgeUnreadyEmployees: boolean;
}

export type ConfirmChatInstallationSwitchResult =
	| {
			kind: "switched";
			activeInstallationId: string;
			retiredInstallationIds: string[];
			retirementDeadlineAt: string;
			carriedForwardIdentityCount: number;
			promotedEnrollmentCount: number;
			effectiveSettings: ChatEffectiveSettings;
			preview: ChatSwitchImpactPreview;
	  }
	| {
			kind: "refused";
			code: ChatSwitchRefusalCode;
			message: string;
			freshPreview: ChatSwitchImpactPreview;
	  };

export interface RetireSettledChatInstallationsResult {
	checkedCount: number;
	retiredCount: number;
	retiredInstallationIds: string[];
	retiredByReason: {
		workSettled: number;
		deadlineReached: number;
	};
}

export type DisconnectLegacySlackResult =
	| {
			kind: "disconnected";
			disconnectedLegacyConfigId: string | null;
			installationId: string | null;
	  }
	| {
			kind: "refused";
			code: "legacy_setup_superseded" | "migration_blocked";
			status: 409 | 410;
			message: string;
	  };

const DEFAULT_EFFECTIVE_SETTINGS: ChatEffectiveSettings = {
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: true,
	enableEscalations: true,
	digestTime: "08:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
};

function getNow(deps?: Pick<ChatSwitchLifecycleDeps, "now">): Date {
	return deps?.now ? deps.now() : dateFromInstant(systemClock.nowInstant());
}

function toPreviewItem(row: typeof chatInstallation.$inferSelect): SwitchInstallationPreviewItem {
	return {
		id: row.id,
		status: row.status,
		credentialSource: row.credentialSource,
		externalAppId: row.externalAppId,
		externalBotId: row.externalBotId,
		externalBotUsername: row.externalBotUsername,
		externalDisplayName: row.externalDisplayName,
		externalSpaceId: row.externalSpaceId,
		externalSpaceName: row.externalSpaceName,
		activeCredentialRevisionId: row.activeCredentialRevisionId,
		legacyTable: row.legacyTable,
		legacyRecordId: row.legacyRecordId,
		verificationState: row.verificationState,
		lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
	};
}

async function defaultRecordAudit(event: ChatSwitchAuditEvent): Promise<void> {
	try {
		await logAudit({
			action: event.action,
			actorId: event.actorId,
			organizationId: event.organizationId,
			targetId: event.targetId,
			targetType: "chat_installation",
			metadata: event.metadata,
			timestamp: new Date(),
		});
	} catch (error) {
		logger.warn(
			{ error, organizationId: event.organizationId, installationId: event.targetId },
			"Failed to record redacted chat switch audit event",
		);
	}
}

// ============================================
// PURE DOMAIN HELPERS
// ============================================

/**
 * Computes the exact 30-day UTC retirement deadline using Temporal.
 */
export function computeRetirementDeadline(switchedAt: Date): Date {
	const deadlineInstant = instantFromDate(switchedAt).add({
		hours: CHAT_INSTALLATION_RETIREMENT_HOURS,
	});
	return dateFromInstant(deadlineInstant);
}

/**
 * Computes a deterministic SHA-256 fingerprint over the reviewed installations,
 * credential revisions, affected legacy records, and material impact counts.
 */
export function computeSwitchImpactDigest(input: SwitchImpactDigestInput): string {
	const canonical = {
		version: 1,
		organizationId: input.organizationId,
		provider: input.provider,
		currentInstallationIds: [...input.currentInstallationIds].sort(),
		currentCredentialRevisionIds: [...input.currentCredentialRevisionIds].sort(),
		candidateInstallationId: input.candidateInstallationId,
		candidateCredentialRevisionId: input.candidateCredentialRevisionId,
		affectedLegacyIds: [...input.affectedLegacyIds].sort(),
		materialCounts: {
			totalActiveEmployees: input.materialCounts.totalActiveEmployees,
			verifiedReachableEmployees: input.materialCounts.verifiedReachableEmployees,
			actionNeededEmployees: input.materialCounts.actionNeededEmployees,
			unknownReachabilityEmployees: input.materialCounts.unknownReachabilityEmployees,
			carryForwardIdentityEmployees: input.materialCounts.carryForwardIdentityEmployees,
			outstandingApprovalCards: input.materialCounts.outstandingApprovalCards,
			outstandingApprovalWork: input.materialCounts.outstandingApprovalWork,
			pendingLegacyApprovalCards: input.materialCounts.pendingLegacyApprovalCards,
			inFlightDurableDispatches: input.materialCounts.inFlightDurableDispatches,
			uncertainDurableDispatches: input.materialCounts.uncertainDurableDispatches,
		},
	};
	return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Compares the admin's reviewed switch snapshot against the live transactional snapshot.
 */
export function hasMaterialSwitchImpactChanged(input: {
	reviewedCurrentInstallationId: string | null;
	reviewedCurrentInstallationIds?: readonly string[];
	reviewedCurrentCredentialRevisionId: string | null;
	reviewedCandidateCredentialRevisionId: string | null;
	reviewedImpactDigest: string;
	freshCurrentInstallationId: string | null;
	freshCurrentInstallationIds: readonly string[];
	freshCurrentCredentialRevisionId: string | null;
	freshCandidateCredentialRevisionId: string | null;
	freshImpactDigest: string;
}): boolean {
	if (input.reviewedCurrentInstallationId !== input.freshCurrentInstallationId) {
		return true;
	}
	if (input.reviewedCurrentInstallationIds) {
		const reviewedSet = [...input.reviewedCurrentInstallationIds].sort();
		const freshSet = [...input.freshCurrentInstallationIds].sort();
		if (
			reviewedSet.length !== freshSet.length ||
			reviewedSet.some((id, idx) => id !== freshSet[idx])
		) {
			return true;
		}
	}
	if (input.reviewedCurrentCredentialRevisionId !== input.freshCurrentCredentialRevisionId) {
		return true;
	}
	if (input.reviewedCandidateCredentialRevisionId !== input.freshCandidateCredentialRevisionId) {
		return true;
	}
	if (input.reviewedImpactDigest !== input.freshImpactDigest) {
		return true;
	}
	return false;
}

/**
 * Classifies active roster employees into mutually exclusive switch-readiness buckets:
 * - `verifiedReachableEmployees`: candidate has a verified reachable private conversation.
 * - `actionNeededEmployees`: candidate conversation failed/needs action, or employee has neither
 *   a candidate link nor a proven same-scope identity that can carry forward.
 * - `unknownReachabilityEmployees`: employee has a candidate link or proven same-scope identity
 *   (or a candidate conversation marked `unknown`) whose private DM reachability on the
 *   replacement has not yet been confirmed.
 */
export function classifyEmployeeSwitchReachability(input: {
	activeUserIds: readonly string[];
	candidateConversationStatusByUser: ReadonlyMap<string, ChatConversationReachabilityStatus>;
	candidateLinkedUserIds: ReadonlySet<string>;
	sameScopeCarryForwardUserIds: ReadonlySet<string>;
}): EmployeeSwitchReachabilitySummary {
	let verifiedReachableEmployees = 0;
	let actionNeededEmployees = 0;
	let unknownReachabilityEmployees = 0;
	let carryForwardIdentityEmployees = 0;

	for (const userId of input.activeUserIds) {
		const convStatus = input.candidateConversationStatusByUser.get(userId) ?? null;
		const hasCandidateLink = input.candidateLinkedUserIds.has(userId);
		const canCarryForward = !hasCandidateLink && input.sameScopeCarryForwardUserIds.has(userId);

		if (canCarryForward) {
			carryForwardIdentityEmployees += 1;
		}

		if (convStatus === "reachable") {
			verifiedReachableEmployees += 1;
		} else if (convStatus === "action_needed" || convStatus === "unreachable") {
			actionNeededEmployees += 1;
		} else if (convStatus === "unknown" || hasCandidateLink || canCarryForward) {
			unknownReachabilityEmployees += 1;
		} else {
			actionNeededEmployees += 1;
		}
	}

	return {
		totalActiveEmployees: input.activeUserIds.length,
		verifiedReachableEmployees,
		actionNeededEmployees,
		unknownReachabilityEmployees,
		carryForwardIdentityEmployees,
		unreadyEmployees: actionNeededEmployees + unknownReachabilityEmployees,
	};
}

/**
 * Evaluates whether a retiring installation should transition to `retired`.
 */
export function evaluateInstallationRetirementEligibility(input: {
	retirementDeadlineAt: Date | null;
	now: Date;
	totalOutstandingApprovalWork: number;
}): { shouldRetire: boolean; reason: "work_settled" | "deadline_reached" | null } {
	if (input.totalOutstandingApprovalWork <= 0) {
		return { shouldRetire: true, reason: "work_settled" };
	}
	if (
		input.retirementDeadlineAt !== null &&
		Temporal.Instant.compare(
			instantFromDate(input.now),
			instantFromDate(input.retirementDeadlineAt),
		) >= 0
	) {
		return { shouldRetire: true, reason: "deadline_reached" };
	}
	return { shouldRetire: false, reason: null };
}

// ============================================
// PER-ORGANIZATION SWITCH GATE
// ============================================

/**
 * Reads `chat_installation_switch_control` for `(organizationId, provider)`.
 * Switches are disabled by default unless an explicit control row exists.
 */
export async function isChatInstallationSwitchEnabled(
	db: Pick<ChatSwitchDb, "select">,
	organizationId: string,
	provider: ChatInstallationProvider,
): Promise<boolean> {
	const [row] = await db
		.select({ organizationId: chatInstallationSwitchControl.organizationId })
		.from(chatInstallationSwitchControl)
		.where(
			and(
				eq(chatInstallationSwitchControl.organizationId, organizationId),
				eq(chatInstallationSwitchControl.provider, provider),
			),
		)
		.limit(1);
	return Boolean(row);
}

// ============================================
// INTERNAL LOADERS
// ============================================

async function loadEffectiveSettingsForProvider(
	db: Pick<ChatSwitchDb, "select">,
	organizationId: string,
	provider: ChatInstallationProvider,
): Promise<ChatEffectiveSettings> {
	const [settingsRow] = await db
		.select()
		.from(chatProviderSettings)
		.where(
			and(
				eq(chatProviderSettings.organizationId, organizationId),
				eq(chatProviderSettings.provider, provider),
			),
		)
		.limit(1);

	if (settingsRow?.isAuthoritative) {
		return {
			enableApprovals: settingsRow.enableApprovals,
			enableCommands: settingsRow.enableCommands,
			enableDailyDigest: settingsRow.enableDailyDigest,
			enableEscalations: settingsRow.enableEscalations,
			digestTime: settingsRow.digestTime,
			digestTimezone: settingsRow.digestTimezone,
			escalationTimeoutHours: settingsRow.escalationTimeoutHours,
		};
	}

	if (provider === "slack") {
		const [legacy] = await db
			.select()
			.from(slackWorkspaceConfig)
			.where(eq(slackWorkspaceConfig.organizationId, organizationId))
			.limit(1);
		if (legacy && legacy.setupStatus !== "disconnected") {
			return {
				enableApprovals: legacy.enableApprovals,
				enableCommands: legacy.enableCommands,
				enableDailyDigest: legacy.enableDailyDigest,
				enableEscalations: legacy.enableEscalations,
				digestTime: legacy.digestTime,
				digestTimezone: legacy.digestTimezone,
				escalationTimeoutHours: legacy.escalationTimeoutHours,
			};
		}
	} else if (provider === "telegram") {
		const [legacy] = await db
			.select()
			.from(telegramBotConfig)
			.where(eq(telegramBotConfig.organizationId, organizationId))
			.limit(1);
		if (legacy && legacy.setupStatus !== "disconnected") {
			return {
				enableApprovals: legacy.enableApprovals,
				enableCommands: legacy.enableCommands,
				enableDailyDigest: legacy.enableDailyDigest,
				enableEscalations: legacy.enableEscalations,
				digestTime: legacy.digestTime,
				digestTimezone: legacy.digestTimezone,
				escalationTimeoutHours: legacy.escalationTimeoutHours,
			};
		}
	} else if (provider === "discord") {
		const [legacy] = await db
			.select()
			.from(discordBotConfig)
			.where(eq(discordBotConfig.organizationId, organizationId))
			.limit(1);
		if (legacy && legacy.setupStatus !== "disconnected") {
			return {
				enableApprovals: legacy.enableApprovals,
				enableCommands: legacy.enableCommands,
				enableDailyDigest: legacy.enableDailyDigest,
				enableEscalations: legacy.enableEscalations,
				digestTime: legacy.digestTime,
				digestTimezone: legacy.digestTimezone,
				escalationTimeoutHours: legacy.escalationTimeoutHours,
			};
		}
	} else if (provider === "teams") {
		const legacyRows = await db
			.select()
			.from(teamsTenantConfig)
			.where(eq(teamsTenantConfig.organizationId, organizationId))
			.orderBy(asc(teamsTenantConfig.createdAt), asc(teamsTenantConfig.tenantId));
		const primary =
			legacyRows.find((row) => row.setupStatus === "active") ??
			legacyRows.find((row) => row.setupStatus !== "disconnected") ??
			null;
		if (primary) {
			return {
				enableApprovals: primary.enableApprovals,
				enableCommands: primary.enableCommands,
				enableDailyDigest: primary.enableDailyDigest,
				enableEscalations: primary.enableEscalations,
				digestTime: primary.digestTime,
				digestTimezone: primary.digestTimezone,
				escalationTimeoutHours: primary.escalationTimeoutHours,
			};
		}
	}

	if (settingsRow) {
		return {
			enableApprovals: settingsRow.enableApprovals,
			enableCommands: settingsRow.enableCommands,
			enableDailyDigest: settingsRow.enableDailyDigest,
			enableEscalations: settingsRow.enableEscalations,
			digestTime: settingsRow.digestTime,
			digestTimezone: settingsRow.digestTimezone,
			escalationTimeoutHours: settingsRow.escalationTimeoutHours,
		};
	}

	return { ...DEFAULT_EFFECTIVE_SETTINGS };
}

function evaluateCandidateReadiness(
	candidate: typeof chatInstallation.$inferSelect | null,
	now: Date,
	verificationTtlMs: number,
): { ready: boolean; verificationState: ChatVerificationState | null } {
	if (!candidate) {
		return { ready: false, verificationState: null };
	}
	if (candidate.provider === "slack") {
		const status = computeSlackCandidateSetupStatus(
			candidate as unknown as SlackCandidateInstallationRecord,
			now,
			verificationTtlMs,
		);
		return {
			ready: status.readyForSwitch,
			verificationState: status.effectiveVerificationState,
		};
	}
	const ready =
		candidate.verificationState === "verified" && Boolean(candidate.activeCredentialRevisionId);
	return { ready, verificationState: candidate.verificationState };
}

async function loadActiveRosterUserIds(
	db: Pick<ChatSwitchDb, "select">,
	organizationId: string,
	now: Date,
): Promise<string[]> {
	const nowInstant = instantFromDate(now);
	const rows = await db
		.select({ userId: employee.userId })
		.from(employee)
		.innerJoin(
			member,
			and(
				eq(member.userId, employee.userId),
				eq(member.organizationId, employee.organizationId),
				eq(member.status, "approved"),
			),
		)
		.where(onCurrentRoster(organizationId, employee, nowInstant));

	return [...new Set(rows.map((row) => row.userId))].sort();
}

async function computeEmployeeImpact(
	db: Pick<ChatSwitchDb, "select">,
	input: {
		organizationId: string;
		provider: ChatInstallationProvider;
		currentInstallations: Array<typeof chatInstallation.$inferSelect>;
		candidate: typeof chatInstallation.$inferSelect | null;
		now: Date;
	},
): Promise<EmployeeSwitchReachabilitySummary> {
	const activeUserIds = await loadActiveRosterUserIds(db, input.organizationId, input.now);
	if (activeUserIds.length === 0) {
		return {
			totalActiveEmployees: 0,
			verifiedReachableEmployees: 0,
			actionNeededEmployees: 0,
			unknownReachabilityEmployees: 0,
			carryForwardIdentityEmployees: 0,
			unreadyEmployees: 0,
		};
	}

	const candidateConversationStatusByUser = new Map<string, ChatConversationReachabilityStatus>();
	const candidateLinkedUserIds = new Set<string>();
	const sameScopeCarryForwardUserIds = new Set<string>();

	if (input.candidate) {
		const [candidateConvs, candidateLinks] = await Promise.all([
			db
				.select({
					userId: chatInstallationConversation.userId,
					reachabilityStatus: chatInstallationConversation.reachabilityStatus,
				})
				.from(chatInstallationConversation)
				.where(
					and(
						eq(chatInstallationConversation.organizationId, input.organizationId),
						eq(chatInstallationConversation.installationId, input.candidate.id),
						eq(chatInstallationConversation.isActive, true),
					),
				),
			db
				.select({ userId: chatInstallationMemberLink.userId })
				.from(chatInstallationMemberLink)
				.where(
					and(
						eq(chatInstallationMemberLink.organizationId, input.organizationId),
						eq(chatInstallationMemberLink.installationId, input.candidate.id),
						eq(chatInstallationMemberLink.isActive, true),
					),
				),
		]);

		for (const conv of candidateConvs) {
			if (!conv.userId) continue;
			const existing = candidateConversationStatusByUser.get(conv.userId);
			// Prefer "reachable" if the user has multiple conversation records for the candidate.
			if (!existing || conv.reachabilityStatus === "reachable") {
				candidateConversationStatusByUser.set(conv.userId, conv.reachabilityStatus);
			}
		}

		for (const link of candidateLinks) {
			candidateLinkedUserIds.add(link.userId);
		}

		const candidateScope = buildVerifiedExternalScope(input.candidate);
		if (candidateScope && input.currentInstallations.length > 0) {
			const matchingCurrent = input.currentInstallations.filter(
				(inst) => buildVerifiedExternalScope(inst) === candidateScope,
			);
			const matchingCurrentIds = matchingCurrent.map((inst) => inst.id);

			if (matchingCurrentIds.length > 0) {
				const currentLinks = await db
					.select({ userId: chatInstallationMemberLink.userId })
					.from(chatInstallationMemberLink)
					.where(
						and(
							eq(chatInstallationMemberLink.organizationId, input.organizationId),
							inArray(chatInstallationMemberLink.installationId, matchingCurrentIds),
							eq(chatInstallationMemberLink.externalScope, candidateScope),
							eq(chatInstallationMemberLink.isCandidateEnrollment, false),
							eq(chatInstallationMemberLink.isActive, true),
						),
					);
				for (const link of currentLinks) {
					sameScopeCarryForwardUserIds.add(link.userId);
				}

				if (input.provider === "slack" && input.candidate.externalSpaceId) {
					const legacyMappings = await db
						.select({ userId: slackUserMapping.userId })
						.from(slackUserMapping)
						.where(
							and(
								eq(slackUserMapping.organizationId, input.organizationId),
								eq(slackUserMapping.slackTeamId, input.candidate.externalSpaceId),
								eq(slackUserMapping.isActive, true),
							),
						);
					for (const mapping of legacyMappings) {
						sameScopeCarryForwardUserIds.add(mapping.userId);
					}
				} else if (input.provider === "teams" && input.candidate.externalSpaceId) {
					const legacyMappings = await db
						.select({ userId: teamsUserMapping.userId })
						.from(teamsUserMapping)
						.where(
							and(
								eq(teamsUserMapping.organizationId, input.organizationId),
								eq(teamsUserMapping.teamsTenantId, input.candidate.externalSpaceId),
								eq(teamsUserMapping.isActive, true),
							),
						);
					for (const mapping of legacyMappings) {
						sameScopeCarryForwardUserIds.add(mapping.userId);
					}
				}
			}
		}
	}

	return classifyEmployeeSwitchReachability({
		activeUserIds,
		candidateConversationStatusByUser,
		candidateLinkedUserIds,
		sameScopeCarryForwardUserIds,
	});
}

// ============================================
// IMPACT PREVIEW
// ============================================

/**
 * Builds the organization-scoped switch impact preview and retirement view for a provider.
 * Reused across Slack (#2045), rotation/restore (#2046), Telegram (#2047), Discord (#2048),
 * and multi-tenant Teams (#2050).
 */
export async function buildChatSwitchImpactPreview(
	input: {
		organizationId: string;
		provider: ChatInstallationProvider;
		candidateInstallationId?: string | null;
	},
	deps?: ChatSwitchLifecycleDeps,
): Promise<ChatSwitchImpactPreview> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);
	const verificationTtlMs = deps?.verificationTtlMs ?? SLACK_VERIFICATION_FRESHNESS_MS;

	if (deps?.syncLegacy !== false) {
		await backfillOrganizationChatInstallations(input.organizationId, { db, now: () => now });
	}

	const [switchControlEnabled, eligibility, installations, effectiveSettings] = await Promise.all([
		isChatInstallationSwitchEnabled(db, input.organizationId, input.provider),
		checkSwitchEligibility(input.organizationId, input.provider, {
			db,
			now: () => now,
			syncLegacy: false,
		}),
		db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, input.organizationId),
					eq(chatInstallation.provider, input.provider),
				),
			)
			.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id)),
		loadEffectiveSettingsForProvider(db, input.organizationId, input.provider),
	]);

	const currentInstallations = installations.filter(
		(row) => row.status === "active" || row.status === "legacy_active",
	);
	const candidate = input.candidateInstallationId
		? (installations.find(
				(row) => row.id === input.candidateInstallationId && row.status === "candidate",
			) ?? null)
		: (installations.find((row) => row.status === "candidate") ?? null);
	const retiringRows = installations.filter((row) => row.status === "retiring");

	const countApprovalWork =
		deps?.countOutstandingApprovalWork ??
		((orgId: string, instId: string, dbClient: ChatSwitchDb) =>
			countOutstandingApprovalWorkByInstallation(orgId, instId, { db: dbClient }));
	const countInFlight =
		deps?.countInFlightDurable ??
		((
			orgId: string,
			provider: ChatInstallationProvider,
			instId: string | null,
			dbClient: ChatSwitchDb,
		) => countInFlightDurableDispatches(orgId, provider, instId, { db: dbClient }));

	const [
		employeeImpact,
		currentApprovalCounts,
		retiringApprovalCounts,
		inFlightNotificationImpact,
	] = await Promise.all([
		computeEmployeeImpact(db, {
			organizationId: input.organizationId,
			provider: input.provider,
			currentInstallations,
			candidate,
			now,
		}),
		Promise.all(
			currentInstallations.map((inst) => countApprovalWork(input.organizationId, inst.id, db)),
		),
		Promise.all(retiringRows.map((inst) => countApprovalWork(input.organizationId, inst.id, db))),
		countInFlight(input.organizationId, input.provider, null, db),
	]);

	const approvalImpact = currentApprovalCounts.reduce(
		(acc, counts) => ({
			openCanonicalCards: acc.openCanonicalCards + counts.openCanonicalMessages,
			openLegacyOwnerCards: acc.openLegacyOwnerCards + counts.openLegacyOwnerMessages,
			outstandingDeliveryWork: acc.outstandingDeliveryWork + counts.outstandingWork.total,
			outstandingRefreshWork: acc.outstandingRefreshWork + counts.outstandingWork.refresh,
			uncertainApprovalWork:
				acc.uncertainApprovalWork + counts.outstandingWork.uncertainAcrossSwitch,
			pendingLegacyCards: acc.pendingLegacyCards + counts.pendingLegacyCards,
			totalOutstanding: acc.totalOutstanding + counts.totalOutstanding,
		}),
		{
			openCanonicalCards: 0,
			openLegacyOwnerCards: 0,
			outstandingDeliveryWork: 0,
			outstandingRefreshWork: 0,
			uncertainApprovalWork: 0,
			pendingLegacyCards: 0,
			totalOutstanding: 0,
		},
	);

	const retiringInstallations: RetiringInstallationPreviewItem[] = retiringRows.map((row, idx) => {
		const counts = retiringApprovalCounts[idx];
		return {
			id: row.id,
			credentialSource: row.credentialSource,
			externalAppId: row.externalAppId,
			externalDisplayName: row.externalDisplayName,
			externalSpaceName: row.externalSpaceName,
			retirementDeadlineAt: row.retirementDeadlineAt?.toISOString() ?? null,
			openCanonicalCards: counts?.openCanonicalMessages ?? 0,
			openLegacyOwnerCards: counts?.openLegacyOwnerMessages ?? 0,
			outstandingRefreshWork: counts?.outstandingWork.refresh ?? 0,
			pendingLegacyCards: counts?.pendingLegacyCards ?? 0,
			totalOutstandingCardsAndWork: counts?.totalOutstanding ?? 0,
		};
	});

	const { ready: candidateReady, verificationState: candidateVerificationState } =
		evaluateCandidateReadiness(candidate, now, verificationTtlMs);

	const primaryCurrent = currentInstallations[0] ?? null;
	const hasHardBlockers = eligibility.blockers.some((b) => b.blocksSwitchAndEndpointMutation);

	const impactDigest = computeSwitchImpactDigest({
		organizationId: input.organizationId,
		provider: input.provider,
		currentInstallationIds: currentInstallations.map((row) => row.id),
		currentCredentialRevisionIds: currentInstallations.map(
			(row) => `${row.id}:${row.activeCredentialRevisionId ?? "none"}`,
		),
		candidateInstallationId: candidate?.id ?? null,
		candidateCredentialRevisionId: candidate?.activeCredentialRevisionId ?? null,
		affectedLegacyIds: currentInstallations
			.filter((row) => row.legacyTable && row.legacyRecordId)
			.map((row) => `${row.legacyTable}:${row.legacyRecordId}`),
		materialCounts: {
			totalActiveEmployees: employeeImpact.totalActiveEmployees,
			verifiedReachableEmployees: employeeImpact.verifiedReachableEmployees,
			actionNeededEmployees: employeeImpact.actionNeededEmployees,
			unknownReachabilityEmployees: employeeImpact.unknownReachabilityEmployees,
			carryForwardIdentityEmployees: employeeImpact.carryForwardIdentityEmployees,
			outstandingApprovalCards:
				approvalImpact.openCanonicalCards + approvalImpact.openLegacyOwnerCards,
			outstandingApprovalWork: approvalImpact.outstandingDeliveryWork,
			pendingLegacyApprovalCards: approvalImpact.pendingLegacyCards,
			inFlightDurableDispatches: inFlightNotificationImpact.intentRecorded,
			uncertainDurableDispatches: inFlightNotificationImpact.reconciliationRequired,
		},
	});

	return {
		organizationId: input.organizationId,
		provider: input.provider,
		generatedAt: now.toISOString(),
		switchControlEnabled,
		blockers: eligibility.blockers,
		hasHardBlockers,
		currentInstallations: currentInstallations.map(toPreviewItem),
		primaryCurrentInstallationId: primaryCurrent?.id ?? null,
		primaryCurrentCredentialRevisionId: primaryCurrent?.activeCredentialRevisionId ?? null,
		candidateInstallation: candidate ? toPreviewItem(candidate) : null,
		candidateReady,
		candidateVerificationState,
		retiringInstallations,
		employeeImpact,
		approvalImpact,
		inFlightNotificationImpact,
		effectiveSettings,
		requiresUnreadyAcknowledgement: employeeImpact.unreadyEmployees > 0,
		canConfirm: switchControlEnabled && !hasHardBlockers && Boolean(candidate) && candidateReady,
		impactDigest,
	};
}

// ============================================
// ATOMIC SWITCH CONFIRMATION
// ============================================

async function carryForwardVerifiedIdentities(
	tx: ChatSwitchDb,
	input: {
		organizationId: string;
		provider: ChatInstallationProvider;
		retiringInstallations: Array<typeof chatInstallation.$inferSelect>;
		activeInstallation: typeof chatInstallation.$inferSelect;
		now: Date;
	},
): Promise<{ promotedEnrollmentCount: number; carriedForwardIdentityCount: number }> {
	let promotedEnrollmentCount = 0;
	let carriedForwardIdentityCount = 0;

	// 1. Promote verified candidate enrollments on the newly active installation to live links
	//    (only for currently eligible roster members; conversations stay untouched).
	const candidateEnrollments = await tx
		.select()
		.from(chatInstallationMemberLink)
		.where(
			and(
				eq(chatInstallationMemberLink.organizationId, input.organizationId),
				eq(chatInstallationMemberLink.installationId, input.activeInstallation.id),
				eq(chatInstallationMemberLink.isCandidateEnrollment, true),
				eq(chatInstallationMemberLink.isActive, true),
			),
		);

	for (const enrollment of candidateEnrollments) {
		const eligibility = await verifyEligibleChatLinkMember(
			enrollment.userId,
			input.organizationId,
			{ db: tx as unknown as typeof defaultDb, now: () => input.now },
		);
		if (!eligibility.eligible) {
			await tx
				.update(chatInstallationMemberLink)
				.set({ isActive: false, unlinkedAt: input.now, updatedAt: input.now })
				.where(eq(chatInstallationMemberLink.id, enrollment.id));
			continue;
		}

		const [existingLive] = await tx
			.select({ id: chatInstallationMemberLink.id })
			.from(chatInstallationMemberLink)
			.where(
				and(
					eq(chatInstallationMemberLink.organizationId, input.organizationId),
					eq(chatInstallationMemberLink.installationId, input.activeInstallation.id),
					eq(chatInstallationMemberLink.userId, enrollment.userId),
					eq(chatInstallationMemberLink.isCandidateEnrollment, false),
					eq(chatInstallationMemberLink.isActive, true),
				),
			)
			.limit(1);

		if (!existingLive) {
			await tx
				.update(chatInstallationMemberLink)
				.set({
					isCandidateEnrollment: false,
					employeeId: eligibility.employeeId,
					updatedAt: input.now,
				})
				.where(eq(chatInstallationMemberLink.id, enrollment.id));
			promotedEnrollmentCount += 1;
		} else {
			await tx
				.update(chatInstallationMemberLink)
				.set({ isActive: false, unlinkedAt: input.now, updatedAt: input.now })
				.where(eq(chatInstallationMemberLink.id, enrollment.id));
		}
	}

	// 2. Carry forward proven same-workspace / same-tenant employee identities via
	//    `reuseVerifiedExternalIdentity`, keeping DM conversation reachability separate.
	const targetScope = buildVerifiedExternalScope(input.activeInstallation);
	if (!targetScope || input.retiringInstallations.length === 0) {
		return { promotedEnrollmentCount, carriedForwardIdentityCount };
	}

	const activeUserIds = await loadActiveRosterUserIds(tx, input.organizationId, input.now);
	if (activeUserIds.length === 0) {
		return { promotedEnrollmentCount, carriedForwardIdentityCount };
	}

	const existingActiveLinks = await tx
		.select({ userId: chatInstallationMemberLink.userId })
		.from(chatInstallationMemberLink)
		.where(
			and(
				eq(chatInstallationMemberLink.organizationId, input.organizationId),
				eq(chatInstallationMemberLink.installationId, input.activeInstallation.id),
				eq(chatInstallationMemberLink.isCandidateEnrollment, false),
				eq(chatInstallationMemberLink.isActive, true),
			),
		);
	const alreadyLinkedUsers = new Set(existingActiveLinks.map((row) => row.userId));

	for (const retiringInst of input.retiringInstallations) {
		if (buildVerifiedExternalScope(retiringInst) !== targetScope) continue;
		for (const userId of activeUserIds) {
			if (alreadyLinkedUsers.has(userId)) continue;
			const reused = await reuseVerifiedExternalIdentity(
				{
					organizationId: input.organizationId,
					sourceInstallationId: retiringInst.id,
					targetInstallationId: input.activeInstallation.id,
					userId,
					targetIsCandidateEnrollment: false,
				},
				{
					db: tx as unknown as typeof defaultDb,
					now: () => input.now,
				},
			);
			if (reused.status === "reused") {
				carriedForwardIdentityCount += 1;
				alreadyLinkedUsers.add(userId);
			}
		}
	}

	return { promotedEnrollmentCount, carriedForwardIdentityCount };
}

/**
 * Atomically switches `(organizationId, provider)` to a verified candidate installation
 * inside a serialized PostgreSQL transaction (`pg_advisory_xact_lock` + `FOR UPDATE`).
 *
 * Rechecks switch control, blockers, candidate freshness, reviewed installation IDs,
 * credential revisions, and `impactDigest` inside the lock so concurrent confirmations
 * can never both activate and any material drift refuses with `impact_changed` + fresh preview.
 */
export async function confirmChatInstallationSwitch(
	input: ConfirmChatInstallationSwitchInput,
	deps?: ChatSwitchLifecycleDeps,
): Promise<ConfirmChatInstallationSwitchResult> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const lockKey = `chat-switch:${input.organizationId}:${input.provider}`;

	const outcome = await db.transaction(async (rawTx) => {
		const tx = rawTx as unknown as ChatSwitchDb;

		// Serialize concurrent switches for this (organization, provider).
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

		// Row-lock all installations for (organization, provider) before inspecting state.
		await tx.execute(sql`
			SELECT id
			FROM chat_installation
			WHERE organization_id = ${input.organizationId}
				AND provider = ${input.provider}
			FOR UPDATE
		`);

		const freshPreview = await buildChatSwitchImpactPreview(
			{
				organizationId: input.organizationId,
				provider: input.provider,
				candidateInstallationId: input.candidateInstallationId,
			},
			{
				...deps,
				db: tx,
				now: () => now,
				syncLegacy: false,
			},
		);

		if (!freshPreview.switchControlEnabled) {
			return {
				result: {
					kind: "refused" as const,
					code: "switch_not_enabled" as const,
					message: "Organization-owned app switching is not enabled for this organization yet.",
					freshPreview,
				},
				audit: null,
			};
		}

		if (freshPreview.hasHardBlockers) {
			return {
				result: {
					kind: "refused" as const,
					code: "migration_blocked" as const,
					message: "Resolve migration blockers before switching to the replacement app.",
					freshPreview,
				},
				audit: null,
			};
		}

		const [candidateRow] = await tx
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.id, input.candidateInstallationId),
					eq(chatInstallation.organizationId, input.organizationId),
					eq(chatInstallation.provider, input.provider),
				),
			)
			.limit(1);

		if (!candidateRow) {
			return {
				result: {
					kind: "refused" as const,
					code: "candidate_not_found" as const,
					message: "The candidate installation could not be found.",
					freshPreview,
				},
				audit: null,
			};
		}

		if (candidateRow.status === "active") {
			return {
				result: {
					kind: "refused" as const,
					code: "already_switched" as const,
					message: "This replacement installation is already active.",
					freshPreview,
				},
				audit: null,
			};
		}

		if (candidateRow.status !== "candidate") {
			return {
				result: {
					kind: "refused" as const,
					code: "candidate_not_ready" as const,
					message: "The selected installation is no longer a candidate for switching.",
					freshPreview,
				},
				audit: null,
			};
		}

		if (!freshPreview.candidateReady) {
			const isExpired = freshPreview.candidateVerificationState === "expired";
			return {
				result: {
					kind: "refused" as const,
					code: isExpired
						? ("candidate_verification_expired" as const)
						: ("candidate_not_ready" as const),
					message: isExpired
						? "Candidate verification proofs have expired. Re-verify the candidate app before switching."
						: "Complete all verification steps for the candidate app before switching.",
					freshPreview,
				},
				audit: null,
			};
		}

		const drifted = hasMaterialSwitchImpactChanged({
			reviewedCurrentInstallationId: input.reviewedCurrentInstallationId,
			reviewedCurrentInstallationIds: input.reviewedCurrentInstallationIds,
			reviewedCurrentCredentialRevisionId: input.reviewedCurrentCredentialRevisionId,
			reviewedCandidateCredentialRevisionId: input.reviewedCandidateCredentialRevisionId,
			reviewedImpactDigest: input.reviewedImpactDigest,
			freshCurrentInstallationId: freshPreview.primaryCurrentInstallationId,
			freshCurrentInstallationIds: freshPreview.currentInstallations.map((row) => row.id),
			freshCurrentCredentialRevisionId: freshPreview.primaryCurrentCredentialRevisionId,
			freshCandidateCredentialRevisionId:
				freshPreview.candidateInstallation?.activeCredentialRevisionId ?? null,
			freshImpactDigest: freshPreview.impactDigest,
		});

		if (drifted) {
			return {
				result: {
					kind: "refused" as const,
					code: "impact_changed" as const,
					message:
						"Switch impact or installation revisions changed since you reviewed them. Review the updated summary and confirm again.",
					freshPreview,
				},
				audit: null,
			};
		}

		if (freshPreview.requiresUnreadyAcknowledgement && !input.acknowledgeUnreadyEmployees) {
			return {
				result: {
					kind: "refused" as const,
					code: "unready_acknowledgement_required" as const,
					message:
						"Acknowledge that some employees still need to connect or verify direct message reachability before switching.",
					freshPreview,
				},
				audit: null,
			};
		}

		const retirementDeadlineAt = computeRetirementDeadline(now);

		const retiringRows = await tx
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, input.organizationId),
					eq(chatInstallation.provider, input.provider),
					inArray(chatInstallation.status, ["active", "legacy_active"]),
				),
			)
			.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id));

		const retiredInstallationIds = retiringRows.map((row) => row.id);

		// 1. Transition all current active/legacy_active installations to `retiring` FIRST
		//    so the partial unique index `(organization_id, provider) WHERE status = 'active'`
		//    is satisfied when promoting the candidate.
		if (retiredInstallationIds.length > 0) {
			await tx
				.update(chatInstallation)
				.set({
					status: "retiring",
					retirementDeadlineAt,
					updatedAt: now,
				})
				.where(
					and(
						eq(chatInstallation.organizationId, input.organizationId),
						eq(chatInstallation.provider, input.provider),
						inArray(chatInstallation.id, retiredInstallationIds),
					),
				);
		}

		// 2. Promote candidate -> `active`.
		const [activated] = await tx
			.update(chatInstallation)
			.set({
				status: "active",
				verificationState: "verified",
				lastVerifiedAt: candidateRow.lastVerifiedAt ?? now,
				updatedAt: now,
			})
			.where(
				and(
					eq(chatInstallation.id, candidateRow.id),
					eq(chatInstallation.organizationId, input.organizationId),
					eq(chatInstallation.status, "candidate"),
				),
			)
			.returning();

		if (!activated) {
			throw new Error("Failed to promote candidate installation to active");
		}

		// 3. Mark the candidate's active credential revision as `active`.
		if (activated.activeCredentialRevisionId) {
			await tx
				.update(chatInstallationCredentialRevision)
				.set({
					status: "active",
					verifiedAt: now,
				})
				.where(
					and(
						eq(chatInstallationCredentialRevision.id, activated.activeCredentialRevisionId),
						eq(chatInstallationCredentialRevision.installationId, activated.id),
						eq(chatInstallationCredentialRevision.organizationId, input.organizationId),
					),
				);
		}

		// 4. Mark `chat_provider_settings` as authoritative for (organization, provider).
		const effectiveSettings = freshPreview.effectiveSettings;
		await tx
			.insert(chatProviderSettings)
			.values({
				organizationId: input.organizationId,
				provider: input.provider,
				isAuthoritative: true,
				activeInstallationId: activated.id,
				enableApprovals: effectiveSettings.enableApprovals,
				enableCommands: effectiveSettings.enableCommands,
				enableDailyDigest: effectiveSettings.enableDailyDigest,
				enableEscalations: effectiveSettings.enableEscalations,
				digestTime: effectiveSettings.digestTime,
				digestTimezone: effectiveSettings.digestTimezone,
				escalationTimeoutHours: effectiveSettings.escalationTimeoutHours,
				confirmedByUserId: input.actorUserId,
				confirmedAt: now,
			})
			.onConflictDoUpdate({
				target: [chatProviderSettings.organizationId, chatProviderSettings.provider],
				set: {
					isAuthoritative: true,
					activeInstallationId: activated.id,
					enableApprovals: effectiveSettings.enableApprovals,
					enableCommands: effectiveSettings.enableCommands,
					enableDailyDigest: effectiveSettings.enableDailyDigest,
					enableEscalations: effectiveSettings.enableEscalations,
					digestTime: effectiveSettings.digestTime,
					digestTimezone: effectiveSettings.digestTimezone,
					escalationTimeoutHours: effectiveSettings.escalationTimeoutHours,
					confirmedByUserId: input.actorUserId,
					confirmedAt: now,
					updatedAt: now,
				},
			});

		// 5. Carry forward proven same-workspace identities (keeping DM conversations separate).
		const identityTransfer = await carryForwardVerifiedIdentities(tx, {
			organizationId: input.organizationId,
			provider: input.provider,
			retiringInstallations: retiringRows,
			activeInstallation: activated,
			now,
		});

		const updatedPreview = await buildChatSwitchImpactPreview(
			{
				organizationId: input.organizationId,
				provider: input.provider,
			},
			{
				...deps,
				db: tx,
				now: () => now,
				syncLegacy: false,
			},
		);

		return {
			result: {
				kind: "switched" as const,
				activeInstallationId: activated.id,
				retiredInstallationIds,
				retirementDeadlineAt: retirementDeadlineAt.toISOString(),
				carriedForwardIdentityCount: identityTransfer.carriedForwardIdentityCount,
				promotedEnrollmentCount: identityTransfer.promotedEnrollmentCount,
				effectiveSettings,
				preview: updatedPreview,
			},
			audit: {
				action: AuditAction.CHAT_INSTALLATION_SWITCH_CONFIRMED,
				actorId: input.actorUserId,
				organizationId: input.organizationId,
				targetId: activated.id,
				metadata: {
					provider: input.provider,
					activeInstallationId: activated.id,
					activeCredentialRevisionId: activated.activeCredentialRevisionId,
					retiredInstallationIds,
					retirementDeadlineAt: retirementDeadlineAt.toISOString(),
					acknowledgedUnreadyEmployees: input.acknowledgeUnreadyEmployees,
					carriedForwardIdentityCount: identityTransfer.carriedForwardIdentityCount,
					promotedEnrollmentCount: identityTransfer.promotedEnrollmentCount,
					reviewedImpactDigest: input.reviewedImpactDigest,
					employeeImpact: freshPreview.employeeImpact,
					approvalImpact: freshPreview.approvalImpact,
					inFlightNotificationImpact: freshPreview.inFlightNotificationImpact,
				},
			},
		};
	});

	if (outcome.audit) {
		await recordAudit(outcome.audit);
	}

	return outcome.result;
}

// ============================================
// AUTOMATIC RETIREMENT SWEEP
// ============================================

/**
 * Transitions `retiring` chat installations to `retired` when either:
 * (a) `countOutstandingApprovalWorkByInstallation` reports 0 open canonical/legacy-owner cards,
 *     0 pending refresh/delivery work, and 0 pending legacy cards, OR
 * (b) `now >= retirementDeadlineAt` (30-day limit reached).
 *
 * Pending approvals remain completely untouched and accessible in the Z8 inbox.
 */
export async function retireSettledChatInstallations(
	nowInput?: Date,
	deps?: ChatSwitchLifecycleDeps & {
		organizationId?: string;
		provider?: ChatInstallationProvider;
	},
): Promise<RetireSettledChatInstallationsResult> {
	const db = deps?.db ?? defaultDb;
	const now = nowInput ?? getNow(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const countApprovalWork =
		deps?.countOutstandingApprovalWork ??
		((orgId: string, instId: string, dbClient: ChatSwitchDb) =>
			countOutstandingApprovalWorkByInstallation(orgId, instId, { db: dbClient }));

	const conditions = [eq(chatInstallation.status, "retiring")];
	if (deps?.organizationId) {
		conditions.push(eq(chatInstallation.organizationId, deps.organizationId));
	}
	if (deps?.provider) {
		conditions.push(eq(chatInstallation.provider, deps.provider));
	}

	const retiringRows = await db
		.select()
		.from(chatInstallation)
		.where(and(...conditions))
		.orderBy(asc(chatInstallation.retirementDeadlineAt), asc(chatInstallation.id));

	const retiredInstallationIds: string[] = [];
	let workSettled = 0;
	let deadlineReached = 0;

	for (const inst of retiringRows) {
		const counts = await countApprovalWork(inst.organizationId, inst.id, db);
		const evaluation = evaluateInstallationRetirementEligibility({
			retirementDeadlineAt: inst.retirementDeadlineAt,
			now,
			totalOutstandingApprovalWork: counts.totalOutstanding,
		});

		if (!evaluation.shouldRetire || !evaluation.reason) {
			continue;
		}

		const [updated] = await db
			.update(chatInstallation)
			.set({
				status: "retired",
				retiredAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(chatInstallation.id, inst.id),
					eq(chatInstallation.organizationId, inst.organizationId),
					eq(chatInstallation.status, "retiring"),
				),
			)
			.returning({ id: chatInstallation.id });

		if (!updated) continue;

		retiredInstallationIds.push(updated.id);
		if (evaluation.reason === "work_settled") {
			workSettled += 1;
		} else {
			deadlineReached += 1;
		}

		if (deps?.recordAudit || inst.createdByUserId) {
			await recordAudit({
				action: AuditAction.CHAT_INSTALLATION_RETIRED,
				actorId: inst.createdByUserId ?? "system",
				organizationId: inst.organizationId,
				targetId: inst.id,
				metadata: {
					provider: inst.provider,
					reason: evaluation.reason,
					retirementDeadlineAt: inst.retirementDeadlineAt?.toISOString() ?? null,
					retiredAt: now.toISOString(),
					outstandingAtRetirement: counts.totalOutstanding,
				},
			});
		}
	}

	if (retiredInstallationIds.length > 0) {
		logger.info(
			{
				retiredCount: retiredInstallationIds.length,
				workSettled,
				deadlineReached,
				organizationId: deps?.organizationId ?? null,
			},
			"Retired settled or expired retiring chat installations",
		);
	}

	return {
		checkedCount: retiringRows.length,
		retiredCount: retiredInstallationIds.length,
		retiredInstallationIds,
		retiredByReason: {
			workSettled,
			deadlineReached,
		},
	};
}

// ============================================
// AUTHORIZED LEGACY SLACK DISCONNECT
// ============================================

/**
 * Authorized lifecycle handler for legacy `DELETE /api/slack/setup`.
 * Refuses when superseded by an organization-owned active/retiring installation or
 * blocked by remediation so legacy setup routes can never bypass the installation lifecycle.
 */
export async function disconnectLegacySlackInstallation(
	input: {
		organizationId: string;
		actorUserId: string;
	},
	deps?: ChatSwitchLifecycleDeps,
): Promise<DisconnectLegacySlackResult> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const removeSecret = deps?.deleteSecret ?? deleteOrgSecret;

	const installations = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, input.organizationId),
				eq(chatInstallation.provider, "slack"),
			),
		);

	const hasSupersededOrgOwned = installations.some(
		(row) =>
			(row.status === "active" && row.credentialSource === "organization_owned") ||
			row.status === "retiring",
	);
	if (hasSupersededOrgOwned) {
		return {
			kind: "refused",
			code: "legacy_setup_superseded",
			status: 410,
			message:
				"Legacy Slack setup disconnect has been superseded by organization-owned chat installation management.",
		};
	}

	const hasRemediation = installations.some((row) => row.status === "remediation_required");
	if (hasRemediation) {
		return {
			kind: "refused",
			code: "migration_blocked",
			status: 409,
			message:
				"Slack installation requires remediation before disconnecting via the legacy setup route.",
		};
	}

	const [legacyConfig] = await db
		.select()
		.from(slackWorkspaceConfig)
		.where(eq(slackWorkspaceConfig.organizationId, input.organizationId))
		.limit(1);

	const legacyInstallation =
		installations.find(
			(row) => row.legacyTable === "slack_workspace_config" && row.status === "legacy_active",
		) ?? null;

	if (legacyConfig) {
		await removeSecret(input.organizationId, "slack/bot_access_token");
		await db
			.update(slackWorkspaceConfig)
			.set({ setupStatus: "disconnected" })
			.where(
				and(
					eq(slackWorkspaceConfig.id, legacyConfig.id),
					eq(slackWorkspaceConfig.organizationId, input.organizationId),
				),
			);
	}

	if (legacyInstallation) {
		await db
			.update(chatInstallation)
			.set({
				status: "revoked",
				revokedAt: now,
				legacyStatus: "disconnected",
				updatedAt: now,
			})
			.where(
				and(
					eq(chatInstallation.id, legacyInstallation.id),
					eq(chatInstallation.organizationId, input.organizationId),
				),
			);
	}

	if (legacyConfig || legacyInstallation) {
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_LEGACY_DISCONNECTED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: legacyInstallation?.id ?? legacyConfig?.id ?? input.organizationId,
			metadata: {
				provider: "slack",
				legacyConfigId: legacyConfig?.id ?? null,
				installationId: legacyInstallation?.id ?? null,
			},
		});
	}

	return {
		kind: "disconnected",
		disconnectedLegacyConfigId: legacyConfig?.id ?? null,
		installationId: legacyInstallation?.id ?? null,
	};
}
