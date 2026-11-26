import { randomBytes } from "node:crypto";
import type { CloudAdapter, ConversationReference } from "botbuilder";
import { and, asc, desc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	type ChatInstallationStatus,
	type ChatOwnershipClaimKind,
	type ChatVerificationEvidence,
	type ChatVerificationState,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationCredentialRevision,
	chatInstallationMemberLink,
	teamsTenantConfig,
	teamsUserMapping,
} from "@/db/schema";
import { env } from "@/env";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import {
	evictTeamsInstallationBotAdapter,
	getTeamsInstallationBotAdapter,
	sendTeamsProactiveTestMessage,
	type TeamsInstallationBotAdapterConfig,
	type TeamsSendResult,
} from "@/lib/teams/bot-adapter";
import { isSecretStoreUnavailableError, type SecretStoreProviderKind } from "@/lib/vault";
import { acquireExternalOwnershipClaim } from "./backfill";
import {
	type CredentialRevisionRepository,
	readInstallationCredentialRevision,
	storeInstallationCredentialRevision,
} from "./credential-revisions";
import { isValidGuid } from "./legacy-analysis";
import {
	type RedeemChatLinkProofInput,
	type RedeemChatLinkProofResult,
	verifyEligibleChatLinkMember,
} from "./member-links";
import {
	buildTeamsAppPackageZip,
	type GeneratedTeamsAppPackage,
	generateTeamsAppPackage,
	TEAMS_MANIFEST_SCHEMA_URL,
	TEAMS_MANIFEST_VERSION,
	TEAMS_PLACEHOLDER_APP_ID,
	type TeamsAdminRolloutStep,
	type TeamsAppManifestDocument,
	type TeamsCandidateSetupView,
	type TeamsVerificationStepStatus,
	type TeamsVerificationStepView,
} from "./teams-app-package";
import type { ChatInstallationsDb } from "./types";

export {
	buildTeamsAppPackageZip,
	type GeneratedTeamsAppPackage,
	generateTeamsAppPackage,
	TEAMS_MANIFEST_SCHEMA_URL,
	TEAMS_MANIFEST_VERSION,
	TEAMS_PLACEHOLDER_APP_ID,
	type TeamsAdminRolloutStep,
	type TeamsAppManifestDocument,
	type TeamsCandidateSetupView,
	type TeamsVerificationStepStatus,
	type TeamsVerificationStepView,
};

const logger = createLogger("TeamsCandidateSetup");

/**
 * Freshness window for candidate Teams verification proofs (authenticated inbound
 * app+tenant activity and synthetic proactive private test message).
 */
export const TEAMS_VERIFICATION_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export interface TeamsCandidateInstallationRecord {
	id: string;
	organizationId: string;
	provider: "teams";
	credentialSource: "organization_owned" | "deployment_managed";
	status: ChatInstallationStatus;
	routeId: string;
	externalAppId: string | null;
	externalBotId: string | null;
	externalBotUsername: string | null;
	externalDisplayName: string | null;
	externalSpaceId: string | null;
	externalSpaceName: string | null;
	receiverScope: string | null;
	spaceClaimId: string | null;
	botClaimId: string | null;
	activeCredentialRevisionId: string | null;
	verificationState: ChatVerificationState;
	verificationEvidence: ChatVerificationEvidence | null;
	lastVerifiedAt: Date | null;
	retirementDeadlineAt?: Date | null;
	retiredAt?: Date | null;
	revokedAt?: Date | null;
	endpointGeneration: number;
	createdByUserId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface StoredCandidatePersonalConversation {
	externalConversationId: string;
	externalUserId: string | null;
	userId: string | null;
	conversationReference: Record<string, unknown>;
	verifiedAt: Date | null;
}

export interface ProvenSameTenantMember {
	userId: string;
	employeeId: string;
	displayName: string | null;
}

export interface TeamsSetupRepository {
	findCandidateByOrg(organizationId: string): Promise<TeamsCandidateInstallationRecord | null>;
	findCandidateById(
		organizationId: string,
		installationId: string,
	): Promise<TeamsCandidateInstallationRecord | null>;
	findInstallationByRouteId(routeId: string): Promise<TeamsCandidateInstallationRecord | null>;
	insertCandidate(input: {
		organizationId: string;
		routeId: string;
		createdByUserId: string | null;
	}): Promise<TeamsCandidateInstallationRecord>;
	updateCandidate(
		organizationId: string,
		installationId: string,
		patch: Partial<
			Pick<
				TeamsCandidateInstallationRecord,
				| "externalAppId"
				| "externalBotId"
				| "externalDisplayName"
				| "externalSpaceId"
				| "externalSpaceName"
				| "receiverScope"
				| "spaceClaimId"
				| "botClaimId"
				| "activeCredentialRevisionId"
				| "verificationState"
				| "verificationEvidence"
				| "lastVerifiedAt"
			>
		>,
	): Promise<TeamsCandidateInstallationRecord>;
	acquireClaim(input: {
		organizationId: string;
		claimKind: ChatOwnershipClaimKind;
		externalId: string;
		verifiedAt: Date;
	}): Promise<{ kind: "acquired"; claimId: string } | { kind: "conflict" }>;
	findCandidatePersonalConversation(input: {
		organizationId: string;
		installationId: string;
		preferredUserId?: string | null;
	}): Promise<StoredCandidatePersonalConversation | null>;
	upsertCandidatePersonalConversation(input: {
		organizationId: string;
		installationId: string;
		userId?: string | null;
		employeeId?: string | null;
		externalUserId?: string | null;
		externalConversationId: string;
		conversationReference: Record<string, unknown>;
		reachabilityStatus: "reachable" | "unknown" | "action_needed" | "unreachable";
		verifiedAt: Date;
	}): Promise<void>;
	findProvenSameTenantMember(input: {
		organizationId: string;
		tenantId: string;
		aadObjectId: string;
	}): Promise<ProvenSameTenantMember | null>;
	upsertCandidateMemberEnrollment(input: {
		organizationId: string;
		installationId: string;
		userId: string;
		employeeId: string;
		externalUserId: string;
		externalUsername?: string | null;
		externalDisplayName?: string | null;
		externalScope: string;
		provenance: "link_proof" | "verified_same_scope_reuse";
		verifiedAt: Date;
	}): Promise<void>;
	getRevisionNumber(
		organizationId: string,
		installationId: string,
		revisionId: string,
	): Promise<number | null>;
}

export interface TeamsSetupAuditEvent {
	action: AuditAction;
	actorId: string;
	organizationId: string;
	targetId: string;
	metadata: Record<string, unknown>;
}

export interface TeamsSetupRuntimeDeps {
	db?: ChatInstallationsDb;
	repository?: TeamsSetupRepository;
	revisionRepository?: CredentialRevisionRepository;
	storeSecret?: (organizationId: string, key: string, value: string) => Promise<void>;
	readSecret?: (organizationId: string, key: string) => Promise<string | null>;
	deleteSecret?: (organizationId: string, key: string) => Promise<void>;
	secretStoreProvider?: SecretStoreProviderKind;
	getAdapter?: (config: TeamsInstallationBotAdapterConfig) => CloudAdapter;
	evictAdapter?: (installationId: string, credentialRevisionId?: string) => number;
	sendProactiveTest?: (
		adapter: CloudAdapter,
		appId: string,
		conversationReference: ConversationReference,
		message: string,
	) => Promise<TeamsSendResult>;
	redeemLinkProof?: (input: RedeemChatLinkProofInput) => Promise<RedeemChatLinkProofResult>;
	recordAudit?: (event: TeamsSetupAuditEvent) => Promise<void>;
	appUrl?: string;
	verificationTtlMs?: number;
	now?: () => Date;
}

function generateRouteId(): string {
	return randomBytes(18).toString("base64url");
}

function resolveAppUrl(override?: string): string {
	const raw = (override || env.APP_URL || "https://z8-time.app").trim();
	return raw.replace(/\/+$/, "");
}

function isFreshTimestamp(
	verifiedAtIso: string | null | undefined,
	expiresAtIso: string | null | undefined,
	now: Date,
	ttlMs: number,
): boolean {
	if (!verifiedAtIso) return false;
	const verifiedMs = Date.parse(verifiedAtIso);
	if (Number.isNaN(verifiedMs)) return false;
	if (now.getTime() - verifiedMs > ttlMs) return false;
	if (expiresAtIso) {
		const expiresMs = Date.parse(expiresAtIso);
		if (!Number.isNaN(expiresMs) && now.getTime() > expiresMs) {
			return false;
		}
	}
	return true;
}

/**
 * Evaluates step-by-step readiness for a candidate single-tenant Teams installation.
 * Marks `readyForSwitch = true` ONLY when:
 * 1) Credentials & valid single-tenant app/tenant GUIDs are stored for the active revision,
 * 2) A fresh authenticated inbound activity from matching app & tenant was verified for the active revision, AND
 * 3) A fresh synthetic proactive private test succeeded via the installation-scoped adapter for the active revision.
 */
export function computeTeamsCandidateSetupStatus(
	installation: Pick<
		TeamsCandidateInstallationRecord,
		| "activeCredentialRevisionId"
		| "externalAppId"
		| "externalSpaceId"
		| "externalSpaceName"
		| "verificationEvidence"
	>,
	now: Date = new Date(),
	ttlMs: number = TEAMS_VERIFICATION_FRESHNESS_MS,
): {
	readyForSwitch: boolean;
	effectiveVerificationState: ChatVerificationState;
	steps: TeamsCandidateSetupView["steps"];
} {
	const evidence = installation.verificationEvidence;
	const activeRevId = installation.activeCredentialRevisionId;

	const credentialsPassed = Boolean(
		activeRevId &&
		isValidGuid(installation.externalAppId) &&
		isValidGuid(installation.externalSpaceId) &&
		evidence?.identityRevisionId === activeRevId,
	);
	const credentialsStep: TeamsVerificationStepView = credentialsPassed
		? {
				status: "passed",
				verifiedAt: evidence?.identityVerifiedAt ?? evidence?.configuredAt ?? null,
				expiresAt: null,
				detail: `${installation.externalAppId} / ${installation.externalSpaceName ?? installation.externalSpaceId}`,
				failureCode: null,
			}
		: evidence?.lastFailureStep === "credentials" || evidence?.lastFailureStep === "identity"
			? {
					status: "failed",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: evidence.lastFailureCode ?? "credential_write_failed",
				}
			: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
				};

	const inboundMatchesRev = Boolean(
		activeRevId &&
		evidence?.signedEventVerifiedAt &&
		evidence.signedEventRevisionId === activeRevId,
	);
	const inboundFresh =
		inboundMatchesRev &&
		isFreshTimestamp(evidence?.signedEventVerifiedAt, evidence?.signedEventExpiresAt, now, ttlMs);
	const inboundStep: TeamsVerificationStepView = inboundFresh
		? {
				status: "passed",
				verifiedAt: evidence?.signedEventVerifiedAt ?? null,
				expiresAt: evidence?.signedEventExpiresAt ?? null,
				detail: evidence?.signedEventType ?? null,
				failureCode: null,
			}
		: inboundMatchesRev
			? {
					status: "expired",
					verifiedAt: evidence?.signedEventVerifiedAt ?? null,
					expiresAt: evidence?.signedEventExpiresAt ?? null,
					detail: evidence?.signedEventType ?? null,
					failureCode: "inbound_proof_expired",
				}
			: evidence?.lastFailureStep === "signed_event"
				? {
						status: "failed",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode: evidence.lastFailureCode ?? "tenant_mismatch",
					}
				: {
						status: "pending",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode: null,
					};

	const privateTestMatchesRev = Boolean(
		activeRevId &&
		evidence?.privateDeliveryVerifiedAt &&
		evidence.privateDeliveryRevisionId === activeRevId,
	);
	const privateTestFresh =
		privateTestMatchesRev &&
		isFreshTimestamp(
			evidence?.privateDeliveryVerifiedAt,
			evidence?.privateDeliveryExpiresAt,
			now,
			ttlMs,
		);
	const privateTestStep: TeamsVerificationStepView = privateTestFresh
		? {
				status: "passed",
				verifiedAt: evidence?.privateDeliveryVerifiedAt ?? null,
				expiresAt: evidence?.privateDeliveryExpiresAt ?? null,
				detail: evidence?.privateDeliveryChannelId ?? null,
				failureCode: null,
			}
		: privateTestMatchesRev
			? {
					status: "expired",
					verifiedAt: evidence?.privateDeliveryVerifiedAt ?? null,
					expiresAt: evidence?.privateDeliveryExpiresAt ?? null,
					detail: evidence?.privateDeliveryChannelId ?? null,
					failureCode: "private_test_expired",
				}
			: evidence?.lastFailureStep === "private_test"
				? {
						status: "failed",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode: evidence.lastFailureCode ?? "private_delivery_failed",
					}
				: {
						status: "pending",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode: null,
					};

	const readyForSwitch =
		credentialsStep.status === "passed" &&
		inboundStep.status === "passed" &&
		privateTestStep.status === "passed";

	let effectiveVerificationState: ChatVerificationState = "unverified";
	if (readyForSwitch) {
		effectiveVerificationState = "verified";
	} else if (inboundStep.status === "expired" || privateTestStep.status === "expired") {
		effectiveVerificationState = "expired";
	} else if (
		credentialsStep.status === "failed" ||
		inboundStep.status === "failed" ||
		privateTestStep.status === "failed"
	) {
		effectiveVerificationState = "failed";
	} else if (credentialsStep.status === "passed") {
		effectiveVerificationState = "pending";
	}

	return {
		readyForSwitch,
		effectiveVerificationState,
		steps: {
			credentials: credentialsStep,
			inboundProof: inboundStep,
			privateTest: privateTestStep,
		},
	};
}

function createDrizzleTeamsSetupRepository(db: ChatInstallationsDb): TeamsSetupRepository {
	return {
		async findCandidateByOrg(organizationId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, "teams"),
						eq(chatInstallation.status, "candidate"),
					),
				)
				.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id))
				.limit(1);
			return (row as TeamsCandidateInstallationRecord | undefined) ?? null;
		},

		async findCandidateById(organizationId, installationId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.id, installationId),
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, "teams"),
						eq(chatInstallation.status, "candidate"),
					),
				)
				.limit(1);
			return (row as TeamsCandidateInstallationRecord | undefined) ?? null;
		},

		async findInstallationByRouteId(routeId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(and(eq(chatInstallation.routeId, routeId), eq(chatInstallation.provider, "teams")))
				.limit(1);
			return (row as TeamsCandidateInstallationRecord | undefined) ?? null;
		},

		async insertCandidate(input) {
			const [row] = await db
				.insert(chatInstallation)
				.values({
					organizationId: input.organizationId,
					provider: "teams",
					credentialSource: "organization_owned",
					status: "candidate",
					routeId: input.routeId,
					verificationState: "unverified",
					createdByUserId: input.createdByUserId,
				})
				.returning();
			if (!row) {
				throw new Error("Failed to insert candidate Teams installation");
			}
			return row as TeamsCandidateInstallationRecord;
		},

		async updateCandidate(organizationId, installationId, patch) {
			const [row] = await db
				.update(chatInstallation)
				.set({
					...patch,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(chatInstallation.id, installationId),
						eq(chatInstallation.organizationId, organizationId),
					),
				)
				.returning();
			if (!row) {
				throw new Error("Failed to update candidate Teams installation");
			}
			return row as TeamsCandidateInstallationRecord;
		},

		async acquireClaim({ organizationId, claimKind, externalId, verifiedAt }) {
			const normalized = externalId.trim().toLowerCase();

			// Also guard against claiming a legacy Teams tenant that already belongs to another org,
			// even if legacy backfill has not yet populated chat_external_ownership_claim for that org.
			if (claimKind === "tenant") {
				const [legacyOwner] = await db
					.select({
						organizationId: teamsTenantConfig.organizationId,
						setupStatus: teamsTenantConfig.setupStatus,
					})
					.from(teamsTenantConfig)
					.where(eq(teamsTenantConfig.tenantId, normalized))
					.limit(1);

				if (
					legacyOwner &&
					legacyOwner.organizationId !== organizationId &&
					legacyOwner.setupStatus !== "disconnected"
				) {
					return { kind: "conflict" };
				}
			}

			const result = await acquireExternalOwnershipClaim(
				{
					organizationId,
					provider: "teams",
					claimKind,
					externalId: normalized,
					provenance: "verified_setup",
					verifiedAt,
				},
				{ db },
			);
			if (result.kind === "conflict") {
				return { kind: "conflict" };
			}
			return { kind: "acquired", claimId: result.claim.id };
		},

		async findCandidatePersonalConversation({ organizationId, installationId, preferredUserId }) {
			const rows = await db
				.select({
					externalConversationId: chatInstallationConversation.externalConversationId,
					externalUserId: chatInstallationConversation.externalUserId,
					userId: chatInstallationConversation.userId,
					conversationReference: chatInstallationConversation.conversationReference,
					verifiedAt: chatInstallationConversation.verifiedAt,
				})
				.from(chatInstallationConversation)
				.where(
					and(
						eq(chatInstallationConversation.organizationId, organizationId),
						eq(chatInstallationConversation.installationId, installationId),
						eq(chatInstallationConversation.conversationType, "personal"),
						eq(chatInstallationConversation.isActive, true),
					),
				)
				.orderBy(desc(chatInstallationConversation.updatedAt));

			const withRef = rows.filter(
				(row): row is typeof row & { conversationReference: Record<string, unknown> } =>
					row.conversationReference !== null && typeof row.conversationReference === "object",
			);
			if (withRef.length === 0) return null;

			const preferred = preferredUserId
				? withRef.find((row) => row.userId === preferredUserId)
				: undefined;
			return preferred ?? withRef[0] ?? null;
		},

		async upsertCandidatePersonalConversation(input) {
			const [existingByExt] = await db
				.select({ id: chatInstallationConversation.id })
				.from(chatInstallationConversation)
				.where(
					and(
						eq(chatInstallationConversation.organizationId, input.organizationId),
						eq(chatInstallationConversation.installationId, input.installationId),
						eq(chatInstallationConversation.externalConversationId, input.externalConversationId),
					),
				)
				.limit(1);

			if (existingByExt) {
				await db
					.update(chatInstallationConversation)
					.set({
						userId: input.userId ?? undefined,
						employeeId: input.employeeId ?? undefined,
						externalUserId: input.externalUserId ?? undefined,
						conversationReference: input.conversationReference,
						reachabilityStatus: input.reachabilityStatus,
						reachabilityReason: null,
						verifiedAt: input.verifiedAt,
						lastUsedAt: input.verifiedAt,
						isActive: true,
						updatedAt: input.verifiedAt,
					})
					.where(eq(chatInstallationConversation.id, existingByExt.id));
				return;
			}

			if (input.userId) {
				const [existingByUser] = await db
					.select({ id: chatInstallationConversation.id })
					.from(chatInstallationConversation)
					.where(
						and(
							eq(chatInstallationConversation.organizationId, input.organizationId),
							eq(chatInstallationConversation.installationId, input.installationId),
							eq(chatInstallationConversation.userId, input.userId),
							eq(chatInstallationConversation.conversationType, "personal"),
						),
					)
					.limit(1);

				if (existingByUser) {
					await db
						.update(chatInstallationConversation)
						.set({
							employeeId: input.employeeId ?? undefined,
							externalUserId: input.externalUserId ?? undefined,
							externalConversationId: input.externalConversationId,
							conversationReference: input.conversationReference,
							reachabilityStatus: input.reachabilityStatus,
							reachabilityReason: null,
							verifiedAt: input.verifiedAt,
							lastUsedAt: input.verifiedAt,
							isActive: true,
							updatedAt: input.verifiedAt,
						})
						.where(eq(chatInstallationConversation.id, existingByUser.id));
					return;
				}
			}

			await db.insert(chatInstallationConversation).values({
				organizationId: input.organizationId,
				installationId: input.installationId,
				userId: input.userId ?? null,
				employeeId: input.employeeId ?? null,
				externalUserId: input.externalUserId ?? null,
				externalConversationId: input.externalConversationId,
				conversationType: "personal",
				conversationReference: input.conversationReference,
				reachabilityStatus: input.reachabilityStatus,
				reachabilityReason: null,
				verifiedAt: input.verifiedAt,
				lastUsedAt: input.verifiedAt,
				isActive: true,
			});
		},

		async findProvenSameTenantMember({ organizationId, tenantId, aadObjectId }) {
			const normalizedTenantId = tenantId.trim().toLowerCase();
			const normalizedAad = aadObjectId.trim();
			const expectedScope = `teams:tenant:${normalizedTenantId}`;

			// 1. Check verified non-candidate member link in exact same organization & Teams tenant scope
			const [verifiedLink] = await db
				.select({
					userId: chatInstallationMemberLink.userId,
					displayName: chatInstallationMemberLink.externalDisplayName,
				})
				.from(chatInstallationMemberLink)
				.where(
					and(
						eq(chatInstallationMemberLink.organizationId, organizationId),
						eq(chatInstallationMemberLink.externalScope, expectedScope),
						eq(chatInstallationMemberLink.externalUserId, normalizedAad),
						eq(chatInstallationMemberLink.isCandidateEnrollment, false),
						eq(chatInstallationMemberLink.isActive, true),
					),
				)
				.limit(1);

			let candidateUserId = verifiedLink?.userId ?? null;
			let displayName = verifiedLink?.displayName ?? null;

			// 2. Fallback to existing verified legacy teams_user_mapping in the SAME (organizationId, tenantId)
			// NEVER uses email matching!
			if (!candidateUserId) {
				const [legacyMapping] = await db
					.select({
						userId: teamsUserMapping.userId,
						displayName: teamsUserMapping.teamsDisplayName,
					})
					.from(teamsUserMapping)
					.where(
						and(
							eq(teamsUserMapping.organizationId, organizationId),
							eq(teamsUserMapping.teamsTenantId, normalizedTenantId),
							eq(teamsUserMapping.teamsUserId, normalizedAad),
							eq(teamsUserMapping.isActive, true),
						),
					)
					.limit(1);

				if (legacyMapping) {
					candidateUserId = legacyMapping.userId;
					displayName = legacyMapping.displayName;
				}
			}

			if (!candidateUserId) {
				return null;
			}

			const eligibility = await verifyEligibleChatLinkMember(candidateUserId, organizationId, {
				db: db as typeof defaultDb,
			});
			if (!eligibility.eligible) {
				return null;
			}

			return {
				userId: eligibility.userId,
				employeeId: eligibility.employeeId,
				displayName,
			};
		},

		async upsertCandidateMemberEnrollment(input) {
			// Strictly segregated candidate lane (`isCandidateEnrollment: true`).
			// Never mutates live `teams_user_mapping` or non-candidate `chat_installation_member_link` rows.
			const [existing] = await db
				.select({ id: chatInstallationMemberLink.id })
				.from(chatInstallationMemberLink)
				.where(
					and(
						eq(chatInstallationMemberLink.organizationId, input.organizationId),
						eq(chatInstallationMemberLink.installationId, input.installationId),
						eq(chatInstallationMemberLink.userId, input.userId),
						eq(chatInstallationMemberLink.isCandidateEnrollment, true),
						eq(chatInstallationMemberLink.isActive, true),
					),
				)
				.limit(1);

			if (existing) {
				await db
					.update(chatInstallationMemberLink)
					.set({
						employeeId: input.employeeId,
						externalUserId: input.externalUserId,
						externalUsername: input.externalUsername ?? null,
						externalDisplayName: input.externalDisplayName ?? null,
						externalScope: input.externalScope,
						provenance: input.provenance,
						verifiedAt: input.verifiedAt,
						lastSeenAt: input.verifiedAt,
						updatedAt: input.verifiedAt,
					})
					.where(eq(chatInstallationMemberLink.id, existing.id));
				return;
			}

			await db.insert(chatInstallationMemberLink).values({
				organizationId: input.organizationId,
				installationId: input.installationId,
				userId: input.userId,
				employeeId: input.employeeId,
				externalUserId: input.externalUserId,
				externalUsername: input.externalUsername ?? null,
				externalDisplayName: input.externalDisplayName ?? null,
				externalScope: input.externalScope,
				provenance: input.provenance,
				isCandidateEnrollment: true,
				isActive: true,
				verifiedAt: input.verifiedAt,
				lastSeenAt: input.verifiedAt,
			});
		},

		async getRevisionNumber(organizationId, installationId, revisionId) {
			const [row] = await db
				.select({ revisionNumber: chatInstallationCredentialRevision.revisionNumber })
				.from(chatInstallationCredentialRevision)
				.where(
					and(
						eq(chatInstallationCredentialRevision.id, revisionId),
						eq(chatInstallationCredentialRevision.installationId, installationId),
						eq(chatInstallationCredentialRevision.organizationId, organizationId),
					),
				)
				.limit(1);
			return row?.revisionNumber ?? null;
		},
	};
}

export function resolveTeamsSetupRepository(deps?: TeamsSetupRuntimeDeps): TeamsSetupRepository {
	return deps?.repository ?? createDrizzleTeamsSetupRepository(deps?.db ?? defaultDb);
}

async function defaultRecordAudit(event: TeamsSetupAuditEvent): Promise<void> {
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
			"Failed to record redacted Teams installation audit log",
		);
	}
}

export async function buildTeamsCandidateSetupView(
	installation: TeamsCandidateInstallationRecord,
	deps?: TeamsSetupRuntimeDeps & { organizationName?: string | null; actorUserId?: string | null },
): Promise<TeamsCandidateSetupView> {
	const repository = resolveTeamsSetupRepository(deps);
	const now = deps?.now ? deps.now() : new Date();
	const ttlMs = deps?.verificationTtlMs ?? TEAMS_VERIFICATION_FRESHNESS_MS;

	const generated = generateTeamsAppPackage({
		routeId: installation.routeId,
		microsoftAppId: installation.externalAppId,
		appUrl: resolveAppUrl(deps?.appUrl),
		organizationName: deps?.organizationName,
	});
	const computed = computeTeamsCandidateSetupStatus(installation, now, ttlMs);
	const [revisionNumber, personalConversation] = await Promise.all([
		installation.activeCredentialRevisionId
			? repository.getRevisionNumber(
					installation.organizationId,
					installation.id,
					installation.activeCredentialRevisionId,
				)
			: Promise.resolve(null),
		repository.findCandidatePersonalConversation({
			organizationId: installation.organizationId,
			installationId: installation.id,
			preferredUserId: deps?.actorUserId ?? null,
		}),
	]);

	return {
		installationId: installation.id,
		organizationId: installation.organizationId,
		routeId: installation.routeId,
		status: installation.status,
		verificationState: computed.effectiveVerificationState,
		readyForSwitch: computed.readyForSwitch,
		microsoftAppId: installation.externalAppId,
		microsoftTenantId: installation.externalSpaceId,
		tenantDisplayName: installation.externalSpaceName,
		hasStoredCredentials: Boolean(installation.activeCredentialRevisionId),
		credentialRevisionNumber: revisionNumber,
		messagingEndpointUrl: generated.messagingEndpointUrl,
		manifestJson: generated.manifestJson,
		manifestFileName: generated.manifestFileName,
		packageFileName: generated.packageFileName,
		usesPlaceholderAppId: generated.usesPlaceholderAppId,
		rolloutInstructions: generated.rolloutInstructions,
		hasPrivateReachability: Boolean(personalConversation?.conversationReference),
		privateReachabilityUpdatedAt: personalConversation?.verifiedAt?.toISOString() ?? null,
		enrollmentProofCount: installation.verificationEvidence?.enrollmentProofCount ?? 0,
		steps: computed.steps,
		lastVerifiedAt: installation.lastVerifiedAt?.toISOString() ?? null,
		updatedAt: installation.updatedAt.toISOString(),
	};
}

/**
 * Loads the current candidate single-tenant Teams setup view without creating a new row.
 */
export async function getTeamsCandidateSetupView(
	organizationId: string,
	deps?: TeamsSetupRuntimeDeps & { organizationName?: string | null; actorUserId?: string | null },
): Promise<TeamsCandidateSetupView | null> {
	const repository = resolveTeamsSetupRepository(deps);
	const existing = await repository.findCandidateByOrg(organizationId);
	if (!existing) {
		return null;
	}
	return buildTeamsCandidateSetupView(existing, deps);
}

/**
 * Prepares (or returns an existing) single-tenant Teams candidate installation with a
 * stable, non-secret `routeId`, messaging endpoint, app package manifest, and rollout guide.
 */
export async function prepareTeamsCandidateInstallation(
	input: {
		organizationId: string;
		actorUserId: string;
		organizationName?: string | null;
	},
	deps?: TeamsSetupRuntimeDeps,
): Promise<TeamsCandidateSetupView> {
	const repository = resolveTeamsSetupRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;

	let candidate = await repository.findCandidateByOrg(input.organizationId);
	if (!candidate) {
		candidate = await repository.insertCandidate({
			organizationId: input.organizationId,
			routeId: generateRouteId(),
			createdByUserId: input.actorUserId,
		});

		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_CANDIDATE_PREPARED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "teams",
				routeId: candidate.routeId,
			},
		});
	}

	return buildTeamsCandidateSetupView(candidate, {
		...deps,
		organizationName: input.organizationName,
		actorUserId: input.actorUserId,
	});
}

export type ConfigureTeamsCredentialsResult =
	| { kind: "ok"; view: TeamsCandidateSetupView }
	| {
			kind: "error";
			code:
				| "candidate_not_found"
				| "invalid_app_id_format"
				| "invalid_tenant_id_format"
				| "invalid_app_password_format"
				| "tenant_claimed_by_other_org"
				| "app_claimed_by_other_org"
				| "secret_store_unavailable"
				| "credential_write_failed";
			message: string;
	  };

/**
 * Validates write-only single-tenant Microsoft Teams credentials, enforces external ownership
 * claims (allowing same-org replacement staging in the same Teams tenant while blocking
 * cross-organization collisions), stores an immutable credential revision in Vault/Scaleway,
 * evicts cached adapters for this installation, and resets inbound/proactive proofs.
 * Never returns raw secrets.
 */
export async function configureTeamsCandidateCredentials(
	input: {
		organizationId: string;
		actorUserId: string;
		installationId: string;
		microsoftAppId: string;
		microsoftTenantId: string;
		microsoftAppPassword: string;
		tenantDisplayName?: string | null;
	},
	deps?: TeamsSetupRuntimeDeps,
): Promise<ConfigureTeamsCredentialsResult> {
	const repository = resolveTeamsSetupRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const evictAdapter = deps?.evictAdapter ?? evictTeamsInstallationBotAdapter;
	const now = deps?.now ? deps.now() : new Date();

	const appId = input.microsoftAppId.trim().toLowerCase();
	const tenantId = input.microsoftTenantId.trim().toLowerCase();
	const appPassword = input.microsoftAppPassword.trim();
	const tenantDisplayName = input.tenantDisplayName?.trim() || null;

	if (!isValidGuid(appId)) {
		return {
			kind: "error",
			code: "invalid_app_id_format",
			message: "Microsoft App ID must be a valid GUID.",
		};
	}

	if (!isValidGuid(tenantId)) {
		return {
			kind: "error",
			code: "invalid_tenant_id_format",
			message: "Microsoft Entra Tenant ID must be a valid GUID.",
		};
	}

	if (appPassword.length < 8) {
		return {
			kind: "error",
			code: "invalid_app_password_format",
			message: "Microsoft App Password (client secret) must be at least 8 characters.",
		};
	}

	const candidate = await repository.findCandidateById(input.organizationId, input.installationId);
	if (!candidate) {
		return {
			kind: "error",
			code: "candidate_not_found",
			message: "Candidate Teams installation was not found.",
		};
	}

	// Ownership claim 1: Microsoft Teams tenant (same org may stage a replacement in its own tenant)
	const tenantClaim = await repository.acquireClaim({
		organizationId: input.organizationId,
		claimKind: "tenant",
		externalId: tenantId,
		verifiedAt: now,
	});
	if (tenantClaim.kind === "conflict") {
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "teams",
				step: "identity",
				failureCode: "tenant_claimed_by_other_org",
				externalSpaceId: tenantId,
			},
		});
		return {
			kind: "error",
			code: "tenant_claimed_by_other_org",
			message: "This Microsoft Teams tenant is already connected to another Z8 organization.",
		};
	}

	// Ownership claim 2: single-tenant Teams application ID
	const appClaim = await repository.acquireClaim({
		organizationId: input.organizationId,
		claimKind: "bot",
		externalId: appId,
		verifiedAt: now,
	});
	if (appClaim.kind === "conflict") {
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "teams",
				step: "identity",
				failureCode: "app_claimed_by_other_org",
				externalAppId: appId,
			},
		});
		return {
			kind: "error",
			code: "app_claimed_by_other_org",
			message: "This Microsoft Teams App ID is already claimed by another Z8 organization.",
		};
	}

	// Persist immutable credential revision without altering legacy deployments or prior revisions
	let revision: Awaited<ReturnType<typeof storeInstallationCredentialRevision>>;
	try {
		revision = await storeInstallationCredentialRevision(
			{
				organizationId: input.organizationId,
				installationId: candidate.id,
				provider: "teams",
				secrets: {
					microsoft_app_id: appId,
					microsoft_tenant_id: tenantId,
					microsoft_app_password: appPassword,
				},
				status: "staged",
				externalIdentityFingerprint: `teams:${tenantId}:${appId}`,
				verifiedAt: null,
				createdByUserId: input.actorUserId,
			},
			{
				db: deps?.db,
				repository: deps?.revisionRepository,
				storeSecret: deps?.storeSecret,
				deleteSecret: deps?.deleteSecret,
				secretStoreProvider: deps?.secretStoreProvider,
			},
		);
	} catch (error) {
		const isUnavailable = isSecretStoreUnavailableError(error);
		const failureCode = isUnavailable ? "secret_store_unavailable" : "credential_write_failed";
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "teams",
				step: "credentials",
				failureCode,
			},
		});
		return {
			kind: "error",
			code: failureCode,
			message: isUnavailable
				? "The organization secret store is currently unavailable. Existing Teams delivery is unchanged."
				: "Failed to store Teams credentials securely. Existing Teams delivery is unchanged.",
		};
	}

	// Evict any cached adapters for prior revisions of this candidate installation
	evictAdapter(candidate.id);

	// New credential revision requires fresh authenticated inbound proof and proactive private test
	const evidence: ChatVerificationEvidence = {
		source: "verified_setup",
		configuredAt: now.toISOString(),
		tenantId,
		applicationId: appId,
		serviceUrlRecorded: false,
		secretStoreStatus: "available",
		identityVerifiedAt: now.toISOString(),
		identityRevisionId: revision.id,
		signedEventVerifiedAt: null,
		signedEventRevisionId: null,
		signedEventType: null,
		signedEventExpiresAt: null,
		privateDeliveryVerifiedAt: null,
		privateDeliveryRevisionId: null,
		privateDeliveryTargetUserId: null,
		privateDeliveryChannelId: null,
		privateDeliveryExpiresAt: null,
		lastFailureStep: null,
		lastFailureCode: null,
		lastFailureAt: null,
		enrollmentProofCount: candidate.verificationEvidence?.enrollmentProofCount ?? 0,
		lastEnrollmentProofAt: candidate.verificationEvidence?.lastEnrollmentProofAt ?? null,
	};

	const updated = await repository.updateCandidate(input.organizationId, candidate.id, {
		externalAppId: appId,
		externalBotId: appId,
		externalDisplayName: tenantDisplayName ?? candidate.externalDisplayName ?? tenantId,
		externalSpaceId: tenantId,
		externalSpaceName: tenantDisplayName ?? candidate.externalSpaceName,
		receiverScope: `teams-bot:${appId}:tenant:${tenantId}`,
		spaceClaimId: tenantClaim.claimId,
		botClaimId: appClaim.claimId,
		activeCredentialRevisionId: revision.id,
		verificationState: "pending",
		verificationEvidence: evidence,
	});

	await recordAudit({
		action: AuditAction.CHAT_INSTALLATION_CREDENTIALS_STORED,
		actorId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: candidate.id,
		metadata: {
			provider: "teams",
			revisionId: revision.id,
			revisionNumber: revision.revisionNumber,
			secretStoreProvider: revision.secretStoreProvider,
			externalAppId: appId,
			externalSpaceId: tenantId,
		},
	});

	const view = await buildTeamsCandidateSetupView(updated, {
		...deps,
		actorUserId: input.actorUserId,
	});
	return { kind: "ok", view };
}

export type SendTeamsCandidateProactiveTestResult =
	| { kind: "ok"; view: TeamsCandidateSetupView; conversationId: string; activityId: string | null }
	| {
			kind: "error";
			code:
				| "candidate_not_found"
				| "credentials_not_configured"
				| "credentials_missing"
				| "secret_store_unavailable"
				| "missing_private_reachability"
				| "tenant_mismatch"
				| "private_delivery_failed";
			message: string;
	  };

function formatTeamsFailureCode(result: Exclude<TeamsSendResult, { kind: "ok" }>): string {
	if (result.kind === "unknown") {
		return result.reason;
	}
	return result.code ? `teams_${result.status}_${result.code}` : `teams_${result.status}`;
}

/**
 * Sends a synthetic proactive private test message using the candidate installation's
 * revision-scoped SingleTenant CloudAdapter and stored candidate personal conversation reference.
 * Never reads legacy `teams_conversation` or sends production notifications/approvals.
 */
export async function sendTeamsCandidateProactiveTestMessage(
	input: {
		organizationId: string;
		actorUserId: string;
		installationId: string;
	},
	deps?: TeamsSetupRuntimeDeps,
): Promise<SendTeamsCandidateProactiveTestResult> {
	const repository = resolveTeamsSetupRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const getAdapter = deps?.getAdapter ?? getTeamsInstallationBotAdapter;
	const sendProactive = deps?.sendProactiveTest ?? sendTeamsProactiveTestMessage;
	const now = deps?.now ? deps.now() : new Date();
	const ttlMs = deps?.verificationTtlMs ?? TEAMS_VERIFICATION_FRESHNESS_MS;

	const candidate = await repository.findCandidateById(input.organizationId, input.installationId);
	if (!candidate) {
		return {
			kind: "error",
			code: "candidate_not_found",
			message: "Candidate Teams installation was not found.",
		};
	}

	if (
		!candidate.activeCredentialRevisionId ||
		!isValidGuid(candidate.externalAppId) ||
		!isValidGuid(candidate.externalSpaceId)
	) {
		return {
			kind: "error",
			code: "credentials_not_configured",
			message:
				"Save your single-tenant Teams App ID, Tenant ID, and App Password before testing proactive delivery.",
		};
	}

	const credResult = await readInstallationCredentialRevision(
		{
			organizationId: input.organizationId,
			installationId: candidate.id,
			revisionId: candidate.activeCredentialRevisionId,
		},
		{
			db: deps?.db,
			repository: deps?.revisionRepository,
			readSecret: deps?.readSecret,
		},
	);

	if (credResult.kind === "unavailable") {
		return {
			kind: "error",
			code: "secret_store_unavailable",
			message: "The organization secret store is temporarily unavailable. Retry shortly.",
		};
	}

	if (credResult.kind !== "ok" || !credResult.secrets.microsoft_app_password) {
		return {
			kind: "error",
			code: "credentials_missing",
			message:
				"Stored Teams credentials could not be found. Re-enter and save your single-tenant credentials.",
		};
	}

	const storedConversation = await repository.findCandidatePersonalConversation({
		organizationId: input.organizationId,
		installationId: candidate.id,
		preferredUserId: input.actorUserId,
	});

	if (!storedConversation?.conversationReference) {
		const failedEvidence: ChatVerificationEvidence = {
			...(candidate.verificationEvidence ?? { source: "verified_setup" }),
			source: "verified_setup",
			lastFailureStep: "private_test",
			lastFailureCode: "missing_private_reachability",
			lastFailureAt: now.toISOString(),
		};
		await repository.updateCandidate(input.organizationId, candidate.id, {
			verificationState: "failed",
			verificationEvidence: failedEvidence,
		});
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "teams",
				step: "private_test",
				failureCode: "missing_private_reachability",
			},
		});
		return {
			kind: "error",
			code: "missing_private_reachability",
			message:
				"No personal chat reachability has been captured for this candidate Teams app yet. Send a 1:1 message to the candidate bot in Microsoft Teams first, then retry.",
		};
	}

	const conversationRef =
		storedConversation.conversationReference as unknown as ConversationReference;
	const refTenantId = conversationRef.conversation?.tenantId?.trim().toLowerCase();
	if (refTenantId && refTenantId !== candidate.externalSpaceId.trim().toLowerCase()) {
		return {
			kind: "error",
			code: "tenant_mismatch",
			message:
				"The stored candidate conversation belongs to a different Microsoft Teams tenant. Message the candidate bot from the configured tenant and retry.",
		};
	}

	const adapter = getAdapter({
		installationId: candidate.id,
		credentialRevisionId: candidate.activeCredentialRevisionId,
		appId: candidate.externalAppId,
		appPassword: credResult.secrets.microsoft_app_password,
		tenantId: candidate.externalSpaceId,
	});

	const testMessage =
		"Z8 single-tenant Teams verification test — this synthetic private message confirms your organization-owned Teams app can proactively reach employees. Live notifications and approvals remain unchanged until you switch.";

	const sendResult = await sendProactive(
		adapter,
		candidate.externalAppId,
		conversationRef,
		testMessage,
	);

	if (sendResult.kind !== "ok") {
		const failureCode = formatTeamsFailureCode(sendResult);
		const failedEvidence: ChatVerificationEvidence = {
			...(candidate.verificationEvidence ?? { source: "verified_setup" }),
			source: "verified_setup",
			lastFailureStep: "private_test",
			lastFailureCode: failureCode,
			lastFailureAt: now.toISOString(),
		};
		await repository.updateCandidate(input.organizationId, candidate.id, {
			verificationState: "failed",
			verificationEvidence: failedEvidence,
		});
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "teams",
				step: "private_test",
				failureCode,
			},
		});
		return {
			kind: "error",
			code: "private_delivery_failed",
			message:
				"Could not deliver the synthetic proactive private test message to Microsoft Teams. Verify your App Password and bot messaging permissions, then retry.",
		};
	}

	await repository.upsertCandidatePersonalConversation({
		organizationId: input.organizationId,
		installationId: candidate.id,
		userId: storedConversation.userId,
		externalUserId: storedConversation.externalUserId,
		externalConversationId: storedConversation.externalConversationId,
		conversationReference: storedConversation.conversationReference,
		reachabilityStatus: "reachable",
		verifiedAt: now,
	});

	const nextEvidence: ChatVerificationEvidence = {
		...(candidate.verificationEvidence ?? { source: "verified_setup" }),
		source: "verified_setup",
		privateDeliveryVerifiedAt: now.toISOString(),
		privateDeliveryRevisionId: candidate.activeCredentialRevisionId,
		privateDeliveryTargetUserId: storedConversation.externalUserId ?? input.actorUserId,
		privateDeliveryChannelId: storedConversation.externalConversationId,
		privateDeliveryExpiresAt: new Date(now.getTime() + ttlMs).toISOString(),
		...(candidate.verificationEvidence?.lastFailureStep === "private_test"
			? { lastFailureStep: null, lastFailureCode: null, lastFailureAt: null }
			: {}),
	};

	const nextStatus = computeTeamsCandidateSetupStatus(
		{
			...candidate,
			verificationEvidence: nextEvidence,
		},
		now,
		ttlMs,
	);

	const updated = await repository.updateCandidate(input.organizationId, candidate.id, {
		verificationEvidence: nextEvidence,
		verificationState: nextStatus.effectiveVerificationState,
		lastVerifiedAt: nextStatus.readyForSwitch ? now : candidate.lastVerifiedAt,
	});

	await recordAudit({
		action: AuditAction.CHAT_INSTALLATION_TEST_MESSAGE_SENT,
		actorId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: candidate.id,
		metadata: {
			provider: "teams",
			revisionId: candidate.activeCredentialRevisionId,
			externalConversationId: storedConversation.externalConversationId,
			readyForSwitch: nextStatus.readyForSwitch,
		},
	});

	const view = await buildTeamsCandidateSetupView(updated, {
		...deps,
		actorUserId: input.actorUserId,
	});

	return {
		kind: "ok",
		view,
		conversationId: storedConversation.externalConversationId,
		activityId: sendResult.activityId,
	};
}
