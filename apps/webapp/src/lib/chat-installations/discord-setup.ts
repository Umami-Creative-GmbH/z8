import { and, asc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	type ChatConversationReachabilityStatus,
	type ChatInstallationStatus,
	type ChatOwnershipClaimKind,
	type ChatVerificationEvidence,
	type ChatVerificationState,
	chatInstallation,
	chatInstallationCredentialRevision,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import {
	openDMChannelWithOutcome,
	sendMessageWithOutcome,
	type VerifyBotApplicationResult,
	verifyBotApplication,
} from "@/lib/discord/api";
import {
	classifyDiscordDmFailure,
	type DiscordDmFailureCode,
	type DiscordDmRecoveryHint,
} from "@/lib/discord/signature";
import { registerDiscordSlashCommands } from "@/lib/discord/slash-commands";
import { createLogger } from "@/lib/logger";
import { isSecretStoreUnavailableError, type SecretStoreProviderKind } from "@/lib/vault";
import { acquireExternalOwnershipClaim } from "./backfill";
import {
	type CredentialRevisionRepository,
	readInstallationCredentialRevision,
	storeInstallationCredentialRevision,
} from "./credential-revisions";
import { upsertInstallationConversation } from "./inventory";
import { isValidDiscordSnowflake } from "./legacy-analysis";
import {
	type ChatRecoveryRuntimeDeps,
	type RotateChatInstallationCredentialsResult,
	rotateChatInstallationCredentials,
	type VerifyRotationIdentityResult,
} from "./recovery-lifecycle";
import {
	computeExpiryIso,
	defaultRecordAudit,
	generateRouteId,
	isFreshTimestamp,
	resolveAppUrl,
} from "./setup-utils";
import type { ChatInstallationsDb } from "./types";

const logger = createLogger("DiscordCandidateSetup");

/**
 * Freshness window for candidate Discord verification proofs (signed interaction endpoint
 * PING and synthetic private DM delivery). Older proofs expire and require re-verification.
 */
export const DISCORD_VERIFICATION_FRESHNESS_MS = 24 * 60 * 60 * 1000;

const HEX_PUBLIC_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

export type DiscordVerificationStepStatus = "passed" | "pending" | "failed" | "expired";

export interface DiscordVerificationStepView {
	status: DiscordVerificationStepStatus;
	verifiedAt: string | null;
	expiresAt: string | null;
	detail: string | null;
	failureCode: string | null;
	recoveryHint?: string | null;
	canRetry?: boolean;
}

export interface DiscordCandidateSetupView {
	installationId: string;
	organizationId: string;
	routeId: string;
	status: ChatInstallationStatus;
	verificationState: ChatVerificationState;
	readyForSwitch: boolean;
	externalAppId: string | null;
	externalDisplayName: string | null;
	hasStoredCredentials: boolean;
	credentialRevisionNumber: number | null;
	interactionEndpointUrl: string;
	steps: {
		applicationIdentity: DiscordVerificationStepView;
		signedInteractionEndpoint: DiscordVerificationStepView;
		commandRegistration: DiscordVerificationStepView;
		privateDmDelivery: DiscordVerificationStepView;
	};
	lastVerifiedAt: string | null;
	updatedAt: string;
}

export interface DiscordCandidateInstallationRecord {
	id: string;
	organizationId: string;
	provider: "discord";
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
	retirementDeadlineAt: Date | null;
	retiredAt: Date | null;
	revokedAt: Date | null;
	endpointGeneration: number;
	createdByUserId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface DiscordSetupRepository {
	findCandidateByOrg(organizationId: string): Promise<DiscordCandidateInstallationRecord | null>;
	findCandidateById(
		organizationId: string,
		installationId: string,
	): Promise<DiscordCandidateInstallationRecord | null>;
	findInstallationById(
		organizationId: string,
		installationId: string,
	): Promise<DiscordCandidateInstallationRecord | null>;
	findInstallationByRouteId(routeId: string): Promise<DiscordCandidateInstallationRecord | null>;
	insertCandidate(input: {
		organizationId: string;
		routeId: string;
		createdByUserId: string | null;
	}): Promise<DiscordCandidateInstallationRecord>;
	updateInstallation(
		organizationId: string,
		installationId: string,
		patch: Partial<
			Pick<
				DiscordCandidateInstallationRecord,
				| "externalAppId"
				| "externalBotId"
				| "externalBotUsername"
				| "externalDisplayName"
				| "receiverScope"
				| "botClaimId"
				| "activeCredentialRevisionId"
				| "verificationState"
				| "verificationEvidence"
				| "lastVerifiedAt"
			>
		>,
	): Promise<DiscordCandidateInstallationRecord>;
	acquireClaim(input: {
		organizationId: string;
		claimKind: ChatOwnershipClaimKind;
		externalId: string;
		verifiedAt: Date;
	}): Promise<{ kind: "acquired"; claimId: string } | { kind: "conflict" }>;
	upsertCandidateConversation(input: {
		organizationId: string;
		installationId: string;
		userId: string;
		externalUserId: string;
		externalConversationId: string;
		reachabilityStatus: ChatConversationReachabilityStatus;
		reachabilityReason?: string | null;
		verifiedAt: Date | null;
	}): Promise<void>;
	getRevisionNumber(
		organizationId: string,
		installationId: string,
		revisionId: string,
	): Promise<number | null>;
}

export type SendDiscordPrivateDmResult =
	| { kind: "ok"; channelId: string; messageId: string }
	| {
			kind: "failed";
			code: DiscordDmFailureCode;
			recoveryHint: DiscordDmRecoveryHint;
			isPrivacyOrPrerequisiteBlock: boolean;
			channelId: string | null;
			message: string;
	  };

export interface DiscordSetupAuditEvent {
	action: AuditAction;
	actorId: string;
	organizationId: string;
	targetId: string;
	metadata: Record<string, unknown>;
}

export interface DiscordSetupRuntimeDeps {
	db?: ChatInstallationsDb;
	repository?: DiscordSetupRepository;
	revisionRepository?: CredentialRevisionRepository;
	storeSecret?: (organizationId: string, key: string, value: string) => Promise<void>;
	readSecret?: (organizationId: string, key: string) => Promise<string | null>;
	deleteSecret?: (organizationId: string, key: string) => Promise<void>;
	secretStoreProvider?: SecretStoreProviderKind;
	verifyBotApplication?: (botToken: string) => Promise<VerifyBotApplicationResult>;
	registerSlashCommands?: (botToken: string, applicationId: string) => Promise<boolean>;
	sendPrivateDm?: (
		botToken: string,
		input: { discordUserId: string; content: string },
	) => Promise<SendDiscordPrivateDmResult>;
	recordAudit?: (event: DiscordSetupAuditEvent) => Promise<void>;
	appUrl?: string;
	verificationTtlMs?: number;
	now?: () => Date;
}

/**
 * Builds the non-secret installation-scoped Interactions Endpoint URL configured
 * in the Discord Developer Portal.
 */
export function buildDiscordInteractionEndpointUrl(routeId: string, appUrl?: string): string {
	const baseUrl = resolveAppUrl(appUrl);
	return `${baseUrl}/api/discord/installations/${encodeURIComponent(routeId)}/interactions`;
}

/**
 * Evaluates step-by-step readiness for a candidate Discord installation.
 *
 * CRITICAL:
 * - A signed `PING` on the interaction endpoint NEVER establishes private DM reachability
 *   and NEVER marks `readyForSwitch = true` on its own.
 * - Slash command registration is tracked independently with retry support so partial
 *   failures are clearly surfaced without discarding verified identity or endpoint proofs.
 * - `readyForSwitch = true` requires:
 *   1) Verified Discord application identity & stored immutable credential revision,
 *   2) Fresh Ed25519-signed interaction endpoint proof (`PING`), AND
 *   3) Fresh synthetic private DM delivery confirmation.
 */
export function computeDiscordCandidateSetupStatus(
	installation: Pick<
		DiscordCandidateInstallationRecord,
		"activeCredentialRevisionId" | "externalAppId" | "externalDisplayName" | "verificationEvidence"
	>,
	now: Date = new Date(),
	ttlMs: number = DISCORD_VERIFICATION_FRESHNESS_MS,
): {
	readyForSwitch: boolean;
	effectiveVerificationState: ChatVerificationState;
	steps: DiscordCandidateSetupView["steps"];
} {
	const evidence = installation.verificationEvidence;
	const activeRevId = installation.activeCredentialRevisionId;

	const identityPassed = Boolean(
		activeRevId &&
		installation.externalAppId &&
		evidence?.identityVerifiedAt &&
		evidence.identityRevisionId === activeRevId,
	);
	const applicationIdentity: DiscordVerificationStepView = identityPassed
		? {
				status: "passed",
				verifiedAt: evidence?.identityVerifiedAt ?? null,
				expiresAt: null,
				detail: installation.externalDisplayName
					? `${installation.externalDisplayName} (${installation.externalAppId})`
					: installation.externalAppId,
				failureCode: null,
			}
		: evidence?.lastFailureStep === "identity" || evidence?.lastFailureStep === "credentials"
			? {
					status: "failed",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: evidence.lastFailureCode ?? "identity_verification_failed",
				}
			: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
				};

	const signedMatchesRev = Boolean(
		activeRevId &&
		evidence?.signedEventVerifiedAt &&
		evidence.signedEventRevisionId === activeRevId,
	);
	const signedFresh =
		signedMatchesRev &&
		isFreshTimestamp(evidence?.signedEventVerifiedAt, evidence?.signedEventExpiresAt, now, ttlMs);
	const signedInteractionEndpoint: DiscordVerificationStepView = signedFresh
		? {
				status: "passed",
				verifiedAt: evidence?.signedEventVerifiedAt ?? null,
				expiresAt: evidence?.signedEventExpiresAt ?? null,
				detail: evidence?.signedEventType ?? "PING",
				failureCode: null,
			}
		: signedMatchesRev
			? {
					status: "expired",
					verifiedAt: evidence?.signedEventVerifiedAt ?? null,
					expiresAt: evidence?.signedEventExpiresAt ?? null,
					detail: evidence?.signedEventType ?? "PING",
					failureCode: "signed_endpoint_expired",
				}
			: evidence?.lastFailureStep === "signed_event"
				? {
						status: "failed",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode: evidence.lastFailureCode ?? "application_id_mismatch",
					}
				: {
						status: "pending",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode: null,
					};

	const commandsRegistered = Boolean(
		activeRevId &&
		evidence?.commandsRegistrationStatus === "registered" &&
		evidence.commandsRegisteredAt &&
		evidence.commandsRegisteredRevisionId === activeRevId,
	);
	const commandsFailed = Boolean(activeRevId && evidence?.commandsRegistrationStatus === "failed");
	const commandRegistration: DiscordVerificationStepView = commandsRegistered
		? {
				status: "passed",
				verifiedAt: evidence?.commandsRegisteredAt ?? null,
				expiresAt: null,
				detail: null,
				failureCode: null,
				canRetry: Boolean(activeRevId),
			}
		: commandsFailed
			? {
					status: "failed",
					verifiedAt: null,
					expiresAt: null,
					detail: evidence?.commandsRegistrationAttemptedAt ?? null,
					failureCode: evidence?.commandsRegistrationErrorCode ?? "command_registration_failed",
					canRetry: Boolean(activeRevId),
				}
			: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
					canRetry: Boolean(activeRevId),
				};

	const dmMatchesRev = Boolean(
		activeRevId &&
		evidence?.privateDeliveryVerifiedAt &&
		evidence.privateDeliveryRevisionId === activeRevId,
	);
	const dmFresh =
		dmMatchesRev &&
		isFreshTimestamp(
			evidence?.privateDeliveryVerifiedAt,
			evidence?.privateDeliveryExpiresAt,
			now,
			ttlMs,
		);
	const privateDmDelivery: DiscordVerificationStepView = dmFresh
		? {
				status: "passed",
				verifiedAt: evidence?.privateDeliveryVerifiedAt ?? null,
				expiresAt: evidence?.privateDeliveryExpiresAt ?? null,
				detail: evidence?.privateDeliveryTargetUserId ?? null,
				failureCode: null,
				recoveryHint: null,
			}
		: dmMatchesRev
			? {
					status: "expired",
					verifiedAt: evidence?.privateDeliveryVerifiedAt ?? null,
					expiresAt: evidence?.privateDeliveryExpiresAt ?? null,
					detail: evidence?.privateDeliveryTargetUserId ?? null,
					failureCode: "private_test_expired",
					recoveryHint: null,
				}
			: evidence?.lastFailureStep === "private_test" || evidence?.privateDeliveryErrorCode
				? {
						status: "failed",
						verifiedAt: null,
						expiresAt: null,
						detail: evidence?.privateDeliveryTargetUserId ?? null,
						failureCode:
							evidence?.privateDeliveryErrorCode ??
							evidence?.lastFailureCode ??
							"discord_dm_failed",
						recoveryHint: evidence?.privateDeliveryRecoveryHint ?? null,
					}
				: {
						status: "pending",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode: null,
						recoveryHint: null,
					};

	const readyForSwitch =
		applicationIdentity.status === "passed" &&
		signedInteractionEndpoint.status === "passed" &&
		privateDmDelivery.status === "passed";

	let effectiveVerificationState: ChatVerificationState = "unverified";
	if (readyForSwitch) {
		effectiveVerificationState = "verified";
	} else if (
		signedInteractionEndpoint.status === "expired" ||
		privateDmDelivery.status === "expired"
	) {
		effectiveVerificationState = "expired";
	} else if (
		applicationIdentity.status === "failed" ||
		signedInteractionEndpoint.status === "failed" ||
		privateDmDelivery.status === "failed"
	) {
		effectiveVerificationState = "failed";
	} else if (applicationIdentity.status === "passed") {
		effectiveVerificationState = "pending";
	}

	return {
		readyForSwitch,
		effectiveVerificationState,
		steps: {
			applicationIdentity,
			signedInteractionEndpoint,
			commandRegistration,
			privateDmDelivery,
		},
	};
}

function createDrizzleDiscordSetupRepository(db: ChatInstallationsDb): DiscordSetupRepository {
	return {
		async findCandidateByOrg(organizationId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, "discord"),
						eq(chatInstallation.status, "candidate"),
					),
				)
				.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id))
				.limit(1);
			return (row as DiscordCandidateInstallationRecord | undefined) ?? null;
		},

		async findCandidateById(organizationId, installationId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.id, installationId),
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, "discord"),
						eq(chatInstallation.status, "candidate"),
					),
				)
				.limit(1);
			return (row as DiscordCandidateInstallationRecord | undefined) ?? null;
		},

		async findInstallationById(organizationId, installationId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.id, installationId),
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, "discord"),
					),
				)
				.limit(1);
			return (row as DiscordCandidateInstallationRecord | undefined) ?? null;
		},

		async findInstallationByRouteId(routeId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(and(eq(chatInstallation.routeId, routeId), eq(chatInstallation.provider, "discord")))
				.limit(1);
			return (row as DiscordCandidateInstallationRecord | undefined) ?? null;
		},

		async insertCandidate(input) {
			const [row] = await db
				.insert(chatInstallation)
				.values({
					organizationId: input.organizationId,
					provider: "discord",
					credentialSource: "organization_owned",
					status: "candidate",
					routeId: input.routeId,
					verificationState: "unverified",
					createdByUserId: input.createdByUserId,
				})
				.returning();
			if (!row) {
				throw new Error("Failed to insert candidate Discord installation");
			}
			return row as DiscordCandidateInstallationRecord;
		},

		async updateInstallation(organizationId, installationId, patch) {
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
				throw new Error("Failed to update Discord installation");
			}
			return row as DiscordCandidateInstallationRecord;
		},

		async acquireClaim({ organizationId, claimKind, externalId, verifiedAt }) {
			const result = await acquireExternalOwnershipClaim(
				{
					organizationId,
					provider: "discord",
					claimKind,
					externalId,
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

		async upsertCandidateConversation(input) {
			await upsertInstallationConversation(
				{
					organizationId: input.organizationId,
					installationId: input.installationId,
					userId: input.userId,
					externalUserId: input.externalUserId,
					externalConversationId: input.externalConversationId,
					conversationType: "private",
					reachabilityStatus: input.reachabilityStatus,
					reachabilityReason: input.reachabilityReason ?? null,
					verifiedAt: input.verifiedAt,
					lastUsedAt: input.verifiedAt ?? undefined,
				},
				{ db },
			);
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

export function resolveDiscordSetupRepository(
	deps?: DiscordSetupRuntimeDeps,
): DiscordSetupRepository {
	return deps?.repository ?? createDrizzleDiscordSetupRepository(deps?.db ?? defaultDb);
}

export async function defaultSendDiscordPrivateDm(
	botToken: string,
	input: { discordUserId: string; content: string },
): Promise<SendDiscordPrivateDmResult> {
	const opened = await openDMChannelWithOutcome(botToken, input.discordUserId);
	if (opened.kind !== "ok") {
		const classified = classifyDiscordDmFailure(opened);
		return {
			kind: "failed",
			code: classified.code,
			recoveryHint: classified.recoveryHint,
			isPrivacyOrPrerequisiteBlock: classified.isPrivacyOrPrerequisiteBlock,
			channelId: null,
			message: classified.message,
		};
	}

	const sent = await sendMessageWithOutcome(botToken, opened.result, {
		content: input.content,
		allowed_mentions: { parse: [] },
	});
	if (sent.kind !== "ok") {
		const classified = classifyDiscordDmFailure(sent);
		return {
			kind: "failed",
			code: classified.code,
			recoveryHint: classified.recoveryHint,
			isPrivacyOrPrerequisiteBlock: classified.isPrivacyOrPrerequisiteBlock,
			channelId: opened.result,
			message: classified.message,
		};
	}

	return {
		kind: "ok",
		channelId: sent.result.channel_id,
		messageId: sent.result.id,
	};
}

export async function buildDiscordCandidateSetupView(
	installation: DiscordCandidateInstallationRecord,
	deps?: DiscordSetupRuntimeDeps,
): Promise<DiscordCandidateSetupView> {
	const repository = resolveDiscordSetupRepository(deps);
	const now = deps?.now ? deps.now() : new Date();
	const ttlMs = deps?.verificationTtlMs ?? DISCORD_VERIFICATION_FRESHNESS_MS;

	const computed = computeDiscordCandidateSetupStatus(installation, now, ttlMs);
	const revisionNumber = installation.activeCredentialRevisionId
		? await repository.getRevisionNumber(
				installation.organizationId,
				installation.id,
				installation.activeCredentialRevisionId,
			)
		: null;

	return {
		installationId: installation.id,
		organizationId: installation.organizationId,
		routeId: installation.routeId,
		status: installation.status,
		verificationState: computed.effectiveVerificationState,
		readyForSwitch: computed.readyForSwitch,
		externalAppId: installation.externalAppId,
		externalDisplayName: installation.externalDisplayName,
		hasStoredCredentials: Boolean(installation.activeCredentialRevisionId),
		credentialRevisionNumber: revisionNumber,
		interactionEndpointUrl: buildDiscordInteractionEndpointUrl(installation.routeId, deps?.appUrl),
		steps: computed.steps,
		lastVerifiedAt: installation.lastVerifiedAt?.toISOString() ?? null,
		updatedAt: installation.updatedAt.toISOString(),
	};
}

export async function getDiscordCandidateSetupView(
	organizationId: string,
	deps?: DiscordSetupRuntimeDeps,
): Promise<DiscordCandidateSetupView | null> {
	const repository = resolveDiscordSetupRepository(deps);
	const existing = await repository.findCandidateByOrg(organizationId);
	if (!existing) {
		return null;
	}
	return buildDiscordCandidateSetupView(existing, deps);
}

/**
 * Prepares (or returns an existing) organization-owned Discord candidate installation
 * with a non-secret installation-scoped `routeId` and Interactions Endpoint URL.
 */
export async function prepareDiscordCandidateInstallation(
	input: {
		organizationId: string;
		actorUserId: string;
	},
	deps?: DiscordSetupRuntimeDeps,
): Promise<DiscordCandidateSetupView> {
	const repository = resolveDiscordSetupRepository(deps);
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
				provider: "discord",
				routeId: candidate.routeId,
			},
		});
	}

	return buildDiscordCandidateSetupView(candidate, deps);
}

export type ConfigureDiscordCredentialsResult =
	| { kind: "ok"; view: DiscordCandidateSetupView; commandsRegistered: boolean }
	| {
			kind: "error";
			code:
				| "candidate_not_found"
				| "invalid_bot_token_format"
				| "invalid_application_id_format"
				| "invalid_public_key_format"
				| "invalid_bot_token"
				| "application_id_mismatch"
				| "public_key_mismatch"
				| "app_claimed_by_other_org"
				| "discord_unavailable"
				| "secret_store_unavailable"
				| "credential_write_failed";
			message: string;
	  };

/**
 * Verifies Discord application identity (`GET /applications/@me`), confirms `applicationId`
 * and Ed25519 `publicKey`, acquires a `bot` ownership claim (blocking cross-org collisions
 * while allowing same-org staging), stores an immutable credential revision (`bot_token`,
 * `public_key`), and attempts slash command registration tracked independently.
 */
export async function configureDiscordCandidateCredentials(
	input: {
		organizationId: string;
		actorUserId: string;
		installationId: string;
		botToken: string;
		applicationId: string;
		publicKey: string;
	},
	deps?: DiscordSetupRuntimeDeps,
): Promise<ConfigureDiscordCredentialsResult> {
	const repository = resolveDiscordSetupRepository(deps);
	const verifyApp = deps?.verifyBotApplication ?? verifyBotApplication;
	const registerCommands = deps?.registerSlashCommands ?? registerDiscordSlashCommands;
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const now = deps?.now ? deps.now() : new Date();

	const botToken = input.botToken.trim();
	const applicationId = input.applicationId.trim();
	const publicKey = input.publicKey.trim().toLowerCase();

	if (botToken.length < 10 || /\s/.test(botToken)) {
		return {
			kind: "error",
			code: "invalid_bot_token_format",
			message: "Enter a valid Discord bot token with no whitespace.",
		};
	}

	if (!isValidDiscordSnowflake(applicationId)) {
		return {
			kind: "error",
			code: "invalid_application_id_format",
			message: "Application ID must be a valid numeric Discord snowflake ID.",
		};
	}

	if (!HEX_PUBLIC_KEY_PATTERN.test(publicKey)) {
		return {
			kind: "error",
			code: "invalid_public_key_format",
			message: "Public key must be a 64-character hexadecimal Ed25519 key.",
		};
	}

	const candidate = await repository.findCandidateById(input.organizationId, input.installationId);
	if (!candidate) {
		return {
			kind: "error",
			code: "candidate_not_found",
			message: "Candidate Discord installation was not found.",
		};
	}

	const verification = await verifyApp(botToken);
	if (verification.kind !== "ok") {
		const failureCode =
			verification.kind === "unauthorized" ? "invalid_bot_token" : "discord_unavailable";
		const failedEvidence: ChatVerificationEvidence = {
			...(candidate.verificationEvidence ?? { source: "verified_setup" }),
			source: "verified_setup",
			lastFailureStep: "identity",
			lastFailureCode: failureCode,
			lastFailureAt: now.toISOString(),
		};
		await repository.updateInstallation(input.organizationId, candidate.id, {
			verificationState: "failed",
			verificationEvidence: failedEvidence,
		});
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "discord",
				step: "identity",
				failureCode,
			},
		});
		return {
			kind: "error",
			code: failureCode,
			message:
				failureCode === "invalid_bot_token"
					? "Discord rejected the bot token. Check your bot credentials in the Discord Developer Portal."
					: "Discord API is temporarily unavailable while verifying your application. Please retry.",
		};
	}

	if (verification.application.id !== applicationId) {
		await repository.updateInstallation(input.organizationId, candidate.id, {
			verificationState: "failed",
			verificationEvidence: {
				...(candidate.verificationEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
				lastFailureStep: "identity",
				lastFailureCode: "application_id_mismatch",
				lastFailureAt: now.toISOString(),
			},
		});
		return {
			kind: "error",
			code: "application_id_mismatch",
			message: "Application ID does not match the provided Discord bot token.",
		};
	}

	if (verification.application.verifyKey.toLowerCase() !== publicKey) {
		await repository.updateInstallation(input.organizationId, candidate.id, {
			verificationState: "failed",
			verificationEvidence: {
				...(candidate.verificationEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
				lastFailureStep: "identity",
				lastFailureCode: "public_key_mismatch",
				lastFailureAt: now.toISOString(),
			},
		});
		return {
			kind: "error",
			code: "public_key_mismatch",
			message: "Public key does not match the Discord application's Ed25519 verify key.",
		};
	}

	// Acquire organization-scoped bot ownership claim (blocks cross-org collisions; allows same-org staging)
	const botClaim = await repository.acquireClaim({
		organizationId: input.organizationId,
		claimKind: "bot",
		externalId: verification.application.id,
		verifiedAt: now,
	});
	if (botClaim.kind === "conflict") {
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "discord",
				step: "identity",
				failureCode: "app_claimed_by_other_org",
				externalAppId: verification.application.id,
			},
		});
		return {
			kind: "error",
			code: "app_claimed_by_other_org",
			message: "This Discord application is already claimed by another Z8 organization.",
		};
	}

	// Store immutable credential revision (bot_token + Ed25519 public_key)
	let revision: Awaited<ReturnType<typeof storeInstallationCredentialRevision>>;
	try {
		revision = await storeInstallationCredentialRevision(
			{
				organizationId: input.organizationId,
				installationId: candidate.id,
				provider: "discord",
				secrets: {
					bot_token: botToken,
					public_key: verification.application.verifyKey.toLowerCase(),
				},
				status: "verified",
				externalIdentityFingerprint: `discord:${verification.application.id}`,
				verifiedAt: now,
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
				provider: "discord",
				step: "credentials",
				failureCode,
			},
		});
		return {
			kind: "error",
			code: failureCode,
			message: isUnavailable
				? "The organization secret store is currently unavailable. Existing Discord delivery is unchanged."
				: "Failed to store Discord credentials securely. Existing Discord delivery is unchanged.",
		};
	}

	// Attempt slash command registration independently; failures are tracked & retryable without rollback.
	let commandsRegistered = false;
	try {
		commandsRegistered = await registerCommands(botToken, verification.application.id);
	} catch (error) {
		logger.warn(
			{ error, organizationId: input.organizationId, installationId: candidate.id },
			"Discord slash command registration failed during candidate setup; retryable separately",
		);
		commandsRegistered = false;
	}

	// New revision invalidates prior signed PING & private DM proofs so fresh checks run against it.
	const evidence: ChatVerificationEvidence = {
		source: "verified_setup",
		configuredAt: now.toISOString(),
		applicationId: verification.application.id,
		interactionEndpointConfigured: false,
		secretStoreStatus: "available",
		identityVerifiedAt: now.toISOString(),
		identityRevisionId: revision.id,
		signedEventVerifiedAt: null,
		signedEventRevisionId: null,
		signedEventType: null,
		signedEventExpiresAt: null,
		commandsRegisteredAt: commandsRegistered ? now.toISOString() : null,
		commandsRegisteredRevisionId: commandsRegistered ? revision.id : null,
		commandsRegistrationStatus: commandsRegistered ? "registered" : "failed",
		commandsRegistrationErrorCode: commandsRegistered ? null : "command_registration_failed",
		commandsRegistrationAttemptedAt: now.toISOString(),
		privateDeliveryVerifiedAt: null,
		privateDeliveryRevisionId: null,
		privateDeliveryTargetUserId: null,
		privateDeliveryChannelId: null,
		privateDeliveryExpiresAt: null,
		privateDeliveryErrorCode: null,
		privateDeliveryRecoveryHint: null,
		lastFailureStep: null,
		lastFailureCode: null,
		lastFailureAt: null,
	};

	const updated = await repository.updateInstallation(input.organizationId, candidate.id, {
		externalAppId: verification.application.id,
		externalBotId: verification.application.id,
		externalDisplayName: verification.application.name || verification.application.id,
		receiverScope: `discord-app:${verification.application.id}`,
		botClaimId: botClaim.claimId,
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
			provider: "discord",
			revisionId: revision.id,
			revisionNumber: revision.revisionNumber,
			secretStoreProvider: revision.secretStoreProvider,
			externalAppId: verification.application.id,
			commandsRegistered,
		},
	});

	const view = await buildDiscordCandidateSetupView(updated, deps);
	return { kind: "ok", view, commandsRegistered };
}

export type RetryDiscordCommandRegistrationResult =
	| { kind: "ok"; view: DiscordCandidateSetupView; commandsRegistered: true }
	| {
			kind: "error";
			code:
				| "installation_not_found"
				| "credentials_not_configured"
				| "credentials_missing"
				| "secret_store_unavailable"
				| "command_registration_failed";
			message: string;
			view?: DiscordCandidateSetupView;
	  };

/**
 * Retries Discord global slash command registration independently using the installation's
 * stored credential revision, preserving existing signed-endpoint and private-DM proofs.
 */
export async function retryDiscordCandidateCommandRegistration(
	input: {
		organizationId: string;
		actorUserId: string;
		installationId: string;
	},
	deps?: DiscordSetupRuntimeDeps,
): Promise<RetryDiscordCommandRegistrationResult> {
	const repository = resolveDiscordSetupRepository(deps);
	const registerCommands = deps?.registerSlashCommands ?? registerDiscordSlashCommands;
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const now = deps?.now ? deps.now() : new Date();

	const installation = await repository.findInstallationById(
		input.organizationId,
		input.installationId,
	);
	if (!installation || (installation.status !== "candidate" && installation.status !== "active")) {
		return {
			kind: "error",
			code: "installation_not_found",
			message:
				"Discord installation was not found or cannot register commands in its current state.",
		};
	}

	if (!installation.activeCredentialRevisionId || !installation.externalAppId) {
		return {
			kind: "error",
			code: "credentials_not_configured",
			message: "Save and verify Discord application credentials before registering commands.",
		};
	}

	const credResult = await readInstallationCredentialRevision(
		{
			organizationId: input.organizationId,
			installationId: installation.id,
			revisionId: installation.activeCredentialRevisionId,
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

	if (credResult.kind !== "ok" || !credResult.secrets.bot_token) {
		return {
			kind: "error",
			code: "credentials_missing",
			message: "Stored Discord bot credentials are missing. Re-enter credentials first.",
		};
	}

	let registered = false;
	try {
		registered = await registerCommands(credResult.secrets.bot_token, installation.externalAppId);
	} catch (error) {
		logger.warn(
			{ error, organizationId: input.organizationId, installationId: installation.id },
			"Discord slash command registration retry failed",
		);
		registered = false;
	}

	const previousEvidence = installation.verificationEvidence ?? {
		source: "verified_setup" as const,
	};
	const nextEvidence: ChatVerificationEvidence = {
		...previousEvidence,
		source: "verified_setup",
		commandsRegistrationAttemptedAt: now.toISOString(),
		commandsRegistrationStatus: registered ? "registered" : "failed",
		commandsRegisteredAt: registered
			? now.toISOString()
			: (previousEvidence.commandsRegisteredAt ?? null),
		commandsRegisteredRevisionId: registered
			? installation.activeCredentialRevisionId
			: (previousEvidence.commandsRegisteredRevisionId ?? null),
		commandsRegistrationErrorCode: registered ? null : "command_registration_failed",
	};

	const updated = await repository.updateInstallation(input.organizationId, installation.id, {
		verificationEvidence: nextEvidence,
	});

	if (!registered) {
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: installation.id,
			metadata: {
				provider: "discord",
				step: "command_registration",
				failureCode: "command_registration_failed",
			},
		});
		const view = await buildDiscordCandidateSetupView(updated, deps);
		return {
			kind: "error",
			code: "command_registration_failed",
			message:
				"Discord rejected slash command registration. Verify your bot token and application.commands scope in the Discord Developer Portal, then retry.",
			view,
		};
	}

	const view = await buildDiscordCandidateSetupView(updated, deps);
	return { kind: "ok", view, commandsRegistered: true };
}

export type SendDiscordCandidatePrivateTestResult =
	| { kind: "ok"; view: DiscordCandidateSetupView; channelId: string; messageId: string }
	| {
			kind: "error";
			code:
				| "candidate_not_found"
				| "invalid_discord_user_id"
				| "credentials_not_configured"
				| "credentials_missing"
				| "secret_store_unavailable"
				| DiscordDmFailureCode;
			recoveryHint?: DiscordDmRecoveryHint;
			message: string;
			view?: DiscordCandidateSetupView;
	  };

/**
 * Sends a synthetic private DM test message to the admin's Discord user ID using the
 * candidate's immutable credential revision (`allowed_mentions: { parse: [] }`).
 *
 * Explicitly classifies Discord error `50007` (DM privacy controls blocking DMs) and
 * `50001` (no shared server) with actionable recovery guidance, storing segregated
 * candidate conversation reachability without touching legacy Discord tables.
 */
export async function sendDiscordCandidatePrivateTestMessage(
	input: {
		organizationId: string;
		actorUserId: string;
		installationId: string;
		discordUserId: string;
	},
	deps?: DiscordSetupRuntimeDeps,
): Promise<SendDiscordCandidatePrivateTestResult> {
	const repository = resolveDiscordSetupRepository(deps);
	const sendPrivateDm = deps?.sendPrivateDm ?? defaultSendDiscordPrivateDm;
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const now = deps?.now ? deps.now() : new Date();
	const ttlMs = deps?.verificationTtlMs ?? DISCORD_VERIFICATION_FRESHNESS_MS;

	const discordUserId = input.discordUserId.trim();
	if (!isValidDiscordSnowflake(discordUserId)) {
		return {
			kind: "error",
			code: "invalid_discord_user_id",
			message:
				"Enter a valid numeric Discord user ID (enable Developer Mode in Discord to copy it).",
		};
	}

	const candidate = await repository.findCandidateById(input.organizationId, input.installationId);
	if (!candidate) {
		return {
			kind: "error",
			code: "candidate_not_found",
			message: "Candidate Discord installation was not found.",
		};
	}

	if (!candidate.activeCredentialRevisionId) {
		return {
			kind: "error",
			code: "credentials_not_configured",
			message:
				"Save and verify Discord application credentials before testing private DM delivery.",
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

	if (credResult.kind !== "ok" || !credResult.secrets.bot_token) {
		return {
			kind: "error",
			code: "credentials_missing",
			message: "Stored Discord credentials are missing. Re-enter and verify your bot credentials.",
		};
	}

	const content =
		"Z8 Discord bot verification test — this synthetic private message confirms your organization-owned Discord bot can deliver direct messages. Live notifications and approvals remain unchanged until you switch.";

	const deliveryResult = await sendPrivateDm(credResult.secrets.bot_token, {
		discordUserId,
		content,
	});

	if (deliveryResult.kind !== "ok") {
		if (deliveryResult.isPrivacyOrPrerequisiteBlock) {
			await repository.upsertCandidateConversation({
				organizationId: input.organizationId,
				installationId: candidate.id,
				userId: input.actorUserId,
				externalUserId: discordUserId,
				externalConversationId: deliveryResult.channelId ?? `dm-blocked:${discordUserId}`,
				reachabilityStatus: "action_needed",
				reachabilityReason: deliveryResult.code,
				verifiedAt: null,
			});
		}

		const failedEvidence: ChatVerificationEvidence = {
			...(candidate.verificationEvidence ?? { source: "verified_setup" }),
			source: "verified_setup",
			privateDeliveryTargetUserId: discordUserId,
			privateDeliveryErrorCode: deliveryResult.code,
			privateDeliveryRecoveryHint: deliveryResult.recoveryHint,
			lastFailureStep: "private_test",
			lastFailureCode: deliveryResult.code,
			lastFailureAt: now.toISOString(),
		};

		const updated = await repository.updateInstallation(input.organizationId, candidate.id, {
			verificationState: "failed",
			verificationEvidence: failedEvidence,
		});

		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "discord",
				step: "private_test",
				failureCode: deliveryResult.code,
				recoveryHint: deliveryResult.recoveryHint,
			},
		});

		const view = await buildDiscordCandidateSetupView(updated, deps);
		return {
			kind: "error",
			code: deliveryResult.code,
			recoveryHint: deliveryResult.recoveryHint,
			message: deliveryResult.message,
			view,
		};
	}

	// Store segregated candidate private DM conversation (never touches legacy discord_conversation)
	await repository.upsertCandidateConversation({
		organizationId: input.organizationId,
		installationId: candidate.id,
		userId: input.actorUserId,
		externalUserId: discordUserId,
		externalConversationId: deliveryResult.channelId,
		reachabilityStatus: "reachable",
		reachabilityReason: null,
		verifiedAt: now,
	});

	const nextEvidence: ChatVerificationEvidence = {
		...(candidate.verificationEvidence ?? { source: "verified_setup" }),
		source: "verified_setup",
		privateDeliveryVerifiedAt: now.toISOString(),
		privateDeliveryRevisionId: candidate.activeCredentialRevisionId,
		privateDeliveryTargetUserId: discordUserId,
		privateDeliveryChannelId: deliveryResult.channelId,
		privateDeliveryExpiresAt: computeExpiryIso(now, ttlMs),
		privateDeliveryErrorCode: null,
		privateDeliveryRecoveryHint: null,
		...(candidate.verificationEvidence?.lastFailureStep === "private_test"
			? { lastFailureStep: null, lastFailureCode: null, lastFailureAt: null }
			: {}),
	};

	const nextStatus = computeDiscordCandidateSetupStatus(
		{
			...candidate,
			verificationEvidence: nextEvidence,
		},
		now,
		ttlMs,
	);

	const updated = await repository.updateInstallation(input.organizationId, candidate.id, {
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
			provider: "discord",
			revisionId: candidate.activeCredentialRevisionId,
			targetDiscordUserId: discordUserId,
			readyForSwitch: nextStatus.readyForSwitch,
		},
	});

	const view = await buildDiscordCandidateSetupView(updated, deps);
	return {
		kind: "ok",
		view,
		channelId: deliveryResult.channelId,
		messageId: deliveryResult.messageId,
	};
}

/**
 * Same-app Discord credential rotation: verifies the provided bot token resolves to
 * the exact same Discord `applicationId`, stores a new immutable credential revision
 * (`bot_token` + verified `public_key`), and preserves installation ID, routeId,
 * conversations, employee links, and approval card origin.
 */
export async function rotateDiscordInstallationCredentials(
	input: {
		organizationId: string;
		installationId: string;
		actorUserId: string;
		botToken: string;
		publicKey?: string;
	},
	deps?: ChatRecoveryRuntimeDeps & {
		verifyBotApplication?: (botToken: string) => Promise<VerifyBotApplicationResult>;
	},
): Promise<RotateChatInstallationCredentialsResult> {
	const verifyApp = deps?.verifyBotApplication ?? verifyBotApplication;
	const botToken = input.botToken.trim();
	const providedPublicKey = input.publicKey?.trim().toLowerCase() || null;

	if (botToken.length < 10 || /\s/.test(botToken)) {
		return {
			kind: "refused",
			code: "invalid_bot_token_format",
			message: "Enter a valid Discord bot token with no whitespace.",
		};
	}

	if (providedPublicKey && !HEX_PUBLIC_KEY_PATTERN.test(providedPublicKey)) {
		return {
			kind: "refused",
			code: "invalid_credentials",
			message: "Public key must be a 64-character hexadecimal Ed25519 key.",
		};
	}

	const appCheck = await verifyApp(botToken);
	if (appCheck.kind !== "ok") {
		if (appCheck.kind === "unauthorized") {
			return {
				kind: "refused",
				code: "invalid_bot_token",
				message:
					"Discord rejected the bot token. Check your bot token in the Discord Developer Portal.",
			};
		}
		return {
			kind: "refused",
			code: "provider_unavailable",
			message: "Discord API is temporarily unavailable. Please retry.",
		};
	}

	if (providedPublicKey && appCheck.application.verifyKey.toLowerCase() !== providedPublicKey) {
		return {
			kind: "refused",
			code: "invalid_credentials",
			message: "Public key does not match the Discord application's Ed25519 verify key.",
		};
	}

	const verifiedPublicKey = appCheck.application.verifyKey.toLowerCase();

	return rotateChatInstallationCredentials(
		{
			organizationId: input.organizationId,
			installationId: input.installationId,
			actorUserId: input.actorUserId,
			secrets: {
				bot_token: botToken,
				public_key: verifiedPublicKey,
			},
			verifyIdentity: async (_secrets, installation): Promise<VerifyRotationIdentityResult> => {
				if (!installation.externalAppId) {
					return {
						kind: "mismatch",
						reason: "installation_missing_verified_external_identity",
					};
				}
				if (appCheck.application.id !== installation.externalAppId) {
					return {
						kind: "mismatch",
						reason: "discord_application_id_mismatch",
					};
				}
				return {
					kind: "matched",
					fingerprint: `discord:${appCheck.application.id}`,
					spaceName: appCheck.application.name || installation.externalDisplayName,
				};
			},
		},
		deps,
	);
}
