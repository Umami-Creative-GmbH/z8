import { mapConcurrently } from "@/lib/async/map-concurrently";
import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, ne } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	type ChatCredentialSource,
	type ChatInstallationProvider,
	type ChatInstallationStatus,
	type ChatLegacyTableName,
	type ChatOwnershipClaimKind,
	type ChatOwnershipClaimProvenance,
	type ChatRemediationDetails,
	type ChatRemediationReason,
	type ChatVerificationEvidence,
	chatExternalOwnershipClaim,
	chatInstallation,
	chatProviderSettings,
	discordBotConfig,
	slackWorkspaceConfig,
	teamsTenantConfig,
	telegramBotConfig,
} from "@/db/schema";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault";
import {
	buildLegacyReceiverScope,
	extractTelegramNumericBotId,
	isKnownLegacySetupStatus,
	isValidDiscordSnowflake,
	isValidGuid,
} from "./legacy-analysis";
import type {
	BackfillAllOrganizationsResult,
	BackfillOrganizationResult,
	ChatEffectiveSettings,
	ChatInstallationsDb,
	ChatInstallationsDeploymentConfig,
	ChatInstallationsRuntimeDeps,
} from "./types";

const logger = createLogger("ChatInstallationsBackfill");

const PROTECTED_LIFECYCLE_STATUSES = new Set<ChatInstallationStatus>([
	"active",
	"retiring",
	"revoked",
]);

function generateRouteId(): string {
	return randomBytes(18).toString("base64url");
}

function getDeploymentConfig(
	override?: ChatInstallationsDeploymentConfig,
): ChatInstallationsDeploymentConfig {
	return {
		microsoftAppId: override?.microsoftAppId ?? env.MICROSOFT_APP_ID,
		microsoftAppPassword: override?.microsoftAppPassword ?? env.MICROSOFT_APP_PASSWORD,
		slackClientId: override?.slackClientId ?? env.SLACK_CLIENT_ID,
	};
}

export type AcquireOwnershipClaimResult =
	| {
			kind: "acquired";
			claim: typeof chatExternalOwnershipClaim.$inferSelect;
	  }
	| {
			kind: "conflict";
	  };

/**
 * Atomically acquires or reuses an external ownership claim for an organization.
 * Returns `{ kind: "conflict" }` when another organization owns the external identity,
 * without leaking the other organization's identifier.
 */
export async function acquireExternalOwnershipClaim(
	input: {
		organizationId: string;
		provider: ChatInstallationProvider;
		claimKind: ChatOwnershipClaimKind;
		externalId: string;
		provenance?: ChatOwnershipClaimProvenance;
		verifiedAt?: Date | null;
	},
	deps?: Pick<ChatInstallationsRuntimeDeps, "db">,
): Promise<AcquireOwnershipClaimResult> {
	const db = deps?.db ?? defaultDb;
	const trimmedExternalId = input.externalId.trim();
	if (!trimmedExternalId) {
		throw new Error("externalId must not be blank");
	}

	const inserted = await db
		.insert(chatExternalOwnershipClaim)
		.values({
			organizationId: input.organizationId,
			provider: input.provider,
			claimKind: input.claimKind,
			externalId: trimmedExternalId,
			provenance: input.provenance ?? "verified_setup",
			verifiedAt: input.verifiedAt ?? null,
		})
		.onConflictDoNothing({
			target: [
				chatExternalOwnershipClaim.provider,
				chatExternalOwnershipClaim.claimKind,
				chatExternalOwnershipClaim.externalId,
			],
		})
		.returning();

	if (inserted[0]) {
		return { kind: "acquired", claim: inserted[0] };
	}

	const [existing] = await db
		.select()
		.from(chatExternalOwnershipClaim)
		.where(
			and(
				eq(chatExternalOwnershipClaim.provider, input.provider),
				eq(chatExternalOwnershipClaim.claimKind, input.claimKind),
				eq(chatExternalOwnershipClaim.externalId, trimmedExternalId),
			),
		)
		.limit(1);

	if (!existing || existing.organizationId !== input.organizationId) {
		return { kind: "conflict" };
	}

	return { kind: "acquired", claim: existing };
}

interface UpsertLegacyInstallationInput {
	organizationId: string;
	provider: ChatInstallationProvider;
	credentialSource: ChatCredentialSource;
	status: ChatInstallationStatus;
	externalAppId: string | null;
	externalBotId: string | null;
	externalBotUsername: string | null;
	externalDisplayName: string | null;
	externalSpaceId: string | null;
	externalSpaceName: string | null;
	receiverScope: string | null;
	spaceClaimId: string | null;
	botClaimId: string | null;
	legacyTable: ChatLegacyTableName;
	legacyRecordId: string;
	legacyStatus: string;
	remediationReason: ChatRemediationReason | null;
	remediationDetails: ChatRemediationDetails | null;
	verificationEvidence: ChatVerificationEvidence;
	createdByUserId: string | null;
	now: Date;
}

function canonicalJson(value: unknown): string {
	if (value === null || value === undefined || typeof value !== "object") {
		return JSON.stringify(value ?? null);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.toSorted(([a], [b]) => a.localeCompare(b));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

async function upsertLegacyInstallation(
	db: ChatInstallationsDb,
	input: UpsertLegacyInstallationInput,
): Promise<"created" | "updated" | "skipped"> {
	const [existing] = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, input.organizationId),
				eq(chatInstallation.legacyTable, input.legacyTable),
				eq(chatInstallation.legacyRecordId, input.legacyRecordId),
			),
		)
		.limit(1);

	if (existing && PROTECTED_LIFECYCLE_STATUSES.has(existing.status)) {
		return "skipped";
	}

	if (!existing) {
		await db
			.insert(chatInstallation)
			.values({
				organizationId: input.organizationId,
				provider: input.provider,
				credentialSource: input.credentialSource,
				status: input.status,
				routeId: generateRouteId(),
				externalAppId: input.externalAppId,
				externalBotId: input.externalBotId,
				externalBotUsername: input.externalBotUsername,
				externalDisplayName: input.externalDisplayName,
				externalSpaceId: input.externalSpaceId,
				externalSpaceName: input.externalSpaceName,
				receiverScope: input.receiverScope,
				spaceClaimId: input.spaceClaimId,
				botClaimId: input.botClaimId,
				legacyTable: input.legacyTable,
				legacyRecordId: input.legacyRecordId,
				legacyStatus: input.legacyStatus,
				remediationReason: input.remediationReason,
				remediationDetails: input.remediationDetails,
				verificationState: "unverified",
				verificationEvidence: input.verificationEvidence,
				retiredAt: input.status === "retired" ? input.now : null,
				createdByUserId: input.createdByUserId,
			})
			.onConflictDoNothing();
		return "created";
	}

	const changed =
		existing.status !== input.status ||
		existing.credentialSource !== input.credentialSource ||
		existing.externalAppId !== input.externalAppId ||
		existing.externalBotId !== input.externalBotId ||
		existing.externalBotUsername !== input.externalBotUsername ||
		existing.externalDisplayName !== input.externalDisplayName ||
		existing.externalSpaceId !== input.externalSpaceId ||
		existing.externalSpaceName !== input.externalSpaceName ||
		existing.receiverScope !== input.receiverScope ||
		existing.spaceClaimId !== input.spaceClaimId ||
		existing.botClaimId !== input.botClaimId ||
		existing.legacyStatus !== input.legacyStatus ||
		existing.remediationReason !== input.remediationReason ||
		canonicalJson(existing.remediationDetails ?? null) !==
			canonicalJson(input.remediationDetails ?? null) ||
		canonicalJson(existing.verificationEvidence ?? null) !==
			canonicalJson(input.verificationEvidence ?? null);

	if (!changed) {
		return "skipped";
	}

	await db
		.update(chatInstallation)
		.set({
			credentialSource: input.credentialSource,
			status: input.status,
			externalAppId: input.externalAppId,
			externalBotId: input.externalBotId,
			externalBotUsername: input.externalBotUsername,
			externalDisplayName: input.externalDisplayName,
			externalSpaceId: input.externalSpaceId,
			externalSpaceName: input.externalSpaceName,
			receiverScope: input.receiverScope,
			spaceClaimId: input.spaceClaimId,
			botClaimId: input.botClaimId,
			legacyStatus: input.legacyStatus,
			remediationReason: input.remediationReason,
			remediationDetails: input.remediationDetails,
			verificationEvidence: input.verificationEvidence,
			retiredAt: input.status === "retired" ? (existing.retiredAt ?? input.now) : null,
			updatedAt: input.now,
		})
		.where(
			and(
				eq(chatInstallation.id, existing.id),
				eq(chatInstallation.organizationId, input.organizationId),
			),
		);

	return "updated";
}

async function seedNonAuthoritativeProviderSettings(
	db: ChatInstallationsDb,
	organizationId: string,
	provider: ChatInstallationProvider,
	settings: ChatEffectiveSettings,
): Promise<void> {
	await db
		.insert(chatProviderSettings)
		.values({
			organizationId,
			provider,
			isAuthoritative: false,
			enableApprovals: settings.enableApprovals,
			enableCommands: settings.enableCommands,
			enableDailyDigest: settings.enableDailyDigest,
			enableEscalations: settings.enableEscalations,
			digestTime: settings.digestTime,
			digestTimezone: settings.digestTimezone,
			escalationTimeoutHours: settings.escalationTimeoutHours,
		})
		.onConflictDoNothing({
			target: [chatProviderSettings.organizationId, chatProviderSettings.provider],
		});
}

function recordOutcome(
	result: BackfillOrganizationResult,
	outcome: "created" | "updated" | "skipped",
	status: ChatInstallationStatus,
) {
	if (outcome === "created") result.createdCount += 1;
	else if (outcome === "updated") result.updatedCount += 1;
	else result.skippedCount += 1;
	if (status === "remediation_required") result.remediationCount += 1;
}

/**
 * Additive, idempotent, resumable legacy backfill for one organization across Slack,
 * Teams (every tenant row), Telegram, and Discord.
 *
 * Legacy tables, settings, receiver scopes, and inbound routes are never mutated.
 */
export async function backfillOrganizationChatInstallations(
	organizationId: string,
	options?: ChatInstallationsRuntimeDeps & {
		knownDuplicateTelegramBotIds?: ReadonlySet<string>;
	},
): Promise<BackfillOrganizationResult> {
	const db = options?.db ?? defaultDb;
	const readSecret = options?.readSecret ?? getOrgSecret;
	const deployment = getDeploymentConfig(options?.deploymentConfig);
	const now = options?.now ? options.now() : new Date();

	const result: BackfillOrganizationResult = {
		organizationId,
		createdCount: 0,
		updatedCount: 0,
		skippedCount: 0,
		remediationCount: 0,
	};

	const [slackRows, teamsRows, telegramRows, discordRows] = await Promise.all([
		db
			.select()
			.from(slackWorkspaceConfig)
			.where(eq(slackWorkspaceConfig.organizationId, organizationId))
			.orderBy(asc(slackWorkspaceConfig.createdAt), asc(slackWorkspaceConfig.id)),
		db
			.select()
			.from(teamsTenantConfig)
			.where(eq(teamsTenantConfig.organizationId, organizationId))
			.orderBy(asc(teamsTenantConfig.createdAt), asc(teamsTenantConfig.id)),
		db
			.select()
			.from(telegramBotConfig)
			.where(eq(telegramBotConfig.organizationId, organizationId))
			.orderBy(asc(telegramBotConfig.createdAt), asc(telegramBotConfig.id)),
		db
			.select()
			.from(discordBotConfig)
			.where(eq(discordBotConfig.organizationId, organizationId))
			.orderBy(asc(discordBotConfig.createdAt), asc(discordBotConfig.id)),
	]);

	// 1. Slack
	for (const row of slackRows) {
		const receiverScope = buildLegacyReceiverScope({
			provider: "slack",
			slackTeamId: row.slackTeamId,
		});
		const teamId = row.slackTeamId.trim();
		const botUserId = row.botUserId?.trim() || null;

		let secretStoreStatus: ChatVerificationEvidence["secretStoreStatus"] = "not_applicable";
		if (row.setupStatus !== "disconnected") {
			try {
				const token = await readSecret(organizationId, "slack/bot_access_token");
				secretStoreStatus =
					token || (row.botAccessToken && row.botAccessToken !== "vault:managed")
						? "available"
						: "missing";
			} catch (error) {
				logger.warn({ error, organizationId }, "Secret store unavailable during Slack backfill");
				secretStoreStatus = "unavailable";
			}
		}

		const evidence: ChatVerificationEvidence = {
			source: "legacy_metadata",
			configuredAt: row.configuredAt?.toISOString() ?? null,
			workspaceId: teamId || null,
			botUserId,
			secretStoreStatus,
		};

		if (row.setupStatus === "disconnected") {
			const outcome = await upsertLegacyInstallation(db, {
				organizationId,
				provider: "slack",
				credentialSource: "deployment_managed",
				status: "retired",
				externalAppId: deployment.slackClientId ?? null,
				externalBotId: botUserId,
				externalBotUsername: null,
				externalDisplayName: row.slackTeamName ?? (teamId || null),
				externalSpaceId: teamId || null,
				externalSpaceName: row.slackTeamName,
				receiverScope,
				spaceClaimId: null,
				botClaimId: null,
				legacyTable: "slack_workspace_config",
				legacyRecordId: row.id,
				legacyStatus: row.setupStatus,
				remediationReason: null,
				remediationDetails: null,
				verificationEvidence: evidence,
				createdByUserId: row.configuredByUserId,
				now,
			});
			recordOutcome(result, outcome, "retired");
			continue;
		}

		await seedNonAuthoritativeProviderSettings(db, organizationId, "slack", row);

		let status: ChatInstallationStatus = "legacy_active";
		let remediationReason: ChatRemediationReason | null = null;
		let remediationDetails: ChatRemediationDetails | null = null;
		let spaceClaimId: string | null = null;
		let botClaimId: string | null = null;

		if (!isKnownLegacySetupStatus("slack", row.setupStatus)) {
			status = "remediation_required";
			remediationReason = "unexpected_legacy_status";
			remediationDetails = {
				legacyStatus: row.setupStatus,
				legacyTable: "slack_workspace_config",
				legacyRecordId: row.id,
				externalIdentityLabel: row.slackTeamName ?? teamId,
			};
		} else if (!teamId || !botUserId) {
			status = "remediation_required";
			remediationReason = "unknown_bot_identity";
			remediationDetails = {
				missingField: !teamId ? "slackTeamId" : "botUserId",
				legacyTable: "slack_workspace_config",
				legacyRecordId: row.id,
				externalIdentityLabel: row.slackTeamName ?? (teamId || null),
			};
		}

		if (teamId) {
			const spaceClaim = await acquireExternalOwnershipClaim(
				{
					organizationId,
					provider: "slack",
					claimKind: "workspace",
					externalId: teamId,
					provenance: "legacy_backfill",
				},
				{ db },
			);
			if (spaceClaim.kind === "conflict") {
				status = "remediation_required";
				remediationReason = "duplicate_external_identity";
				remediationDetails = {
					claimKind: "workspace",
					legacyTable: "slack_workspace_config",
					legacyRecordId: row.id,
					externalIdentityLabel: row.slackTeamName ?? teamId,
				};
			} else {
				spaceClaimId = spaceClaim.claim.id;
			}
		}

		if (status === "legacy_active" && teamId && botUserId) {
			const botClaim = await acquireExternalOwnershipClaim(
				{
					organizationId,
					provider: "slack",
					claimKind: "bot",
					externalId: `${teamId}:${botUserId}`,
					provenance: "legacy_backfill",
				},
				{ db },
			);
			if (botClaim.kind === "conflict") {
				status = "remediation_required";
				remediationReason = "duplicate_external_identity";
				remediationDetails = {
					claimKind: "bot",
					legacyTable: "slack_workspace_config",
					legacyRecordId: row.id,
					externalIdentityLabel: row.slackTeamName ?? teamId,
				};
			} else {
				botClaimId = botClaim.claim.id;
			}
		}

		const outcome = await upsertLegacyInstallation(db, {
			organizationId,
			provider: "slack",
			credentialSource: "deployment_managed",
			status,
			externalAppId: deployment.slackClientId ?? null,
			externalBotId: botUserId,
			externalBotUsername: null,
			externalDisplayName: row.slackTeamName ?? (teamId || null),
			externalSpaceId: teamId || null,
			externalSpaceName: row.slackTeamName,
			receiverScope,
			spaceClaimId,
			botClaimId,
			legacyTable: "slack_workspace_config",
			legacyRecordId: row.id,
			legacyStatus: row.setupStatus,
			remediationReason,
			remediationDetails,
			verificationEvidence: evidence,
			createdByUserId: row.configuredByUserId,
			now,
		});
		recordOutcome(result, outcome, status);
	}

	// 2. Microsoft Teams (EVERY legacy tenant row)
	const deploymentTeamsAppId = isValidGuid(deployment.microsoftAppId)
		? deployment.microsoftAppId.trim()
		: null;
	const deploymentTeamsConfigured = Boolean(
		deploymentTeamsAppId && deployment.microsoftAppPassword?.trim(),
	);

	for (const row of teamsRows) {
		const tenantId = row.tenantId.trim();
		const receiverScope = buildLegacyReceiverScope({
			provider: "teams",
			microsoftAppId: deploymentTeamsAppId,
			tenantId,
		});
		const evidence: ChatVerificationEvidence = {
			source: "legacy_metadata",
			configuredAt: row.configuredAt?.toISOString() ?? null,
			tenantId: tenantId || null,
			applicationId: deploymentTeamsAppId,
			serviceUrlRecorded: Boolean(row.serviceUrl?.trim()),
			deploymentBotConfigured: deploymentTeamsConfigured,
			secretStoreStatus: "not_applicable",
		};

		if (row.setupStatus === "disconnected") {
			const outcome = await upsertLegacyInstallation(db, {
				organizationId,
				provider: "teams",
				credentialSource: "deployment_managed",
				status: "retired",
				externalAppId: deploymentTeamsAppId,
				externalBotId: deploymentTeamsAppId,
				externalBotUsername: null,
				externalDisplayName: row.tenantName ?? (tenantId || null),
				externalSpaceId: tenantId || null,
				externalSpaceName: row.tenantName,
				receiverScope,
				spaceClaimId: null,
				botClaimId: null,
				legacyTable: "teams_tenant_config",
				legacyRecordId: row.id,
				legacyStatus: row.setupStatus,
				remediationReason: null,
				remediationDetails: null,
				verificationEvidence: evidence,
				createdByUserId: row.configuredByUserId,
				now,
			});
			recordOutcome(result, outcome, "retired");
			continue;
		}

		await seedNonAuthoritativeProviderSettings(db, organizationId, "teams", row);

		let status: ChatInstallationStatus = "legacy_active";
		let remediationReason: ChatRemediationReason | null = null;
		let remediationDetails: ChatRemediationDetails | null = null;
		let spaceClaimId: string | null = null;

		if (!isKnownLegacySetupStatus("teams", row.setupStatus)) {
			status = "remediation_required";
			remediationReason = "unexpected_legacy_status";
			remediationDetails = {
				legacyStatus: row.setupStatus,
				legacyTable: "teams_tenant_config",
				legacyRecordId: row.id,
				externalIdentityLabel: row.tenantName ?? tenantId,
			};
		} else if (!isValidGuid(tenantId) || !deploymentTeamsAppId) {
			status = "remediation_required";
			remediationReason = "unknown_bot_identity";
			remediationDetails = {
				missingField: !isValidGuid(tenantId) ? "tenantId" : "MICROSOFT_APP_ID",
				legacyTable: "teams_tenant_config",
				legacyRecordId: row.id,
				externalIdentityLabel: row.tenantName ?? (tenantId || null),
			};
		}

		if (isValidGuid(tenantId)) {
			const tenantClaim = await acquireExternalOwnershipClaim(
				{
					organizationId,
					provider: "teams",
					claimKind: "tenant",
					externalId: tenantId,
					provenance: "legacy_backfill",
				},
				{ db },
			);
			if (tenantClaim.kind === "conflict") {
				status = "remediation_required";
				remediationReason = "duplicate_external_identity";
				remediationDetails = {
					claimKind: "tenant",
					legacyTable: "teams_tenant_config",
					legacyRecordId: row.id,
					externalIdentityLabel: row.tenantName ?? tenantId,
				};
			} else {
				spaceClaimId = tenantClaim.claim.id;
			}
		}

		const outcome = await upsertLegacyInstallation(db, {
			organizationId,
			provider: "teams",
			credentialSource: "deployment_managed",
			status,
			externalAppId: deploymentTeamsAppId,
			externalBotId: deploymentTeamsAppId,
			externalBotUsername: null,
			externalDisplayName: row.tenantName ?? (tenantId || null),
			externalSpaceId: tenantId || null,
			externalSpaceName: row.tenantName,
			receiverScope,
			spaceClaimId,
			// Shared deployment-managed Teams bot is NOT claimed as an org-exclusive bot.
			botClaimId: null,
			legacyTable: "teams_tenant_config",
			legacyRecordId: row.id,
			legacyStatus: row.setupStatus,
			remediationReason,
			remediationDetails,
			verificationEvidence: evidence,
			createdByUserId: row.configuredByUserId,
			now,
		});
		recordOutcome(result, outcome, status);
	}

	// 3. Telegram
	for (const row of telegramRows) {
		const displayName = row.botDisplayName ?? (row.botUsername ? `@${row.botUsername}` : null);

		if (row.setupStatus === "disconnected") {
			const outcome = await upsertLegacyInstallation(db, {
				organizationId,
				provider: "telegram",
				credentialSource: "organization_owned",
				status: "retired",
				externalAppId: null,
				externalBotId: null,
				externalBotUsername: row.botUsername,
				externalDisplayName: displayName,
				externalSpaceId: null,
				externalSpaceName: null,
				receiverScope: null,
				spaceClaimId: null,
				botClaimId: null,
				legacyTable: "telegram_bot_config",
				legacyRecordId: row.id,
				legacyStatus: row.setupStatus,
				remediationReason: null,
				remediationDetails: null,
				verificationEvidence: {
					source: "legacy_metadata",
					configuredAt: row.configuredAt?.toISOString() ?? null,
					botUsername: row.botUsername,
					webhookRegistered: row.webhookRegistered,
					secretStoreStatus: "not_applicable",
				},
				createdByUserId: row.configuredByUserId,
				now,
			});
			recordOutcome(result, outcome, "retired");
			continue;
		}

		await seedNonAuthoritativeProviderSettings(db, organizationId, "telegram", row);

		let secretStoreStatus: ChatVerificationEvidence["secretStoreStatus"] = "missing";
		let token: string | null = null;
		try {
			token = await readSecret(organizationId, "telegram/bot_token");
			if (!token && row.botToken && row.botToken !== "vault:managed") {
				token = row.botToken;
			}
			secretStoreStatus = token ? "available" : "missing";
		} catch (error) {
			logger.warn({ error, organizationId }, "Secret store unavailable during Telegram backfill");
			secretStoreStatus = "unavailable";
		}

		const numericBotId = extractTelegramNumericBotId(token);
		const receiverScope = buildLegacyReceiverScope({
			provider: "telegram",
			numericBotId,
		});

		const evidence: ChatVerificationEvidence = {
			source: "legacy_metadata",
			configuredAt: row.configuredAt?.toISOString() ?? null,
			botUsername: row.botUsername,
			numericBotId,
			webhookRegistered: row.webhookRegistered,
			secretStoreStatus,
		};

		let status: ChatInstallationStatus = "legacy_active";
		let remediationReason: ChatRemediationReason | null = null;
		let remediationDetails: ChatRemediationDetails | null = null;
		let botClaimId: string | null = null;

		if (!isKnownLegacySetupStatus("telegram", row.setupStatus)) {
			status = "remediation_required";
			remediationReason = "unexpected_legacy_status";
			remediationDetails = {
				legacyStatus: row.setupStatus,
				legacyTable: "telegram_bot_config",
				legacyRecordId: row.id,
				externalIdentityLabel: displayName,
			};
		} else if (secretStoreStatus === "unavailable") {
			status = "remediation_required";
			remediationReason = "secret_store_unavailable";
			remediationDetails = {
				secretStoreUnavailable: true,
				legacyTable: "telegram_bot_config",
				legacyRecordId: row.id,
				externalIdentityLabel: displayName,
			};
		} else if (!numericBotId) {
			status = "remediation_required";
			remediationReason = "unknown_bot_identity";
			remediationDetails = {
				missingField: "numericBotId",
				legacyTable: "telegram_bot_config",
				legacyRecordId: row.id,
				externalIdentityLabel: displayName,
			};
		} else if (options?.knownDuplicateTelegramBotIds?.has(numericBotId)) {
			status = "remediation_required";
			remediationReason = "duplicate_external_identity";
			remediationDetails = {
				claimKind: "bot",
				legacyTable: "telegram_bot_config",
				legacyRecordId: row.id,
				externalIdentityLabel: displayName ?? numericBotId,
			};
		} else {
			const botClaim = await acquireExternalOwnershipClaim(
				{
					organizationId,
					provider: "telegram",
					claimKind: "bot",
					externalId: numericBotId,
					provenance: "legacy_backfill",
				},
				{ db },
			);
			if (botClaim.kind === "conflict") {
				status = "remediation_required";
				remediationReason = "duplicate_external_identity";
				remediationDetails = {
					claimKind: "bot",
					legacyTable: "telegram_bot_config",
					legacyRecordId: row.id,
					externalIdentityLabel: displayName ?? numericBotId,
				};
			} else {
				botClaimId = botClaim.claim.id;
			}
		}

		const outcome = await upsertLegacyInstallation(db, {
			organizationId,
			provider: "telegram",
			credentialSource: "organization_owned",
			status,
			externalAppId: numericBotId,
			externalBotId: numericBotId,
			externalBotUsername: row.botUsername,
			externalDisplayName: displayName,
			externalSpaceId: null,
			externalSpaceName: null,
			receiverScope,
			spaceClaimId: null,
			botClaimId,
			legacyTable: "telegram_bot_config",
			legacyRecordId: row.id,
			legacyStatus: row.setupStatus,
			remediationReason,
			remediationDetails,
			verificationEvidence: evidence,
			createdByUserId: row.configuredByUserId,
			now,
		});
		recordOutcome(result, outcome, status);
	}

	// 4. Discord
	for (const row of discordRows) {
		const appId = row.applicationId.trim();
		const validAppId = isValidDiscordSnowflake(appId) ? appId : null;
		const receiverScope = buildLegacyReceiverScope({
			provider: "discord",
			applicationId: validAppId,
		});

		let secretStoreStatus: ChatVerificationEvidence["secretStoreStatus"] = "not_applicable";
		if (row.setupStatus !== "disconnected") {
			try {
				const token = await readSecret(organizationId, "discord/bot_token");
				secretStoreStatus =
					token || (row.botToken && row.botToken !== "vault:managed") ? "available" : "missing";
			} catch (error) {
				logger.warn({ error, organizationId }, "Secret store unavailable during Discord backfill");
				secretStoreStatus = "unavailable";
			}
		}

		const evidence: ChatVerificationEvidence = {
			source: "legacy_metadata",
			configuredAt: row.configuredAt?.toISOString() ?? null,
			applicationId: validAppId,
			interactionEndpointConfigured: row.interactionEndpointConfigured,
			secretStoreStatus,
		};

		if (row.setupStatus === "disconnected") {
			const outcome = await upsertLegacyInstallation(db, {
				organizationId,
				provider: "discord",
				credentialSource: "organization_owned",
				status: "retired",
				externalAppId: validAppId,
				externalBotId: validAppId,
				externalBotUsername: null,
				externalDisplayName: validAppId,
				externalSpaceId: null,
				externalSpaceName: null,
				receiverScope,
				spaceClaimId: null,
				botClaimId: null,
				legacyTable: "discord_bot_config",
				legacyRecordId: row.id,
				legacyStatus: row.setupStatus,
				remediationReason: null,
				remediationDetails: null,
				verificationEvidence: evidence,
				createdByUserId: row.configuredByUserId,
				now,
			});
			recordOutcome(result, outcome, "retired");
			continue;
		}

		await seedNonAuthoritativeProviderSettings(db, organizationId, "discord", row);

		let status: ChatInstallationStatus = "legacy_active";
		let remediationReason: ChatRemediationReason | null = null;
		let remediationDetails: ChatRemediationDetails | null = null;
		let botClaimId: string | null = null;

		if (!isKnownLegacySetupStatus("discord", row.setupStatus)) {
			status = "remediation_required";
			remediationReason = "unexpected_legacy_status";
			remediationDetails = {
				legacyStatus: row.setupStatus,
				legacyTable: "discord_bot_config",
				legacyRecordId: row.id,
				externalIdentityLabel: validAppId ?? (appId || null),
			};
		} else if (!validAppId) {
			status = "remediation_required";
			remediationReason = "unknown_bot_identity";
			remediationDetails = {
				missingField: "applicationId",
				legacyTable: "discord_bot_config",
				legacyRecordId: row.id,
				externalIdentityLabel: appId || null,
			};
		} else {
			// Detect conflicting legacy Discord bot identities across organizations before assigning a claim.
			const conflictingLegacy = await db
				.select({ id: discordBotConfig.id })
				.from(discordBotConfig)
				.where(
					and(
						eq(discordBotConfig.applicationId, validAppId),
						ne(discordBotConfig.organizationId, organizationId),
						ne(discordBotConfig.setupStatus, "disconnected"),
					),
				)
				.limit(1);

			if (conflictingLegacy.length > 0) {
				status = "remediation_required";
				remediationReason = "duplicate_external_identity";
				remediationDetails = {
					claimKind: "bot",
					legacyTable: "discord_bot_config",
					legacyRecordId: row.id,
					externalIdentityLabel: validAppId,
				};
			} else {
				const botClaim = await acquireExternalOwnershipClaim(
					{
						organizationId,
						provider: "discord",
						claimKind: "bot",
						externalId: validAppId,
						provenance: "legacy_backfill",
					},
					{ db },
				);
				if (botClaim.kind === "conflict") {
					status = "remediation_required";
					remediationReason = "duplicate_external_identity";
					remediationDetails = {
						claimKind: "bot",
						legacyTable: "discord_bot_config",
						legacyRecordId: row.id,
						externalIdentityLabel: validAppId,
					};
				} else {
					botClaimId = botClaim.claim.id;
				}
			}
		}

		const outcome = await upsertLegacyInstallation(db, {
			organizationId,
			provider: "discord",
			credentialSource: "organization_owned",
			status,
			externalAppId: validAppId,
			externalBotId: validAppId,
			externalBotUsername: null,
			externalDisplayName: validAppId,
			externalSpaceId: null,
			externalSpaceName: null,
			receiverScope,
			spaceClaimId: null,
			botClaimId,
			legacyTable: "discord_bot_config",
			legacyRecordId: row.id,
			legacyStatus: row.setupStatus,
			remediationReason,
			remediationDetails,
			verificationEvidence: evidence,
			createdByUserId: row.configuredByUserId,
			now,
		});
		recordOutcome(result, outcome, status);
	}

	return result;
}

/**
 * Resumable, cursor-paginated batch backfill across all organizations with legacy chat rows.
 * Pre-scans active legacy Telegram tokens to detect cross-organization duplicate bot IDs
 * before assigning ownership claims.
 */
export async function backfillAllLegacyChatInstallations(
	options?: ChatInstallationsRuntimeDeps & {
		cursor?: string | null;
		limit?: number;
	},
): Promise<BackfillAllOrganizationsResult> {
	const db = options?.db ?? defaultDb;
	const readSecret = options?.readSecret ?? getOrgSecret;
	const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
	const cursor = options?.cursor?.trim() || null;

	const [slackOrgs, teamsOrgs, telegramOrgs, discordOrgs] = await Promise.all([
		db
			.selectDistinct({ organizationId: slackWorkspaceConfig.organizationId })
			.from(slackWorkspaceConfig)
			.where(cursor ? gt(slackWorkspaceConfig.organizationId, cursor) : undefined),
		db
			.selectDistinct({ organizationId: teamsTenantConfig.organizationId })
			.from(teamsTenantConfig)
			.where(cursor ? gt(teamsTenantConfig.organizationId, cursor) : undefined),
		db
			.selectDistinct({ organizationId: telegramBotConfig.organizationId })
			.from(telegramBotConfig)
			.where(cursor ? gt(telegramBotConfig.organizationId, cursor) : undefined),
		db
			.selectDistinct({ organizationId: discordBotConfig.organizationId })
			.from(discordBotConfig)
			.where(cursor ? gt(discordBotConfig.organizationId, cursor) : undefined),
	]);

	const allOrgIds = Array.from(
		new Set([
			...slackOrgs.map((r) => r.organizationId),
			...teamsOrgs.map((r) => r.organizationId),
			...telegramOrgs.map((r) => r.organizationId),
			...discordOrgs.map((r) => r.organizationId),
		]),
	).toSorted();

	const hasMore = allOrgIds.length > limit;
	const pageOrgIds = allOrgIds.slice(0, limit);

	// Pre-scan all non-disconnected Telegram bots so cross-org duplicate bot IDs are detected
	// before either organization acquires a legacy ownership claim.
	const allLiveTelegramRows = await db
		.select({
			organizationId: telegramBotConfig.organizationId,
			botToken: telegramBotConfig.botToken,
		})
		.from(telegramBotConfig)
		.where(ne(telegramBotConfig.setupStatus, "disconnected"));

	const telegramBotIdToOrgs = new Map<string, Set<string>>();
	await mapConcurrently(allLiveTelegramRows, 4, async (row) => {
		try {
			let token = await readSecret(row.organizationId, "telegram/bot_token");
			if (!token && row.botToken && row.botToken !== "vault:managed") {
				token = row.botToken;
			}
			const numericBotId = extractTelegramNumericBotId(token);
			if (numericBotId) {
				const orgs = telegramBotIdToOrgs.get(numericBotId) ?? new Set<string>();
				orgs.add(row.organizationId);
				telegramBotIdToOrgs.set(numericBotId, orgs);
			}
		} catch {
			// Secret store outages are handled per-org during backfill.
		}
	});

	const duplicateTelegramBotIds = new Set<string>();
	for (const [botId, orgs] of telegramBotIdToOrgs) {
		if (orgs.size > 1) {
			duplicateTelegramBotIds.add(botId);
		}
	}

	const totals = {
		createdCount: 0,
		updatedCount: 0,
		skippedCount: 0,
		remediationCount: 0,
	};

	for (const orgId of pageOrgIds) {
		// react-doctor-disable-next-line react-doctor/async-await-in-loop -- Finish the current organization before advancing the resumable migration cursor.
		const orgResult = await backfillOrganizationChatInstallations(orgId, {
			...options,
			knownDuplicateTelegramBotIds: duplicateTelegramBotIds,
		});
		totals.createdCount += orgResult.createdCount;
		totals.updatedCount += orgResult.updatedCount;
		totals.skippedCount += orgResult.skippedCount;
		totals.remediationCount += orgResult.remediationCount;
	}

	return {
		processedOrganizationIds: pageOrgIds,
		nextCursor: hasMore ? (pageOrgIds.at(-1) ?? null) : null,
		hasMore,
		totals,
	};
}
