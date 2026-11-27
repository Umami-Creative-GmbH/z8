import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { member } from "@/db/auth-schema";
import {
	type ChatConversationReachabilityStatus,
	type ChatCredentialSource,
	type ChatInstallationStatus,
	type ChatVerificationEvidence,
	type ChatVerificationState,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationCredentialRevision,
	chatInstallationMemberLink,
	chatProviderSettings,
	employee,
	teamsUserMapping,
} from "@/db/schema";
import {
	countOutstandingApprovalWorkByInstallation,
	type InstallationOutstandingApprovalCounts,
} from "@/lib/approvals/delivery/installation-origin";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { dateFromInstant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { createLogger } from "@/lib/logger";
import { evictTeamsInstallationBotAdapter } from "@/lib/teams/bot-adapter";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";
import { isSecretStoreUnavailableError } from "@/lib/vault";
import { backfillOrganizationChatInstallations } from "./backfill";
import {
	readInstallationCredentialRevision,
	storeInstallationCredentialRevision,
} from "./credential-revisions";
import {
	countInFlightDurableDispatches,
	type InFlightDurableDispatchCounts,
} from "./durable-dispatch";
import { checkSwitchEligibility, listLegacyTeamsTenantsForOrganization } from "./inventory";
import { detectTeamsTenantSettingsDisagreements, isValidGuid } from "./legacy-analysis";
import {
	buildVerifiedExternalScope,
	reuseVerifiedExternalIdentity,
	verifyEligibleChatLinkMember,
} from "./member-links";
import {
	type BeginChatInstallationRestoreResult,
	beginChatInstallationRestore,
	type ChatRecoveryCleanupJobView,
	type ChatRecoveryInstallationView,
	type ChatRecoveryRuntimeDeps,
	getChatInstallationRecoveryState,
	getProviderRotationGuidance,
	type ProviderRotationGuidance,
	type RevokeChatInstallationResult,
	type RotateChatInstallationCredentialsResult,
	revokeChatInstallation,
	rotateChatInstallationCredentials,
} from "./recovery-lifecycle";
import {
	type ChatSwitchAuditEvent,
	type ChatSwitchDb,
	classifyEmployeeSwitchReachability,
	computeRetirementDeadline,
	type EmployeeSwitchReachabilitySummary,
	isChatInstallationSwitchEnabled,
	type SwitchInstallationPreviewItem,
	type SwitchMaterialCounts,
} from "./switch-lifecycle";
import {
	computeTeamsCandidateSetupStatus,
	sendTeamsCandidateProactiveTestMessage,
	TEAMS_VERIFICATION_FRESHNESS_MS,
	type TeamsCandidateInstallationRecord,
	type TeamsSetupRuntimeDeps,
} from "./teams-setup";
import type {
	ChatEffectiveSettingField,
	ChatEffectiveSettings,
	ChatMigrationBlocker,
	LegacyTeamsTenantInventoryItem,
	TeamsSettingsDisagreement,
} from "./types";

const logger = createLogger("TeamsMultiTenantSwitch");

const DEFAULT_TEAMS_EFFECTIVE_SETTINGS: ChatEffectiveSettings = {
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: true,
	enableEscalations: true,
	digestTime: "08:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
};

const DIGEST_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface TeamsSwitchRuntimeDeps {
	db?: ChatSwitchDb;
	now?: () => Date;
	syncLegacy?: boolean;
	verificationTtlMs?: number;
	recordAudit?: (event: ChatSwitchAuditEvent) => Promise<void>;
	countOutstandingApprovalWork?: (
		organizationId: string,
		installationId: string,
		dbClient: ChatSwitchDb,
	) => Promise<InstallationOutstandingApprovalCounts>;
	countInFlightDurable?: (
		organizationId: string,
		installationId: string | null,
		dbClient: ChatSwitchDb,
	) => Promise<InFlightDurableDispatchCounts>;
	confirmedReplacementSettings?: ChatEffectiveSettings | null;
}

export interface TeamsSwitchAffectedTenantDigestEntry {
	installationId: string;
	legacyRecordId: string | null;
	tenantId: string | null;
	status: ChatInstallationStatus;
	activeCredentialRevisionId: string | null;
	effectiveSettings: ChatEffectiveSettings;
}

export interface TeamsSwitchImpactDigestInput {
	organizationId: string;
	affectedTenants: readonly TeamsSwitchAffectedTenantDigestEntry[];
	candidateInstallationId: string | null;
	candidateCredentialRevisionId: string | null;
	hasSettingsDisagreements: boolean;
	disagreementFields: readonly ChatEffectiveSettingField[];
	confirmedReplacementSettings: ChatEffectiveSettings;
	materialCounts: SwitchMaterialCounts;
}

export interface TeamsSwitchAffectedTenantItem {
	installationId: string;
	legacyRecordId: string | null;
	tenantId: string;
	tenantName: string | null;
	installationStatus: ChatInstallationStatus;
	legacySetupStatus: string | null;
	isUnexpectedStatus: boolean;
	credentialSource: ChatCredentialSource;
	receiverScope: string | null;
	activeCredentialRevisionId: string | null;
	effectiveSettings: ChatEffectiveSettings;
	openCanonicalCards: number;
	openLegacyOwnerCards: number;
	outstandingRefreshWork: number;
	pendingLegacyCards: number;
	totalOutstandingCardsAndWork: number;
	canRevoke: boolean;
	blockers: ChatMigrationBlocker[];
}

export interface TeamsSwitchRetiringTenantItem {
	installationId: string;
	legacyRecordId: string | null;
	tenantId: string | null;
	tenantName: string | null;
	credentialSource: ChatCredentialSource;
	receiverScope: string | null;
	retirementDeadlineAt: string | null;
	openCanonicalCards: number;
	openLegacyOwnerCards: number;
	outstandingRefreshWork: number;
	pendingLegacyCards: number;
	totalOutstandingCardsAndWork: number;
	canRevoke: boolean;
}

export interface TeamsSwitchImpactPreview {
	organizationId: string;
	provider: "teams";
	generatedAt: string;
	switchControlEnabled: boolean;
	blockers: ChatMigrationBlocker[];
	hasHardBlockers: boolean;
	affectedTenants: TeamsSwitchAffectedTenantItem[];
	discoveredLegacyTenants: LegacyTeamsTenantInventoryItem[];
	settingsDisagreements: TeamsSettingsDisagreement[];
	hasSettingsDisagreements: boolean;
	proposedReplacementSettings: ChatEffectiveSettings;
	candidateInstallation: SwitchInstallationPreviewItem | null;
	candidateReady: boolean;
	candidateVerificationState: ChatVerificationState | null;
	retiringTenants: TeamsSwitchRetiringTenantItem[];
	activeOrgOwnedInstallation: ChatRecoveryInstallationView | null;
	restorableInstallations: ChatRecoveryInstallationView[];
	pendingCleanupJobs: ChatRecoveryCleanupJobView[];
	rotationGuidance: ProviderRotationGuidance;
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
	requiresUnreadyAcknowledgement: boolean;
	requiresSettingsConfirmation: boolean;
	canConfirm: boolean;
	impactDigest: string;
}

export type TeamsSwitchRefusalCode =
	| "switch_not_enabled"
	| "migration_blocked"
	| "candidate_not_found"
	| "already_switched"
	| "candidate_not_ready"
	| "candidate_verification_expired"
	| "impact_changed"
	| "unready_acknowledgement_required"
	| "settings_confirmation_required"
	| "invalid_replacement_settings"
	| "endpoint_reconciliation_required";

export interface ConfirmTeamsOrganizationSwitchInput {
	organizationId: string;
	actorUserId: string;
	candidateInstallationId: string;
	reviewedAffectedInstallationIds: readonly string[];
	reviewedCandidateCredentialRevisionId: string | null;
	reviewedImpactDigest: string;
	acknowledgeUnreadyEmployees: boolean;
	confirmedReplacementSettings?: ChatEffectiveSettings | null;
}

export type ConfirmTeamsOrganizationSwitchResult =
	| {
			kind: "switched";
			activeInstallationId: string;
			retiredInstallationIds: string[];
			retiredTenantIds: string[];
			retirementDeadlineAt: string;
			carriedForwardIdentityCount: number;
			promotedEnrollmentCount: number;
			effectiveSettings: ChatEffectiveSettings;
			preview: TeamsSwitchImpactPreview;
	  }
	| {
			kind: "refused";
			code: TeamsSwitchRefusalCode;
			message: string;
			freshPreview: TeamsSwitchImpactPreview;
	  };

export type DisconnectLegacyTeamsTenantResult =
	| {
			kind: "disconnected";
			installationId: string;
			tenantId: string | null;
	  }
	| {
			kind: "refused";
			code:
				| "legacy_setup_superseded"
				| "migration_blocked"
				| "tenant_id_required"
				| "installation_not_found";
			status: 400 | 404 | 409 | 410;
			message: string;
	  };

export interface RotateTeamsCredentialsInput {
	organizationId: string;
	installationId: string;
	actorUserId: string;
	microsoftAppId: string;
	microsoftTenantId: string;
	microsoftAppPassword: string;
}

export interface RevokeTeamsInstallationInput {
	organizationId: string;
	installationId: string;
	actorUserId: string;
	reason?: string;
}

export interface BeginTeamsRestoreInput {
	organizationId: string;
	installationId: string;
	actorUserId: string;
}

export interface VerifyRestoredTeamsInput {
	organizationId: string;
	installationId: string;
	actorUserId: string;
	microsoftAppId?: string;
	microsoftTenantId?: string;
	microsoftAppPassword?: string;
	sendProactiveTest?: boolean;
}

export type VerifyRestoredTeamsResult =
	| {
			kind: "verified_step";
			installationId: string;
			readyForSwitch: boolean;
			verificationState: ChatVerificationState;
			activeCredentialRevisionId: string | null;
			preview: TeamsSwitchImpactPreview;
	  }
	| {
			kind: "refused";
			code:
				| "installation_not_found"
				| "installation_not_in_restore_mode"
				| "endpoint_reconciliation_required"
				| "credentials_required"
				| "invalid_app_id_format"
				| "invalid_tenant_id_format"
				| "invalid_app_password_format"
				| "external_identity_mismatch"
				| "secret_store_unavailable"
				| "credential_write_failed"
				| "missing_private_reachability"
				| "tenant_mismatch"
				| "private_delivery_failed";
			message: string;
	  };

function getNow(deps?: { now?: () => Date }): Date {
	return deps?.now ? deps.now() : dateFromInstant(systemClock.nowInstant());
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
			"Failed to record redacted Teams switch audit event",
		);
	}
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

function normalizeEffectiveSettings(settings: ChatEffectiveSettings): ChatEffectiveSettings {
	return {
		enableApprovals: Boolean(settings.enableApprovals),
		enableCommands: Boolean(settings.enableCommands),
		enableDailyDigest: Boolean(settings.enableDailyDigest),
		enableEscalations: Boolean(settings.enableEscalations),
		digestTime: settings.digestTime.trim(),
		digestTimezone: settings.digestTimezone.trim(),
		escalationTimeoutHours: Math.trunc(settings.escalationTimeoutHours),
	};
}

export function validateTeamsEffectiveSettings(settings: ChatEffectiveSettings): string | null {
	if (!DIGEST_TIME_PATTERN.test(settings.digestTime.trim())) {
		return "Digest time must use HH:mm format.";
	}
	if (!settings.digestTimezone.trim() || !isValidIanaTimeZone(settings.digestTimezone.trim())) {
		return "Digest timezone must be a valid IANA timezone.";
	}
	if (!Number.isInteger(settings.escalationTimeoutHours) || settings.escalationTimeoutHours < 1) {
		return "Escalation timeout must be an integer of at least 1 hour.";
	}
	return null;
}

// ============================================
// PURE DOMAIN HELPERS
// ============================================

/**
 * Proposes deterministic default replacement settings for the organization-owned
 * Teams app: prefers authoritative `chat_provider_settings` if already confirmed,
 * else the primary live Teams tenant's settings, else platform defaults.
 */
export function proposeTeamsReplacementSettings(input: {
	authoritativeSettings: ChatEffectiveSettings | null;
	liveTenantSettings: readonly ChatEffectiveSettings[];
}): ChatEffectiveSettings {
	if (input.authoritativeSettings) {
		return normalizeEffectiveSettings(input.authoritativeSettings);
	}
	if (input.liveTenantSettings.length > 0 && input.liveTenantSettings[0]) {
		return normalizeEffectiveSettings(input.liveTenantSettings[0]);
	}
	return { ...DEFAULT_TEAMS_EFFECTIVE_SETTINGS };
}

/**
 * Computes a deterministic SHA-256 fingerprint bound to:
 * - exact sorted set of affected live tenant/installation IDs, statuses, revisions & settings
 * - candidate installation & credential revision ID
 * - settings disagreement state & sorted differing fields
 * - confirmed/proposed replacement settings
 * - material employee, approval card/work, and in-flight notification counts
 */
export function computeTeamsSwitchImpactDigest(input: TeamsSwitchImpactDigestInput): string {
	const sortedTenants = [...input.affectedTenants]
		.map((tenant) => ({
			installationId: tenant.installationId,
			legacyRecordId: tenant.legacyRecordId,
			tenantId: tenant.tenantId?.toLowerCase() ?? null,
			status: tenant.status,
			activeCredentialRevisionId: tenant.activeCredentialRevisionId,
			effectiveSettings: normalizeEffectiveSettings(tenant.effectiveSettings),
		}))
		.sort((a, b) => a.installationId.localeCompare(b.installationId));

	const canonical = {
		version: 1,
		organizationId: input.organizationId,
		provider: "teams" as const,
		affectedTenants: sortedTenants,
		candidateInstallationId: input.candidateInstallationId,
		candidateCredentialRevisionId: input.candidateCredentialRevisionId,
		hasSettingsDisagreements: input.hasSettingsDisagreements,
		disagreementFields: [...input.disagreementFields].sort(),
		confirmedReplacementSettings: normalizeEffectiveSettings(input.confirmedReplacementSettings),
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
 * Compares the admin's reviewed multi-tenant Teams switch snapshot against the live
 * transactional snapshot. Any change to the live tenant set, candidate revision, or
 * impact digest forces a fresh review (`impact_changed`).
 */
export function hasTeamsSwitchImpactChanged(input: {
	reviewedAffectedInstallationIds: readonly string[];
	reviewedCandidateCredentialRevisionId: string | null;
	reviewedImpactDigest: string;
	freshAffectedInstallationIds: readonly string[];
	freshCandidateCredentialRevisionId: string | null;
	freshImpactDigest: string;
}): boolean {
	const reviewedSet = [...input.reviewedAffectedInstallationIds].sort();
	const freshSet = [...input.freshAffectedInstallationIds].sort();
	if (
		reviewedSet.length !== freshSet.length ||
		reviewedSet.some((id, idx) => id !== freshSet[idx])
	) {
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

// ============================================
// INTERNAL LOADERS
// ============================================

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

async function computeTeamsEmployeeImpact(
	db: Pick<ChatSwitchDb, "select">,
	input: {
		organizationId: string;
		liveInstallations: Array<typeof chatInstallation.$inferSelect>;
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
			if (!existing || conv.reachabilityStatus === "reachable") {
				candidateConversationStatusByUser.set(conv.userId, conv.reachabilityStatus);
			}
		}

		for (const link of candidateLinks) {
			candidateLinkedUserIds.add(link.userId);
		}

		const candidateScope = buildVerifiedExternalScope(input.candidate);
		if (candidateScope && input.liveInstallations.length > 0) {
			const matchingLive = input.liveInstallations.filter(
				(inst) => buildVerifiedExternalScope(inst) === candidateScope,
			);
			const matchingLiveIds = matchingLive.map((inst) => inst.id);

			if (matchingLiveIds.length > 0) {
				const liveLinks = await db
					.select({ userId: chatInstallationMemberLink.userId })
					.from(chatInstallationMemberLink)
					.where(
						and(
							eq(chatInstallationMemberLink.organizationId, input.organizationId),
							inArray(chatInstallationMemberLink.installationId, matchingLiveIds),
							eq(chatInstallationMemberLink.externalScope, candidateScope),
							eq(chatInstallationMemberLink.isCandidateEnrollment, false),
							eq(chatInstallationMemberLink.isActive, true),
						),
					);
				for (const link of liveLinks) {
					sameScopeCarryForwardUserIds.add(link.userId);
				}

				if (input.candidate.externalSpaceId) {
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

async function carryForwardTeamsIdentitiesAndEnrollments(
	tx: ChatSwitchDb,
	input: {
		organizationId: string;
		retiringInstallations: Array<typeof chatInstallation.$inferSelect>;
		activeInstallation: typeof chatInstallation.$inferSelect;
		now: Date;
	},
): Promise<{ promotedEnrollmentCount: number; carriedForwardIdentityCount: number }> {
	let promotedEnrollmentCount = 0;
	let carriedForwardIdentityCount = 0;

	// 1. Promote verified candidate enrollments (`isCandidateEnrollment = true` -> `false`)
	//    on the newly active installation while leaving all retiring tenants' conversations untouched.
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
		// react-doctor-disable-next-line react-doctor/async-await-in-loop -- Promotion reads and updates member links within one switch transaction.
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

	// 2. Carry forward proven same-tenant Entra identities from retiring installations
	//    whose external scope matches the newly active Teams app.
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
			// react-doctor-disable-next-line react-doctor/async-await-in-loop -- A successful transfer reserves this user before the next source installation is considered.
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

// ============================================
// 1. MULTI-TENANT TEAMS SWITCH IMPACT PREVIEW
// ============================================

/**
 * Builds the complete multi-tenant Microsoft Teams switch impact preview:
 * - Enumerates EVERY live legacy Teams tenant (`legacy_active` / `active`) alongside
 *   all discovered legacy `teams_tenant_config` rows, per-tenant effective settings,
 *   statuses, and per-tenant outstanding approval card counts;
 * - Identifies differing settings across live legacy tenants and proposes replacement settings;
 * - Computes employee reachability, total approval impact, in-flight/uncertain durable
 *   dispatches, retiring tenants, recovery state, and a deterministic `impactDigest`.
 */
export async function buildTeamsSwitchImpactPreview(
	organizationId: string,
	candidateInstallationId?: string | null,
	deps?: TeamsSwitchRuntimeDeps,
): Promise<TeamsSwitchImpactPreview> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);
	const verificationTtlMs = deps?.verificationTtlMs ?? TEAMS_VERIFICATION_FRESHNESS_MS;

	if (deps?.syncLegacy !== false) {
		await backfillOrganizationChatInstallations(organizationId, { db, now: () => now });
	}

	const [
		switchControlEnabled,
		eligibility,
		legacyInventory,
		installations,
		providerSettingsRow,
		recoveryState,
	] = await Promise.all([
		isChatInstallationSwitchEnabled(db, organizationId, "teams"),
		checkSwitchEligibility(organizationId, "teams", {
			db,
			now: () => now,
			syncLegacy: false,
		}),
		listLegacyTeamsTenantsForOrganization(organizationId, {
			db,
			now: () => now,
			syncLegacy: false,
		}),
		db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, organizationId),
					eq(chatInstallation.provider, "teams"),
				),
			)
			.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id)),
		db
			.select()
			.from(chatProviderSettings)
			.where(
				and(
					eq(chatProviderSettings.organizationId, organizationId),
					eq(chatProviderSettings.provider, "teams"),
				),
			)
			.limit(1)
			.then((rows) => rows[0] ?? null),
		getChatInstallationRecoveryState(
			{ organizationId, provider: "teams" },
			{ db, now: () => now, verificationTtlMs },
		),
	]);

	const liveRows = installations.filter(
		(row) => row.status === "active" || row.status === "legacy_active",
	);
	const candidate = candidateInstallationId
		? (installations.find(
				(row) => row.id === candidateInstallationId && row.status === "candidate",
			) ?? null)
		: (installations.find((row) => row.status === "candidate") ?? null);
	const retiringRows = installations.filter((row) => row.status === "retiring");

	const legacyByRecordId = new Map(legacyInventory.tenants.map((t) => [t.id, t]));
	const legacyByInstallationId = new Map(
		legacyInventory.tenants
			.filter((t): t is LegacyTeamsTenantInventoryItem & { installationId: string } =>
				Boolean(t.installationId),
			)
			.map((t) => [t.installationId, t]),
	);

	const countApprovalWork =
		deps?.countOutstandingApprovalWork ??
		((orgId: string, instId: string, dbClient: ChatSwitchDb) =>
			countOutstandingApprovalWorkByInstallation(orgId, instId, { db: dbClient }));
	const countInFlight =
		deps?.countInFlightDurable ??
		((orgId: string, instId: string | null, dbClient: ChatSwitchDb) =>
			countInFlightDurableDispatches(orgId, "teams", instId, { db: dbClient }));

	const [employeeImpact, liveApprovalCounts, retiringApprovalCounts, inFlightNotificationImpact] =
		await Promise.all([
			computeTeamsEmployeeImpact(db, {
				organizationId,
				liveInstallations: liveRows,
				candidate,
				now,
			}),
			Promise.all(liveRows.map((inst) => countApprovalWork(organizationId, inst.id, db))),
			Promise.all(retiringRows.map((inst) => countApprovalWork(organizationId, inst.id, db))),
			countInFlight(organizationId, null, db),
		]);

	const authoritativeSettings: ChatEffectiveSettings | null = providerSettingsRow?.isAuthoritative
		? {
				enableApprovals: providerSettingsRow.enableApprovals,
				enableCommands: providerSettingsRow.enableCommands,
				enableDailyDigest: providerSettingsRow.enableDailyDigest,
				enableEscalations: providerSettingsRow.enableEscalations,
				digestTime: providerSettingsRow.digestTime,
				digestTimezone: providerSettingsRow.digestTimezone,
				escalationTimeoutHours: providerSettingsRow.escalationTimeoutHours,
			}
		: null;

	const affectedTenants: TeamsSwitchAffectedTenantItem[] = liveRows.map((row, idx) => {
		const counts = liveApprovalCounts[idx];
		const legacyItem =
			(row.legacyRecordId ? legacyByRecordId.get(row.legacyRecordId) : undefined) ??
			legacyByInstallationId.get(row.id) ??
			null;
		const effectiveSettings: ChatEffectiveSettings = legacyItem?.effectiveSettings ??
			authoritativeSettings ?? { ...DEFAULT_TEAMS_EFFECTIVE_SETTINGS };

		return {
			installationId: row.id,
			legacyRecordId: row.legacyRecordId,
			tenantId: legacyItem?.tenantId ?? row.externalSpaceId ?? row.id,
			tenantName: legacyItem?.tenantName ?? row.externalSpaceName ?? row.externalDisplayName,
			installationStatus: row.status,
			legacySetupStatus: legacyItem?.setupStatus ?? row.legacyStatus,
			isUnexpectedStatus: legacyItem?.isUnexpectedStatus ?? false,
			credentialSource: row.credentialSource,
			receiverScope: row.receiverScope,
			activeCredentialRevisionId: row.activeCredentialRevisionId,
			effectiveSettings,
			openCanonicalCards: counts?.openCanonicalMessages ?? 0,
			openLegacyOwnerCards: counts?.openLegacyOwnerMessages ?? 0,
			outstandingRefreshWork: counts?.outstandingWork.refresh ?? 0,
			pendingLegacyCards: counts?.pendingLegacyCards ?? 0,
			totalOutstandingCardsAndWork: counts?.totalOutstanding ?? 0,
			canRevoke: true,
			blockers: legacyItem?.blockers ?? [],
		};
	});

	// Detect settings disagreements across the LIVE affected tenants (excluding disconnected/revoked).
	const settingsDisagreements = detectTeamsTenantSettingsDisagreements(
		affectedTenants.map((tenant) => ({
			tenantId: tenant.tenantId,
			tenantName: tenant.tenantName,
			setupStatus: tenant.legacySetupStatus ?? "active",
			settings: tenant.effectiveSettings,
		})),
	);
	const hasSettingsDisagreements = settingsDisagreements.length > 0;

	const proposedReplacementSettings = proposeTeamsReplacementSettings({
		authoritativeSettings,
		liveTenantSettings: affectedTenants.map((t) => t.effectiveSettings),
	});

	const retiringTenants: TeamsSwitchRetiringTenantItem[] = retiringRows.map((row, idx) => {
		const counts = retiringApprovalCounts[idx];
		const legacyItem =
			(row.legacyRecordId ? legacyByRecordId.get(row.legacyRecordId) : undefined) ??
			legacyByInstallationId.get(row.id) ??
			null;
		return {
			installationId: row.id,
			legacyRecordId: row.legacyRecordId,
			tenantId: legacyItem?.tenantId ?? row.externalSpaceId,
			tenantName: legacyItem?.tenantName ?? row.externalSpaceName ?? row.externalDisplayName,
			credentialSource: row.credentialSource,
			receiverScope: row.receiverScope,
			retirementDeadlineAt: row.retirementDeadlineAt?.toISOString() ?? null,
			openCanonicalCards: counts?.openCanonicalMessages ?? 0,
			openLegacyOwnerCards: counts?.openLegacyOwnerMessages ?? 0,
			outstandingRefreshWork: counts?.outstandingWork.refresh ?? 0,
			pendingLegacyCards: counts?.pendingLegacyCards ?? 0,
			totalOutstandingCardsAndWork: counts?.totalOutstanding ?? 0,
			canRevoke: true,
		};
	});

	const approvalImpact = liveApprovalCounts.reduce(
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

	const candidateEvaluation = candidate
		? computeTeamsCandidateSetupStatus(
				candidate as unknown as TeamsCandidateInstallationRecord,
				now,
				verificationTtlMs,
			)
		: null;
	const candidateReady = candidateEvaluation?.readyForSwitch ?? false;
	const candidateVerificationState = candidateEvaluation?.effectiveVerificationState ?? null;

	const hasHardBlockers = eligibility.blockers.some((b) => b.blocksSwitchAndEndpointMutation);

	const effectiveSettingsForDigest =
		deps?.confirmedReplacementSettings ?? proposedReplacementSettings;

	const impactDigest = computeTeamsSwitchImpactDigest({
		organizationId,
		affectedTenants: affectedTenants.map((tenant) => ({
			installationId: tenant.installationId,
			legacyRecordId: tenant.legacyRecordId,
			tenantId: tenant.tenantId,
			status: tenant.installationStatus,
			activeCredentialRevisionId: tenant.activeCredentialRevisionId,
			effectiveSettings: tenant.effectiveSettings,
		})),
		candidateInstallationId: candidate?.id ?? null,
		candidateCredentialRevisionId: candidate?.activeCredentialRevisionId ?? null,
		hasSettingsDisagreements,
		disagreementFields: settingsDisagreements.map((d) => d.field),
		confirmedReplacementSettings: effectiveSettingsForDigest,
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

	const activeOrgOwnedInstallation =
		recoveryState.activeInstallation?.credentialSource === "organization_owned" &&
		recoveryState.activeInstallation.status === "active"
			? recoveryState.activeInstallation
			: null;

	return {
		organizationId,
		provider: "teams",
		generatedAt: now.toISOString(),
		switchControlEnabled,
		blockers: eligibility.blockers,
		hasHardBlockers,
		affectedTenants,
		discoveredLegacyTenants: legacyInventory.tenants,
		settingsDisagreements,
		hasSettingsDisagreements,
		proposedReplacementSettings,
		candidateInstallation: candidate ? toPreviewItem(candidate) : null,
		candidateReady,
		candidateVerificationState,
		retiringTenants,
		activeOrgOwnedInstallation,
		restorableInstallations: recoveryState.restorableInstallations,
		pendingCleanupJobs: recoveryState.pendingCleanupJobs,
		rotationGuidance: getProviderRotationGuidance("teams"),
		employeeImpact,
		approvalImpact,
		inFlightNotificationImpact,
		requiresUnreadyAcknowledgement: employeeImpact.unreadyEmployees > 0,
		requiresSettingsConfirmation: hasSettingsDisagreements,
		canConfirm: switchControlEnabled && !hasHardBlockers && Boolean(candidate) && candidateReady,
		impactDigest,
	};
}

// ============================================
// 2. ATOMIC MULTI-TENANT TEAMS SWITCH
// ============================================

/**
 * Atomically switches a Z8 organization to its verified single-tenant org-owned
 * Microsoft Teams app inside ONE serialized PostgreSQL transaction (`pg_advisory_xact_lock`
 * + `FOR UPDATE`):
 * - Rechecks switch control, blockers, candidate verification freshness, affected live
 *   tenant set, revisions, `impactDigest`, unready-employee acknowledgement, and explicit
 *   replacement settings confirmation when legacy tenants disagree;
 * - Promotes the verified candidate & credential revision to `active`;
 * - Retires EVERY reviewed live legacy/active Teams tenant together with a 30-day
 *   `retirementDeadlineAt`, preserving each retiring tenant's `receiver_scope`,
 *   `legacy_record_id`, and card route;
 * - Writes admin-confirmed authoritative `chat_provider_settings`;
 * - Promotes verified candidate enrollments & carries forward proven same-tenant Entra
 *   identities while leaving retiring tenants' historical conversations intact;
 * - Records a redacted audit event.
 */
export async function confirmTeamsOrganizationSwitch(
	input: ConfirmTeamsOrganizationSwitchInput,
	deps?: TeamsSwitchRuntimeDeps,
): Promise<ConfirmTeamsOrganizationSwitchResult> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const lockKey = `chat-switch:${input.organizationId}:teams`;

	const outcome = await db.transaction(async (rawTx) => {
		const tx = rawTx as unknown as ChatSwitchDb;

		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
		await tx.execute(sql`
			SELECT id
			FROM chat_installation
			WHERE organization_id = ${input.organizationId}
				AND provider = 'teams'
			FOR UPDATE
		`);
		await tx.execute(sql`
			SELECT id
			FROM teams_tenant_config
			WHERE organization_id = ${input.organizationId}
			FOR UPDATE
		`);

		const freshPreview = await buildTeamsSwitchImpactPreview(
			input.organizationId,
			input.candidateInstallationId,
			{
				...deps,
				db: tx,
				now: () => now,
				syncLegacy: false,
				confirmedReplacementSettings: undefined,
			},
		);

		if (!freshPreview.switchControlEnabled) {
			return {
				result: {
					kind: "refused" as const,
					code: "switch_not_enabled" as const,
					message: "Organization-owned Teams switching is not enabled for this organization yet.",
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
					message: "Resolve Microsoft Teams migration blockers before switching.",
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
					eq(chatInstallation.provider, "teams"),
				),
			)
			.limit(1);

		if (!candidateRow) {
			return {
				result: {
					kind: "refused" as const,
					code: "candidate_not_found" as const,
					message: "The candidate Teams installation could not be found.",
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
					message: "This organization-owned Teams installation is already active.",
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
					message: "The selected Teams installation is no longer a candidate for switching.",
					freshPreview,
				},
				audit: null,
			};
		}

		if (candidateRow.endpointState === "uncertain") {
			return {
				result: {
					kind: "refused" as const,
					code: "endpoint_reconciliation_required" as const,
					message:
						"Provider endpoint state is uncertain. Reconcile the endpoint before activating this Teams installation.",
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
						? "Candidate Teams verification proofs have expired. Re-verify inbound activity and proactive private delivery before switching."
						: "Complete all single-tenant Teams verification steps before switching.",
					freshPreview,
				},
				audit: null,
			};
		}

		const drifted = hasTeamsSwitchImpactChanged({
			reviewedAffectedInstallationIds: input.reviewedAffectedInstallationIds,
			reviewedCandidateCredentialRevisionId: input.reviewedCandidateCredentialRevisionId,
			reviewedImpactDigest: input.reviewedImpactDigest,
			freshAffectedInstallationIds: freshPreview.affectedTenants.map((t) => t.installationId),
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
						"Affected Teams tenants, settings, revisions, or impact counts changed since you reviewed them. Review the updated summary and confirm again.",
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
						"Acknowledge that some employees still need to connect or verify direct messages with the new Teams app before switching.",
					freshPreview,
				},
				audit: null,
			};
		}

		if (freshPreview.hasSettingsDisagreements && !input.confirmedReplacementSettings) {
			return {
				result: {
					kind: "refused" as const,
					code: "settings_confirmation_required" as const,
					message:
						"Your legacy Teams tenants have differing settings. Explicitly confirm the replacement settings before switching.",
					freshPreview,
				},
				audit: null,
			};
		}

		const chosenSettings = normalizeEffectiveSettings(
			input.confirmedReplacementSettings ?? freshPreview.proposedReplacementSettings,
		);
		const settingsValidationError = validateTeamsEffectiveSettings(chosenSettings);
		if (settingsValidationError) {
			return {
				result: {
					kind: "refused" as const,
					code: "invalid_replacement_settings" as const,
					message: settingsValidationError,
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
					eq(chatInstallation.provider, "teams"),
					inArray(chatInstallation.status, ["active", "legacy_active"]),
				),
			)
			.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id));

		const retiredInstallationIds = retiringRows.map((row) => row.id);
		const retiredTenantIds = retiringRows
			.map((row) => row.externalSpaceId)
			.filter((id): id is string => Boolean(id));

		// 1. Retire EVERY reviewed live legacy/active Teams installation in the same transaction
		//    FIRST to satisfy the partial unique index `(organization_id, provider) WHERE status = 'active'`.
		//    Each retiring tenant retains its own `receiver_scope`, `legacy_record_id`, and card ownership.
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
						eq(chatInstallation.provider, "teams"),
						inArray(chatInstallation.id, retiredInstallationIds),
					),
				);
		}

		// 2. Promote verified single-tenant org-owned candidate -> `active`.
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
			throw new Error("Failed to promote candidate Teams installation to active");
		}

		// 3. Mark active credential revision as `active`.
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

		// 4. Write admin-confirmed replacement effective settings to `chat_provider_settings`.
		await tx
			.insert(chatProviderSettings)
			.values({
				organizationId: input.organizationId,
				provider: "teams",
				isAuthoritative: true,
				activeInstallationId: activated.id,
				enableApprovals: chosenSettings.enableApprovals,
				enableCommands: chosenSettings.enableCommands,
				enableDailyDigest: chosenSettings.enableDailyDigest,
				enableEscalations: chosenSettings.enableEscalations,
				digestTime: chosenSettings.digestTime,
				digestTimezone: chosenSettings.digestTimezone,
				escalationTimeoutHours: chosenSettings.escalationTimeoutHours,
				confirmedByUserId: input.actorUserId,
				confirmedAt: now,
			})
			.onConflictDoUpdate({
				target: [chatProviderSettings.organizationId, chatProviderSettings.provider],
				set: {
					isAuthoritative: true,
					activeInstallationId: activated.id,
					enableApprovals: chosenSettings.enableApprovals,
					enableCommands: chosenSettings.enableCommands,
					enableDailyDigest: chosenSettings.enableDailyDigest,
					enableEscalations: chosenSettings.enableEscalations,
					digestTime: chosenSettings.digestTime,
					digestTimezone: chosenSettings.digestTimezone,
					escalationTimeoutHours: chosenSettings.escalationTimeoutHours,
					confirmedByUserId: input.actorUserId,
					confirmedAt: now,
					updatedAt: now,
				},
			});

		// 5. Promote verified candidate enrollments & carry forward proven same-tenant Entra identities
		//    while keeping every retiring tenant's historical conversations intact.
		const identityTransfer = await carryForwardTeamsIdentitiesAndEnrollments(tx, {
			organizationId: input.organizationId,
			retiringInstallations: retiringRows,
			activeInstallation: activated,
			now,
		});

		// react-doctor-disable-next-line react-doctor/server-sequential-independent-await -- The preview must include the identity transfers written immediately above.
		const updatedPreview = await buildTeamsSwitchImpactPreview(input.organizationId, null, {
			...deps,
			db: tx,
			now: () => now,
			syncLegacy: false,
		});

		return {
			result: {
				kind: "switched" as const,
				activeInstallationId: activated.id,
				retiredInstallationIds,
				retiredTenantIds,
				retirementDeadlineAt: retirementDeadlineAt.toISOString(),
				carriedForwardIdentityCount: identityTransfer.carriedForwardIdentityCount,
				promotedEnrollmentCount: identityTransfer.promotedEnrollmentCount,
				effectiveSettings: chosenSettings,
				preview: updatedPreview,
			},
			audit: {
				action: AuditAction.CHAT_INSTALLATION_SWITCH_CONFIRMED,
				actorId: input.actorUserId,
				organizationId: input.organizationId,
				targetId: activated.id,
				metadata: {
					provider: "teams",
					activeInstallationId: activated.id,
					activeCredentialRevisionId: activated.activeCredentialRevisionId,
					activeTenantId: activated.externalSpaceId,
					activeAppId: activated.externalAppId,
					retiredInstallationIds,
					retiredTenantIds,
					retirementDeadlineAt: retirementDeadlineAt.toISOString(),
					hadSettingsDisagreements: freshPreview.hasSettingsDisagreements,
					confirmedSettings: chosenSettings,
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
// 3. SEPARATELY SCOPED PER-TENANT REVOKE
// ============================================

/**
 * Immediately revokes ONE specific legacy or retiring Teams tenant installation
 * without affecting sibling retiring tenants, the active organization-owned Teams
 * app, or shared deployment credentials.
 */
export async function revokeLegacyTeamsTenantInstallation(
	organizationId: string,
	installationId: string,
	actorUserId: string,
	deps?: ChatRecoveryRuntimeDeps & { reason?: string },
): Promise<RevokeChatInstallationResult> {
	const db = deps?.db ?? defaultDb;
	const [inst] = await db
		.select({ id: chatInstallation.id, provider: chatInstallation.provider })
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.id, installationId),
				eq(chatInstallation.organizationId, organizationId),
				eq(chatInstallation.provider, "teams"),
			),
		)
		.limit(1);

	if (!inst) {
		return {
			kind: "refused",
			code: "installation_not_found",
			message: "The selected Microsoft Teams tenant installation was not found.",
		};
	}

	return revokeChatInstallation(
		{
			organizationId,
			installationId,
			actorUserId,
			reason: deps?.reason ?? "per_tenant_revoke",
		},
		deps,
	);
}

/**
 * Authorized lifecycle handler for legacy `DELETE /api/teams/setup`.
 * Blocks bypassing the organization-owned lifecycle once switched or during remediation,
 * requires explicit `tenantId` when multiple legacy tenants exist, and routes eligible
 * legacy disconnects through `revokeLegacyTeamsTenantInstallation`.
 */
export async function disconnectLegacyTeamsTenantInstallation(
	input: {
		organizationId: string;
		actorUserId: string;
		tenantId?: string | null;
	},
	deps?: ChatRecoveryRuntimeDeps,
): Promise<DisconnectLegacyTeamsTenantResult> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);

	await backfillOrganizationChatInstallations(input.organizationId, { db, now: () => now });

	const installations = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, input.organizationId),
				eq(chatInstallation.provider, "teams"),
			),
		)
		.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id));

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
				"Legacy Teams setup mutations have been superseded by organization-owned installation management. Use Settings → Chat Integrations to revoke individual tenants or manage your Teams app.",
		};
	}

	const hasRemediation = installations.some((row) => row.status === "remediation_required");
	if (hasRemediation) {
		return {
			kind: "refused",
			code: "migration_blocked",
			status: 409,
			message:
				"Microsoft Teams installation requires remediation before disconnecting via the legacy setup route.",
		};
	}

	const legacyActive = installations.filter(
		(row) => row.legacyTable === "teams_tenant_config" && row.status === "legacy_active",
	);

	if (legacyActive.length === 0) {
		return {
			kind: "refused",
			code: "installation_not_found",
			status: 404,
			message: "No active legacy Microsoft Teams tenant was found for this organization.",
		};
	}

	const requestedTenantId = input.tenantId?.trim().toLowerCase() || null;
	let target: (typeof legacyActive)[number] | undefined = legacyActive[0];
	if (requestedTenantId) {
		target = legacyActive.find(
			(row) => row.externalSpaceId?.trim().toLowerCase() === requestedTenantId,
		);
		if (!target) {
			return {
				kind: "refused",
				code: "installation_not_found",
				status: 404,
				message: "The specified legacy Microsoft Teams tenant was not found for this organization.",
			};
		}
	} else if (legacyActive.length > 1) {
		return {
			kind: "refused",
			code: "tenant_id_required",
			status: 409,
			message:
				"Multiple legacy Microsoft Teams tenants are connected. Specify tenantId or revoke each tenant individually in Settings → Chat Integrations.",
		};
	}

	if (!target) {
		return {
			kind: "refused",
			code: "installation_not_found",
			status: 404,
			message: "No active legacy Microsoft Teams tenant was found for this organization.",
		};
	}

	const revoked = await revokeLegacyTeamsTenantInstallation(
		input.organizationId,
		target.id,
		input.actorUserId,
		{ ...deps, reason: "legacy_setup_disconnect" },
	);
	if (revoked.kind === "refused") {
		return {
			kind: "refused",
			code: "installation_not_found",
			status: 404,
			message: revoked.message,
		};
	}

	return {
		kind: "disconnected",
		installationId: target.id,
		tenantId: target.externalSpaceId,
	};
}

// ============================================
// 4. ORG-OWNED TEAMS ROTATION, REVOKE & RESTORE
// ============================================

/**
 * Rotates credentials for an organization-owned single-tenant Microsoft Teams
 * installation while strictly verifying the exact same `microsoftAppId` AND
 * `microsoftTenantId`, writing an immutable revision, evicting the cached
 * `CloudAdapter`, and preserving conversations, links, and approval card ownership.
 */
export async function rotateTeamsInstallationCredentials(
	input: RotateTeamsCredentialsInput,
	deps?: ChatRecoveryRuntimeDeps,
): Promise<RotateChatInstallationCredentialsResult> {
	const appId = input.microsoftAppId.trim().toLowerCase();
	const tenantId = input.microsoftTenantId.trim().toLowerCase();
	const appPassword = input.microsoftAppPassword.trim();

	return rotateChatInstallationCredentials(
		{
			organizationId: input.organizationId,
			installationId: input.installationId,
			actorUserId: input.actorUserId,
			secrets: {
				microsoft_app_id: appId,
				microsoft_tenant_id: tenantId,
				microsoft_app_password: appPassword,
			},
			verifyIdentity: async (secrets, installation) => {
				if (installation.provider !== "teams") {
					return { kind: "mismatch", reason: "provider_mismatch" };
				}
				const candidateAppId = (secrets.microsoft_app_id ?? "").trim().toLowerCase();
				const candidateTenantId = (secrets.microsoft_tenant_id ?? "").trim().toLowerCase();
				const candidatePassword = (secrets.microsoft_app_password ?? "").trim();

				if (!isValidGuid(candidateAppId) || !isValidGuid(candidateTenantId)) {
					return {
						kind: "invalid_credentials",
						code: "invalid_credentials",
						message: "Microsoft App ID and Entra Tenant ID must be valid GUIDs.",
					};
				}
				if (candidatePassword.length < 8) {
					return {
						kind: "invalid_credentials",
						code: "invalid_credentials",
						message: "Microsoft App Password (client secret) must be at least 8 characters.",
					};
				}
				if (
					!installation.externalAppId ||
					!installation.externalSpaceId ||
					candidateAppId !== installation.externalAppId.trim().toLowerCase() ||
					candidateTenantId !== installation.externalSpaceId.trim().toLowerCase()
				) {
					return {
						kind: "mismatch",
						reason: "teams_app_or_tenant_mismatch",
					};
				}

				return {
					kind: "matched",
					fingerprint: `teams:${candidateTenantId}:${candidateAppId}`,
					spaceName: installation.externalSpaceName,
				};
			},
		},
		deps,
	);
}

/**
 * Immediately revokes an organization-owned (or legacy) Microsoft Teams installation.
 */
export async function revokeTeamsInstallation(
	input: RevokeTeamsInstallationInput,
	deps?: ChatRecoveryRuntimeDeps,
): Promise<RevokeChatInstallationResult> {
	const db = deps?.db ?? defaultDb;
	const [inst] = await db
		.select({ id: chatInstallation.id })
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.id, input.installationId),
				eq(chatInstallation.organizationId, input.organizationId),
				eq(chatInstallation.provider, "teams"),
			),
		)
		.limit(1);

	if (!inst) {
		return {
			kind: "refused",
			code: "installation_not_found",
			message: "Microsoft Teams installation was not found for this organization.",
		};
	}

	return revokeChatInstallation(input, deps);
}

/**
 * Starts verified restoration of a retiring, retired, or revoked organization-owned
 * Microsoft Teams installation, fencing stale cleanup jobs and clearing verification
 * proofs so fresh verification & impact review are mandatory before switch-back.
 */
export async function beginTeamsInstallationRestore(
	input: BeginTeamsRestoreInput,
	deps?: ChatRecoveryRuntimeDeps,
): Promise<BeginChatInstallationRestoreResult> {
	const db = deps?.db ?? defaultDb;
	const [inst] = await db
		.select({ id: chatInstallation.id })
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.id, input.installationId),
				eq(chatInstallation.organizationId, input.organizationId),
				eq(chatInstallation.provider, "teams"),
			),
		)
		.limit(1);

	if (!inst) {
		return {
			kind: "refused",
			code: "installation_not_found",
			message: "Microsoft Teams installation was not found for this organization.",
		};
	}

	return beginChatInstallationRestore(input, deps);
}

/**
 * Re-verifies credentials (matching the exact same Teams App ID & Entra Tenant ID)
 * and optionally runs a fresh synthetic proactive private test message for a Teams
 * installation undergoing restore. Full switch-back still requires fresh inbound
 * authenticated proof and proactive private delivery (`readyForSwitch = true`).
 */
export async function verifyRestoredTeamsInstallation(
	input: VerifyRestoredTeamsInput,
	deps?: ChatRecoveryRuntimeDeps & TeamsSetupRuntimeDeps,
): Promise<VerifyRestoredTeamsResult> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);
	const ttlMs = deps?.verificationTtlMs ?? TEAMS_VERIFICATION_FRESHNESS_MS;

	const [installation] = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.id, input.installationId),
				eq(chatInstallation.organizationId, input.organizationId),
				eq(chatInstallation.provider, "teams"),
			),
		)
		.limit(1);

	if (!installation) {
		return {
			kind: "refused",
			code: "installation_not_found",
			message: "Microsoft Teams installation was not found for this organization.",
		};
	}

	if (installation.status !== "candidate") {
		return {
			kind: "refused",
			code: "installation_not_in_restore_mode",
			message: "Start restoring this Teams installation before running fresh verification.",
		};
	}

	if (installation.endpointState === "uncertain") {
		return {
			kind: "refused",
			code: "endpoint_reconciliation_required",
			message:
				"Provider endpoint state is uncertain. Reconcile the endpoint before verifying restore.",
		};
	}

	let currentInstallation = installation;
	const providedPassword = input.microsoftAppPassword?.trim() ?? "";

	if (providedPassword) {
		const appId = (input.microsoftAppId ?? installation.externalAppId ?? "").trim().toLowerCase();
		const tenantId = (input.microsoftTenantId ?? installation.externalSpaceId ?? "")
			.trim()
			.toLowerCase();

		if (!isValidGuid(appId)) {
			return {
				kind: "refused",
				code: "invalid_app_id_format",
				message: "Microsoft App ID must be a valid GUID.",
			};
		}
		if (!isValidGuid(tenantId)) {
			return {
				kind: "refused",
				code: "invalid_tenant_id_format",
				message: "Microsoft Entra Tenant ID must be a valid GUID.",
			};
		}
		if (providedPassword.length < 8) {
			return {
				kind: "refused",
				code: "invalid_app_password_format",
				message: "Microsoft App Password (client secret) must be at least 8 characters.",
			};
		}
		if (
			!installation.externalAppId ||
			!installation.externalSpaceId ||
			appId !== installation.externalAppId.trim().toLowerCase() ||
			tenantId !== installation.externalSpaceId.trim().toLowerCase()
		) {
			return {
				kind: "refused",
				code: "external_identity_mismatch",
				message:
					"Provided Microsoft App ID or Entra Tenant ID does not match the Teams installation being restored.",
			};
		}

		let revision: Awaited<ReturnType<typeof storeInstallationCredentialRevision>>;
		try {
			revision = await storeInstallationCredentialRevision(
				{
					organizationId: input.organizationId,
					installationId: installation.id,
					provider: "teams",
					secrets: {
						microsoft_app_id: appId,
						microsoft_tenant_id: tenantId,
						microsoft_app_password: providedPassword,
					},
					status: "staged",
					externalIdentityFingerprint: `teams:${tenantId}:${appId}`,
					verifiedAt: null,
					createdByUserId: input.actorUserId,
				},
				{
					db,
					repository: deps?.revisionRepository,
					storeSecret: deps?.storeSecret,
					deleteSecret: deps?.deleteSecret,
					secretStoreProvider: deps?.secretStoreProvider,
				},
			);
		} catch (error) {
			const isUnavailable = isSecretStoreUnavailableError(error);
			return {
				kind: "refused",
				code: isUnavailable ? "secret_store_unavailable" : "credential_write_failed",
				message: isUnavailable
					? "The organization secret store is currently unavailable."
					: "Failed to store credentials for restored Teams installation.",
			};
		}

		evictTeamsInstallationBotAdapter(installation.id);
		const nextEvidence: ChatVerificationEvidence = {
			...(installation.verificationEvidence ?? { source: "verified_setup" }),
			source: "verified_setup",
			configuredAt: now.toISOString(),
			tenantId,
			applicationId: appId,
			secretStoreStatus: "available",
			identityVerifiedAt: now.toISOString(),
			identityRevisionId: revision.id,
			signedEventVerifiedAt: null,
			signedEventRevisionId: null,
			signedEventExpiresAt: null,
			privateDeliveryVerifiedAt: null,
			privateDeliveryRevisionId: null,
			privateDeliveryExpiresAt: null,
			lastFailureStep: null,
			lastFailureCode: null,
			lastFailureAt: null,
		};

		const [updated] = await db
			.update(chatInstallation)
			.set({
				activeCredentialRevisionId: revision.id,
				verificationState: "pending",
				verificationEvidence: nextEvidence,
				updatedAt: now,
			})
			.where(
				and(
					eq(chatInstallation.id, installation.id),
					eq(chatInstallation.organizationId, input.organizationId),
				),
			)
			.returning();
		if (updated) {
			currentInstallation = updated;
		}
	} else {
		if (!currentInstallation.activeCredentialRevisionId) {
			return {
				kind: "refused",
				code: "credentials_required",
				message:
					"Enter a fresh Microsoft App Password (client secret) to re-verify this previously revoked Teams installation.",
			};
		}

		const credRead = await readInstallationCredentialRevision(
			{
				organizationId: input.organizationId,
				installationId: currentInstallation.id,
				revisionId: currentInstallation.activeCredentialRevisionId,
			},
			{
				db,
				repository: deps?.revisionRepository,
				readSecret: deps?.readSecret,
			},
		);
		if (credRead.kind === "unavailable") {
			return {
				kind: "refused",
				code: "secret_store_unavailable",
				message: "The organization secret store is temporarily unavailable.",
			};
		}
		if (credRead.kind !== "ok" || !credRead.secrets.microsoft_app_password) {
			return {
				kind: "refused",
				code: "credentials_required",
				message:
					"Stored Teams credentials are missing or revoked. Enter a fresh Microsoft App Password.",
			};
		}

		const nextEvidence: ChatVerificationEvidence = {
			...(currentInstallation.verificationEvidence ?? { source: "verified_setup" }),
			source: "verified_setup",
			secretStoreStatus: "available",
			identityVerifiedAt: now.toISOString(),
			identityRevisionId: currentInstallation.activeCredentialRevisionId,
			lastFailureStep: null,
			lastFailureCode: null,
			lastFailureAt: null,
		};
		const statusEval = computeTeamsCandidateSetupStatus(
			{
				...(currentInstallation as unknown as TeamsCandidateInstallationRecord),
				verificationEvidence: nextEvidence,
			},
			now,
			ttlMs,
		);
		const [updated] = await db
			.update(chatInstallation)
			.set({
				verificationEvidence: nextEvidence,
				verificationState: statusEval.effectiveVerificationState,
				lastVerifiedAt: statusEval.readyForSwitch ? now : currentInstallation.lastVerifiedAt,
				updatedAt: now,
			})
			.where(
				and(
					eq(chatInstallation.id, currentInstallation.id),
					eq(chatInstallation.organizationId, input.organizationId),
				),
			)
			.returning();
		if (updated) {
			currentInstallation = updated;
		}
	}

	if (input.sendProactiveTest) {
		const proactive = await sendTeamsCandidateProactiveTestMessage(
			{
				organizationId: input.organizationId,
				actorUserId: input.actorUserId,
				installationId: currentInstallation.id,
			},
			{
				db,
				revisionRepository: deps?.revisionRepository,
				readSecret: deps?.readSecret,
				getAdapter: deps?.getAdapter,
				sendProactiveTest: deps?.sendProactiveTest,
				recordAudit: deps?.recordAudit,
				appUrl: deps?.appUrl,
				verificationTtlMs: ttlMs,
				now: () => now,
			},
		);
		if (proactive.kind === "error") {
			const mappedCode =
				proactive.code === "secret_store_unavailable"
					? "secret_store_unavailable"
					: proactive.code === "credentials_missing" ||
						  proactive.code === "credentials_not_configured"
						? "credentials_required"
						: proactive.code === "missing_private_reachability"
							? "missing_private_reachability"
							: proactive.code === "tenant_mismatch"
								? "tenant_mismatch"
								: "private_delivery_failed";
			return {
				kind: "refused",
				code: mappedCode,
				message: proactive.message,
			};
		}

		const [reloaded] = await db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.id, currentInstallation.id),
					eq(chatInstallation.organizationId, input.organizationId),
				),
			)
			.limit(1);
		if (reloaded) {
			currentInstallation = reloaded;
		}
	}

	const computed = computeTeamsCandidateSetupStatus(
		currentInstallation as unknown as TeamsCandidateInstallationRecord,
		now,
		ttlMs,
	);
	const preview = await buildTeamsSwitchImpactPreview(
		input.organizationId,
		currentInstallation.id,
		{
			db,
			now: () => now,
			syncLegacy: false,
			verificationTtlMs: ttlMs,
		},
	);

	return {
		kind: "verified_step",
		installationId: currentInstallation.id,
		readyForSwitch: computed.readyForSwitch,
		verificationState: computed.effectiveVerificationState,
		activeCredentialRevisionId: currentInstallation.activeCredentialRevisionId,
		preview,
	};
}

/**
 * Confirms verified switch-back/restore of a previously retiring/retired/revoked
 * organization-owned Teams installation through the atomic multi-tenant switch
 * transaction and records `CHAT_INSTALLATION_RESTORED`.
 */
export async function confirmTeamsInstallationRestore(
	input: ConfirmTeamsOrganizationSwitchInput,
	deps?: TeamsSwitchRuntimeDeps,
): Promise<ConfirmTeamsOrganizationSwitchResult> {
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const switchResult = await confirmTeamsOrganizationSwitch(input, deps);

	if (switchResult.kind === "switched") {
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_RESTORED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: switchResult.activeInstallationId,
			metadata: {
				provider: "teams",
				activeInstallationId: switchResult.activeInstallationId,
				retiredInstallationIds: switchResult.retiredInstallationIds,
				retiredTenantIds: switchResult.retiredTenantIds,
				reviewedImpactDigest: input.reviewedImpactDigest,
			},
		});
	}

	return switchResult;
}
