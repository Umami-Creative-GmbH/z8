import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	type ChatInstallationEndpointState,
	type ChatInstallationStatus,
	type ChatVerificationEvidence,
	type ChatVerificationState,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationCredentialRevision,
	chatInstallationSwitchControl,
	telegramBotConfig,
} from "@/db/schema";
import { env } from "@/env";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { dateFromInstant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	deleteWebhookWithOutcome,
	getMeWithOutcome,
	getWebhookInfoWithOutcome,
	sendMessageWithOutcome,
	setMyCommandsWithOutcome,
	setWebhookWithOutcome,
	type TelegramCallOutcome,
} from "@/lib/telegram/api";
import type {
	TelegramMessage,
	TelegramSendMessageParams,
	TelegramWebhookInfo,
} from "@/lib/telegram/types";
import {
	deleteOrgSecret,
	getOrgSecret,
	isSecretStoreUnavailableError,
	type SecretStoreProviderKind,
} from "@/lib/vault";
import { acquireExternalOwnershipClaim } from "./backfill";
import {
	type CredentialRevisionRepository,
	readInstallationCredentialRevision,
	storeInstallationCredentialRevision,
} from "./credential-revisions";
import { upsertInstallationConversation } from "./inventory";
import { extractTelegramNumericBotId } from "./legacy-analysis";
import {
	buildStableBotKey,
	type ChatRecoveryCleanupJobRecord,
	type ChatRecoveryDb,
	type ChatRecoveryInstallationRecord,
	type ChatRecoveryRuntimeDeps,
	type ProviderEndpointCleanupResult,
	type ProviderEndpointReconcileResult,
	type RotateChatInstallationCredentialsResult,
	rotateChatInstallationCredentials,
	withStableBotEndpointLock,
} from "./recovery-lifecycle";

const logger = createLogger("TelegramCandidateSetup");

/**
 * Freshness window for candidate Telegram verification proofs (authenticated inbound
 * webhook receipt and synthetic private test delivery).
 */
export const TELEGRAM_VERIFICATION_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/**
 * The 11 Telegram bot commands registered via `setMyCommands` for the Telegram command menu.
 */
export const TELEGRAM_BOT_COMMANDS = [
	{ command: "status", description: "Check your current clock-in status" },
	{ command: "clockin", description: "Clock in to start tracking time" },
	{ command: "clockout", description: "Clock out to stop tracking time" },
	{ command: "clockedin", description: "See who's currently clocked in" },
	{ command: "whosout", description: "See who's currently out/on leave" },
	{ command: "pending", description: "See pending approval requests" },
	{ command: "coverage", description: "View staffing coverage" },
	{ command: "openshifts", description: "View open shifts" },
	{ command: "compliance", description: "View compliance issues" },
	{ command: "language", description: "Change your language" },
	{ command: "help", description: "Show available commands" },
] as const;

export type TelegramVerificationStepStatus = "passed" | "pending" | "failed" | "expired";

export interface TelegramVerificationStepView {
	status: TelegramVerificationStepStatus;
	verifiedAt: string | null;
	expiresAt: string | null;
	detail: string | null;
	failureCode: string | null;
}

export interface TelegramCandidateSetupView {
	installationId: string;
	organizationId: string;
	routeId: string;
	status: ChatInstallationStatus;
	verificationState: ChatVerificationState;
	readyForSwitch: boolean;
	externalBotId: string | null;
	externalBotUsername: string | null;
	externalDisplayName: string | null;
	hasStoredCredentials: boolean;
	credentialRevisionNumber: number | null;
	webhookUrl: string;
	webhookRegistered: boolean;
	endpointGeneration: number;
	endpointState: ChatInstallationEndpointState;
	steps: {
		identity: TelegramVerificationStepView;
		webhookReceipt: TelegramVerificationStepView;
		commandRegistration: TelegramVerificationStepView;
		privateDelivery: TelegramVerificationStepView;
	};
	lastVerifiedAt: string | null;
	updatedAt: string;
}

export interface TelegramCandidateInstallationRecord {
	id: string;
	organizationId: string;
	provider: "telegram";
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
	endpointState: ChatInstallationEndpointState;
	createdByUserId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface TelegramSetupRepository {
	findCandidateByOrg(organizationId: string): Promise<TelegramCandidateInstallationRecord | null>;
	findCandidateById(
		organizationId: string,
		installationId: string,
	): Promise<TelegramCandidateInstallationRecord | null>;
	findInstallationById(
		organizationId: string,
		installationId: string,
	): Promise<TelegramCandidateInstallationRecord | null>;
	findInstallationByRouteId(routeId: string): Promise<TelegramCandidateInstallationRecord | null>;
	insertCandidate(input: {
		organizationId: string;
		routeId: string;
		createdByUserId: string | null;
	}): Promise<TelegramCandidateInstallationRecord>;
	updateInstallation(
		organizationId: string,
		installationId: string,
		patch: Partial<
			Pick<
				TelegramCandidateInstallationRecord,
				| "externalBotId"
				| "externalBotUsername"
				| "externalDisplayName"
				| "receiverScope"
				| "botClaimId"
				| "activeCredentialRevisionId"
				| "verificationState"
				| "verificationEvidence"
				| "lastVerifiedAt"
				| "endpointGeneration"
				| "endpointState"
			>
		>,
	): Promise<TelegramCandidateInstallationRecord>;
	acquireBotClaim(input: {
		organizationId: string;
		externalBotId: string;
		verifiedAt: Date;
	}): Promise<{ kind: "acquired"; claimId: string } | { kind: "conflict" }>;
	withEndpointLock<T>(stableBotKey: string, fn: () => Promise<T>): Promise<T>;
	findCandidateConversationForUser(
		organizationId: string,
		installationId: string,
		userId: string,
	): Promise<{ externalConversationId: string; externalUserId: string | null } | null>;
	upsertCandidateConversation(input: {
		organizationId: string;
		installationId: string;
		userId: string;
		externalUserId: string;
		externalConversationId: string;
		reachabilityStatus: "reachable";
		verifiedAt: Date;
	}): Promise<void>;
	getRevisionNumber(
		organizationId: string,
		installationId: string,
		revisionId: string,
	): Promise<number | null>;
}

export interface TelegramSetupAuditEvent {
	action: AuditAction;
	actorId: string;
	organizationId: string;
	targetId: string;
	metadata: Record<string, unknown>;
}

export interface TelegramSetupRuntimeDeps {
	db?: ChatRecoveryDb;
	repository?: TelegramSetupRepository;
	revisionRepository?: CredentialRevisionRepository;
	storeSecret?: (organizationId: string, key: string, value: string) => Promise<void>;
	readSecret?: (organizationId: string, key: string) => Promise<string | null>;
	deleteSecret?: (organizationId: string, key: string) => Promise<void>;
	secretStoreProvider?: SecretStoreProviderKind;
	getMe?: (
		botToken: string,
	) => Promise<TelegramCallOutcome<{ id: number; username?: string; first_name: string }>>;
	setWebhook?: (
		botToken: string,
		url: string,
		secretToken: string,
	) => Promise<TelegramCallOutcome<true>>;
	setMyCommands?: (
		botToken: string,
		commands: readonly { command: string; description: string }[],
	) => Promise<TelegramCallOutcome<true>>;
	deleteWebhook?: (botToken: string) => Promise<TelegramCallOutcome<true>>;
	getWebhookInfo?: (botToken: string) => Promise<TelegramCallOutcome<TelegramWebhookInfo>>;
	sendMessage?: (
		botToken: string,
		params: TelegramSendMessageParams,
	) => Promise<TelegramCallOutcome<TelegramMessage>>;
	recordAudit?: (event: TelegramSetupAuditEvent) => Promise<void>;
	appUrl?: string;
	verificationTtlMs?: number;
	now?: () => Date;
}

const TELEGRAM_TOKEN_FORMAT_PATTERN = /^\d+:[A-Za-z0-9_-]{20,}$/;
const TELEGRAM_CHAT_ID_PATTERN = /^-?\d{1,20}$/;

function getNow(deps?: Pick<TelegramSetupRuntimeDeps, "now">): Date {
	return deps?.now ? deps.now() : dateFromInstant(systemClock.nowInstant());
}

function generateRouteId(): string {
	return randomBytes(18).toString("base64url");
}

function generateWebhookSecret(): string {
	// Telegram `secret_token` accepts 1-256 chars from A-Z, a-z, 0-9, _ and -
	return randomBytes(32).toString("base64url");
}

function normalizeBotToken(raw: string): string {
	return raw.trim().replace(/^bot/i, "");
}

function resolveAppUrl(override?: string): string {
	const raw = (override || env.APP_URL || "https://z8-time.app").trim();
	return raw.replace(/\/+$/, "");
}

export function buildTelegramInstallationWebhookUrl(routeId: string, appUrl?: string): string {
	return `${resolveAppUrl(appUrl)}/api/telegram/installations/${encodeURIComponent(routeId)}/webhook`;
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

function formatTelegramOutcomeFailureCode(
	outcome: Exclude<TelegramCallOutcome<unknown>, { kind: "ok" }>,
): string {
	if (outcome.kind === "unknown") {
		return `telegram_${outcome.reason}`;
	}
	return `telegram_${outcome.errorCode ?? "error"}`;
}

/**
 * Evaluates all 4 independently tracked Telegram candidate verification steps:
 * 1) Bot identity (`getMe` numeric bot ID + revision stored)
 * 2) Authenticated webhook receipt (inbound webhook with matching secret_token & routeId)
 * 3) Command registration (`setMyCommands` for the 11 Z8 commands)
 * 4) Private delivery (synthetic private test message sent to admin's candidate chat)
 */
export function computeTelegramCandidateSetupStatus(
	installation: Pick<
		TelegramCandidateInstallationRecord,
		| "activeCredentialRevisionId"
		| "externalBotId"
		| "externalBotUsername"
		| "externalDisplayName"
		| "verificationEvidence"
	>,
	now: Date = new Date(),
	ttlMs: number = TELEGRAM_VERIFICATION_FRESHNESS_MS,
): {
	readyForSwitch: boolean;
	effectiveVerificationState: ChatVerificationState;
	steps: TelegramCandidateSetupView["steps"];
} {
	const evidence = installation.verificationEvidence;
	const activeRevId = installation.activeCredentialRevisionId;

	// 1. Bot Identity
	const identityPassed = Boolean(
		activeRevId &&
		installation.externalBotId &&
		evidence?.identityVerifiedAt &&
		evidence.identityRevisionId === activeRevId,
	);
	const identityDetail = installation.externalBotUsername
		? `@${installation.externalBotUsername.replace(/^@/, "")} (#${installation.externalBotId})`
		: installation.externalBotId
			? `#${installation.externalBotId}`
			: null;
	const identityStep: TelegramVerificationStepView = identityPassed
		? {
				status: "passed",
				verifiedAt: evidence?.identityVerifiedAt ?? null,
				expiresAt: null,
				detail: identityDetail,
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

	// 2. Authenticated Webhook Receipt (ONLY confirmed when an inbound authenticated webhook arrives!)
	const webhookReceiptMatchesRev = Boolean(
		activeRevId &&
		evidence?.signedEventVerifiedAt &&
		evidence.signedEventRevisionId === activeRevId,
	);
	const webhookReceiptFresh =
		webhookReceiptMatchesRev &&
		isFreshTimestamp(evidence?.signedEventVerifiedAt, evidence?.signedEventExpiresAt, now, ttlMs);
	const webhookRegistrationFailed = Boolean(
		activeRevId &&
		evidence?.webhookRegisteredRevisionId === activeRevId &&
		evidence?.webhookRegistered === false &&
		evidence?.webhookFailureCode,
	);

	const webhookReceiptStep: TelegramVerificationStepView = webhookReceiptFresh
		? {
				status: "passed",
				verifiedAt: evidence?.signedEventVerifiedAt ?? null,
				expiresAt: evidence?.signedEventExpiresAt ?? null,
				detail: evidence?.signedEventType ?? "webhook_update",
				failureCode: null,
			}
		: webhookReceiptMatchesRev
			? {
					status: "expired",
					verifiedAt: evidence?.signedEventVerifiedAt ?? null,
					expiresAt: evidence?.signedEventExpiresAt ?? null,
					detail: evidence?.signedEventType ?? null,
					failureCode: "webhook_receipt_expired",
				}
			: webhookRegistrationFailed || evidence?.lastFailureStep === "webhook"
				? {
						status: "failed",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode:
							evidence?.webhookFailureCode ??
							evidence?.lastFailureCode ??
							"webhook_registration_failed",
					}
				: {
						status: "pending",
						verifiedAt: null,
						expiresAt: null,
						detail: evidence?.webhookRegistered ? "webhook_registered_awaiting_event" : null,
						failureCode: null,
					};

	// 3. Command Registration (11 commands, independently tracked & retryable)
	const commandsMatchesRev = Boolean(
		activeRevId &&
		evidence?.commandsRevisionId === activeRevId &&
		evidence?.commandsRegisteredAt &&
		evidence?.commandsRegistrationStatus !== "failed",
	);
	const commandsFailed = Boolean(
		activeRevId &&
		evidence?.commandsRevisionId === activeRevId &&
		evidence?.commandsRegistrationStatus === "failed",
	);
	const commandRegistrationStep: TelegramVerificationStepView = commandsMatchesRev
		? {
				status: "passed",
				verifiedAt: evidence?.commandsRegisteredAt ?? null,
				expiresAt: null,
				detail: `${TELEGRAM_BOT_COMMANDS.length} commands`,
				failureCode: null,
			}
		: commandsFailed
			? {
					status: "failed",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: evidence?.commandsFailureCode ?? "command_registration_failed",
				}
			: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
				};

	// 4. Synthetic Private Delivery
	const privateDeliveryMatchesRev = Boolean(
		activeRevId &&
		evidence?.privateDeliveryVerifiedAt &&
		evidence.privateDeliveryRevisionId === activeRevId,
	);
	const privateDeliveryFresh =
		privateDeliveryMatchesRev &&
		isFreshTimestamp(
			evidence?.privateDeliveryVerifiedAt,
			evidence?.privateDeliveryExpiresAt,
			now,
			ttlMs,
		);
	const privateDeliveryStep: TelegramVerificationStepView = privateDeliveryFresh
		? {
				status: "passed",
				verifiedAt: evidence?.privateDeliveryVerifiedAt ?? null,
				expiresAt: evidence?.privateDeliveryExpiresAt ?? null,
				detail: evidence?.privateDeliveryChannelId ?? null,
				failureCode: null,
			}
		: privateDeliveryMatchesRev
			? {
					status: "expired",
					verifiedAt: evidence?.privateDeliveryVerifiedAt ?? null,
					expiresAt: evidence?.privateDeliveryExpiresAt ?? null,
					detail: evidence?.privateDeliveryChannelId ?? null,
					failureCode: "private_delivery_expired",
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
		identityStep.status === "passed" &&
		webhookReceiptStep.status === "passed" &&
		commandRegistrationStep.status === "passed" &&
		privateDeliveryStep.status === "passed";

	let effectiveVerificationState: ChatVerificationState = "unverified";
	if (readyForSwitch) {
		effectiveVerificationState = "verified";
	} else if (webhookReceiptStep.status === "expired" || privateDeliveryStep.status === "expired") {
		effectiveVerificationState = "expired";
	} else if (
		identityStep.status === "failed" ||
		webhookReceiptStep.status === "failed" ||
		commandRegistrationStep.status === "failed" ||
		privateDeliveryStep.status === "failed"
	) {
		effectiveVerificationState = "failed";
	} else if (identityStep.status === "passed") {
		effectiveVerificationState = "pending";
	}

	return {
		readyForSwitch,
		effectiveVerificationState,
		steps: {
			identity: identityStep,
			webhookReceipt: webhookReceiptStep,
			commandRegistration: commandRegistrationStep,
			privateDelivery: privateDeliveryStep,
		},
	};
}

function createDrizzleTelegramSetupRepository(db: ChatRecoveryDb): TelegramSetupRepository {
	return {
		async findCandidateByOrg(organizationId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, "telegram"),
						eq(chatInstallation.status, "candidate"),
					),
				)
				.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id))
				.limit(1);
			return (row as TelegramCandidateInstallationRecord | undefined) ?? null;
		},

		async findCandidateById(organizationId, installationId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.id, installationId),
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, "telegram"),
						eq(chatInstallation.status, "candidate"),
					),
				)
				.limit(1);
			return (row as TelegramCandidateInstallationRecord | undefined) ?? null;
		},

		async findInstallationById(organizationId, installationId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.id, installationId),
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, "telegram"),
					),
				)
				.limit(1);
			return (row as TelegramCandidateInstallationRecord | undefined) ?? null;
		},

		async findInstallationByRouteId(routeId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(eq(chatInstallation.routeId, routeId), eq(chatInstallation.provider, "telegram")),
				)
				.limit(1);
			return (row as TelegramCandidateInstallationRecord | undefined) ?? null;
		},

		async insertCandidate(input) {
			const [row] = await db
				.insert(chatInstallation)
				.values({
					organizationId: input.organizationId,
					provider: "telegram",
					credentialSource: "organization_owned",
					status: "candidate",
					routeId: input.routeId,
					verificationState: "unverified",
					createdByUserId: input.createdByUserId,
				})
				.returning();
			if (!row) {
				throw new Error("Failed to insert candidate Telegram installation");
			}
			return row as TelegramCandidateInstallationRecord;
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
				throw new Error("Failed to update Telegram installation");
			}
			return row as TelegramCandidateInstallationRecord;
		},

		async acquireBotClaim({ organizationId, externalBotId, verifiedAt }) {
			const result = await acquireExternalOwnershipClaim(
				{
					organizationId,
					provider: "telegram",
					claimKind: "bot",
					externalId: externalBotId,
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

		async withEndpointLock(stableBotKey, fn) {
			return db.transaction(async (rawTx) => {
				const tx = rawTx as unknown as Pick<ChatRecoveryDb, "execute">;
				return withStableBotEndpointLock(tx, stableBotKey, fn);
			});
		},

		async findCandidateConversationForUser(organizationId, installationId, userId) {
			const [row] = await db
				.select({
					externalConversationId: chatInstallationConversation.externalConversationId,
					externalUserId: chatInstallationConversation.externalUserId,
				})
				.from(chatInstallationConversation)
				.where(
					and(
						eq(chatInstallationConversation.organizationId, organizationId),
						eq(chatInstallationConversation.installationId, installationId),
						eq(chatInstallationConversation.userId, userId),
						eq(chatInstallationConversation.conversationType, "private"),
						eq(chatInstallationConversation.isActive, true),
					),
				)
				.limit(1);
			return row ?? null;
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
					verifiedAt: input.verifiedAt,
					lastUsedAt: input.verifiedAt,
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

export function resolveTelegramSetupRepository(
	deps?: TelegramSetupRuntimeDeps,
): TelegramSetupRepository {
	return deps?.repository ?? createDrizzleTelegramSetupRepository(deps?.db ?? defaultDb);
}

async function defaultRecordAudit(event: TelegramSetupAuditEvent): Promise<void> {
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
			"Failed to record redacted Telegram installation audit event",
		);
	}
}

export async function buildTelegramCandidateSetupView(
	installation: TelegramCandidateInstallationRecord,
	deps?: TelegramSetupRuntimeDeps,
): Promise<TelegramCandidateSetupView> {
	const repository = resolveTelegramSetupRepository(deps);
	const now = getNow(deps);
	const ttlMs = deps?.verificationTtlMs ?? TELEGRAM_VERIFICATION_FRESHNESS_MS;

	const computed = computeTelegramCandidateSetupStatus(installation, now, ttlMs);
	const credentialRevisionNumber = installation.activeCredentialRevisionId
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
		externalBotId: installation.externalBotId,
		externalBotUsername: installation.externalBotUsername,
		externalDisplayName: installation.externalDisplayName,
		hasStoredCredentials: Boolean(installation.activeCredentialRevisionId),
		credentialRevisionNumber,
		webhookUrl: buildTelegramInstallationWebhookUrl(installation.routeId, deps?.appUrl),
		webhookRegistered: Boolean(
			installation.activeCredentialRevisionId &&
			installation.verificationEvidence?.webhookRegistered &&
			installation.verificationEvidence?.webhookRegisteredRevisionId ===
				installation.activeCredentialRevisionId,
		),
		endpointGeneration: installation.endpointGeneration,
		endpointState: installation.endpointState,
		steps: computed.steps,
		lastVerifiedAt: installation.lastVerifiedAt?.toISOString() ?? null,
		updatedAt: installation.updatedAt.toISOString(),
	};
}

export async function getTelegramCandidateSetupView(
	organizationId: string,
	deps?: TelegramSetupRuntimeDeps,
): Promise<TelegramCandidateSetupView | null> {
	const repository = resolveTelegramSetupRepository(deps);
	const candidate = await repository.findCandidateByOrg(organizationId);
	if (!candidate) return null;
	return buildTelegramCandidateSetupView(candidate, deps);
}

/**
 * Prepares (or reuses an existing) candidate organization-owned Telegram installation
 * with a non-secret `routeId` for `/api/telegram/installations/{routeId}/webhook`.
 */
export async function prepareTelegramCandidateInstallation(
	input: {
		organizationId: string;
		actorUserId: string;
	},
	deps?: TelegramSetupRuntimeDeps,
): Promise<TelegramCandidateSetupView> {
	const repository = resolveTelegramSetupRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;

	const existing = await repository.findCandidateByOrg(input.organizationId);
	if (existing) {
		return buildTelegramCandidateSetupView(existing, deps);
	}

	const routeId = generateRouteId();
	const created = await repository.insertCandidate({
		organizationId: input.organizationId,
		routeId,
		createdByUserId: input.actorUserId,
	});

	await recordAudit({
		action: AuditAction.CHAT_INSTALLATION_CANDIDATE_PREPARED,
		actorId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: created.id,
		metadata: {
			provider: "telegram",
			routeId: created.routeId,
		},
	});

	return buildTelegramCandidateSetupView(created, deps);
}

export type ConfigureTelegramCredentialsResult =
	| { kind: "ok"; view: TelegramCandidateSetupView }
	| {
			kind: "error";
			code:
				| "candidate_not_found"
				| "invalid_bot_token_format"
				| "invalid_bot_token"
				| "telegram_unavailable"
				| "bot_ownership_conflict"
				| "secret_store_unavailable"
				| "credential_write_failed";
			message: string;
	  };

/**
 * Configures credentials for a Telegram candidate installation:
 * 1) Validates token format and calls `getMe` to confirm numeric `botId`, `username`, and `first_name`.
 * 2) Acquires the `telegram:bot:<botId>` ownership claim BEFORE mutating Telegram's webhook!
 * 3) Stores an immutable credential revision containing `bot_token` + freshly generated `webhook_secret`.
 * 4) Under `withStableBotEndpointLock`, increments `endpoint_generation` and registers the webhook
 *    at `/api/telegram/installations/{routeId}/webhook` with the revision-bound `secret_token`.
 * 5) Independently attempts `setMyCommands` for the 11 Z8 commands and records its status separately.
 */
export async function configureTelegramCandidateCredentials(
	input: {
		organizationId: string;
		actorUserId: string;
		installationId: string;
		botToken: string;
	},
	deps?: TelegramSetupRuntimeDeps,
): Promise<ConfigureTelegramCredentialsResult> {
	const repository = resolveTelegramSetupRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const now = getNow(deps);

	const candidate = await repository.findCandidateById(input.organizationId, input.installationId);
	if (!candidate) {
		return {
			kind: "error",
			code: "candidate_not_found",
			message: "Candidate Telegram installation not found for this organization.",
		};
	}

	const botToken = normalizeBotToken(input.botToken);
	if (!TELEGRAM_TOKEN_FORMAT_PATTERN.test(botToken)) {
		return {
			kind: "error",
			code: "invalid_bot_token_format",
			message: "Enter a valid BotFather token (for example, 123456789:ABCdef...).",
		};
	}

	// Step 1: Verify bot identity via Telegram `getMe`
	const callGetMe = deps?.getMe ?? getMeWithOutcome;
	const meOutcome = await callGetMe(botToken);
	if (meOutcome.kind !== "ok") {
		const isInvalidToken =
			meOutcome.kind === "failed" && (meOutcome.errorCode === 401 || meOutcome.errorCode === 404);
		const failureCode = isInvalidToken
			? "invalid_bot_token"
			: formatTelegramOutcomeFailureCode(meOutcome);

		await repository.updateInstallation(input.organizationId, candidate.id, {
			verificationState: "failed",
			verificationEvidence: {
				...(candidate.verificationEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
				lastFailureStep: "identity",
				lastFailureCode: failureCode,
				lastFailureAt: now.toISOString(),
			},
		});

		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: { provider: "telegram", step: "identity", failureCode },
		});

		return {
			kind: "error",
			code: isInvalidToken ? "invalid_bot_token" : "telegram_unavailable",
			message: isInvalidToken
				? "Telegram rejected this bot token. Check your token from @BotFather."
				: "Telegram API is temporarily unavailable. Please retry.",
		};
	}

	const botInfo = meOutcome.result;
	const numericBotId = String(botInfo.id);
	const botUsername = botInfo.username?.trim() || null;
	const botDisplayName = botInfo.first_name?.trim() || botUsername || `Bot #${numericBotId}`;
	const receiverScope = `telegram-bot:${numericBotId}`;

	// Step 2: Acquire `bot` ownership claim BEFORE mutating Telegram's webhook!
	const claimResult = await repository.acquireBotClaim({
		organizationId: input.organizationId,
		externalBotId: numericBotId,
		verifiedAt: now,
	});
	if (claimResult.kind === "conflict") {
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: { provider: "telegram", step: "identity", failureCode: "bot_ownership_conflict" },
		});
		return {
			kind: "error",
			code: "bot_ownership_conflict",
			message:
				"This Telegram bot is already claimed by another organization. Create a dedicated bot with @BotFather for this organization.",
		};
	}

	// Step 3: Store immutable credential revision (`bot_token` + freshly generated `webhook_secret`)
	const webhookSecret = generateWebhookSecret();
	let revisionId: string;
	let revisionNumber: number;
	try {
		const revision = await storeInstallationCredentialRevision(
			{
				organizationId: input.organizationId,
				installationId: candidate.id,
				provider: "telegram",
				secrets: {
					bot_token: botToken,
					webhook_secret: webhookSecret,
				},
				status: "verified",
				externalIdentityFingerprint: `telegram:${numericBotId}`,
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
		revisionId = revision.id;
		revisionNumber = revision.revisionNumber;
	} catch (error) {
		const isUnavailable = isSecretStoreUnavailableError(error);
		await repository.updateInstallation(input.organizationId, candidate.id, {
			verificationState: "failed",
			verificationEvidence: {
				...(candidate.verificationEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
				secretStoreStatus: isUnavailable ? "unavailable" : "missing",
				lastFailureStep: "credentials",
				lastFailureCode: isUnavailable ? "secret_store_unavailable" : "credential_write_failed",
				lastFailureAt: now.toISOString(),
			},
		});
		return {
			kind: "error",
			code: isUnavailable ? "secret_store_unavailable" : "credential_write_failed",
			message: isUnavailable
				? "The organization secret store is currently unavailable. Existing connections remain usable."
				: "Failed to store Telegram bot credentials.",
		};
	}

	// Step 4: Register webhook serialized under stable bot identity lock
	const stableBotKey = `telegram:${numericBotId}`;
	const webhookUrl = buildTelegramInstallationWebhookUrl(candidate.routeId, deps?.appUrl);
	const callSetWebhook = deps?.setWebhook ?? setWebhookWithOutcome;
	const callSetMyCommands = deps?.setMyCommands ?? setMyCommandsWithOutcome;

	const webhookOutcome = await repository.withEndpointLock(stableBotKey, async () =>
		callSetWebhook(botToken, webhookUrl, webhookSecret),
	);
	const webhookRegistered = webhookOutcome.kind === "ok";
	const webhookFailureCode =
		webhookOutcome.kind === "ok" ? null : formatTelegramOutcomeFailureCode(webhookOutcome);

	// Step 5: Independently register the 11 Telegram commands
	const commandsOutcome = await callSetMyCommands(botToken, TELEGRAM_BOT_COMMANDS);
	const commandsPassed = commandsOutcome.kind === "ok";
	const commandsFailureCode =
		commandsOutcome.kind === "ok" ? null : formatTelegramOutcomeFailureCode(commandsOutcome);

	const nextGeneration = candidate.endpointGeneration + 1;
	const nextEvidence: ChatVerificationEvidence = {
		source: "verified_setup",
		numericBotId,
		botId: numericBotId,
		botUsername,
		secretStoreStatus: "available",
		identityVerifiedAt: now.toISOString(),
		identityRevisionId: revisionId,
		webhookRegistered,
		webhookRegisteredAt: webhookRegistered ? now.toISOString() : null,
		webhookRegisteredRevisionId: revisionId,
		webhookFailureCode,
		// Reset inbound receipt and private test whenever credentials change so fresh proofs are required
		signedEventVerifiedAt: null,
		signedEventRevisionId: null,
		signedEventType: null,
		signedEventExpiresAt: null,
		commandsRegisteredAt: commandsPassed ? now.toISOString() : null,
		commandsRevisionId: revisionId,
		commandsRegistrationStatus: commandsPassed ? "passed" : "failed",
		commandsFailureCode,
		privateDeliveryVerifiedAt: null,
		privateDeliveryRevisionId: null,
		privateDeliveryTargetUserId: null,
		privateDeliveryChannelId: null,
		privateDeliveryExpiresAt: null,
		lastFailureStep: !webhookRegistered ? "webhook" : !commandsPassed ? "commands" : null,
		lastFailureCode: !webhookRegistered
			? webhookFailureCode
			: !commandsPassed
				? commandsFailureCode
				: null,
		lastFailureAt: !webhookRegistered || !commandsPassed ? now.toISOString() : null,
	};

	const computed = computeTelegramCandidateSetupStatus(
		{
			activeCredentialRevisionId: revisionId,
			externalBotId: numericBotId,
			externalBotUsername: botUsername,
			externalDisplayName: botDisplayName,
			verificationEvidence: nextEvidence,
		},
		now,
		deps?.verificationTtlMs,
	);

	const updated = await repository.updateInstallation(input.organizationId, candidate.id, {
		externalBotId: numericBotId,
		externalBotUsername: botUsername,
		externalDisplayName: botDisplayName,
		receiverScope,
		botClaimId: claimResult.claimId,
		activeCredentialRevisionId: revisionId,
		endpointGeneration: nextGeneration,
		endpointState: webhookRegistered ? "synced" : "uncertain",
		verificationState: computed.effectiveVerificationState,
		verificationEvidence: nextEvidence,
	});

	await recordAudit({
		action: AuditAction.CHAT_INSTALLATION_CREDENTIALS_STORED,
		actorId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: updated.id,
		metadata: {
			provider: "telegram",
			revisionId,
			revisionNumber,
			externalBotId: numericBotId,
			externalBotUsername: botUsername,
			webhookRegistered,
			commandsRegistered: commandsPassed,
			endpointGeneration: nextGeneration,
		},
	});

	return {
		kind: "ok",
		view: await buildTelegramCandidateSetupView(updated, deps),
	};
}

export type RetryTelegramStepResult =
	| { kind: "ok"; view: TelegramCandidateSetupView }
	| {
			kind: "error";
			code:
				| "candidate_not_found"
				| "credentials_not_configured"
				| "credentials_missing"
				| "secret_store_unavailable"
				| "webhook_registration_failed"
				| "command_registration_failed";
			message: string;
	  };

/**
 * Retries serialized Telegram webhook registration for a candidate installation using its
 * active credential revision's `bot_token` and `webhook_secret`.
 */
export async function retryTelegramCandidateWebhookRegistration(
	input: {
		organizationId: string;
		actorUserId: string;
		installationId: string;
	},
	deps?: TelegramSetupRuntimeDeps,
): Promise<RetryTelegramStepResult> {
	const repository = resolveTelegramSetupRepository(deps);
	const now = getNow(deps);

	const candidate = await repository.findCandidateById(input.organizationId, input.installationId);
	if (!candidate) {
		return {
			kind: "error",
			code: "candidate_not_found",
			message: "Candidate Telegram installation not found.",
		};
	}
	if (!candidate.activeCredentialRevisionId) {
		return {
			kind: "error",
			code: "credentials_not_configured",
			message: "Save and verify a Telegram bot token first.",
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
			message: "The organization secret store is currently unavailable.",
		};
	}
	if (
		credResult.kind !== "ok" ||
		!credResult.secrets.bot_token ||
		!credResult.secrets.webhook_secret
	) {
		return {
			kind: "error",
			code: "credentials_missing",
			message: "Stored credentials for this candidate bot are missing. Save a bot token again.",
		};
	}

	const stableBotKey = buildStableBotKey(candidate);
	const webhookUrl = buildTelegramInstallationWebhookUrl(candidate.routeId, deps?.appUrl);
	const callSetWebhook = deps?.setWebhook ?? setWebhookWithOutcome;

	const outcome = await repository.withEndpointLock(stableBotKey, async () =>
		callSetWebhook(credResult.secrets.bot_token, webhookUrl, credResult.secrets.webhook_secret),
	);

	const nextGeneration = candidate.endpointGeneration + 1;
	const passed = outcome.kind === "ok";
	const failureCode = passed ? null : formatTelegramOutcomeFailureCode(outcome);
	const prev = candidate.verificationEvidence;

	const nextEvidence: ChatVerificationEvidence = {
		...(prev ?? { source: "verified_setup" }),
		source: "verified_setup",
		webhookRegistered: passed,
		webhookRegisteredAt: passed ? now.toISOString() : null,
		webhookRegisteredRevisionId: candidate.activeCredentialRevisionId,
		webhookFailureCode: failureCode,
		...(passed && prev?.lastFailureStep === "webhook"
			? { lastFailureStep: null, lastFailureCode: null, lastFailureAt: null }
			: !passed
				? {
						lastFailureStep: "webhook",
						lastFailureCode: failureCode,
						lastFailureAt: now.toISOString(),
					}
				: {}),
	};

	const computed = computeTelegramCandidateSetupStatus(
		{ ...candidate, verificationEvidence: nextEvidence },
		now,
		deps?.verificationTtlMs,
	);

	const updated = await repository.updateInstallation(input.organizationId, candidate.id, {
		endpointGeneration: nextGeneration,
		endpointState: passed ? "synced" : "uncertain",
		verificationEvidence: nextEvidence,
		verificationState: computed.effectiveVerificationState,
		lastVerifiedAt: computed.readyForSwitch ? now : candidate.lastVerifiedAt,
	});

	if (!passed) {
		return {
			kind: "error",
			code: "webhook_registration_failed",
			message: "Telegram could not register the webhook URL. Retry once Telegram is reachable.",
		};
	}

	return {
		kind: "ok",
		view: await buildTelegramCandidateSetupView(updated, deps),
	};
}

/**
 * Independently retries `setMyCommands` for the 11 Z8 Telegram commands without altering
 * bot identity, webhook receipt, or private delivery evidence.
 */
export async function retryTelegramCandidateCommandRegistration(
	input: {
		organizationId: string;
		actorUserId: string;
		installationId: string;
	},
	deps?: TelegramSetupRuntimeDeps,
): Promise<RetryTelegramStepResult> {
	const repository = resolveTelegramSetupRepository(deps);
	const now = getNow(deps);

	const candidate = await repository.findCandidateById(input.organizationId, input.installationId);
	if (!candidate) {
		return {
			kind: "error",
			code: "candidate_not_found",
			message: "Candidate Telegram installation not found.",
		};
	}
	if (!candidate.activeCredentialRevisionId) {
		return {
			kind: "error",
			code: "credentials_not_configured",
			message: "Save and verify a Telegram bot token first.",
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
			message: "The organization secret store is currently unavailable.",
		};
	}
	if (credResult.kind !== "ok" || !credResult.secrets.bot_token) {
		return {
			kind: "error",
			code: "credentials_missing",
			message: "Stored bot token is missing. Save a bot token again.",
		};
	}

	const callSetMyCommands = deps?.setMyCommands ?? setMyCommandsWithOutcome;
	const outcome = await callSetMyCommands(credResult.secrets.bot_token, TELEGRAM_BOT_COMMANDS);
	const passed = outcome.kind === "ok";
	const failureCode = passed ? null : formatTelegramOutcomeFailureCode(outcome);
	const prev = candidate.verificationEvidence;

	const nextEvidence: ChatVerificationEvidence = {
		...(prev ?? { source: "verified_setup" }),
		source: "verified_setup",
		commandsRegisteredAt: passed ? now.toISOString() : null,
		commandsRevisionId: candidate.activeCredentialRevisionId,
		commandsRegistrationStatus: passed ? "passed" : "failed",
		commandsFailureCode: failureCode,
		...(passed && prev?.lastFailureStep === "commands"
			? { lastFailureStep: null, lastFailureCode: null, lastFailureAt: null }
			: !passed
				? {
						lastFailureStep: "commands",
						lastFailureCode: failureCode,
						lastFailureAt: now.toISOString(),
					}
				: {}),
	};

	const computed = computeTelegramCandidateSetupStatus(
		{ ...candidate, verificationEvidence: nextEvidence },
		now,
		deps?.verificationTtlMs,
	);

	const updated = await repository.updateInstallation(input.organizationId, candidate.id, {
		verificationEvidence: nextEvidence,
		verificationState: computed.effectiveVerificationState,
		lastVerifiedAt: computed.readyForSwitch ? now : candidate.lastVerifiedAt,
	});

	if (!passed) {
		return {
			kind: "error",
			code: "command_registration_failed",
			message: "Telegram could not register the bot command menu. Retry command registration.",
		};
	}

	return {
		kind: "ok",
		view: await buildTelegramCandidateSetupView(updated, deps),
	};
}

export type SendTelegramCandidateTestResult =
	| { kind: "ok"; view: TelegramCandidateSetupView; chatId: string; messageId: number }
	| {
			kind: "error";
			code:
				| "candidate_not_found"
				| "credentials_not_configured"
				| "credentials_missing"
				| "secret_store_unavailable"
				| "candidate_chat_required"
				| "invalid_chat_id"
				| "private_delivery_failed";
			message: string;
	  };

/**
 * Sends a synthetic private test message to the admin's verified candidate Telegram chat
 * (NEVER production notifications or approval cards!).
 */
export async function sendTelegramCandidateTestMessage(
	input: {
		organizationId: string;
		actorUserId: string;
		installationId: string;
		chatId?: string | null;
	},
	deps?: TelegramSetupRuntimeDeps,
): Promise<SendTelegramCandidateTestResult> {
	const repository = resolveTelegramSetupRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const now = getNow(deps);
	const ttlMs = deps?.verificationTtlMs ?? TELEGRAM_VERIFICATION_FRESHNESS_MS;

	const candidate = await repository.findCandidateById(input.organizationId, input.installationId);
	if (!candidate) {
		return {
			kind: "error",
			code: "candidate_not_found",
			message: "Candidate Telegram installation not found.",
		};
	}
	if (!candidate.activeCredentialRevisionId) {
		return {
			kind: "error",
			code: "credentials_not_configured",
			message: "Save and verify a Telegram bot token first.",
		};
	}

	const candidateConv = await repository.findCandidateConversationForUser(
		input.organizationId,
		candidate.id,
		input.actorUserId,
	);
	const explicitChatId = input.chatId?.trim() || null;
	const targetChatId = explicitChatId ?? candidateConv?.externalConversationId ?? null;

	if (!targetChatId) {
		return {
			kind: "error",
			code: "candidate_chat_required",
			message:
				"Start a private chat with the replacement Telegram bot and link your account (or provide your verified candidate chat ID) before sending the private test.",
		};
	}

	if (!TELEGRAM_CHAT_ID_PATTERN.test(targetChatId)) {
		return {
			kind: "error",
			code: "invalid_chat_id",
			message: "Enter a valid numeric Telegram private chat ID.",
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
			message: "The organization secret store is currently unavailable.",
		};
	}
	if (credResult.kind !== "ok" || !credResult.secrets.bot_token) {
		return {
			kind: "error",
			code: "credentials_missing",
			message: "Stored bot token is missing. Save a bot token again.",
		};
	}

	const callSendMessage = deps?.sendMessage ?? sendMessageWithOutcome;
	const outcome = await callSendMessage(credResult.secrets.bot_token, {
		chat_id: targetChatId,
		text: "Z8 setup verification test: private delivery with your organization-owned replacement Telegram bot is working. No production notifications or approvals have been switched yet.",
	});

	if (outcome.kind !== "ok") {
		const failureCode = formatTelegramOutcomeFailureCode(outcome);
		await repository.updateInstallation(input.organizationId, candidate.id, {
			verificationState: "failed",
			verificationEvidence: {
				...(candidate.verificationEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
				lastFailureStep: "private_test",
				lastFailureCode: failureCode,
				lastFailureAt: now.toISOString(),
			},
		});
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: { provider: "telegram", step: "private_test", failureCode },
		});
		return {
			kind: "error",
			code: "private_delivery_failed",
			message:
				"Telegram could not deliver the private test message. Confirm you started a private chat with the new bot and try again.",
		};
	}

	const deliveredChatId = String(outcome.result.chat.id);
	const expiresAt = dateFromInstant(
		instantFromDate(now).add({ milliseconds: ttlMs }),
	).toISOString();

	await repository.upsertCandidateConversation({
		organizationId: input.organizationId,
		installationId: candidate.id,
		userId: input.actorUserId,
		externalUserId: candidateConv?.externalUserId ?? deliveredChatId,
		externalConversationId: deliveredChatId,
		reachabilityStatus: "reachable",
		verifiedAt: now,
	});

	const prev = candidate.verificationEvidence;
	const nextEvidence: ChatVerificationEvidence = {
		...(prev ?? { source: "verified_setup" }),
		source: "verified_setup",
		privateDeliveryVerifiedAt: now.toISOString(),
		privateDeliveryRevisionId: candidate.activeCredentialRevisionId,
		privateDeliveryTargetUserId: input.actorUserId,
		privateDeliveryChannelId: deliveredChatId,
		privateDeliveryExpiresAt: expiresAt,
		...(prev?.lastFailureStep === "private_test"
			? { lastFailureStep: null, lastFailureCode: null, lastFailureAt: null }
			: {}),
	};

	const computed = computeTelegramCandidateSetupStatus(
		{ ...candidate, verificationEvidence: nextEvidence },
		now,
		ttlMs,
	);

	const updated = await repository.updateInstallation(input.organizationId, candidate.id, {
		verificationEvidence: nextEvidence,
		verificationState: computed.effectiveVerificationState,
		lastVerifiedAt: computed.readyForSwitch ? now : candidate.lastVerifiedAt,
	});

	await recordAudit({
		action: AuditAction.CHAT_INSTALLATION_TEST_MESSAGE_SENT,
		actorId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: updated.id,
		metadata: {
			provider: "telegram",
			revisionId: candidate.activeCredentialRevisionId,
			readyForSwitch: computed.readyForSwitch,
		},
	});

	return {
		kind: "ok",
		view: await buildTelegramCandidateSetupView(updated, deps),
		chatId: deliveredChatId,
		messageId: outcome.result.message_id,
	};
}

// ============================================
// SAME-BOT CREDENTIAL ROTATION
// ============================================

/**
 * Rotates the BotFather token for an existing organization-owned Telegram installation:
 * - Calls `getMe` and verifies the EXACT same numeric `botId` (`installation.externalBotId`).
 * - Preserves the installation's `webhook_secret` across revisions so Telegram's existing
 *   webhook route (`/api/telegram/installations/{routeId}/webhook`) continues working with
 *   zero webhook URL/secret disruption where Telegram allows!
 * - Preserves installation identity, conversations, member links, and open approval card ownership.
 */
export async function rotateTelegramInstallationCredentials(
	input: {
		organizationId: string;
		installationId: string;
		actorUserId: string;
		botToken: string;
	},
	deps?: TelegramSetupRuntimeDeps & ChatRecoveryRuntimeDeps,
): Promise<RotateChatInstallationCredentialsResult> {
	const repository = resolveTelegramSetupRepository(deps);
	const botToken = normalizeBotToken(input.botToken);
	const callGetMe = deps?.getMe ?? getMeWithOutcome;

	const existing = await repository.findInstallationById(
		input.organizationId,
		input.installationId,
	);

	// Preserve existing webhook_secret from the active revision so Telegram's configured
	// secret_token header keeps validating without requiring a webhook re-registration window.
	let preservedWebhookSecret: string | null = null;
	if (existing?.activeCredentialRevisionId) {
		const credRead = await readInstallationCredentialRevision(
			{
				organizationId: input.organizationId,
				installationId: existing.id,
				revisionId: existing.activeCredentialRevisionId,
			},
			{
				db: deps?.db,
				repository: deps?.revisionRepository,
				readSecret: deps?.readSecret,
			},
		);
		if (credRead.kind === "ok" && credRead.secrets.webhook_secret) {
			preservedWebhookSecret = credRead.secrets.webhook_secret;
		}
	}

	const webhookSecret = preservedWebhookSecret ?? generateWebhookSecret();

	const result = await rotateChatInstallationCredentials(
		{
			organizationId: input.organizationId,
			installationId: input.installationId,
			actorUserId: input.actorUserId,
			secrets: {
				bot_token: botToken,
				webhook_secret: webhookSecret,
			},
			verifyIdentity: async (secrets, installation) => {
				const token = normalizeBotToken(secrets.bot_token ?? "");
				if (!TELEGRAM_TOKEN_FORMAT_PATTERN.test(token)) {
					return {
						kind: "invalid_credentials",
						code: "invalid_bot_token_format",
						message: "Enter a valid BotFather token (for example, 123456789:ABCdef...).",
					};
				}
				if (!installation.externalBotId) {
					return { kind: "mismatch", reason: "installation_missing_bot_id" };
				}

				const meOutcome = await callGetMe(token);
				if (meOutcome.kind !== "ok") {
					const isInvalidToken =
						meOutcome.kind === "failed" &&
						(meOutcome.errorCode === 401 || meOutcome.errorCode === 404);
					if (isInvalidToken) {
						return {
							kind: "invalid_credentials",
							code: "invalid_bot_token",
							message: "Telegram rejected the rotated bot token. Check your token from @BotFather.",
						};
					}
					return {
						kind: "unavailable",
						message: "Telegram API is temporarily unavailable. Please retry.",
					};
				}

				const numericBotId = String(meOutcome.result.id);
				if (numericBotId !== installation.externalBotId) {
					return {
						kind: "mismatch",
						reason: "telegram_bot_id_mismatch",
					};
				}

				return {
					kind: "matched",
					fingerprint: `telegram:${numericBotId}`,
					botUsername: meOutcome.result.username?.trim() || installation.externalBotUsername,
				};
			},
		},
		deps,
	);

	// If we had to generate a fresh webhook_secret because none existed, re-register webhook under lock.
	if (result.kind === "rotated" && !preservedWebhookSecret && existing) {
		const callSetWebhook = deps?.setWebhook ?? setWebhookWithOutcome;
		const webhookUrl = buildTelegramInstallationWebhookUrl(existing.routeId, deps?.appUrl);
		await repository.withEndpointLock(buildStableBotKey(existing), async () =>
			callSetWebhook(botToken, webhookUrl, webhookSecret),
		);
	}

	return result;
}

// ============================================
// GENERATION-FENCED WEBHOOK CLEANUP & RECONCILIATION
// ============================================

async function readTelegramTokenForEndpointOp(
	installation: Pick<
		ChatRecoveryInstallationRecord,
		"id" | "organizationId" | "activeCredentialRevisionId"
	>,
	revisionIdOverride: string | null | undefined,
	deps?: Pick<TelegramSetupRuntimeDeps, "db" | "revisionRepository" | "readSecret">,
): Promise<
	| { kind: "ok"; botToken: string; webhookSecret: string | null }
	| { kind: "missing" }
	| { kind: "unavailable" }
> {
	const targetRevisionId = revisionIdOverride ?? installation.activeCredentialRevisionId;
	if (!targetRevisionId) {
		return { kind: "missing" };
	}

	const readSecret = deps?.readSecret ?? getOrgSecret;
	let revision: { secretKeyPrefix: string; secretKeys: string[]; status: string } | null = null;

	if (deps?.revisionRepository) {
		revision = await deps.revisionRepository.findRevision(
			installation.organizationId,
			installation.id,
			targetRevisionId,
		);
	} else {
		const db = deps?.db ?? defaultDb;
		const [row] = await db
			.select({
				secretKeyPrefix: chatInstallationCredentialRevision.secretKeyPrefix,
				secretKeys: chatInstallationCredentialRevision.secretKeys,
				status: chatInstallationCredentialRevision.status,
			})
			.from(chatInstallationCredentialRevision)
			.where(
				and(
					eq(chatInstallationCredentialRevision.id, targetRevisionId),
					eq(chatInstallationCredentialRevision.installationId, installation.id),
					eq(chatInstallationCredentialRevision.organizationId, installation.organizationId),
				),
			)
			.limit(1);
		revision = row ?? null;
	}

	if (!revision || revision.status === "cleaned_up") {
		return { kind: "missing" };
	}

	const prefix = revision.secretKeyPrefix.replace(/\/+$/, "");
	try {
		const botToken = await readSecret(installation.organizationId, `${prefix}/bot_token`);
		if (!botToken) {
			return { kind: "missing" };
		}
		const webhookSecret = revision.secretKeys.includes("webhook_secret")
			? await readSecret(installation.organizationId, `${prefix}/webhook_secret`)
			: null;
		return { kind: "ok", botToken, webhookSecret };
	} catch (error) {
		if (isSecretStoreUnavailableError(error) || error instanceof Error) {
			return { kind: "unavailable" };
		}
		return { kind: "unavailable" };
	}
}

/**
 * Telegram provider endpoint cleanup callback for `processChatInstallationCleanupJobs`:
 * Runs inside `withStableBotEndpointLock` AFTER generation fencing has passed, calls
 * Telegram `deleteWebhook`, and classifies timeouts as `timeout_uncertain` so
 * `endpoint_state` becomes `"uncertain"` until explicitly reconciled.
 */
export async function cleanupTelegramInstallationWebhook(
	input: {
		installation: ChatRecoveryInstallationRecord;
		job: ChatRecoveryCleanupJobRecord;
	},
	deps?: Pick<
		TelegramSetupRuntimeDeps,
		"db" | "revisionRepository" | "readSecret" | "deleteWebhook"
	>,
): Promise<ProviderEndpointCleanupResult> {
	const tokenResult = await readTelegramTokenForEndpointOp(
		input.installation,
		input.job.credentialRevisionId,
		deps,
	);
	if (tokenResult.kind === "unavailable") {
		return { kind: "failed", errorCode: "secret_store_unavailable" };
	}
	if (tokenResult.kind === "missing") {
		// Token already cleaned up; nothing left to call on Telegram.
		return { kind: "ok" };
	}

	const callDeleteWebhook = deps?.deleteWebhook ?? deleteWebhookWithOutcome;
	const outcome = await callDeleteWebhook(tokenResult.botToken);
	if (outcome.kind === "ok") {
		return { kind: "ok" };
	}
	if (outcome.kind === "unknown") {
		return {
			kind: "timeout_uncertain",
			errorCode: `telegram_${outcome.reason}`,
		};
	}
	return {
		kind: "failed",
		errorCode: `telegram_${outcome.errorCode ?? "error"}`,
	};
}

/**
 * Re-reads Telegram's webhook state (`getWebhookInfo`) and reconciles the installation's
 * webhook (`setWebhook`) to `/api/telegram/installations/{routeId}/webhook` with its
 * active revision's `webhook_secret` before reactivation.
 */
export async function reconcileTelegramInstallationWebhook(
	input: {
		installation: ChatRecoveryInstallationRecord;
		targetGeneration: number;
	},
	deps?: Pick<
		TelegramSetupRuntimeDeps,
		"db" | "revisionRepository" | "readSecret" | "getWebhookInfo" | "setWebhook" | "appUrl"
	>,
): Promise<ProviderEndpointReconcileResult> {
	const tokenResult = await readTelegramTokenForEndpointOp(input.installation, null, deps);
	if (tokenResult.kind === "unavailable") {
		return { kind: "failed", errorCode: "secret_store_unavailable" };
	}
	if (tokenResult.kind === "missing" || !tokenResult.webhookSecret) {
		// If credentials were revoked/cleaned up, reconciliation happens once fresh credentials are provided.
		return { kind: "reconciled" };
	}

	const callGetWebhookInfo = deps?.getWebhookInfo ?? getWebhookInfoWithOutcome;
	const infoOutcome = await callGetWebhookInfo(tokenResult.botToken);
	if (infoOutcome.kind === "unknown") {
		return { kind: "uncertain", errorCode: `telegram_${infoOutcome.reason}` };
	}
	if (infoOutcome.kind === "failed") {
		return { kind: "failed", errorCode: `telegram_${infoOutcome.errorCode ?? "error"}` };
	}

	const expectedUrl = buildTelegramInstallationWebhookUrl(input.installation.routeId, deps?.appUrl);
	const callSetWebhook = deps?.setWebhook ?? setWebhookWithOutcome;
	const setOutcome = await callSetWebhook(
		tokenResult.botToken,
		expectedUrl,
		tokenResult.webhookSecret,
	);
	if (setOutcome.kind === "ok") {
		return { kind: "reconciled" };
	}
	if (setOutcome.kind === "unknown") {
		return { kind: "uncertain", errorCode: `telegram_${setOutcome.reason}` };
	}
	return { kind: "failed", errorCode: `telegram_${setOutcome.errorCode ?? "error"}` };
}

// ============================================
// AUTHORIZED LEGACY SETUP GUARD & DISCONNECT
// ============================================

export type LegacyTelegramSetupGuardResult =
	| { allowed: true }
	| {
			allowed: false;
			code: "legacy_setup_superseded" | "migration_blocked";
			status: 409 | 410;
			message: string;
	  };

/**
 * Checks whether legacy `/api/telegram/setup` (POST/DELETE) is allowed to mutate
 * `telegram_bot_config` for an organization. Blocks bypass once:
 * - org-owned Telegram switch is enabled in `chat_installation_switch_control`, OR
 * - an organization-owned Telegram installation is active/retiring/candidate, OR
 * - a Telegram installation is in `remediation_required`.
 */
export async function checkLegacyTelegramSetupMutationAllowed(
	organizationId: string,
	deps?: { db?: ChatRecoveryDb },
): Promise<LegacyTelegramSetupGuardResult> {
	const db = deps?.db ?? defaultDb;
	const [switchControlRows, installations] = await Promise.all([
		db
			.select({ organizationId: chatInstallationSwitchControl.organizationId })
			.from(chatInstallationSwitchControl)
			.where(
				and(
					eq(chatInstallationSwitchControl.organizationId, organizationId),
					eq(chatInstallationSwitchControl.provider, "telegram"),
				),
			)
			.limit(1),
		db
			.select({
				status: chatInstallation.status,
				credentialSource: chatInstallation.credentialSource,
			})
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, organizationId),
					eq(chatInstallation.provider, "telegram"),
				),
			),
	]);

	if (installations.some((inst) => inst.status === "remediation_required")) {
		return {
			allowed: false,
			code: "migration_blocked",
			status: 409,
			message:
				"Telegram installation requires migration remediation before setup changes are allowed.",
		};
	}

	const hasOrgOwnedLifecycle = installations.some(
		(inst) =>
			inst.credentialSource === "organization_owned" &&
			(inst.status === "active" || inst.status === "retiring" || inst.status === "candidate"),
	);
	if (switchControlRows.length > 0 || hasOrgOwnedLifecycle) {
		return {
			allowed: false,
			code: "legacy_setup_superseded",
			status: 410,
			message:
				"Legacy Telegram setup has been superseded by the organization-owned Telegram installation lifecycle in Settings -> Chat Integrations.",
		};
	}

	return { allowed: true };
}

export type DisconnectLegacyTelegramResult =
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

/**
 * Authorized lifecycle handler for legacy `DELETE /api/telegram/setup`.
 * Blocks bypass when org-owned Telegram lifecycle is active or switch-enabled, and
 * otherwise disconnects the legacy bot cleanly with serialized webhook removal.
 */
export async function disconnectLegacyTelegramInstallation(
	input: {
		organizationId: string;
		actorUserId: string;
	},
	deps?: Pick<
		TelegramSetupRuntimeDeps,
		"db" | "readSecret" | "deleteSecret" | "deleteWebhook" | "recordAudit" | "now"
	>,
): Promise<DisconnectLegacyTelegramResult> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;

	const guard = await checkLegacyTelegramSetupMutationAllowed(input.organizationId, { db });
	if (!guard.allowed) {
		return {
			kind: "refused",
			code: guard.code,
			status: guard.status,
			message: guard.message,
		};
	}

	const [config] = await db
		.select()
		.from(telegramBotConfig)
		.where(eq(telegramBotConfig.organizationId, input.organizationId))
		.limit(1);

	let disconnectedInstallationId: string | null = null;
	if (config) {
		const readSecret = deps?.readSecret ?? getOrgSecret;
		const removeSecret = deps?.deleteSecret ?? deleteOrgSecret;
		const callDeleteWebhook = deps?.deleteWebhook ?? deleteWebhookWithOutcome;

		const vaultToken = await readSecret(input.organizationId, "telegram/bot_token").catch(
			() => null,
		);
		const tokenForCleanup =
			vaultToken || (config.botToken !== "vault:managed" ? config.botToken : null);

		if (tokenForCleanup) {
			const numericBotId = extractTelegramNumericBotId(tokenForCleanup);
			const stableBotKey = numericBotId
				? `telegram:${numericBotId}`
				: `telegram:legacy:${config.id}`;
			await db.transaction(async (rawTx) => {
				const tx = rawTx as unknown as Pick<ChatRecoveryDb, "execute">;
				await withStableBotEndpointLock(tx, stableBotKey, async () => {
					await callDeleteWebhook(tokenForCleanup);
				});
			});
		}

		await removeSecret(input.organizationId, "telegram/bot_token");

		await db
			.update(telegramBotConfig)
			.set({
				setupStatus: "disconnected",
				webhookRegistered: false,
				updatedAt: now,
			})
			.where(
				and(
					eq(telegramBotConfig.id, config.id),
					eq(telegramBotConfig.organizationId, input.organizationId),
				),
			);

		const [updatedInst] = await db
			.update(chatInstallation)
			.set({
				status: "revoked",
				revokedAt: now,
				endpointState: "removed",
				updatedAt: now,
			})
			.where(
				and(
					eq(chatInstallation.organizationId, input.organizationId),
					eq(chatInstallation.provider, "telegram"),
					eq(chatInstallation.legacyTable, "telegram_bot_config"),
					eq(chatInstallation.legacyRecordId, config.id),
					inArray(chatInstallation.status, ["legacy_active", "retiring"]),
				),
			)
			.returning({ id: chatInstallation.id });

		disconnectedInstallationId = updatedInst?.id ?? null;

		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_LEGACY_DISCONNECTED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: disconnectedInstallationId ?? config.id,
			metadata: {
				provider: "telegram",
				legacyConfigId: config.id,
			},
		});
	}

	return {
		kind: "disconnected",
		disconnectedLegacyConfigId: config?.id ?? null,
		installationId: disconnectedInstallationId,
	};
}
