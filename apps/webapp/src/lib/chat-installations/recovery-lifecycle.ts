import { and, asc, eq, inArray, lte, ne, or, sql } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	approvalDeliveryWork,
	type ChatCredentialRevisionStatus,
	type ChatCredentialSource,
	type ChatInstallationCleanupJobKind,
	type ChatInstallationCleanupJobStatus,
	type ChatInstallationCleanupRedactedDiagnostics,
	type ChatInstallationEndpointState,
	type ChatInstallationProvider,
	type ChatInstallationStatus,
	type ChatLegacyTableName,
	type ChatVerificationEvidence,
	type ChatVerificationState,
	chatInstallation,
	chatInstallationCleanupJob,
	chatInstallationCredentialRevision,
	chatNotificationDispatchAttempt,
	chatProviderSettings,
	discordBotConfig,
	slackWorkspaceConfig,
	teamsTenantConfig,
	telegramBotConfig,
} from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { dateFromInstant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { type VerifySlackBotMetadataResult, verifySlackBotMetadata } from "@/lib/slack/api";
import { evictTeamsInstallationBotAdapter } from "@/lib/teams/bot-adapter";
import { isSecretStoreUnavailableError, type SecretStoreProviderKind } from "@/lib/vault";
import {
	type CredentialRevisionRecord,
	type CredentialRevisionRepository,
	cleanupUnreferencedCredentialRevision,
	readInstallationCredentialRevision,
	storeInstallationCredentialRevision,
} from "./credential-revisions";
import {
	buildSlackCandidateSetupView,
	computeSlackCandidateSetupStatus,
	SLACK_BOT_TOKEN_PREFIX,
	SLACK_VERIFICATION_FRESHNESS_MS,
	type SendSlackPrivateDmResult,
	type SlackCandidateInstallationRecord,
	type SlackCandidateSetupView,
	type SlackSetupRepository,
	sendSlackCandidateTestMessage,
} from "./slack-setup";
import {
	buildChatSwitchImpactPreview,
	type ChatSwitchDb,
	type ChatSwitchImpactPreview,
	type ChatSwitchLifecycleDeps,
	type ConfirmChatInstallationSwitchInput,
	type ConfirmChatInstallationSwitchResult,
	confirmChatInstallationSwitch,
} from "./switch-lifecycle";

const logger = createLogger("ChatInstallationRecoveryLifecycle");

export const CHAT_CLEANUP_RETRY_BACKOFF_MS = [
	60_000, // 1m
	300_000, // 5m
	1_800_000, // 30m
	7_200_000, // 2h
	43_200_000, // 12h
] as const;

export const CHAT_CLEANUP_DEFAULT_MAX_ATTEMPTS = 5;
export const CHAT_CLEANUP_DEFER_REFERENCED_MS = 5 * 60_000;

export type ChatRecoveryDb = ChatSwitchDb;

export interface ChatRecoveryInstallationRecord {
	id: string;
	organizationId: string;
	provider: ChatInstallationProvider;
	credentialSource: ChatCredentialSource;
	status: ChatInstallationStatus;
	routeId: string;
	externalAppId: string | null;
	externalBotId: string | null;
	externalBotUsername: string | null;
	externalDisplayName: string | null;
	externalSpaceId: string | null;
	externalSpaceName: string | null;
	receiverScope: string | null;
	activeCredentialRevisionId: string | null;
	legacyTable: ChatLegacyTableName | null;
	legacyRecordId: string | null;
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

export interface ChatRecoveryCleanupJobRecord {
	id: string;
	organizationId: string;
	installationId: string;
	provider: ChatInstallationProvider;
	stableBotKey: string;
	kind: ChatInstallationCleanupJobKind;
	credentialRevisionId: string | null;
	authorizedGeneration: number;
	status: ChatInstallationCleanupJobStatus;
	attemptCount: number;
	maxAttempts: number;
	nextAttemptAt: Date;
	lastErrorCode: string | null;
	redactedDiagnostics: ChatInstallationCleanupRedactedDiagnostics | null;
	completedAt: Date | null;
	exhaustedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface ChatRecoveryAuditEvent {
	action: AuditAction;
	actorId: string;
	organizationId: string;
	targetId: string;
	metadata: Record<string, unknown>;
}

export interface ChatRecoveryRepository {
	withEndpointLock<T>(
		stableBotKey: string,
		fn: (repo: ChatRecoveryRepository) => Promise<T>,
	): Promise<T>;
	findInstallationById(
		organizationId: string,
		installationId: string,
	): Promise<ChatRecoveryInstallationRecord | null>;
	listInstallationsByProvider(
		organizationId: string,
		provider: ChatInstallationProvider,
	): Promise<ChatRecoveryInstallationRecord[]>;
	updateInstallation(
		organizationId: string,
		installationId: string,
		patch: Partial<
			Pick<
				ChatRecoveryInstallationRecord,
				| "status"
				| "activeCredentialRevisionId"
				| "verificationState"
				| "verificationEvidence"
				| "lastVerifiedAt"
				| "retirementDeadlineAt"
				| "retiredAt"
				| "revokedAt"
				| "endpointGeneration"
				| "endpointState"
				| "externalBotUsername"
				| "externalSpaceName"
				| "updatedAt"
			>
		>,
	): Promise<ChatRecoveryInstallationRecord>;
	clearActiveProviderInstallation(
		organizationId: string,
		provider: ChatInstallationProvider,
		installationId: string,
	): Promise<void>;
	markLegacyRowDisconnected(
		organizationId: string,
		legacyTable: ChatLegacyTableName,
		legacyRecordId: string,
		now: Date,
	): Promise<void>;
	listNonCleanedRevisions(
		organizationId: string,
		installationId: string,
	): Promise<CredentialRevisionRecord[]>;
	updateRevisionStatus(
		organizationId: string,
		installationId: string,
		revisionId: string,
		status: ChatCredentialRevisionStatus,
		extra?: { verifiedAt?: Date | null; revokedAt?: Date | null },
	): Promise<void>;
	isCredentialRevisionReferenced(
		organizationId: string,
		installationId: string,
		revisionId: string,
	): Promise<boolean>;
	enqueueCleanupJob(input: {
		organizationId: string;
		installationId: string;
		provider: ChatInstallationProvider;
		stableBotKey: string;
		kind: ChatInstallationCleanupJobKind;
		credentialRevisionId?: string | null;
		authorizedGeneration: number;
		maxAttempts?: number;
		nextAttemptAt?: Date;
	}): Promise<ChatRecoveryCleanupJobRecord>;
	listDueCleanupJobs(input: {
		now: Date;
		organizationId?: string;
		provider?: ChatInstallationProvider;
		limit?: number;
	}): Promise<ChatRecoveryCleanupJobRecord[]>;
	listCleanupJobsForProvider(
		organizationId: string,
		provider: ChatInstallationProvider,
	): Promise<ChatRecoveryCleanupJobRecord[]>;
	updateCleanupJob(
		jobId: string,
		patch: Partial<
			Pick<
				ChatRecoveryCleanupJobRecord,
				| "status"
				| "attemptCount"
				| "nextAttemptAt"
				| "lastErrorCode"
				| "redactedDiagnostics"
				| "completedAt"
				| "exhaustedAt"
				| "updatedAt"
			>
		>,
	): Promise<ChatRecoveryCleanupJobRecord>;
}

export type ProviderEndpointCleanupResult =
	| { kind: "ok" }
	| { kind: "timeout_uncertain"; errorCode?: string }
	| { kind: "failed"; errorCode?: string };

export type ProviderEndpointReconcileResult =
	| { kind: "reconciled" }
	| { kind: "uncertain"; errorCode?: string }
	| { kind: "failed"; errorCode?: string };

export type VerifyRotationIdentityResult =
	| {
			kind: "matched";
			fingerprint?: string | null;
			botUsername?: string | null;
			spaceName?: string | null;
	  }
	| { kind: "mismatch"; reason?: string }
	| {
			kind: "invalid_credentials";
			code:
				| "invalid_bot_token_format"
				| "invalid_signing_secret_format"
				| "invalid_bot_token"
				| "missing_slack_scope"
				| "invalid_credentials";
			message: string;
	  }
	| { kind: "unavailable"; message: string };

export interface ChatRecoveryRuntimeDeps {
	db?: ChatRecoveryDb;
	repository?: ChatRecoveryRepository;
	revisionRepository?: CredentialRevisionRepository;
	slackSetupRepository?: SlackSetupRepository;
	storeSecret?: (organizationId: string, key: string, value: string) => Promise<void>;
	readSecret?: (organizationId: string, key: string) => Promise<string | null>;
	deleteSecret?: (organizationId: string, key: string) => Promise<void>;
	secretStoreProvider?: SecretStoreProviderKind;
	verifySlackBotMetadata?: (botToken: string) => Promise<VerifySlackBotMetadataResult>;
	sendPrivateDm?: (
		botToken: string,
		input: { slackUserId: string; text: string },
	) => Promise<SendSlackPrivateDmResult>;
	providerEndpointCleanup?: (input: {
		installation: ChatRecoveryInstallationRecord;
		job: ChatRecoveryCleanupJobRecord;
	}) => Promise<ProviderEndpointCleanupResult>;
	reconcileProviderEndpoint?: (input: {
		installation: ChatRecoveryInstallationRecord;
		targetGeneration: number;
	}) => Promise<ProviderEndpointReconcileResult>;
	recordAudit?: (event: ChatRecoveryAuditEvent) => Promise<void>;
	reportOpsAlert?: (message: string, context: Record<string, unknown>) => void;
	onAdapterEvict?: (installationId: string, revisionId?: string) => void;
	switchDeps?: ChatSwitchLifecycleDeps;
	appUrl?: string;
	verificationTtlMs?: number;
	now?: () => Date;
}

// ============================================
// PURE DOMAIN HELPERS
// ============================================

function getNow(deps?: Pick<ChatRecoveryRuntimeDeps, "now">): Date {
	return deps?.now ? deps.now() : dateFromInstant(systemClock.nowInstant());
}

function addMilliseconds(base: Date, milliseconds: number): Date {
	return dateFromInstant(instantFromDate(base).add({ milliseconds }));
}

/**
 * Computes the stable bot identity key used to serialize provider endpoint
 * registration and removal (`pg_advisory_xact_lock`).
 */
export function buildStableBotKey(
	installation: Pick<
		ChatRecoveryInstallationRecord,
		"id" | "provider" | "externalSpaceId" | "externalAppId" | "externalBotId"
	>,
): string {
	const spaceId = installation.externalSpaceId?.trim() || "";
	const appId = installation.externalAppId?.trim() || "";
	const botId = installation.externalBotId?.trim() || "";

	switch (installation.provider) {
		case "slack":
			if (spaceId && appId) return `slack:${spaceId}:${appId}`;
			if (spaceId && botId) return `slack:${spaceId}:${botId}`;
			return `slack:installation:${installation.id}`;
		case "telegram":
			if (botId) return `telegram:${botId}`;
			return `telegram:installation:${installation.id}`;
		case "discord":
			if (appId) return `discord:${appId}`;
			return `discord:installation:${installation.id}`;
		case "teams":
			if (appId) return `teams:${appId}`;
			if (spaceId) return `teams:tenant:${spaceId}`;
			return `teams:installation:${installation.id}`;
	}
}

export type ProviderRotationInterruptionKind =
	| "signing_secret_cutover"
	| "bot_token_cutover"
	| "overlapping_secret_rollover";

export interface ProviderRotationGuidance {
	provider: ChatInstallationProvider;
	hasProviderInterruption: boolean;
	interruptionKind: ProviderRotationInterruptionKind;
	summary: string;
	interruptionDetails: string;
	verificationSteps: string[];
}

/**
 * Returns provider-specific credential rotation guidance explaining any
 * provider-imposed interruption window and how admins verify recovery.
 */
export function getProviderRotationGuidance(
	provider: ChatInstallationProvider,
): ProviderRotationGuidance {
	switch (provider) {
		case "slack":
			return {
				provider: "slack",
				hasProviderInterruption: true,
				interruptionKind: "signing_secret_cutover",
				summary:
					"Rotating credentials keeps your existing Slack installation, DM conversations, employee links, and open approval card ownership intact.",
				interruptionDetails:
					"Regenerating the Slack Signing Secret immediately invalidates the prior secret. Inbound Slack events, slash commands, and card interactions will fail signature verification until the new signing secret is saved in Z8. Regenerating the Bot User OAuth Token interrupts outbound delivery until saved.",
				verificationSteps: [
					"Generate the new Slack Bot User OAuth Token and/or Signing Secret in your Slack App settings.",
					"Save the rotated credentials in Z8 immediately so Z8 writes a new immutable revision and resumes signature verification.",
					"Send a Slack command (for example, /z8 status) or trigger a test DM to confirm both inbound and outbound recovery.",
				],
			};
		case "telegram":
			return {
				provider: "telegram",
				hasProviderInterruption: true,
				interruptionKind: "bot_token_cutover",
				summary:
					"Same-bot token rotation preserves the Telegram installation, linked employees, and webhook route.",
				interruptionDetails:
					"Revoking the token in @BotFather immediately stops outbound Telegram API calls until the new token is saved in Z8.",
				verificationSteps: [
					"Revoke and copy the new bot token in @BotFather for the same Telegram bot.",
					"Save the new token in Z8 to verify identical bot identity and write a new credential revision.",
					"Send a command or test DM to verify webhook delivery and outbound replies.",
				],
			};
		case "discord":
			return {
				provider: "discord",
				hasProviderInterruption: true,
				interruptionKind: "bot_token_cutover",
				summary:
					"Same-app token rotation preserves the Discord installation, interaction endpoint, employee links, and open approval cards.",
				interruptionDetails:
					"Resetting the Discord Bot Token immediately invalidates outbound Discord API calls until the new token is saved in Z8. The signed interaction public key remains valid unless the app changes.",
				verificationSteps: [
					"Reset and copy the Bot Token in the Discord Developer Portal for the same application.",
					"Save the new token in Z8 to verify identical Discord application identity.",
					"Run a Discord slash command and confirm private DM delivery.",
				],
			};
		case "teams":
			return {
				provider: "teams",
				hasProviderInterruption: false,
				interruptionKind: "overlapping_secret_rollover",
				summary:
					"Microsoft Entra supports overlapping client secrets, enabling zero-downtime credential rotation.",
				interruptionDetails:
					"Create a new client secret in Microsoft Entra ID before deleting the old one. Z8 immediately evicts the cached installation adapter once the new revision is saved.",
				verificationSteps: [
					"Add a second client secret in Microsoft Entra ID while keeping the previous secret active.",
					"Save the new client secret in Z8 and confirm proactive delivery succeeds.",
					"Delete the retired client secret in Microsoft Entra ID after verifying traffic.",
				],
			};
	}
}

export function computeCleanupBackoffMs(attemptCount: number): number {
	const index = Math.max(0, Math.min(attemptCount - 1, CHAT_CLEANUP_RETRY_BACKOFF_MS.length - 1));
	return CHAT_CLEANUP_RETRY_BACKOFF_MS[index];
}

export function evaluateEndpointCleanupFence(input: {
	jobAuthorizedGeneration: number;
	installationGeneration: number;
	installationStatus: ChatInstallationStatus;
}): {
	proceed: boolean;
	reason: "stale_generation" | "installation_reactivated" | null;
} {
	if (input.installationGeneration !== input.jobAuthorizedGeneration) {
		return { proceed: false, reason: "stale_generation" };
	}
	if (
		input.installationStatus === "active" ||
		input.installationStatus === "candidate" ||
		input.installationStatus === "retiring" ||
		input.installationStatus === "legacy_active"
	) {
		return { proceed: false, reason: "installation_reactivated" };
	}
	return { proceed: true, reason: null };
}

const SECRET_LIKE_PATTERN =
	/(xox[bpoas]-|xapp-|bearer\s+|basic\s+|token=|secret=|password=|signing_secret|bot_token|\d{7,}:[A-Za-z0-9_-]{20,}|[A-Za-z0-9+/=_-]{32,})/i;

function sanitizeCodeValue(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (SECRET_LIKE_PATTERN.test(trimmed)) {
		return "redacted";
	}
	return trimmed.slice(0, 120);
}

/**
 * Strips any potential secret material from cleanup diagnostics before persisting or alerting.
 */
export function sanitizeCleanupDiagnostics(
	input: ChatInstallationCleanupRedactedDiagnostics | null | undefined,
): ChatInstallationCleanupRedactedDiagnostics {
	if (!input) return {};
	const out: ChatInstallationCleanupRedactedDiagnostics = {};
	if (input.reason !== undefined) out.reason = sanitizeCodeValue(input.reason);
	if (input.errorCode !== undefined) out.errorCode = sanitizeCodeValue(input.errorCode);
	if (input.errorName !== undefined) out.errorName = sanitizeCodeValue(input.errorName);
	if (typeof input.httpStatus === "number") out.httpStatus = input.httpStatus;
	if (typeof input.timedOut === "boolean") out.timedOut = input.timedOut;
	if (Array.isArray(input.deletedKeys)) {
		out.deletedKeys = input.deletedKeys
			.filter((k) => typeof k === "string")
			.map((k) => k.slice(0, 80));
	}
	if (Array.isArray(input.failedKeys)) {
		out.failedKeys = input.failedKeys
			.filter((k) => typeof k === "string")
			.map((k) => k.slice(0, 80));
	}
	if (typeof input.observedGeneration === "number") {
		out.observedGeneration = input.observedGeneration;
	}
	if (input.observedStatus !== undefined) {
		out.observedStatus = sanitizeCodeValue(input.observedStatus);
	}
	if (typeof input.endpointReconciliationRequired === "boolean") {
		out.endpointReconciliationRequired = input.endpointReconciliationRequired;
	}
	return out;
}

// ============================================
// POSTGRES SERIALIZATION & DRIZZLE REPOSITORY
// ============================================

/**
 * Serializes provider endpoint registration, removal, and reconciliation by stable bot identity
 * using PostgreSQL transaction-scoped advisory locks (`pg_advisory_xact_lock`).
 */
export async function withStableBotEndpointLock<T>(
	dbOrTx: Pick<ChatRecoveryDb, "execute">,
	stableBotKey: string,
	fn: () => Promise<T>,
): Promise<T> {
	const lockKey = `chat-endpoint:${stableBotKey}`;
	await dbOrTx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
	return fn();
}

/**
 * Returns true if any installation active pointer, open/in-flight approval delivery work,
 * or in-flight/unresolved durable notification dispatch still references `revisionId`.
 */
export async function isCredentialRevisionReferenced(
	db: Pick<ChatRecoveryDb, "select">,
	organizationId: string,
	installationId: string,
	revisionId: string,
): Promise<boolean> {
	const [activeInst] = await db
		.select({ id: chatInstallation.id })
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.id, installationId),
				eq(chatInstallation.organizationId, organizationId),
				eq(chatInstallation.activeCredentialRevisionId, revisionId),
			),
		)
		.limit(1);
	if (activeInst) return true;

	const [openApprovalWork] = await db
		.select({ id: approvalDeliveryWork.id })
		.from(approvalDeliveryWork)
		.where(
			and(
				eq(approvalDeliveryWork.organizationId, organizationId),
				eq(approvalDeliveryWork.credentialRevisionId, revisionId),
				or(
					inArray(approvalDeliveryWork.status, ["pending", "processing", "awaiting_repair"]),
					inArray(approvalDeliveryWork.dispatchAttemptState, [
						"intent_recorded",
						"uncertain_across_switch",
					]),
				),
			),
		)
		.limit(1);
	if (openApprovalWork) return true;

	const [openDurableDispatch] = await db
		.select({ id: chatNotificationDispatchAttempt.id })
		.from(chatNotificationDispatchAttempt)
		.where(
			and(
				eq(chatNotificationDispatchAttempt.organizationId, organizationId),
				eq(chatNotificationDispatchAttempt.credentialRevisionId, revisionId),
				inArray(chatNotificationDispatchAttempt.status, [
					"intent_recorded",
					"reconciliation_required",
				]),
			),
		)
		.limit(1);
	if (openDurableDispatch) return true;

	// Keep the installation's credential revision available while a pending provider endpoint
	// cleanup job (e.g. Telegram deleteWebhook) still needs the bot token.
	const [pendingEndpointCleanup] = await db
		.select({ id: chatInstallationCleanupJob.id })
		.from(chatInstallationCleanupJob)
		.where(
			and(
				eq(chatInstallationCleanupJob.organizationId, organizationId),
				eq(chatInstallationCleanupJob.installationId, installationId),
				eq(chatInstallationCleanupJob.kind, "provider_endpoint_cleanup"),
				inArray(chatInstallationCleanupJob.status, ["pending", "processing"]),
			),
		)
		.limit(1);
	return Boolean(pendingEndpointCleanup);
}

function createDrizzleRecoveryRepository(db: ChatRecoveryDb): ChatRecoveryRepository {
	return {
		async withEndpointLock(stableBotKey, fn) {
			return db.transaction(async (rawTx) => {
				const tx = rawTx as unknown as ChatRecoveryDb;
				return withStableBotEndpointLock(tx, stableBotKey, () =>
					fn(createDrizzleRecoveryRepository(tx)),
				);
			});
		},

		async findInstallationById(organizationId, installationId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.id, installationId),
						eq(chatInstallation.organizationId, organizationId),
					),
				)
				.limit(1);
			return (row as ChatRecoveryInstallationRecord | undefined) ?? null;
		},

		async listInstallationsByProvider(organizationId, provider) {
			const rows = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, provider),
					),
				)
				.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id));
			return rows as ChatRecoveryInstallationRecord[];
		},

		async updateInstallation(organizationId, installationId, patch) {
			const [updated] = await db
				.update(chatInstallation)
				.set(patch)
				.where(
					and(
						eq(chatInstallation.id, installationId),
						eq(chatInstallation.organizationId, organizationId),
					),
				)
				.returning();
			if (!updated) {
				throw new Error("Failed to update chat installation");
			}
			return updated as ChatRecoveryInstallationRecord;
		},

		async clearActiveProviderInstallation(organizationId, provider, installationId) {
			await db
				.update(chatProviderSettings)
				.set({ activeInstallationId: null })
				.where(
					and(
						eq(chatProviderSettings.organizationId, organizationId),
						eq(chatProviderSettings.provider, provider),
						eq(chatProviderSettings.activeInstallationId, installationId),
					),
				);
		},

		async markLegacyRowDisconnected(organizationId, legacyTable, legacyRecordId, now) {
			switch (legacyTable) {
				case "slack_workspace_config":
					await db
						.update(slackWorkspaceConfig)
						.set({ setupStatus: "disconnected", updatedAt: now })
						.where(
							and(
								eq(slackWorkspaceConfig.id, legacyRecordId),
								eq(slackWorkspaceConfig.organizationId, organizationId),
							),
						);
					return;
				case "teams_tenant_config":
					await db
						.update(teamsTenantConfig)
						.set({ setupStatus: "disconnected", updatedAt: now })
						.where(
							and(
								eq(teamsTenantConfig.id, legacyRecordId),
								eq(teamsTenantConfig.organizationId, organizationId),
							),
						);
					return;
				case "telegram_bot_config":
					await db
						.update(telegramBotConfig)
						.set({ setupStatus: "disconnected", webhookRegistered: false, updatedAt: now })
						.where(
							and(
								eq(telegramBotConfig.id, legacyRecordId),
								eq(telegramBotConfig.organizationId, organizationId),
							),
						);
					return;
				case "discord_bot_config":
					await db
						.update(discordBotConfig)
						.set({ setupStatus: "disconnected", updatedAt: now })
						.where(
							and(
								eq(discordBotConfig.id, legacyRecordId),
								eq(discordBotConfig.organizationId, organizationId),
							),
						);
					return;
			}
		},

		async listNonCleanedRevisions(organizationId, installationId) {
			return db
				.select()
				.from(chatInstallationCredentialRevision)
				.where(
					and(
						eq(chatInstallationCredentialRevision.organizationId, organizationId),
						eq(chatInstallationCredentialRevision.installationId, installationId),
						ne(chatInstallationCredentialRevision.status, "cleaned_up"),
					),
				)
				.orderBy(asc(chatInstallationCredentialRevision.revisionNumber));
		},

		async updateRevisionStatus(organizationId, installationId, revisionId, status, extra) {
			await db
				.update(chatInstallationCredentialRevision)
				.set({
					status,
					...(extra?.verifiedAt !== undefined ? { verifiedAt: extra.verifiedAt } : {}),
					...(extra?.revokedAt !== undefined ? { revokedAt: extra.revokedAt } : {}),
				})
				.where(
					and(
						eq(chatInstallationCredentialRevision.id, revisionId),
						eq(chatInstallationCredentialRevision.installationId, installationId),
						eq(chatInstallationCredentialRevision.organizationId, organizationId),
					),
				);
		},

		async isCredentialRevisionReferenced(organizationId, installationId, revisionId) {
			return isCredentialRevisionReferenced(db, organizationId, installationId, revisionId);
		},

		async enqueueCleanupJob(input) {
			const [inserted] = await db
				.insert(chatInstallationCleanupJob)
				.values({
					organizationId: input.organizationId,
					installationId: input.installationId,
					provider: input.provider,
					stableBotKey: input.stableBotKey,
					kind: input.kind,
					credentialRevisionId: input.credentialRevisionId ?? null,
					authorizedGeneration: input.authorizedGeneration,
					status: "pending",
					attemptCount: 0,
					maxAttempts: input.maxAttempts ?? CHAT_CLEANUP_DEFAULT_MAX_ATTEMPTS,
					nextAttemptAt: input.nextAttemptAt ?? new Date(),
				})
				.returning();
			if (!inserted) {
				throw new Error("Failed to enqueue chat installation cleanup job");
			}
			return inserted as ChatRecoveryCleanupJobRecord;
		},

		async listDueCleanupJobs(input) {
			const conditions = [
				eq(chatInstallationCleanupJob.status, "pending"),
				lte(chatInstallationCleanupJob.nextAttemptAt, input.now),
			];
			if (input.organizationId) {
				conditions.push(eq(chatInstallationCleanupJob.organizationId, input.organizationId));
			}
			if (input.provider) {
				conditions.push(eq(chatInstallationCleanupJob.provider, input.provider));
			}
			const rows = await db
				.select()
				.from(chatInstallationCleanupJob)
				.where(and(...conditions))
				.orderBy(asc(chatInstallationCleanupJob.nextAttemptAt), asc(chatInstallationCleanupJob.id))
				.limit(input.limit ?? 50);
			return rows as ChatRecoveryCleanupJobRecord[];
		},

		async listCleanupJobsForProvider(organizationId, provider) {
			const rows = await db
				.select()
				.from(chatInstallationCleanupJob)
				.where(
					and(
						eq(chatInstallationCleanupJob.organizationId, organizationId),
						eq(chatInstallationCleanupJob.provider, provider),
					),
				)
				.orderBy(asc(chatInstallationCleanupJob.createdAt), asc(chatInstallationCleanupJob.id));
			return rows as ChatRecoveryCleanupJobRecord[];
		},

		async updateCleanupJob(jobId, patch) {
			const [updated] = await db
				.update(chatInstallationCleanupJob)
				.set(patch)
				.where(eq(chatInstallationCleanupJob.id, jobId))
				.returning();
			if (!updated) {
				throw new Error("Failed to update chat installation cleanup job");
			}
			return updated as ChatRecoveryCleanupJobRecord;
		},
	};
}

function resolveRepository(deps?: ChatRecoveryRuntimeDeps): ChatRecoveryRepository {
	return deps?.repository ?? createDrizzleRecoveryRepository(deps?.db ?? defaultDb);
}

async function defaultRecordAudit(event: ChatRecoveryAuditEvent): Promise<void> {
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
			"Failed to record redacted chat recovery audit event",
		);
	}
}

function defaultReportOpsAlert(message: string, context: Record<string, unknown>): void {
	logger.error(context, message);
}

function evictProviderAdapter(
	installation: Pick<ChatRecoveryInstallationRecord, "id" | "provider">,
	revisionId: string | undefined,
	deps?: ChatRecoveryRuntimeDeps,
): void {
	if (installation.provider === "teams") {
		evictTeamsInstallationBotAdapter(installation.id, revisionId);
	}
	deps?.onAdapterEvict?.(installation.id, revisionId);
}

// ============================================
// 1. SAME-IDENTITY CREDENTIAL ROTATION
// ============================================

export type RotateChatInstallationCredentialsRefusalCode =
	| "installation_not_found"
	| "deployment_managed_not_rotatable"
	| "installation_not_rotatable"
	| "invalid_bot_token_format"
	| "invalid_signing_secret_format"
	| "invalid_bot_token"
	| "missing_slack_scope"
	| "invalid_credentials"
	| "external_identity_mismatch"
	| "provider_unavailable"
	| "secret_store_unavailable"
	| "credential_write_failed";

export type RotateChatInstallationCredentialsResult =
	| {
			kind: "rotated";
			installationId: string;
			routeId: string;
			provider: ChatInstallationProvider;
			previousRevisionId: string | null;
			newRevisionId: string;
			newRevisionNumber: number;
			queuedCleanupJobId: string | null;
			guidance: ProviderRotationGuidance;
	  }
	| {
			kind: "refused";
			code: RotateChatInstallationCredentialsRefusalCode;
			message: string;
	  };

async function verifySlackSameIdentity(
	secrets: Record<string, string>,
	installation: ChatRecoveryInstallationRecord,
	deps?: ChatRecoveryRuntimeDeps,
): Promise<VerifyRotationIdentityResult> {
	const botToken = (secrets.bot_token ?? "").trim();
	const signingSecret = (secrets.signing_secret ?? "").trim();

	if (!botToken.startsWith(SLACK_BOT_TOKEN_PREFIX) || botToken.length < 12) {
		return {
			kind: "invalid_credentials",
			code: "invalid_bot_token_format",
			message: "Bot token must start with xoxb-.",
		};
	}

	if (signingSecret.length < 16 || /\s/.test(signingSecret)) {
		return {
			kind: "invalid_credentials",
			code: "invalid_signing_secret_format",
			message: "Signing secret must be at least 16 characters with no whitespace.",
		};
	}

	if (!installation.externalAppId || !installation.externalSpaceId) {
		return {
			kind: "mismatch",
			reason: "installation_missing_verified_external_identity",
		};
	}

	const verifyMetadata = deps?.verifySlackBotMetadata ?? verifySlackBotMetadata;
	const metadataResult = await verifyMetadata(botToken);
	if (metadataResult.kind !== "ok") {
		if (metadataResult.kind === "invalid_token") {
			return {
				kind: "invalid_credentials",
				code: "invalid_bot_token",
				message: "Slack rejected the bot token. Check your Bot User OAuth Token.",
			};
		}
		if (metadataResult.kind === "missing_scope") {
			return {
				kind: "invalid_credentials",
				code: "missing_slack_scope",
				message:
					"The Slack bot token is missing required scopes (including users:read for bot metadata verification).",
			};
		}
		if (metadataResult.kind === "identity_mismatch") {
			return {
				kind: "mismatch",
				reason: metadataResult.reason,
			};
		}
		return {
			kind: "unavailable",
			message: "Slack API is temporarily unavailable. Please retry.",
		};
	}

	const { identity } = metadataResult;
	if (
		identity.appId !== installation.externalAppId ||
		identity.teamId !== installation.externalSpaceId
	) {
		return {
			kind: "mismatch",
			reason: "slack_app_or_workspace_mismatch",
		};
	}

	return {
		kind: "matched",
		fingerprint: `slack:${identity.teamId}:${identity.appId}:${identity.botId}:${identity.botUserId}`,
		botUsername: identity.botUsername,
		spaceName: identity.teamName || installation.externalSpaceName,
	};
}

/**
 * Rotates credentials for an existing organization-owned chat installation while
 * verifying identical external identity (`app_id` & `team_id` for Slack, or generic
 * `verifyIdentity` callback for Telegram/Discord/Teams).
 *
 * Writes a new immutable credential revision, commits `active_credential_revision_id`
 * on the SAME installation row (preserving `id`, `route_id`, conversations, links,
 * and approval card origin), and queues asynchronous retryable cleanup for the
 * superseded revision once unreferenced.
 */
export async function rotateChatInstallationCredentials(
	input: {
		organizationId: string;
		installationId: string;
		actorUserId: string;
		secrets: Record<string, string>;
		verifyIdentity?: (
			secrets: Record<string, string>,
			installation: ChatRecoveryInstallationRecord,
		) => Promise<VerifyRotationIdentityResult>;
	},
	deps?: ChatRecoveryRuntimeDeps,
): Promise<RotateChatInstallationCredentialsResult> {
	const repository = resolveRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const now = getNow(deps);

	const installation = await repository.findInstallationById(
		input.organizationId,
		input.installationId,
	);
	if (!installation) {
		return {
			kind: "refused",
			code: "installation_not_found",
			message: "Chat installation was not found for this organization.",
		};
	}

	if (installation.credentialSource !== "organization_owned") {
		return {
			kind: "refused",
			code: "deployment_managed_not_rotatable",
			message:
				"Deployment-managed chat apps cannot be rotated here. Prepare and switch to an organization-owned app instead.",
		};
	}

	if (
		installation.status !== "active" &&
		installation.status !== "candidate" &&
		installation.status !== "retiring"
	) {
		return {
			kind: "refused",
			code: "installation_not_rotatable",
			message:
				"Only active, candidate, or retiring installations can rotate credentials. Use restore to re-verify a revoked or retired installation.",
		};
	}

	// Normalize secrets map
	const normalizedSecrets: Record<string, string> = {};
	for (const [k, v] of Object.entries(input.secrets)) {
		const trimmedKey = k.trim();
		const trimmedValue = v.trim();
		if (trimmedKey && trimmedValue) {
			normalizedSecrets[trimmedKey] = trimmedValue;
		}
	}

	// Verify exact same external identity before touching the secret store!
	let verification: VerifyRotationIdentityResult;
	if (input.verifyIdentity) {
		verification = await input.verifyIdentity(normalizedSecrets, installation);
	} else if (installation.provider === "slack") {
		verification = await verifySlackSameIdentity(normalizedSecrets, installation, deps);
	} else {
		return {
			kind: "refused",
			code: "invalid_credentials",
			message: `Identity verifier is required to rotate ${installation.provider} credentials.`,
		};
	}

	if (verification.kind === "mismatch") {
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: installation.id,
			metadata: {
				provider: installation.provider,
				operation: "rotate_credentials",
				failureCode: "external_identity_mismatch",
				reason: verification.reason ?? null,
			},
		});
		return {
			kind: "refused",
			code: "external_identity_mismatch",
			message:
				"The provided credentials belong to a different external app, bot, or workspace. Credential rotation requires the exact same external identity; use app replacement to switch to a different app.",
		};
	}

	if (verification.kind === "invalid_credentials") {
		return {
			kind: "refused",
			code: verification.code,
			message: verification.message,
		};
	}

	if (verification.kind === "unavailable") {
		return {
			kind: "refused",
			code: "provider_unavailable",
			message: verification.message,
		};
	}

	// Write a brand-new immutable credential revision (never mutating the prior revision in place)
	let newRevision: CredentialRevisionRecord;
	try {
		newRevision = await storeInstallationCredentialRevision(
			{
				organizationId: input.organizationId,
				installationId: installation.id,
				provider: installation.provider,
				secrets: normalizedSecrets,
				status: "verified",
				externalIdentityFingerprint: verification.fingerprint ?? null,
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
		return {
			kind: "refused",
			code: isUnavailable ? "secret_store_unavailable" : "credential_write_failed",
			message: isUnavailable
				? "The organization secret store is currently unavailable. Existing credentials remain active."
				: "Failed to store rotated credentials. Existing credentials remain active.",
		};
	}

	const stableBotKey = buildStableBotKey(installation);
	let previousRevisionId: string | null = null;
	let queuedCleanupJobId: string | null = null;

	try {
		const committed = await repository.withEndpointLock(stableBotKey, async (txRepo) => {
			const current = await txRepo.findInstallationById(input.organizationId, installation.id);
			if (
				!current ||
				(current.status !== "active" &&
					current.status !== "candidate" &&
					current.status !== "retiring")
			) {
				throw new Error("Installation status changed during credential rotation");
			}

			const priorRevisionId = current.activeCredentialRevisionId;
			if (priorRevisionId && priorRevisionId !== newRevision.id) {
				await txRepo.updateRevisionStatus(
					input.organizationId,
					current.id,
					priorRevisionId,
					"superseded",
				);
			}

			await txRepo.updateRevisionStatus(
				input.organizationId,
				current.id,
				newRevision.id,
				current.status === "candidate" ? "verified" : "active",
				{ verifiedAt: now },
			);

			const updatedEvidence: ChatVerificationEvidence = {
				...(current.verificationEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
				secretStoreStatus: "available",
				identityVerifiedAt: now.toISOString(),
				identityRevisionId: newRevision.id,
				rotatedAt: now.toISOString(),
				rotatedRevisionId: newRevision.id,
			};

			await txRepo.updateInstallation(input.organizationId, current.id, {
				activeCredentialRevisionId: newRevision.id,
				verificationEvidence: updatedEvidence,
				externalBotUsername: verification.botUsername ?? current.externalBotUsername,
				externalSpaceName: verification.spaceName ?? current.externalSpaceName,
				updatedAt: now,
			});

			let cleanupJobId: string | null = null;
			if (priorRevisionId && priorRevisionId !== newRevision.id) {
				const job = await txRepo.enqueueCleanupJob({
					organizationId: input.organizationId,
					installationId: current.id,
					provider: current.provider,
					stableBotKey,
					kind: "credential_revision_cleanup",
					credentialRevisionId: priorRevisionId,
					authorizedGeneration: current.endpointGeneration,
					nextAttemptAt: now,
				});
				cleanupJobId = job.id;
			}

			return { priorRevisionId, cleanupJobId };
		});

		previousRevisionId = committed.priorRevisionId;
		queuedCleanupJobId = committed.cleanupJobId;
	} catch (commitError) {
		// Compensate newly written revision keys on commit failure; existing revision remains active.
		logger.warn(
			{
				error: commitError,
				organizationId: input.organizationId,
				installationId: installation.id,
				newRevisionId: newRevision.id,
			},
			"Credential rotation commit failed; rolling back newly written revision",
		);
		await cleanupUnreferencedCredentialRevision(
			{
				organizationId: input.organizationId,
				installationId: installation.id,
				revisionId: newRevision.id,
			},
			{
				db: deps?.db,
				repository: deps?.revisionRepository,
				deleteSecret: deps?.deleteSecret,
			},
		).catch(() => undefined);

		return {
			kind: "refused",
			code: "credential_write_failed",
			message: "Could not commit rotated credentials. Existing credentials remain active.",
		};
	}

	evictProviderAdapter(installation, previousRevisionId ?? undefined, deps);

	await recordAudit({
		action: AuditAction.CHAT_INSTALLATION_CREDENTIALS_ROTATED,
		actorId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: installation.id,
		metadata: {
			provider: installation.provider,
			installationId: installation.id,
			routeId: installation.routeId,
			previousRevisionId,
			newRevisionId: newRevision.id,
			newRevisionNumber: newRevision.revisionNumber,
			secretStoreProvider: newRevision.secretStoreProvider,
			externalAppId: installation.externalAppId,
			externalSpaceId: installation.externalSpaceId,
			queuedCleanupJobId,
		},
	});

	return {
		kind: "rotated",
		installationId: installation.id,
		routeId: installation.routeId,
		provider: installation.provider,
		previousRevisionId,
		newRevisionId: newRevision.id,
		newRevisionNumber: newRevision.revisionNumber,
		queuedCleanupJobId,
		guidance: getProviderRotationGuidance(installation.provider),
	};
}

// ============================================
// 2. IMMEDIATE LOCAL REVOCATION
// ============================================

export type RevokeChatInstallationResult =
	| {
			kind: "revoked";
			installationId: string;
			provider: ChatInstallationProvider;
			endpointGeneration: number;
			queuedCredentialCleanupCount: number;
			queuedEndpointCleanup: boolean;
	  }
	| {
			kind: "already_revoked";
			installationId: string;
			endpointGeneration: number;
	  }
	| {
			kind: "refused";
			code: "installation_not_found";
			message: string;
	  };

/**
 * Immediately ends local authorization for a chat installation (`status = "revoked"`,
 * `revoked_at = now()`, increments `endpoint_generation`, clears `active_installation_id`,
 * marks org-owned credential revisions `revoked`, and evicts cached adapters).
 *
 * Asynchronous retryable cleanup jobs are queued strictly for organization-owned revisions
 * and endpoints, fenced by `authorized_generation = new_generation`. Shared deployment
 * credentials and unrelated organizations are NEVER touched. Pending approvals remain
 * accessible in the Z8 inbox.
 */
export async function revokeChatInstallation(
	input: {
		organizationId: string;
		installationId: string;
		actorUserId: string;
		reason?: string;
	},
	deps?: ChatRecoveryRuntimeDeps,
): Promise<RevokeChatInstallationResult> {
	const repository = resolveRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const now = getNow(deps);

	const initial = await repository.findInstallationById(input.organizationId, input.installationId);
	if (!initial) {
		return {
			kind: "refused",
			code: "installation_not_found",
			message: "Chat installation was not found for this organization.",
		};
	}

	const stableBotKey = buildStableBotKey(initial);

	const txResult = await repository.withEndpointLock(stableBotKey, async (txRepo) => {
		const installation = await txRepo.findInstallationById(
			input.organizationId,
			input.installationId,
		);
		if (!installation) {
			return {
				kind: "refused" as const,
				code: "installation_not_found" as const,
				message: "Chat installation was not found for this organization.",
			};
		}

		if (installation.status === "revoked") {
			return {
				kind: "already_revoked" as const,
				installationId: installation.id,
				endpointGeneration: installation.endpointGeneration,
			};
		}

		const newGeneration = installation.endpointGeneration + 1;

		await txRepo.updateInstallation(input.organizationId, installation.id, {
			status: "revoked",
			revokedAt: now,
			endpointGeneration: newGeneration,
			verificationState: "unverified",
			updatedAt: now,
		});

		await txRepo.clearActiveProviderInstallation(
			input.organizationId,
			installation.provider,
			installation.id,
		);

		let queuedCredentialCleanupCount = 0;
		let queuedEndpointCleanup = false;

		if (installation.credentialSource === "organization_owned") {
			const revisions = await txRepo.listNonCleanedRevisions(input.organizationId, installation.id);
			for (const rev of revisions) {
				// react-doctor-disable-next-line react-doctor/async-await-in-loop -- Each revision is revoked and its cleanup enqueued on the same transaction connection.
				await txRepo.updateRevisionStatus(
					input.organizationId,
					installation.id,
					rev.id,
					"revoked",
					{ revokedAt: now },
				);
				await txRepo.enqueueCleanupJob({
					organizationId: input.organizationId,
					installationId: installation.id,
					provider: installation.provider,
					stableBotKey,
					kind: "credential_revision_cleanup",
					credentialRevisionId: rev.id,
					authorizedGeneration: newGeneration,
					nextAttemptAt: now,
				});
				queuedCredentialCleanupCount += 1;
			}

			await txRepo.enqueueCleanupJob({
				organizationId: input.organizationId,
				installationId: installation.id,
				provider: installation.provider,
				stableBotKey,
				kind: "provider_endpoint_cleanup",
				authorizedGeneration: newGeneration,
				nextAttemptAt: now,
			});
			queuedEndpointCleanup = true;
		} else if (installation.legacyTable && installation.legacyRecordId) {
			// Deployment-managed legacy connection: disconnect ONLY this org's legacy row;
			// never mutate shared deployment credentials or endpoints.
			await txRepo.markLegacyRowDisconnected(
				input.organizationId,
				installation.legacyTable,
				installation.legacyRecordId,
				now,
			);
		}

		return {
			kind: "revoked" as const,
			installationId: installation.id,
			provider: installation.provider,
			credentialSource: installation.credentialSource,
			endpointGeneration: newGeneration,
			queuedCredentialCleanupCount,
			queuedEndpointCleanup,
		};
	});

	if (txResult.kind !== "revoked") {
		return txResult;
	}

	evictProviderAdapter(initial, undefined, deps);

	await recordAudit({
		action: AuditAction.CHAT_INSTALLATION_REVOKED,
		actorId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: txResult.installationId,
		metadata: {
			provider: txResult.provider,
			credentialSource: txResult.credentialSource,
			endpointGeneration: txResult.endpointGeneration,
			queuedCredentialCleanupCount: txResult.queuedCredentialCleanupCount,
			queuedEndpointCleanup: txResult.queuedEndpointCleanup,
			reason: sanitizeCodeValue(input.reason) ?? null,
			z8InboxApprovalsPreserved: true,
		},
	});

	return {
		kind: "revoked",
		installationId: txResult.installationId,
		provider: txResult.provider,
		endpointGeneration: txResult.endpointGeneration,
		queuedCredentialCleanupCount: txResult.queuedCredentialCleanupCount,
		queuedEndpointCleanup: txResult.queuedEndpointCleanup,
	};
}

// ============================================
// 3. GENERATION-FENCED SERIALIZED CLEANUP WORKER
// ============================================

export interface ProcessChatInstallationCleanupResult {
	processed: number;
	completed: number;
	skippedStale: number;
	deferredReferenced: number;
	retried: number;
	exhausted: number;
}

/**
 * Executes due asynchronous credential-revision and provider-endpoint cleanup jobs.
 *
 * - `credential_revision_cleanup`: checks reference safety (active installation, open
 *   approval work, in-flight durable dispatches) before deleting secrets. Secret-store
 *   outages keep cleanup retryable; exhausted attempts emit a redacted ops alert.
 * - `provider_endpoint_cleanup`: serializes by `stable_bot_key` and re-checks
 *   `endpoint_generation` + installation status under the lock before each provider call.
 *   Stale generations skip cleanly (`skipped_stale_generation`). Timeouts mark
 *   `endpoint_state = "uncertain"` and require reconciliation before reactivation.
 */
export async function processChatInstallationCleanupJobs(
	input?: {
		now?: Date;
		organizationId?: string;
		provider?: ChatInstallationProvider;
		limit?: number;
	},
	deps?: ChatRecoveryRuntimeDeps,
): Promise<ProcessChatInstallationCleanupResult> {
	const repository = resolveRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const reportOpsAlert = deps?.reportOpsAlert ?? defaultReportOpsAlert;
	const now = input?.now ?? getNow(deps);

	const dueJobs = await repository.listDueCleanupJobs({
		now,
		organizationId: input?.organizationId,
		provider: input?.provider,
		limit: input?.limit ?? 50,
	});

	const summary: ProcessChatInstallationCleanupResult = {
		processed: dueJobs.length,
		completed: 0,
		skippedStale: 0,
		deferredReferenced: 0,
		retried: 0,
		exhausted: 0,
	};

	for (const job of dueJobs) {
		if (job.kind === "credential_revision_cleanup") {
			if (!job.credentialRevisionId) {
				// react-doctor-disable-next-line react-doctor/async-await-in-loop -- Jobs can share an installation and endpoint generation. Finish one cleanup before checking the next.
				await repository.updateCleanupJob(job.id, {
					status: "completed",
					completedAt: now,
					redactedDiagnostics: { reason: "revision_already_removed" },
					updatedAt: now,
				});
				summary.completed += 1;
				continue;
			}

			const stillReferenced = await repository.isCredentialRevisionReferenced(
				job.organizationId,
				job.installationId,
				job.credentialRevisionId,
			);
			if (stillReferenced) {
				await repository.updateCleanupJob(job.id, {
					status: "pending",
					nextAttemptAt: addMilliseconds(now, CHAT_CLEANUP_DEFER_REFERENCED_MS),
					redactedDiagnostics: { reason: "still_referenced" },
					updatedAt: now,
				});
				summary.deferredReferenced += 1;
				continue;
			}

			const cleanupOutcome = await cleanupUnreferencedCredentialRevision(
				{
					organizationId: job.organizationId,
					installationId: job.installationId,
					revisionId: job.credentialRevisionId,
				},
				{
					db: deps?.db,
					repository: deps?.revisionRepository,
					deleteSecret: deps?.deleteSecret,
				},
			);

			if (cleanupOutcome.kind === "referenced") {
				await repository.updateCleanupJob(job.id, {
					status: "pending",
					nextAttemptAt: addMilliseconds(now, CHAT_CLEANUP_DEFER_REFERENCED_MS),
					redactedDiagnostics: { reason: "still_referenced" },
					updatedAt: now,
				});
				summary.deferredReferenced += 1;
				continue;
			}

			if (
				cleanupOutcome.kind === "cleaned_up" ||
				cleanupOutcome.kind === "already_cleaned" ||
				cleanupOutcome.kind === "not_found"
			) {
				await repository.updateCleanupJob(job.id, {
					status: "completed",
					completedAt: now,
					lastErrorCode: null,
					redactedDiagnostics: sanitizeCleanupDiagnostics({
						reason: cleanupOutcome.kind,
						deletedKeys: cleanupOutcome.kind === "cleaned_up" ? cleanupOutcome.deletedKeys : [],
					}),
					updatedAt: now,
				});
				summary.completed += 1;
				continue;
			}

			// Retryable secret-store failure
			const nextAttemptCount = job.attemptCount + 1;
			const diagnostics = sanitizeCleanupDiagnostics({
				reason: "secret_store_unavailable",
				errorCode: "secret_store_unavailable",
				deletedKeys: cleanupOutcome.deletedKeys,
				failedKeys: cleanupOutcome.failedKeys,
			});

			if (nextAttemptCount >= job.maxAttempts) {
				await repository.updateCleanupJob(job.id, {
					status: "exhausted",
					attemptCount: nextAttemptCount,
					lastErrorCode: "secret_store_unavailable",
					redactedDiagnostics: diagnostics,
					exhaustedAt: now,
					updatedAt: now,
				});
				reportOpsAlert("Chat installation credential revision cleanup exhausted retries", {
					jobId: job.id,
					organizationId: job.organizationId,
					installationId: job.installationId,
					provider: job.provider,
					credentialRevisionId: job.credentialRevisionId,
					attemptCount: nextAttemptCount,
					diagnostics,
				});
				if (deps?.recordAudit) {
					await recordAudit({
						action: AuditAction.CHAT_INSTALLATION_CLEANUP_EXHAUSTED,
						actorId: "system",
						organizationId: job.organizationId,
						targetId: job.installationId,
						metadata: {
							jobId: job.id,
							kind: job.kind,
							provider: job.provider,
							credentialRevisionId: job.credentialRevisionId,
							attemptCount: nextAttemptCount,
							diagnostics,
						},
					});
				}
				summary.exhausted += 1;
			} else {
				await repository.updateCleanupJob(job.id, {
					status: "pending",
					attemptCount: nextAttemptCount,
					nextAttemptAt: addMilliseconds(now, computeCleanupBackoffMs(nextAttemptCount)),
					lastErrorCode: "secret_store_unavailable",
					redactedDiagnostics: diagnostics,
					updatedAt: now,
				});
				summary.retried += 1;
			}
			continue;
		}

		// kind === "provider_endpoint_cleanup"
		const endpointOutcome = await repository.withEndpointLock(job.stableBotKey, async (txRepo) => {
			const installation = await txRepo.findInstallationById(
				job.organizationId,
				job.installationId,
			);
			if (!installation) {
				await txRepo.updateCleanupJob(job.id, {
					status: "completed",
					completedAt: now,
					redactedDiagnostics: { reason: "installation_deleted" },
					updatedAt: now,
				});
				return "completed" as const;
			}

			const fence = evaluateEndpointCleanupFence({
				jobAuthorizedGeneration: job.authorizedGeneration,
				installationGeneration: installation.endpointGeneration,
				installationStatus: installation.status,
			});

			if (!fence.proceed) {
				await txRepo.updateCleanupJob(job.id, {
					status: "skipped_stale_generation",
					completedAt: now,
					redactedDiagnostics: sanitizeCleanupDiagnostics({
						reason: fence.reason,
						observedGeneration: installation.endpointGeneration,
						observedStatus: installation.status,
					}),
					updatedAt: now,
				});
				return "skipped_stale" as const;
			}

			let providerResult: ProviderEndpointCleanupResult;
			try {
				if (deps?.providerEndpointCleanup) {
					providerResult = await deps.providerEndpointCleanup({ installation, job });
				} else if (installation.provider === "telegram") {
					const { cleanupTelegramInstallationWebhook } = await import("./telegram-setup");
					providerResult = await cleanupTelegramInstallationWebhook(
						{ installation, job },
						{
							db: deps?.db,
							revisionRepository: deps?.revisionRepository,
							readSecret: deps?.readSecret,
						},
					);
				} else {
					providerResult = { kind: "ok" };
				}
			} catch (error) {
				const isTimeout =
					error instanceof Error &&
					(error.name === "TimeoutError" ||
						error.name === "AbortError" ||
						/timeout|timed out|aborted/i.test(error.message));
				providerResult = isTimeout
					? { kind: "timeout_uncertain", errorCode: "provider_timeout" }
					: {
							kind: "failed",
							errorCode:
								sanitizeCodeValue(error instanceof Error ? error.name : "provider_error") ??
								"provider_error",
						};
			}

			if (providerResult.kind === "ok") {
				await txRepo.updateInstallation(job.organizationId, installation.id, {
					endpointState: "removed",
					updatedAt: now,
				});
				await txRepo.updateCleanupJob(job.id, {
					status: "completed",
					completedAt: now,
					lastErrorCode: null,
					redactedDiagnostics: {
						reason: "endpoint_removed",
						observedGeneration: installation.endpointGeneration,
					},
					updatedAt: now,
				});
				return "completed" as const;
			}

			const isUncertain = providerResult.kind === "timeout_uncertain";
			if (isUncertain) {
				await txRepo.updateInstallation(job.organizationId, installation.id, {
					endpointState: "uncertain",
					updatedAt: now,
				});
			}

			const nextAttemptCount = job.attemptCount + 1;
			const errorCode =
				sanitizeCodeValue(providerResult.errorCode) ??
				(isUncertain ? "provider_timeout" : "endpoint_cleanup_failed");
			const diagnostics = sanitizeCleanupDiagnostics({
				reason: isUncertain ? "provider_timeout_uncertain" : "provider_endpoint_cleanup_failed",
				errorCode,
				timedOut: isUncertain,
				observedGeneration: installation.endpointGeneration,
				observedStatus: installation.status,
				endpointReconciliationRequired: isUncertain,
			});

			if (nextAttemptCount >= job.maxAttempts) {
				await txRepo.updateCleanupJob(job.id, {
					status: "exhausted",
					attemptCount: nextAttemptCount,
					lastErrorCode: errorCode,
					redactedDiagnostics: diagnostics,
					exhaustedAt: now,
					updatedAt: now,
				});
				return { kind: "exhausted" as const, attemptCount: nextAttemptCount, diagnostics };
			}

			await txRepo.updateCleanupJob(job.id, {
				status: "pending",
				attemptCount: nextAttemptCount,
				nextAttemptAt: addMilliseconds(now, computeCleanupBackoffMs(nextAttemptCount)),
				lastErrorCode: errorCode,
				redactedDiagnostics: diagnostics,
				updatedAt: now,
			});
			return "retried" as const;
		});

		if (endpointOutcome === "completed") {
			summary.completed += 1;
		} else if (endpointOutcome === "skipped_stale") {
			summary.skippedStale += 1;
		} else if (endpointOutcome === "retried") {
			summary.retried += 1;
		} else {
			reportOpsAlert("Chat installation provider endpoint cleanup exhausted retries", {
				jobId: job.id,
				organizationId: job.organizationId,
				installationId: job.installationId,
				provider: job.provider,
				stableBotKey: job.stableBotKey,
				authorizedGeneration: job.authorizedGeneration,
				attemptCount: endpointOutcome.attemptCount,
				diagnostics: endpointOutcome.diagnostics,
			});
			if (deps?.recordAudit) {
				await recordAudit({
					action: AuditAction.CHAT_INSTALLATION_CLEANUP_EXHAUSTED,
					actorId: "system",
					organizationId: job.organizationId,
					targetId: job.installationId,
					metadata: {
						jobId: job.id,
						kind: job.kind,
						provider: job.provider,
						stableBotKey: job.stableBotKey,
						authorizedGeneration: job.authorizedGeneration,
						attemptCount: endpointOutcome.attemptCount,
						diagnostics: endpointOutcome.diagnostics,
					},
				});
			}
			summary.exhausted += 1;
		}
	}

	return summary;
}

// ============================================
// 4. VERIFIED RESTORE / SWITCH-BACK
// ============================================

export type BeginChatInstallationRestoreResult =
	| {
			kind: "restore_started";
			installationId: string;
			routeId: string;
			provider: ChatInstallationProvider;
			endpointGeneration: number;
			endpointState: ChatInstallationEndpointState;
			requiresCredentials: boolean;
			status: "candidate";
	  }
	| {
			kind: "refused";
			code:
				| "installation_not_found"
				| "deployment_managed_not_restorable"
				| "installation_not_restorable"
				| "endpoint_reconciliation_required";
			message: string;
	  };

/**
 * Initiates verified restoration of a previously `retiring`, `retired`, or `revoked`
 * organization-owned chat installation:
 * 1) Acquires the `stable_bot_key` endpoint lock;
 * 2) If `endpoint_state === "uncertain"`, requires provider state reconciliation before proceeding;
 * 3) Increments `endpoint_generation` (immediately fencing out any delayed cleanup jobs);
 * 4) Transitions the installation to `candidate` with invalidated verification proofs so fresh
 *    verification and a fresh impact review are mandatory before reactivation.
 */
export async function beginChatInstallationRestore(
	input: {
		organizationId: string;
		installationId: string;
		actorUserId: string;
	},
	deps?: ChatRecoveryRuntimeDeps,
): Promise<BeginChatInstallationRestoreResult> {
	const repository = resolveRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const now = getNow(deps);

	const initial = await repository.findInstallationById(input.organizationId, input.installationId);
	if (!initial) {
		return {
			kind: "refused",
			code: "installation_not_found",
			message: "Chat installation was not found for this organization.",
		};
	}

	const stableBotKey = buildStableBotKey(initial);

	const txOutcome = await repository.withEndpointLock(stableBotKey, async (txRepo) => {
		const installation = await txRepo.findInstallationById(
			input.organizationId,
			input.installationId,
		);
		if (!installation) {
			return {
				kind: "refused" as const,
				code: "installation_not_found" as const,
				message: "Chat installation was not found for this organization.",
			};
		}

		if (installation.credentialSource !== "organization_owned") {
			return {
				kind: "refused" as const,
				code: "deployment_managed_not_restorable" as const,
				message:
					"Deployment-managed installations cannot be restored as organization-owned replacements. Prepare and verify an organization-owned app instead.",
			};
		}

		if (
			installation.status !== "retiring" &&
			installation.status !== "retired" &&
			installation.status !== "revoked"
		) {
			return {
				kind: "refused" as const,
				code: "installation_not_restorable" as const,
				message:
					"Only retiring, retired, or revoked organization-owned installations can be restored.",
			};
		}

		const nextGeneration = installation.endpointGeneration + 1;
		let nextEndpointState: ChatInstallationEndpointState = installation.endpointState;
		let reconciledAtIso: string | null = null;

		if (installation.endpointState === "uncertain") {
			let reconcileResult: ProviderEndpointReconcileResult;
			if (deps?.reconcileProviderEndpoint) {
				reconcileResult = await deps.reconcileProviderEndpoint({
					installation,
					targetGeneration: nextGeneration,
				});
			} else if (installation.provider === "telegram") {
				const { reconcileTelegramInstallationWebhook } = await import("./telegram-setup");
				reconcileResult = await reconcileTelegramInstallationWebhook(
					{ installation, targetGeneration: nextGeneration },
					{
						db: deps?.db,
						revisionRepository: deps?.revisionRepository,
						readSecret: deps?.readSecret,
						appUrl: deps?.appUrl,
					},
				);
			} else {
				return {
					kind: "refused" as const,
					code: "endpoint_reconciliation_required" as const,
					message:
						"Provider endpoint state is uncertain after a timed-out cleanup. Re-read and reconcile the provider endpoint before restoring this installation.",
				};
			}
			if (reconcileResult.kind !== "reconciled") {
				return {
					kind: "refused" as const,
					code: "endpoint_reconciliation_required" as const,
					message:
						"Could not confirm provider endpoint state during reconciliation. Retry once the provider endpoint is reachable.",
				};
			}
			nextEndpointState = "synced";
			reconciledAtIso = now.toISOString();
		} else if (installation.endpointState === "removed") {
			nextEndpointState = "synced";
		}

		// Check if existing credential revision is still usable (not revoked/cleaned up)
		let retainedRevisionId: string | null = null;
		if (installation.activeCredentialRevisionId) {
			const nonCleaned = await txRepo.listNonCleanedRevisions(
				input.organizationId,
				installation.id,
			);
			const activeRev = nonCleaned.find(
				(rev) => rev.id === installation.activeCredentialRevisionId,
			);
			if (
				activeRev &&
				activeRev.status !== "revoked" &&
				activeRev.status !== "cleanup_pending" &&
				activeRev.status !== "cleaned_up"
			) {
				retainedRevisionId = activeRev.id;
			}
		}

		// Reset all verification proofs so FRESH verification is required before switch-back!
		const resetEvidence: ChatVerificationEvidence = {
			...(installation.verificationEvidence ?? { source: "verified_setup" }),
			source: "verified_setup",
			identityVerifiedAt: null,
			identityRevisionId: null,
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
			...(reconciledAtIso
				? {
						endpointReconciledAt: reconciledAtIso,
						endpointReconciledGeneration: nextGeneration,
					}
				: {}),
		};

		await txRepo.updateInstallation(input.organizationId, installation.id, {
			status: "candidate",
			revokedAt: null,
			retiredAt: null,
			retirementDeadlineAt: null,
			endpointGeneration: nextGeneration,
			endpointState: nextEndpointState,
			activeCredentialRevisionId: retainedRevisionId,
			verificationState: "unverified",
			verificationEvidence: resetEvidence,
			lastVerifiedAt: null,
			updatedAt: now,
		});

		return {
			kind: "restore_started" as const,
			installationId: installation.id,
			routeId: installation.routeId,
			provider: installation.provider,
			previousStatus: installation.status,
			endpointGeneration: nextGeneration,
			endpointState: nextEndpointState,
			requiresCredentials: retainedRevisionId === null,
			status: "candidate" as const,
		};
	});

	if (txOutcome.kind !== "restore_started") {
		return txOutcome;
	}

	await recordAudit({
		action: AuditAction.CHAT_INSTALLATION_RESTORE_STARTED,
		actorId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: txOutcome.installationId,
		metadata: {
			provider: txOutcome.provider,
			previousStatus: txOutcome.previousStatus,
			endpointGeneration: txOutcome.endpointGeneration,
			endpointState: txOutcome.endpointState,
			requiresCredentials: txOutcome.requiresCredentials,
		},
	});

	return {
		kind: "restore_started",
		installationId: txOutcome.installationId,
		routeId: txOutcome.routeId,
		provider: txOutcome.provider,
		endpointGeneration: txOutcome.endpointGeneration,
		endpointState: txOutcome.endpointState,
		requiresCredentials: txOutcome.requiresCredentials,
		status: "candidate",
	};
}

export type VerifyRestoredChatInstallationRefusalCode =
	| "installation_not_found"
	| "installation_not_in_restore_mode"
	| "endpoint_reconciliation_required"
	| "credentials_required"
	| "invalid_bot_token_format"
	| "invalid_signing_secret_format"
	| "invalid_bot_token"
	| "missing_slack_scope"
	| "invalid_credentials"
	| "external_identity_mismatch"
	| "provider_unavailable"
	| "secret_store_unavailable"
	| "credential_write_failed"
	| "invalid_slack_user_id"
	| "private_delivery_failed";

export type VerifyRestoredChatInstallationResult =
	| {
			kind: "verified_step";
			installationId: string;
			provider: ChatInstallationProvider;
			readyForSwitch: boolean;
			verificationState: ChatVerificationState;
			activeCredentialRevisionId: string | null;
			setupView?: SlackCandidateSetupView;
			preview?: ChatSwitchImpactPreview;
	  }
	| {
			kind: "refused";
			code: VerifyRestoredChatInstallationRefusalCode;
			message: string;
	  };

/**
 * Re-verifies credentials, external identity, provider endpoint state, and optional
 * synthetic private DM test for a candidate installation undergoing restore.
 */
export async function verifyRestoredChatInstallation(
	input: {
		organizationId: string;
		installationId: string;
		actorUserId: string;
		botToken?: string;
		signingSecret?: string;
		slackUserId?: string;
		secrets?: Record<string, string>;
		verifyCredentials?: (
			secrets: Record<string, string>,
			installation: ChatRecoveryInstallationRecord,
		) => Promise<VerifyRotationIdentityResult>;
	},
	deps?: ChatRecoveryRuntimeDeps,
): Promise<VerifyRestoredChatInstallationResult> {
	const repository = resolveRepository(deps);
	const now = getNow(deps);
	const ttlMs = deps?.verificationTtlMs ?? SLACK_VERIFICATION_FRESHNESS_MS;

	let installation = await repository.findInstallationById(
		input.organizationId,
		input.installationId,
	);
	if (!installation) {
		return {
			kind: "refused",
			code: "installation_not_found",
			message: "Chat installation was not found for this organization.",
		};
	}

	if (installation.status !== "candidate") {
		return {
			kind: "refused",
			code: "installation_not_in_restore_mode",
			message: "Start restoring this installation before running fresh verification.",
		};
	}

	if (installation.endpointState === "uncertain") {
		if (!deps?.reconcileProviderEndpoint) {
			return {
				kind: "refused",
				code: "endpoint_reconciliation_required",
				message:
					"Provider endpoint state is uncertain. Reconcile the provider endpoint before marking this installation ready.",
			};
		}
		const stableBotKey = buildStableBotKey(installation);
		const reconciled = await repository.withEndpointLock(stableBotKey, async (txRepo) => {
			const current = await txRepo.findInstallationById(input.organizationId, input.installationId);
			if (!current) return false;
			const result = await deps.reconcileProviderEndpoint!({
				installation: current,
				targetGeneration: current.endpointGeneration,
			});
			if (result.kind !== "reconciled") return false;
			await txRepo.updateInstallation(input.organizationId, current.id, {
				endpointState: "synced",
				verificationEvidence: {
					...(current.verificationEvidence ?? { source: "verified_setup" }),
					source: "verified_setup",
					endpointReconciledAt: now.toISOString(),
					endpointReconciledGeneration: current.endpointGeneration,
				},
				updatedAt: now,
			});
			return true;
		});
		if (!reconciled) {
			return {
				kind: "refused",
				code: "endpoint_reconciliation_required",
				message: "Provider endpoint reconciliation failed. Retry once the endpoint is reachable.",
			};
		}
		installation = (await repository.findInstallationById(
			input.organizationId,
			input.installationId,
		))!;
	}

	const providedSlackCreds = Boolean(input.botToken?.trim() || input.signingSecret?.trim());
	const providedGenericCreds = Boolean(input.secrets && Object.keys(input.secrets).length > 0);

	if (installation.provider === "slack") {
		if (providedSlackCreds) {
			const secrets = {
				bot_token: (input.botToken ?? "").trim(),
				signing_secret: (input.signingSecret ?? "").trim(),
			};
			const verifyResult = await verifySlackSameIdentity(secrets, installation, deps);
			if (verifyResult.kind === "mismatch") {
				return {
					kind: "refused",
					code: "external_identity_mismatch",
					message:
						"Provided Slack credentials belong to a different app or workspace than the installation being restored.",
				};
			}
			if (verifyResult.kind === "invalid_credentials") {
				return { kind: "refused", code: verifyResult.code, message: verifyResult.message };
			}
			if (verifyResult.kind === "unavailable") {
				return { kind: "refused", code: "provider_unavailable", message: verifyResult.message };
			}

			let revision: CredentialRevisionRecord;
			try {
				revision = await storeInstallationCredentialRevision(
					{
						organizationId: input.organizationId,
						installationId: installation.id,
						provider: "slack",
						secrets,
						status: "verified",
						externalIdentityFingerprint: verifyResult.fingerprint ?? null,
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
				return {
					kind: "refused",
					code: isUnavailable ? "secret_store_unavailable" : "credential_write_failed",
					message: isUnavailable
						? "The organization secret store is currently unavailable."
						: "Failed to store credentials for restored installation.",
				};
			}

			const nextEvidence: ChatVerificationEvidence = {
				...(installation.verificationEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
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

			installation = await repository.updateInstallation(input.organizationId, installation.id, {
				activeCredentialRevisionId: revision.id,
				verificationState: "pending",
				verificationEvidence: nextEvidence,
				updatedAt: now,
			});
		} else {
			if (!installation.activeCredentialRevisionId) {
				return {
					kind: "refused",
					code: "credentials_required",
					message:
						"Enter fresh Slack credentials to re-verify this previously revoked installation.",
				};
			}

			const credRead = await readInstallationCredentialRevision(
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
			if (credRead.kind === "unavailable") {
				return {
					kind: "refused",
					code: "secret_store_unavailable",
					message: "The organization secret store is temporarily unavailable.",
				};
			}
			if (credRead.kind !== "ok") {
				return {
					kind: "refused",
					code: "credentials_required",
					message: "Stored credentials are missing or revoked. Enter fresh Slack credentials.",
				};
			}

			const verifyResult = await verifySlackSameIdentity(credRead.secrets, installation, deps);
			if (verifyResult.kind === "mismatch") {
				return {
					kind: "refused",
					code: "external_identity_mismatch",
					message:
						"Stored Slack credentials no longer match this installation's external identity.",
				};
			}
			if (verifyResult.kind === "invalid_credentials") {
				return { kind: "refused", code: verifyResult.code, message: verifyResult.message };
			}
			if (verifyResult.kind === "unavailable") {
				return { kind: "refused", code: "provider_unavailable", message: verifyResult.message };
			}

			const nextEvidence: ChatVerificationEvidence = {
				...(installation.verificationEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
				secretStoreStatus: "available",
				identityVerifiedAt: now.toISOString(),
				identityRevisionId: installation.activeCredentialRevisionId,
				lastFailureStep: null,
				lastFailureCode: null,
				lastFailureAt: null,
			};
			const statusEval = computeSlackCandidateSetupStatus(
				{ ...installation, verificationEvidence: nextEvidence },
				now,
				ttlMs,
			);
			installation = await repository.updateInstallation(input.organizationId, installation.id, {
				verificationEvidence: nextEvidence,
				verificationState: statusEval.effectiveVerificationState,
				lastVerifiedAt: statusEval.readyForSwitch ? now : installation.lastVerifiedAt,
				updatedAt: now,
			});
		}

		// Optional fresh synthetic private DM test
		if (input.slackUserId?.trim()) {
			const dmResult = await sendSlackCandidateTestMessage(
				{
					organizationId: input.organizationId,
					actorUserId: input.actorUserId,
					installationId: installation.id,
					slackUserId: input.slackUserId,
				},
				{
					db: deps?.db,
					repository: deps?.slackSetupRepository,
					revisionRepository: deps?.revisionRepository,
					readSecret: deps?.readSecret,
					sendPrivateDm: deps?.sendPrivateDm,
					recordAudit: deps?.recordAudit,
					appUrl: deps?.appUrl,
					verificationTtlMs: ttlMs,
					now: () => now,
				},
			);
			if (dmResult.kind !== "ok") {
				const mappedCode: VerifyRestoredChatInstallationRefusalCode =
					dmResult.code === "invalid_slack_user_id"
						? "invalid_slack_user_id"
						: dmResult.code === "secret_store_unavailable"
							? "secret_store_unavailable"
							: dmResult.code === "credentials_missing" ||
								  dmResult.code === "credentials_not_configured"
								? "credentials_required"
								: "private_delivery_failed";
				return { kind: "refused", code: mappedCode, message: dmResult.message };
			}
			installation =
				(await repository.findInstallationById(input.organizationId, installation.id)) ??
				installation;
		}

		const computed = computeSlackCandidateSetupStatus(installation, now, ttlMs);
		const setupView =
			deps?.db || deps?.slackSetupRepository
				? await buildSlackCandidateSetupView(
						installation as unknown as SlackCandidateInstallationRecord,
						{
							db: deps?.db,
							repository: deps?.slackSetupRepository,
							appUrl: deps?.appUrl,
							verificationTtlMs: ttlMs,
							now: () => now,
						},
					)
				: undefined;
		const preview = deps?.db
			? await buildChatSwitchImpactPreview(
					{
						organizationId: input.organizationId,
						provider: "slack",
						candidateInstallationId: installation.id,
					},
					{
						...deps.switchDeps,
						db: deps.db,
						now: () => now,
						syncLegacy: false,
						verificationTtlMs: ttlMs,
					},
				)
			: undefined;

		return {
			kind: "verified_step",
			installationId: installation.id,
			provider: "slack",
			readyForSwitch: computed.readyForSwitch,
			verificationState: computed.effectiveVerificationState,
			activeCredentialRevisionId: installation.activeCredentialRevisionId,
			setupView,
			preview,
		};
	}

	// Generic provider restore verification hook (for #2047 Telegram, #2048 Discord, #2050 Teams)
	if (providedGenericCreds && input.verifyCredentials) {
		const verifyResult = await input.verifyCredentials(input.secrets!, installation);
		if (verifyResult.kind === "mismatch") {
			return {
				kind: "refused",
				code: "external_identity_mismatch",
				message: "Provided credentials do not match the installation being restored.",
			};
		}
		if (verifyResult.kind === "invalid_credentials") {
			return { kind: "refused", code: verifyResult.code, message: verifyResult.message };
		}
		if (verifyResult.kind === "unavailable") {
			return { kind: "refused", code: "provider_unavailable", message: verifyResult.message };
		}

		const revision = await storeInstallationCredentialRevision(
			{
				organizationId: input.organizationId,
				installationId: installation.id,
				provider: installation.provider,
				secrets: input.secrets!,
				status: "verified",
				externalIdentityFingerprint: verifyResult.fingerprint ?? null,
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

		installation = await repository.updateInstallation(input.organizationId, installation.id, {
			activeCredentialRevisionId: revision.id,
			verificationState: "verified",
			lastVerifiedAt: now,
			verificationEvidence: {
				...(installation.verificationEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
				identityVerifiedAt: now.toISOString(),
				identityRevisionId: revision.id,
			},
			updatedAt: now,
		});
	}

	const ready =
		installation.verificationState === "verified" &&
		Boolean(installation.activeCredentialRevisionId) &&
		installation.endpointState === "synced";

	return {
		kind: "verified_step",
		installationId: installation.id,
		provider: installation.provider,
		readyForSwitch: ready,
		verificationState: installation.verificationState,
		activeCredentialRevisionId: installation.activeCredentialRevisionId,
	};
}

export type ConfirmChatInstallationRestoreResult =
	| ConfirmChatInstallationSwitchResult
	| {
			kind: "refused";
			code: "endpoint_reconciliation_required";
			message: string;
	  };

/**
 * Confirms restoring a verified candidate installation through the shared atomic switch
 * flow (`confirmChatInstallationSwitch`), enforcing switch control, fresh verification,
 * impact digest match, unready employee acknowledgment, and endpoint state sync.
 */
export async function confirmChatInstallationRestore(
	input: ConfirmChatInstallationSwitchInput,
	deps?: ChatRecoveryRuntimeDeps,
): Promise<ConfirmChatInstallationRestoreResult> {
	const repository = resolveRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;

	const candidate = await repository.findInstallationById(
		input.organizationId,
		input.candidateInstallationId,
	);
	if (candidate && candidate.endpointState === "uncertain") {
		return {
			kind: "refused",
			code: "endpoint_reconciliation_required",
			message:
				"Provider endpoint state is uncertain. Reconcile the provider endpoint before confirming restore.",
		};
	}

	const switchResult = await confirmChatInstallationSwitch(input, {
		...deps?.switchDeps,
		db: deps?.db ?? deps?.switchDeps?.db,
		now: deps?.now ?? deps?.switchDeps?.now,
		verificationTtlMs: deps?.verificationTtlMs ?? deps?.switchDeps?.verificationTtlMs,
		recordAudit: deps?.recordAudit ?? deps?.switchDeps?.recordAudit,
	});

	if (switchResult.kind === "switched") {
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_RESTORED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: switchResult.activeInstallationId,
			metadata: {
				provider: input.provider,
				activeInstallationId: switchResult.activeInstallationId,
				retiredInstallationIds: switchResult.retiredInstallationIds,
				reviewedImpactDigest: input.reviewedImpactDigest,
			},
		});
	}

	return switchResult;
}

// ============================================
// 5. RECOVERY STATE READER (UI / ACTIONS)
// ============================================

export interface ChatRecoveryInstallationView {
	id: string;
	provider: ChatInstallationProvider;
	credentialSource: ChatCredentialSource;
	status: ChatInstallationStatus;
	routeId: string;
	externalAppId: string | null;
	externalBotId: string | null;
	externalBotUsername: string | null;
	externalDisplayName: string | null;
	externalSpaceId: string | null;
	externalSpaceName: string | null;
	activeCredentialRevisionId: string | null;
	verificationState: ChatVerificationState;
	endpointGeneration: number;
	endpointState: ChatInstallationEndpointState;
	lastVerifiedAt: string | null;
	rotatedAt: string | null;
	retiredAt: string | null;
	revokedAt: string | null;
	canRotate: boolean;
	canRevoke: boolean;
	canRestore: boolean;
}

export interface ChatRecoveryCleanupJobView {
	id: string;
	installationId: string;
	kind: ChatInstallationCleanupJobKind;
	status: ChatInstallationCleanupJobStatus;
	attemptCount: number;
	maxAttempts: number;
	lastErrorCode: string | null;
	nextAttemptAt: string;
	exhaustedAt: string | null;
}

export interface ChatInstallationRecoveryState {
	organizationId: string;
	provider: ChatInstallationProvider;
	activeInstallation: ChatRecoveryInstallationView | null;
	restorableInstallations: ChatRecoveryInstallationView[];
	restoreCandidateSetup: SlackCandidateSetupView | null;
	restoreCandidatePreview: ChatSwitchImpactPreview | null;
	pendingCleanupJobs: ChatRecoveryCleanupJobView[];
	rotationGuidance: ProviderRotationGuidance;
}

function toRecoveryInstallationView(
	row: ChatRecoveryInstallationRecord,
): ChatRecoveryInstallationView {
	return {
		id: row.id,
		provider: row.provider,
		credentialSource: row.credentialSource,
		status: row.status,
		routeId: row.routeId,
		externalAppId: row.externalAppId,
		externalBotId: row.externalBotId,
		externalBotUsername: row.externalBotUsername,
		externalDisplayName: row.externalDisplayName,
		externalSpaceId: row.externalSpaceId,
		externalSpaceName: row.externalSpaceName,
		activeCredentialRevisionId: row.activeCredentialRevisionId,
		verificationState: row.verificationState,
		endpointGeneration: row.endpointGeneration,
		endpointState: row.endpointState,
		lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
		rotatedAt: row.verificationEvidence?.rotatedAt ?? null,
		retiredAt: row.retiredAt?.toISOString() ?? null,
		revokedAt: row.revokedAt?.toISOString() ?? null,
		canRotate:
			row.credentialSource === "organization_owned" &&
			(row.status === "active" || row.status === "retiring"),
		canRevoke:
			row.status === "active" || row.status === "legacy_active" || row.status === "retiring",
		canRestore:
			row.credentialSource === "organization_owned" &&
			(row.status === "retiring" || row.status === "retired" || row.status === "revoked"),
	};
}

/**
 * Loads the organization-scoped recovery view (active installation, restorable prior
 * installations, in-progress restore candidate verification & impact preview, redacted
 * cleanup queue status, and provider-specific rotation guidance).
 */
export async function getChatInstallationRecoveryState(
	input: {
		organizationId: string;
		provider: ChatInstallationProvider;
		restoreCandidateId?: string | null;
	},
	deps?: ChatRecoveryRuntimeDeps,
): Promise<ChatInstallationRecoveryState> {
	const repository = resolveRepository(deps);
	const now = getNow(deps);

	const [installations, cleanupJobs] = await Promise.all([
		repository.listInstallationsByProvider(input.organizationId, input.provider),
		repository.listCleanupJobsForProvider(input.organizationId, input.provider),
	]);

	const activeRow =
		installations.find((row) => row.status === "active") ??
		installations.find((row) => row.status === "legacy_active") ??
		null;

	const restorableRows = installations.filter(
		(row) =>
			row.credentialSource === "organization_owned" &&
			(row.status === "retiring" || row.status === "retired" || row.status === "revoked"),
	);

	// Check if there is a candidate undergoing restore (either explicitly passed or one with endpointGeneration > 0)
	const restoreCandidate = input.restoreCandidateId
		? (installations.find(
				(row) => row.id === input.restoreCandidateId && row.status === "candidate",
			) ?? null)
		: (installations.find(
				(row) =>
					row.status === "candidate" &&
					row.credentialSource === "organization_owned" &&
					row.endpointGeneration > 0,
			) ?? null);

	let restoreCandidateSetup: SlackCandidateSetupView | null = null;
	let restoreCandidatePreview: ChatSwitchImpactPreview | null = null;

	if (restoreCandidate && input.provider === "slack" && (deps?.db || deps?.slackSetupRepository)) {
		restoreCandidateSetup = await buildSlackCandidateSetupView(
			restoreCandidate as unknown as SlackCandidateInstallationRecord,
			{
				db: deps?.db,
				repository: deps?.slackSetupRepository,
				appUrl: deps?.appUrl,
				verificationTtlMs: deps?.verificationTtlMs,
				now: () => now,
			},
		);
	}

	if (restoreCandidate && deps?.db) {
		restoreCandidatePreview = await buildChatSwitchImpactPreview(
			{
				organizationId: input.organizationId,
				provider: input.provider,
				candidateInstallationId: restoreCandidate.id,
			},
			{
				...deps.switchDeps,
				db: deps.db,
				now: () => now,
				syncLegacy: false,
				verificationTtlMs: deps.verificationTtlMs,
			},
		);
	}

	const visibleJobs: ChatRecoveryCleanupJobView[] = cleanupJobs
		.filter(
			(job) =>
				job.status === "pending" || job.status === "processing" || job.status === "exhausted",
		)
		.map((job) => ({
			id: job.id,
			installationId: job.installationId,
			kind: job.kind,
			status: job.status,
			attemptCount: job.attemptCount,
			maxAttempts: job.maxAttempts,
			lastErrorCode: job.lastErrorCode,
			nextAttemptAt: job.nextAttemptAt.toISOString(),
			exhaustedAt: job.exhaustedAt?.toISOString() ?? null,
		}));

	return {
		organizationId: input.organizationId,
		provider: input.provider,
		activeInstallation: activeRow ? toRecoveryInstallationView(activeRow) : null,
		restorableInstallations: restorableRows.map(toRecoveryInstallationView),
		restoreCandidateSetup,
		restoreCandidatePreview,
		pendingCleanupJobs: visibleJobs,
		rotationGuidance: getProviderRotationGuidance(input.provider),
	};
}
