import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db as defaultDb } from "@/db";
import { member } from "@/db/auth-schema";
import {
	CHAT_INSTALLATION_PROVIDERS,
	type ChatConversationReachabilityStatus,
	type ChatInstallationProvider,
	type ChatLinkProofPurpose,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationLinkAttempt,
	chatInstallationLinkProof,
	chatInstallationMemberLink,
	discordBotConfig,
	discordUserMapping,
	employee,
	slackUserMapping,
	slackWorkspaceConfig,
	teamsTenantConfig,
	teamsUserMapping,
	telegramBotConfig,
	telegramUserMapping,
} from "@/db/schema";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { createLogger } from "@/lib/logger";
import type { NotificationChannel } from "@/lib/notifications/types";
import { backfillOrganizationChatInstallations } from "./backfill";
import { extractTelegramNumericBotId } from "./legacy-analysis";
import type { ChatInstallationsRuntimeDeps } from "./types";

const logger = createLogger("ChatInstallationMemberLinks");

// ============================================
// CONSTANTS & TYPES
// ============================================

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 unambiguous chars (5 bits/char)
const CODE_RAW_LENGTH = 12; // 60 bits of cryptographic entropy

export const CHAT_LINK_PROOF_TTL_MINUTES = 10;
export const CHAT_LINK_ISSUE_RATE_LIMIT_MAX = 5;
export const CHAT_LINK_REDEEM_RATE_LIMIT_MAX = 5;
export const CHAT_LINK_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export type OrganizationChatChannelAvailability = Record<ChatInstallationProvider, boolean>;

export type MemberChatLinkStatus =
	| "connected"
	| "action_needed"
	| "could_not_verify"
	| "unavailable";

export type MemberChatLinkRecoveryHint =
	| "link_required"
	| "start_bot_private_chat"
	| "verification_error"
	| "installation_remediation"
	| null;

export interface MemberChatCandidateEnrollmentView {
	installationId: string;
	botUsername: string | null;
	installationLabel: string | null;
	status: "enrolled" | "action_needed";
	externalUsername: string | null;
	externalDisplayName: string | null;
	canGenerateLinkCode: boolean;
}

export interface MemberChatChannelLinkView {
	provider: ChatInstallationProvider;
	available: boolean;
	status: MemberChatLinkStatus;
	installationId: string | null;
	installationLabel: string | null;
	botUsername: string | null;
	externalUsername: string | null;
	externalDisplayName: string | null;
	canGenerateLinkCode: boolean;
	canUnlink: boolean;
	recoveryHint: MemberChatLinkRecoveryHint;
	candidateEnrollment?: MemberChatCandidateEnrollmentView | null;
}

export interface MemberChatLinksSnapshot {
	organizationId: string | null;
	hasOrganizationContext: boolean;
	channels: MemberChatChannelLinkView[];
}

export type ChatLinkMemberEligibility =
	| { eligible: true; userId: string; employeeId: string }
	| { eligible: false; reason: "not_member" | "no_employee" | "former_employee" };

export interface ChatLinkRuntimeDeps extends ChatInstallationsRuntimeDeps {
	db?: typeof defaultDb;
	syncLegacy?: boolean;
	issueRateLimitMax?: number;
	redeemRateLimitMax?: number;
	rateLimitWindowMs?: number;
	checkEligibility?: (
		userId: string,
		organizationId: string,
		dbClient: Pick<typeof defaultDb, "select">,
		now: Date,
	) => Promise<ChatLinkMemberEligibility>;
}

export interface IssueChatLinkProofInput {
	organizationId: string;
	installationId: string;
	userId: string;
	purpose: ChatLinkProofPurpose;
	ttlMinutes?: number;
}

export type IssueChatLinkProofResult =
	| {
			status: "issued";
			proofId: string;
			code: string;
			expiresAt: Date;
			installationId: string;
			purpose: ChatLinkProofPurpose;
			botUsername: string | null;
	  }
	| { status: "installation_unavailable" }
	| { status: "ineligible"; reason: "not_member" | "no_employee" | "former_employee" }
	| { status: "rate_limited"; retryAfterSeconds: number };

export interface RedeemChatLinkProofInput {
	organizationId: string;
	installationId: string;
	purpose: ChatLinkProofPurpose;
	code: string;
	externalUserId: string;
	externalUsername?: string | null;
	externalDisplayName?: string | null;
	externalConversationId?: string | null;
	conversationType?: string;
	conversationReference?: Record<string, unknown> | null;
}

export type RedeemChatLinkProofResult =
	| {
			status: "success";
			userId: string;
			employeeId: string;
			linkId: string;
			installationId: string;
			isCandidateEnrollment: boolean;
	  }
	| { status: "invalid_code" }
	| { status: "expired" }
	| { status: "already_used" }
	| { status: "already_linked" }
	| { status: "ineligible"; reason: "not_member" | "no_employee" | "former_employee" }
	| { status: "rate_limited"; retryAfterSeconds: number }
	| { status: "installation_unavailable" };

export interface ReuseVerifiedExternalIdentityInput {
	organizationId: string;
	sourceInstallationId: string;
	targetInstallationId: string;
	userId: string;
	targetIsCandidateEnrollment?: boolean;
}

export type ReuseVerifiedExternalIdentityResult =
	| {
			status: "reused";
			linkId: string;
			externalUserId: string;
			externalScope: string;
			isCandidateEnrollment: boolean;
	  }
	| { status: "ineligible"; reason: "not_member" | "no_employee" | "former_employee" }
	| { status: "installation_not_found" }
	| { status: "scope_mismatch" }
	| { status: "no_verified_identity" }
	| { status: "already_linked" };

// ============================================
// PURE HELPERS
// ============================================

export function normalizeChatLinkCode(rawCode: string): string {
	return rawCode.replace(/[\s-]+/g, "").toUpperCase();
}

export function hashChatLinkCode(
	rawCode: string,
	context: {
		organizationId: string;
		installationId: string;
		purpose: ChatLinkProofPurpose;
	},
): string {
	const normalized = normalizeChatLinkCode(rawCode);
	return createHash("sha256")
		.update(
			`v1:${context.organizationId}:${context.installationId}:${context.purpose}:${normalized}`,
		)
		.digest("hex");
}

export function generateChatLinkCode(): string {
	const bytes = randomBytes(CODE_RAW_LENGTH);
	let raw = "";
	for (let i = 0; i < CODE_RAW_LENGTH; i++) {
		// 256 is an exact multiple of 32, so bitmasking produces uniform indices.
		raw += CODE_ALPHABET[bytes[i] & 31];
	}
	return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function buildVerifiedExternalScope(installation: {
	provider: ChatInstallationProvider;
	externalSpaceId: string | null;
	externalBotId: string | null;
	externalAppId: string | null;
}): string | null {
	switch (installation.provider) {
		case "slack": {
			const teamId = installation.externalSpaceId?.trim();
			return teamId ? `slack:workspace:${teamId}` : null;
		}
		case "teams": {
			const tenantId = installation.externalSpaceId?.trim();
			return tenantId ? `teams:tenant:${tenantId}` : null;
		}
		case "telegram": {
			const botId = installation.externalBotId?.trim();
			return botId ? `telegram:bot:${botId}` : null;
		}
		case "discord": {
			const appId = installation.externalAppId?.trim();
			return appId ? `discord:app:${appId}` : null;
		}
	}
}

export function buildAvailableNotificationChannels(
	chatAvailability: OrganizationChatChannelAvailability,
): Record<NotificationChannel, boolean> {
	return {
		in_app: true,
		push: true,
		email: true,
		teams: chatAvailability.teams,
		telegram: chatAvailability.telegram,
		discord: chatAvailability.discord,
		slack: chatAvailability.slack,
	};
}

export function deriveMemberChannelLinkStatus(input: {
	hasActiveInstallation: boolean;
	hasRemediationInstallation: boolean;
	verificationFailed: boolean;
	hasLiveLink: boolean;
	conversationReachability: ChatConversationReachabilityStatus | null;
}): { status: MemberChatLinkStatus; recoveryHint: MemberChatLinkRecoveryHint } {
	if (input.verificationFailed) {
		return { status: "could_not_verify", recoveryHint: "verification_error" };
	}
	if (!input.hasActiveInstallation) {
		if (input.hasRemediationInstallation) {
			return { status: "could_not_verify", recoveryHint: "installation_remediation" };
		}
		return { status: "unavailable", recoveryHint: null };
	}
	if (!input.hasLiveLink) {
		return { status: "action_needed", recoveryHint: "link_required" };
	}
	if (
		input.conversationReachability === "unreachable" ||
		input.conversationReachability === "action_needed"
	) {
		return { status: "action_needed", recoveryHint: "start_bot_private_chat" };
	}
	return { status: "connected", recoveryHint: null };
}

// ============================================
// SHARED ORGANIZATION CHANNEL AVAILABILITY
// ============================================

/**
 * Single organization-scoped channel availability reader shared by
 * Settings -> Notifications and GET /api/notifications/preferences.
 * Absent organization context returns all chat channels as unavailable without failing.
 */
export async function getOrganizationChatChannelAvailability(
	organizationId: string | null | undefined,
	deps?: Pick<ChatInstallationsRuntimeDeps, "db">,
): Promise<OrganizationChatChannelAvailability> {
	const unavailable: OrganizationChatChannelAvailability = {
		teams: false,
		telegram: false,
		discord: false,
		slack: false,
	};

	const trimmedOrgId = organizationId?.trim();
	if (!trimmedOrgId) {
		return unavailable;
	}

	const db = deps?.db ?? defaultDb;

	const [installations, activeSlack, activeTeams, activeTelegram, activeDiscord] =
		await Promise.all([
			db
				.select({
					provider: chatInstallation.provider,
					status: chatInstallation.status,
				})
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.organizationId, trimmedOrgId),
						inArray(chatInstallation.status, ["active", "legacy_active"]),
					),
				),
			db
				.select({ id: slackWorkspaceConfig.id })
				.from(slackWorkspaceConfig)
				.where(
					and(
						eq(slackWorkspaceConfig.organizationId, trimmedOrgId),
						eq(slackWorkspaceConfig.setupStatus, "active"),
					),
				)
				.limit(1),
			db
				.select({ id: teamsTenantConfig.id })
				.from(teamsTenantConfig)
				.where(
					and(
						eq(teamsTenantConfig.organizationId, trimmedOrgId),
						eq(teamsTenantConfig.setupStatus, "active"),
					),
				)
				.limit(1),
			db
				.select({ id: telegramBotConfig.id })
				.from(telegramBotConfig)
				.where(
					and(
						eq(telegramBotConfig.organizationId, trimmedOrgId),
						eq(telegramBotConfig.setupStatus, "active"),
					),
				)
				.limit(1),
			db
				.select({ id: discordBotConfig.id })
				.from(discordBotConfig)
				.where(
					and(
						eq(discordBotConfig.organizationId, trimmedOrgId),
						eq(discordBotConfig.setupStatus, "active"),
					),
				)
				.limit(1),
		]);

	const activeProviders = new Set(installations.map((row) => row.provider));

	return {
		slack: activeProviders.has("slack") || activeSlack.length > 0,
		teams: activeProviders.has("teams") || activeTeams.length > 0,
		telegram: activeProviders.has("telegram") || activeTelegram.length > 0,
		discord: activeProviders.has("discord") || activeDiscord.length > 0,
	};
}

// ============================================
// MEMBER ELIGIBILITY & RATE LIMITING
// ============================================

export async function verifyEligibleChatLinkMember(
	userId: string,
	organizationId: string,
	deps?: Pick<ChatLinkRuntimeDeps, "db" | "now" | "checkEligibility">,
): Promise<ChatLinkMemberEligibility> {
	const db = deps?.db ?? defaultDb;
	const now = deps?.now ? deps.now() : new Date();
	if (deps?.checkEligibility) {
		return deps.checkEligibility(userId, organizationId, db, now);
	}

	const nowInstant = Temporal.Instant.fromEpochMilliseconds(now.getTime());

	const [membership] = await db
		.select({ id: member.id })
		.from(member)
		.where(
			and(
				eq(member.userId, userId),
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
		)
		.limit(1);

	if (!membership) {
		return { eligible: false, reason: "not_member" };
	}

	const [anyEmployee] = await db
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.userId, userId), eq(employee.organizationId, organizationId)))
		.limit(1);

	if (!anyEmployee) {
		return { eligible: false, reason: "no_employee" };
	}

	const [currentEmployee] = await db
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.userId, userId), onCurrentRoster(organizationId, employee, nowInstant)))
		.limit(1);

	if (!currentEmployee) {
		return { eligible: false, reason: "former_employee" };
	}

	return { eligible: true, userId, employeeId: currentEmployee.id };
}

function computeRetryAfterSeconds(windowStart: Date, now: Date, windowMs: number): number {
	const startInstant = Temporal.Instant.fromEpochMilliseconds(windowStart.getTime());
	const nowInstant = Temporal.Instant.fromEpochMilliseconds(now.getTime());
	const expiresInstant = startInstant.add({ milliseconds: windowMs });
	const remainingSeconds = expiresInstant.since(nowInstant).total({ unit: "seconds" });
	return Math.max(1, Math.ceil(remainingSeconds));
}

async function checkRateLimitStatus(
	db: Pick<typeof defaultDb, "select">,
	params: {
		organizationId: string;
		installationId: string;
		purpose: ChatLinkProofPurpose;
		actorKey: string;
		maxAttempts: number;
		windowMs: number;
		now: Date;
	},
): Promise<{ limited: false } | { limited: true; retryAfterSeconds: number }> {
	const [counter] = await db
		.select()
		.from(chatInstallationLinkAttempt)
		.where(
			and(
				eq(chatInstallationLinkAttempt.organizationId, params.organizationId),
				eq(chatInstallationLinkAttempt.installationId, params.installationId),
				eq(chatInstallationLinkAttempt.purpose, params.purpose),
				eq(chatInstallationLinkAttempt.actorKey, params.actorKey),
			),
		)
		.limit(1);

	if (!counter) {
		return { limited: false };
	}

	const windowStartInstant = Temporal.Instant.fromEpochMilliseconds(
		counter.rateLimitWindowStart.getTime(),
	);
	const nowInstant = Temporal.Instant.fromEpochMilliseconds(params.now.getTime());
	const elapsedMs = nowInstant.since(windowStartInstant).total({ unit: "milliseconds" });

	if (elapsedMs >= params.windowMs) {
		return { limited: false };
	}

	if (counter.attemptCount >= params.maxAttempts) {
		return {
			limited: true,
			retryAfterSeconds: computeRetryAfterSeconds(
				counter.rateLimitWindowStart,
				params.now,
				params.windowMs,
			),
		};
	}

	return { limited: false };
}

async function incrementRateLimitAttempt(
	db: Pick<typeof defaultDb, "insert">,
	params: {
		organizationId: string;
		installationId: string;
		purpose: ChatLinkProofPurpose;
		actorKey: string;
		windowMs: number;
		now: Date;
	},
): Promise<{ attemptCount: number; rateLimitWindowStart: Date }> {
	const windowCutoff = new Date(
		Temporal.Instant.fromEpochMilliseconds(params.now.getTime()).subtract({
			milliseconds: params.windowMs,
		}).epochMilliseconds,
	);

	const [row] = await db
		.insert(chatInstallationLinkAttempt)
		.values({
			organizationId: params.organizationId,
			installationId: params.installationId,
			purpose: params.purpose,
			actorKey: params.actorKey,
			attemptCount: 1,
			rateLimitWindowStart: params.now,
			lastAttemptAt: params.now,
		})
		.onConflictDoUpdate({
			target: [
				chatInstallationLinkAttempt.organizationId,
				chatInstallationLinkAttempt.installationId,
				chatInstallationLinkAttempt.purpose,
				chatInstallationLinkAttempt.actorKey,
			],
			set: {
				attemptCount: sql`CASE WHEN ${chatInstallationLinkAttempt.rateLimitWindowStart} <= ${windowCutoff} THEN 1 ELSE ${chatInstallationLinkAttempt.attemptCount} + 1 END`,
				rateLimitWindowStart: sql`CASE WHEN ${chatInstallationLinkAttempt.rateLimitWindowStart} <= ${windowCutoff} THEN ${params.now} ELSE ${chatInstallationLinkAttempt.rateLimitWindowStart} END`,
				lastAttemptAt: params.now,
			},
		})
		.returning({
			attemptCount: chatInstallationLinkAttempt.attemptCount,
			rateLimitWindowStart: chatInstallationLinkAttempt.rateLimitWindowStart,
		});

	return row;
}

function installationSupportsPurpose(
	status: typeof chatInstallation.$inferSelect.status,
	purpose: ChatLinkProofPurpose,
): boolean {
	if (purpose === "candidate_enrollment") {
		return status === "candidate";
	}
	return status === "active" || status === "legacy_active";
}

// ============================================
// PROOF ISSUANCE & ATOMIC REDEMPTION
// ============================================

/**
 * Issues a short-lived, single-use, purpose-bound link proof for an eligible active member.
 * Only the SHA-256 digest is persisted; the raw code is returned once to the caller.
 */
export async function issueChatLinkProof(
	input: IssueChatLinkProofInput,
	deps?: ChatLinkRuntimeDeps,
): Promise<IssueChatLinkProofResult> {
	const db = deps?.db ?? defaultDb;
	const now = deps?.now ? deps.now() : new Date();
	const ttlMinutes = input.ttlMinutes ?? CHAT_LINK_PROOF_TTL_MINUTES;
	const issueLimit = deps?.issueRateLimitMax ?? CHAT_LINK_ISSUE_RATE_LIMIT_MAX;
	const windowMs = deps?.rateLimitWindowMs ?? CHAT_LINK_RATE_LIMIT_WINDOW_MS;

	const [installation] = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.id, input.installationId),
				eq(chatInstallation.organizationId, input.organizationId),
			),
		)
		.limit(1);

	if (!installation || !installationSupportsPurpose(installation.status, input.purpose)) {
		return { status: "installation_unavailable" };
	}

	const eligibility = await verifyEligibleChatLinkMember(input.userId, input.organizationId, {
		...deps,
		db,
		now: () => now,
	});
	if (!eligibility.eligible) {
		return { status: "ineligible", reason: eligibility.reason };
	}

	const actorKey = `issue:${input.userId}`;
	const rateStatus = await checkRateLimitStatus(db, {
		organizationId: input.organizationId,
		installationId: input.installationId,
		purpose: input.purpose,
		actorKey,
		maxAttempts: issueLimit,
		windowMs,
		now,
	});
	if (rateStatus.limited) {
		return { status: "rate_limited", retryAfterSeconds: rateStatus.retryAfterSeconds };
	}

	const counter = await incrementRateLimitAttempt(db, {
		organizationId: input.organizationId,
		installationId: input.installationId,
		purpose: input.purpose,
		actorKey,
		windowMs,
		now,
	});
	if (counter.attemptCount > issueLimit) {
		return {
			status: "rate_limited",
			retryAfterSeconds: computeRetryAfterSeconds(counter.rateLimitWindowStart, now, windowMs),
		};
	}

	// Revoke any prior unconsumed proofs for the same user, installation, and purpose.
	await db
		.update(chatInstallationLinkProof)
		.set({ revokedAt: now })
		.where(
			and(
				eq(chatInstallationLinkProof.organizationId, input.organizationId),
				eq(chatInstallationLinkProof.installationId, input.installationId),
				eq(chatInstallationLinkProof.userId, input.userId),
				eq(chatInstallationLinkProof.purpose, input.purpose),
				isNull(chatInstallationLinkProof.consumedAt),
				isNull(chatInstallationLinkProof.revokedAt),
			),
		);

	const code = generateChatLinkCode();
	const codeDigest = hashChatLinkCode(code, {
		organizationId: input.organizationId,
		installationId: input.installationId,
		purpose: input.purpose,
	});
	const expiresInstant = Temporal.Instant.fromEpochMilliseconds(now.getTime()).add({
		minutes: ttlMinutes,
	});
	const expiresAt = new Date(expiresInstant.epochMilliseconds);

	const [created] = await db
		.insert(chatInstallationLinkProof)
		.values({
			organizationId: input.organizationId,
			installationId: input.installationId,
			purpose: input.purpose,
			userId: input.userId,
			employeeId: eligibility.employeeId,
			codeDigest,
			expiresAt,
			attemptCount: 0,
			rateLimitWindowStart: now,
		})
		.returning({ id: chatInstallationLinkProof.id });

	logger.info(
		{
			organizationId: input.organizationId,
			installationId: input.installationId,
			purpose: input.purpose,
			userId: input.userId,
			proofId: created.id,
		},
		"Issued chat installation link proof",
	);

	return {
		status: "issued",
		proofId: created.id,
		code,
		expiresAt,
		installationId: input.installationId,
		purpose: input.purpose,
		botUsername: installation.externalBotUsername,
	};
}

class ControlledRedemptionRollback extends Error {
	constructor(readonly outcome: RedeemChatLinkProofResult) {
		super("Controlled redemption rollback");
	}
}

async function syncLegacyUserMappingForLiveLink(
	tx: Pick<typeof defaultDb, "select" | "insert" | "update">,
	params: {
		installation: typeof chatInstallation.$inferSelect;
		userId: string;
		externalUserId: string;
		externalUsername: string | null;
		externalDisplayName: string | null;
		now: Date;
	},
): Promise<void> {
	const { installation, userId, externalUserId, externalUsername, externalDisplayName, now } =
		params;

	if (installation.provider === "telegram") {
		// Deactivate any conflicting inactive rows for the same user or telegram user in this org first.
		const [existingByUser] = await tx
			.select({ id: telegramUserMapping.id })
			.from(telegramUserMapping)
			.where(
				and(
					eq(telegramUserMapping.userId, userId),
					eq(telegramUserMapping.organizationId, installation.organizationId),
				),
			)
			.limit(1);

		const [existingByExt] = await tx
			.select({ id: telegramUserMapping.id, userId: telegramUserMapping.userId })
			.from(telegramUserMapping)
			.where(
				and(
					eq(telegramUserMapping.telegramUserId, externalUserId),
					eq(telegramUserMapping.organizationId, installation.organizationId),
				),
			)
			.limit(1);

		if (existingByExt && existingByExt.userId !== userId) {
			// If an inactive old mapping owned this externalUserId for a different user, move it out of the way.
			await tx
				.update(telegramUserMapping)
				.set({
					userId,
					telegramUsername: externalUsername,
					telegramDisplayName: externalDisplayName,
					isActive: true,
					lastSeenAt: now,
				})
				.where(eq(telegramUserMapping.id, existingByExt.id));
			return;
		}

		if (existingByUser) {
			await tx
				.update(telegramUserMapping)
				.set({
					telegramUserId: externalUserId,
					telegramUsername: externalUsername,
					telegramDisplayName: externalDisplayName,
					isActive: true,
					lastSeenAt: now,
				})
				.where(eq(telegramUserMapping.id, existingByUser.id));
		} else {
			await tx.insert(telegramUserMapping).values({
				userId,
				organizationId: installation.organizationId,
				telegramUserId: externalUserId,
				telegramUsername: externalUsername,
				telegramDisplayName: externalDisplayName,
				isActive: true,
				lastSeenAt: now,
			});
		}
		return;
	}

	if (installation.provider === "slack" && installation.externalSpaceId) {
		const [existingByUser] = await tx
			.select({ id: slackUserMapping.id })
			.from(slackUserMapping)
			.where(
				and(
					eq(slackUserMapping.userId, userId),
					eq(slackUserMapping.organizationId, installation.organizationId),
				),
			)
			.limit(1);
		if (existingByUser) {
			await tx
				.update(slackUserMapping)
				.set({
					slackUserId: externalUserId,
					slackTeamId: installation.externalSpaceId,
					slackUsername: externalUsername,
					slackDisplayName: externalDisplayName,
					isActive: true,
					lastSeenAt: now,
				})
				.where(eq(slackUserMapping.id, existingByUser.id));
		} else {
			await tx.insert(slackUserMapping).values({
				userId,
				organizationId: installation.organizationId,
				slackUserId: externalUserId,
				slackTeamId: installation.externalSpaceId,
				slackUsername: externalUsername,
				slackDisplayName: externalDisplayName,
				isActive: true,
				lastSeenAt: now,
			});
		}
		return;
	}

	if (installation.provider === "discord") {
		const [existingByUser] = await tx
			.select({ id: discordUserMapping.id })
			.from(discordUserMapping)
			.where(
				and(
					eq(discordUserMapping.userId, userId),
					eq(discordUserMapping.organizationId, installation.organizationId),
				),
			)
			.limit(1);
		if (existingByUser) {
			await tx
				.update(discordUserMapping)
				.set({
					discordUserId: externalUserId,
					discordUsername: externalUsername,
					discordDisplayName: externalDisplayName,
					isActive: true,
					lastSeenAt: now,
				})
				.where(eq(discordUserMapping.id, existingByUser.id));
		} else {
			await tx.insert(discordUserMapping).values({
				userId,
				organizationId: installation.organizationId,
				discordUserId: externalUserId,
				discordUsername: externalUsername,
				discordDisplayName: externalDisplayName,
				isActive: true,
				lastSeenAt: now,
			});
		}
	}
}

/**
 * Atomically verifies and consumes a single-use, purpose-bound link proof.
 * Checks rate limits, org/installation/purpose binding, expiry, current member eligibility,
 * and segregates candidate enrollment from live employee links.
 */
export async function redeemChatLinkProof(
	input: RedeemChatLinkProofInput,
	deps?: ChatLinkRuntimeDeps,
): Promise<RedeemChatLinkProofResult> {
	const db = deps?.db ?? defaultDb;
	const now = deps?.now ? deps.now() : new Date();
	const redeemLimit = deps?.redeemRateLimitMax ?? CHAT_LINK_REDEEM_RATE_LIMIT_MAX;
	const windowMs = deps?.rateLimitWindowMs ?? CHAT_LINK_RATE_LIMIT_WINDOW_MS;

	const [installation] = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.id, input.installationId),
				eq(chatInstallation.organizationId, input.organizationId),
			),
		)
		.limit(1);

	if (!installation || !installationSupportsPurpose(installation.status, input.purpose)) {
		return { status: "installation_unavailable" };
	}

	const actorKey = `redeem:${input.externalUserId}`;
	const rateStatus = await checkRateLimitStatus(db, {
		organizationId: input.organizationId,
		installationId: input.installationId,
		purpose: input.purpose,
		actorKey,
		maxAttempts: redeemLimit,
		windowMs,
		now,
	});
	if (rateStatus.limited) {
		return { status: "rate_limited", retryAfterSeconds: rateStatus.retryAfterSeconds };
	}

	const codeDigest = hashChatLinkCode(input.code, {
		organizationId: input.organizationId,
		installationId: input.installationId,
		purpose: input.purpose,
	});

	let outcome: RedeemChatLinkProofResult;
	let recordFailedAttempt = false;

	try {
		outcome = await db.transaction(async (tx) => {
			// Atomically consume the proof so concurrent redemptions cannot both succeed.
			const [consumedProof] = await tx
				.update(chatInstallationLinkProof)
				.set({
					consumedAt: now,
					consumedByExternalUserId: input.externalUserId,
					attemptCount: sql`${chatInstallationLinkProof.attemptCount} + 1`,
					lastAttemptAt: now,
				})
				.where(
					and(
						eq(chatInstallationLinkProof.organizationId, input.organizationId),
						eq(chatInstallationLinkProof.installationId, input.installationId),
						eq(chatInstallationLinkProof.purpose, input.purpose),
						eq(chatInstallationLinkProof.codeDigest, codeDigest),
						isNull(chatInstallationLinkProof.consumedAt),
						isNull(chatInstallationLinkProof.revokedAt),
						gt(chatInstallationLinkProof.expiresAt, now),
					),
				)
				.returning();

			if (!consumedProof) {
				const [existing] = await tx
					.select()
					.from(chatInstallationLinkProof)
					.where(
						and(
							eq(chatInstallationLinkProof.organizationId, input.organizationId),
							eq(chatInstallationLinkProof.installationId, input.installationId),
							eq(chatInstallationLinkProof.purpose, input.purpose),
							eq(chatInstallationLinkProof.codeDigest, codeDigest),
						),
					)
					.limit(1);

				if (existing) {
					await tx
						.update(chatInstallationLinkProof)
						.set({
							attemptCount: sql`${chatInstallationLinkProof.attemptCount} + 1`,
							lastAttemptAt: now,
						})
						.where(eq(chatInstallationLinkProof.id, existing.id));

					recordFailedAttempt = true;
					if (existing.consumedAt) {
						return { status: "already_used" } as const;
					}
					if (existing.revokedAt) {
						return { status: "invalid_code" } as const;
					}
					if (existing.expiresAt <= now) {
						return { status: "expired" } as const;
					}
				}

				recordFailedAttempt = true;
				return { status: "invalid_code" } as const;
			}

			// Recheck current member eligibility at redemption time (refuse former members).
			const eligibility = await verifyEligibleChatLinkMember(
				consumedProof.userId,
				input.organizationId,
				{
					...deps,
					db: tx as unknown as typeof defaultDb,
					now: () => now,
				},
			);
			if (!eligibility.eligible) {
				// Permanently revoke the proof without creating any link.
				await tx
					.update(chatInstallationLinkProof)
					.set({ consumedAt: null, consumedByExternalUserId: null, revokedAt: now })
					.where(eq(chatInstallationLinkProof.id, consumedProof.id));
				recordFailedAttempt = true;
				return { status: "ineligible", reason: eligibility.reason } as const;
			}

			const isCandidateEnrollment = input.purpose === "candidate_enrollment";
			const externalScope =
				buildVerifiedExternalScope(installation) ??
				`${installation.provider}:installation:${installation.id}`;

			// Prevent linking one external account to a different Z8 user on the same installation & lane.
			const [existingExternalOwner] = await tx
				.select({
					id: chatInstallationMemberLink.id,
					userId: chatInstallationMemberLink.userId,
				})
				.from(chatInstallationMemberLink)
				.where(
					and(
						eq(chatInstallationMemberLink.installationId, input.installationId),
						eq(chatInstallationMemberLink.externalUserId, input.externalUserId),
						eq(chatInstallationMemberLink.isCandidateEnrollment, isCandidateEnrollment),
						eq(chatInstallationMemberLink.isActive, true),
					),
				)
				.limit(1);

			if (existingExternalOwner && existingExternalOwner.userId !== consumedProof.userId) {
				throw new ControlledRedemptionRollback({ status: "already_linked" });
			}

			// Also check active legacy Telegram mapping ownership for live links.
			if (!isCandidateEnrollment && installation.provider === "telegram") {
				const [legacyOwner] = await tx
					.select({ userId: telegramUserMapping.userId })
					.from(telegramUserMapping)
					.where(
						and(
							eq(telegramUserMapping.organizationId, input.organizationId),
							eq(telegramUserMapping.telegramUserId, input.externalUserId),
							eq(telegramUserMapping.isActive, true),
						),
					)
					.limit(1);
				if (legacyOwner && legacyOwner.userId !== consumedProof.userId) {
					throw new ControlledRedemptionRollback({ status: "already_linked" });
				}
			}

			// Deactivate any previous active link for this user on this installation & lane before inserting.
			await tx
				.update(chatInstallationMemberLink)
				.set({ isActive: false, unlinkedAt: now, updatedAt: now })
				.where(
					and(
						eq(chatInstallationMemberLink.organizationId, input.organizationId),
						eq(chatInstallationMemberLink.installationId, input.installationId),
						eq(chatInstallationMemberLink.userId, consumedProof.userId),
						eq(chatInstallationMemberLink.isCandidateEnrollment, isCandidateEnrollment),
						eq(chatInstallationMemberLink.isActive, true),
					),
				);

			const [link] = await tx
				.insert(chatInstallationMemberLink)
				.values({
					organizationId: input.organizationId,
					installationId: input.installationId,
					userId: consumedProof.userId,
					employeeId: eligibility.employeeId,
					externalUserId: input.externalUserId,
					externalUsername: input.externalUsername ?? null,
					externalDisplayName: input.externalDisplayName ?? null,
					externalScope,
					provenance: "link_proof",
					isCandidateEnrollment,
					isActive: true,
					verifiedAt: now,
					unlinkedAt: null,
					lastSeenAt: now,
				})
				.returning({ id: chatInstallationMemberLink.id });

			// Only live member links update legacy user mappings; candidate enrollment stays strictly segregated.
			if (!isCandidateEnrollment) {
				await syncLegacyUserMappingForLiveLink(tx, {
					installation,
					userId: consumedProof.userId,
					externalUserId: input.externalUserId,
					externalUsername: input.externalUsername ?? null,
					externalDisplayName: input.externalDisplayName ?? null,
					now,
				});
			}

			// Optionally record installation-scoped conversation reachability.
			if (input.externalConversationId) {
				const conversationType = input.conversationType ?? "private";
				const [existingConv] = await tx
					.select({ id: chatInstallationConversation.id })
					.from(chatInstallationConversation)
					.where(
						and(
							eq(chatInstallationConversation.organizationId, input.organizationId),
							eq(chatInstallationConversation.installationId, input.installationId),
							eq(chatInstallationConversation.userId, consumedProof.userId),
							eq(chatInstallationConversation.conversationType, conversationType),
						),
					)
					.limit(1);

				if (existingConv) {
					await tx
						.update(chatInstallationConversation)
						.set({
							employeeId: eligibility.employeeId,
							externalUserId: input.externalUserId,
							externalConversationId: input.externalConversationId,
							conversationReference: input.conversationReference ?? null,
							reachabilityStatus: "reachable",
							reachabilityReason: null,
							verifiedAt: now,
							lastUsedAt: now,
							isActive: true,
							updatedAt: now,
						})
						.where(eq(chatInstallationConversation.id, existingConv.id));
				} else {
					await tx.insert(chatInstallationConversation).values({
						organizationId: input.organizationId,
						installationId: input.installationId,
						userId: consumedProof.userId,
						employeeId: eligibility.employeeId,
						externalUserId: input.externalUserId,
						externalConversationId: input.externalConversationId,
						conversationType,
						conversationReference: input.conversationReference ?? null,
						reachabilityStatus: "reachable",
						reachabilityReason: null,
						verifiedAt: now,
						lastUsedAt: now,
						isActive: true,
					});
				}
			}

			return {
				status: "success",
				userId: consumedProof.userId,
				employeeId: eligibility.employeeId,
				linkId: link.id,
				installationId: input.installationId,
				isCandidateEnrollment,
			} as const;
		});
	} catch (error) {
		if (error instanceof ControlledRedemptionRollback) {
			return error.outcome;
		}
		throw error;
	}

	if (recordFailedAttempt) {
		const counter = await incrementRateLimitAttempt(db, {
			organizationId: input.organizationId,
			installationId: input.installationId,
			purpose: input.purpose,
			actorKey,
			windowMs,
			now,
		});
		if (counter.attemptCount > redeemLimit) {
			return {
				status: "rate_limited",
				retryAfterSeconds: computeRetryAfterSeconds(counter.rateLimitWindowStart, now, windowMs),
			};
		}
	}

	return outcome;
}

// ============================================
// VERIFIED SAME-SCOPE IDENTITY REUSE
// ============================================

/**
 * Reuses a verified external user identity from a source installation to a target installation
 * ONLY within the exact same organization, provider, and verified external scope
 * (e.g. same Slack workspace or same Microsoft Teams tenant). Never reuses across orgs or bots.
 */
export async function reuseVerifiedExternalIdentity(
	input: ReuseVerifiedExternalIdentityInput,
	deps?: ChatLinkRuntimeDeps,
): Promise<ReuseVerifiedExternalIdentityResult> {
	const db = deps?.db ?? defaultDb;
	const now = deps?.now ? deps.now() : new Date();

	const eligibility = await verifyEligibleChatLinkMember(input.userId, input.organizationId, {
		...deps,
		db,
		now: () => now,
	});
	if (!eligibility.eligible) {
		return { status: "ineligible", reason: eligibility.reason };
	}

	const installations = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, input.organizationId),
				inArray(chatInstallation.id, [input.sourceInstallationId, input.targetInstallationId]),
			),
		);

	const sourceInstallation = installations.find((row) => row.id === input.sourceInstallationId);
	const targetInstallation = installations.find((row) => row.id === input.targetInstallationId);

	if (!sourceInstallation || !targetInstallation) {
		return { status: "installation_not_found" };
	}

	if (sourceInstallation.provider !== targetInstallation.provider) {
		return { status: "scope_mismatch" };
	}

	const sourceScope = buildVerifiedExternalScope(sourceInstallation);
	const targetScope = buildVerifiedExternalScope(targetInstallation);

	if (!sourceScope || !targetScope || sourceScope !== targetScope) {
		return { status: "scope_mismatch" };
	}

	// Look up verified live identity on source installation within exact same scope.
	const [sourceLink] = await db
		.select()
		.from(chatInstallationMemberLink)
		.where(
			and(
				eq(chatInstallationMemberLink.organizationId, input.organizationId),
				eq(chatInstallationMemberLink.installationId, sourceInstallation.id),
				eq(chatInstallationMemberLink.userId, input.userId),
				eq(chatInstallationMemberLink.externalScope, sourceScope),
				eq(chatInstallationMemberLink.isCandidateEnrollment, false),
				eq(chatInstallationMemberLink.isActive, true),
			),
		)
		.limit(1);

	let verifiedIdentity: {
		externalUserId: string;
		externalUsername: string | null;
		externalDisplayName: string | null;
	} | null = sourceLink
		? {
				externalUserId: sourceLink.externalUserId,
				externalUsername: sourceLink.externalUsername,
				externalDisplayName: sourceLink.externalDisplayName,
			}
		: null;

	// Legacy verified same-workspace / same-tenant fallback for Slack & Teams.
	if (
		!verifiedIdentity &&
		sourceInstallation.provider === "slack" &&
		sourceInstallation.externalSpaceId
	) {
		const [legacySlack] = await db
			.select()
			.from(slackUserMapping)
			.where(
				and(
					eq(slackUserMapping.organizationId, input.organizationId),
					eq(slackUserMapping.userId, input.userId),
					eq(slackUserMapping.slackTeamId, sourceInstallation.externalSpaceId),
					eq(slackUserMapping.isActive, true),
				),
			)
			.limit(1);
		if (legacySlack) {
			verifiedIdentity = {
				externalUserId: legacySlack.slackUserId,
				externalUsername: legacySlack.slackUsername,
				externalDisplayName: legacySlack.slackDisplayName,
			};
		}
	} else if (
		!verifiedIdentity &&
		sourceInstallation.provider === "teams" &&
		sourceInstallation.externalSpaceId
	) {
		const [legacyTeams] = await db
			.select()
			.from(teamsUserMapping)
			.where(
				and(
					eq(teamsUserMapping.organizationId, input.organizationId),
					eq(teamsUserMapping.userId, input.userId),
					eq(teamsUserMapping.teamsTenantId, sourceInstallation.externalSpaceId),
					eq(teamsUserMapping.isActive, true),
				),
			)
			.limit(1);
		if (legacyTeams) {
			verifiedIdentity = {
				externalUserId: legacyTeams.teamsUserId,
				externalUsername: legacyTeams.teamsUserPrincipalName ?? legacyTeams.teamsEmail,
				externalDisplayName: legacyTeams.teamsDisplayName,
			};
		}
	}

	if (!verifiedIdentity) {
		return { status: "no_verified_identity" };
	}

	const isCandidateEnrollment =
		input.targetIsCandidateEnrollment ?? targetInstallation.status === "candidate";

	// Check if another user owns this externalUserId on the target installation & lane.
	const [existingExternal] = await db
		.select({ userId: chatInstallationMemberLink.userId })
		.from(chatInstallationMemberLink)
		.where(
			and(
				eq(chatInstallationMemberLink.installationId, targetInstallation.id),
				eq(chatInstallationMemberLink.externalUserId, verifiedIdentity.externalUserId),
				eq(chatInstallationMemberLink.isCandidateEnrollment, isCandidateEnrollment),
				eq(chatInstallationMemberLink.isActive, true),
			),
		)
		.limit(1);

	if (existingExternal && existingExternal.userId !== input.userId) {
		return { status: "already_linked" };
	}

	// Deactivate any prior active link for this user on target installation & lane.
	await db
		.update(chatInstallationMemberLink)
		.set({ isActive: false, unlinkedAt: now, updatedAt: now })
		.where(
			and(
				eq(chatInstallationMemberLink.organizationId, input.organizationId),
				eq(chatInstallationMemberLink.installationId, targetInstallation.id),
				eq(chatInstallationMemberLink.userId, input.userId),
				eq(chatInstallationMemberLink.isCandidateEnrollment, isCandidateEnrollment),
				eq(chatInstallationMemberLink.isActive, true),
			),
		);

	const [created] = await db
		.insert(chatInstallationMemberLink)
		.values({
			organizationId: input.organizationId,
			installationId: targetInstallation.id,
			userId: input.userId,
			employeeId: eligibility.employeeId,
			externalUserId: verifiedIdentity.externalUserId,
			externalUsername: verifiedIdentity.externalUsername,
			externalDisplayName: verifiedIdentity.externalDisplayName,
			externalScope: targetScope,
			provenance: "verified_same_scope_reuse",
			isCandidateEnrollment,
			isActive: true,
			verifiedAt: now,
			unlinkedAt: null,
		})
		.returning({ id: chatInstallationMemberLink.id });

	return {
		status: "reused",
		linkId: created.id,
		externalUserId: verifiedIdentity.externalUserId,
		externalScope: targetScope,
		isCandidateEnrollment,
	};
}

// ============================================
// MEMBER CHAT LINKS STATUS & UNLINK
// ============================================

function labelForInstallation(inst: typeof chatInstallation.$inferSelect): string | null {
	if (inst.provider === "telegram") {
		if (inst.externalBotUsername) {
			return inst.externalBotUsername.startsWith("@")
				? inst.externalBotUsername
				: `@${inst.externalBotUsername}`;
		}
		return inst.externalDisplayName;
	}
	return inst.externalSpaceName ?? inst.externalDisplayName ?? inst.externalBotUsername ?? null;
}

/**
 * Returns the member's chat connection statuses for the active organization.
 * Candidate enrollment links are excluded from current live status.
 * Absent organization context returns an empty, unscoped snapshot without throwing.
 */
export async function getMemberChatLinks(
	input: {
		userId: string;
		organizationId: string | null | undefined;
	},
	deps?: ChatLinkRuntimeDeps,
): Promise<MemberChatLinksSnapshot> {
	const trimmedOrgId = input.organizationId?.trim() || null;
	if (!trimmedOrgId) {
		return {
			organizationId: null,
			hasOrganizationContext: false,
			channels: [],
		};
	}

	const db = deps?.db ?? defaultDb;

	let verificationFailed = false;
	if (deps?.syncLegacy !== false) {
		try {
			await backfillOrganizationChatInstallations(trimmedOrgId, deps);
		} catch (error) {
			logger.warn(
				{ error, organizationId: trimmedOrgId },
				"Failed to sync legacy chat installations while reading member links",
			);
			verificationFailed = true;
		}
	}

	const [
		installations,
		memberLinks,
		candidateLinks,
		conversations,
		legacyTelegram,
		legacySlack,
		legacyTeams,
		legacyDiscord,
		legacyTelegramBot,
	] = await Promise.all([
		db
			.select()
			.from(chatInstallation)
			.where(eq(chatInstallation.organizationId, trimmedOrgId))
			.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id)),
		db
			.select()
			.from(chatInstallationMemberLink)
			.where(
				and(
					eq(chatInstallationMemberLink.organizationId, trimmedOrgId),
					eq(chatInstallationMemberLink.userId, input.userId),
					eq(chatInstallationMemberLink.isCandidateEnrollment, false),
					eq(chatInstallationMemberLink.isActive, true),
				),
			),
		db
			.select()
			.from(chatInstallationMemberLink)
			.where(
				and(
					eq(chatInstallationMemberLink.organizationId, trimmedOrgId),
					eq(chatInstallationMemberLink.userId, input.userId),
					eq(chatInstallationMemberLink.isCandidateEnrollment, true),
					eq(chatInstallationMemberLink.isActive, true),
				),
			),
		db
			.select()
			.from(chatInstallationConversation)
			.where(
				and(
					eq(chatInstallationConversation.organizationId, trimmedOrgId),
					eq(chatInstallationConversation.userId, input.userId),
					eq(chatInstallationConversation.isActive, true),
				),
			),
		db
			.select()
			.from(telegramUserMapping)
			.where(
				and(
					eq(telegramUserMapping.organizationId, trimmedOrgId),
					eq(telegramUserMapping.userId, input.userId),
					eq(telegramUserMapping.isActive, true),
				),
			)
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select()
			.from(slackUserMapping)
			.where(
				and(
					eq(slackUserMapping.organizationId, trimmedOrgId),
					eq(slackUserMapping.userId, input.userId),
					eq(slackUserMapping.isActive, true),
				),
			)
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select()
			.from(teamsUserMapping)
			.where(
				and(
					eq(teamsUserMapping.organizationId, trimmedOrgId),
					eq(teamsUserMapping.userId, input.userId),
					eq(teamsUserMapping.isActive, true),
				),
			)
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select()
			.from(discordUserMapping)
			.where(
				and(
					eq(discordUserMapping.organizationId, trimmedOrgId),
					eq(discordUserMapping.userId, input.userId),
					eq(discordUserMapping.isActive, true),
				),
			)
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select({
				botUsername: telegramBotConfig.botUsername,
				botDisplayName: telegramBotConfig.botDisplayName,
				setupStatus: telegramBotConfig.setupStatus,
			})
			.from(telegramBotConfig)
			.where(
				and(
					eq(telegramBotConfig.organizationId, trimmedOrgId),
					eq(telegramBotConfig.setupStatus, "active"),
				),
			)
			.limit(1)
			.then((rows) => rows[0] ?? null),
	]);

	const linkByInstallationId = new Map(memberLinks.map((row) => [row.installationId, row]));
	const candidateLinkByInstallationId = new Map(
		candidateLinks.map((row) => [row.installationId, row]),
	);
	const conversationByInstallationId = new Map(
		conversations.map((row) => [row.installationId, row]),
	);

	const channels: MemberChatChannelLinkView[] = CHAT_INSTALLATION_PROVIDERS.map((provider) => {
		const providerInstallations = installations.filter((row) => row.provider === provider);
		const activeInst =
			providerInstallations.find((row) => row.status === "active") ??
			providerInstallations.find((row) => row.status === "legacy_active") ??
			null;
		const remediationInst =
			providerInstallations.find((row) => row.status === "remediation_required") ?? null;
		const candidateInst =
			provider === "telegram"
				? (providerInstallations.find(
						(row) =>
							row.status === "candidate" &&
							Boolean(
								row.externalBotId || row.externalBotUsername || row.activeCredentialRevisionId,
							),
					) ?? null)
				: null;

		const installationLink = activeInst ? (linkByInstallationId.get(activeInst.id) ?? null) : null;
		const installationConv = activeInst
			? (conversationByInstallationId.get(activeInst.id) ?? null)
			: null;

		// Legacy mapping fallback only applies while the current installation is legacy_active (or before switch).
		const isLegacyActive = activeInst?.status === "legacy_active";
		let externalUsername = installationLink?.externalUsername ?? null;
		let externalDisplayName = installationLink?.externalDisplayName ?? null;
		let hasLiveLink = Boolean(installationLink);

		if (!hasLiveLink && isLegacyActive) {
			if (provider === "telegram" && legacyTelegram) {
				hasLiveLink = true;
				externalUsername = legacyTelegram.telegramUsername;
				externalDisplayName = legacyTelegram.telegramDisplayName;
			} else if (provider === "slack" && legacySlack) {
				hasLiveLink = true;
				externalUsername = legacySlack.slackUsername;
				externalDisplayName = legacySlack.slackDisplayName;
			} else if (provider === "teams" && legacyTeams) {
				hasLiveLink = true;
				externalUsername = legacyTeams.teamsUserPrincipalName ?? legacyTeams.teamsEmail;
				externalDisplayName = legacyTeams.teamsDisplayName;
			} else if (provider === "discord" && legacyDiscord) {
				hasLiveLink = true;
				externalUsername = legacyDiscord.discordUsername;
				externalDisplayName = legacyDiscord.discordDisplayName;
			}
		}

		// If legacy Telegram is active in DB but backfill failed, mark verificationFailed for Telegram.
		const providerVerificationFailed =
			verificationFailed &&
			(Boolean(activeInst) || (provider === "telegram" && Boolean(legacyTelegramBot)));

		const derived = deriveMemberChannelLinkStatus({
			hasActiveInstallation: Boolean(activeInst),
			hasRemediationInstallation: Boolean(remediationInst),
			verificationFailed: providerVerificationFailed,
			hasLiveLink,
			conversationReachability: installationConv?.reachabilityStatus ?? null,
		});

		const botUsername =
			provider === "telegram"
				? (activeInst?.externalBotUsername ??
					remediationInst?.externalBotUsername ??
					legacyTelegramBot?.botUsername ??
					null)
				: null;

		const installationLabel = activeInst
			? labelForInstallation(activeInst)
			: remediationInst
				? labelForInstallation(remediationInst)
				: provider === "telegram" && legacyTelegramBot
					? legacyTelegramBot.botUsername
						? `@${legacyTelegramBot.botUsername}`
						: legacyTelegramBot.botDisplayName
					: null;

		const candidateLink = candidateInst
			? (candidateLinkByInstallationId.get(candidateInst.id) ?? null)
			: null;
		const candidateEnrollment: MemberChatCandidateEnrollmentView | null = candidateInst
			? {
					installationId: candidateInst.id,
					botUsername: candidateInst.externalBotUsername,
					installationLabel: labelForInstallation(candidateInst),
					status: candidateLink ? "enrolled" : "action_needed",
					externalUsername: candidateLink?.externalUsername ?? null,
					externalDisplayName: candidateLink?.externalDisplayName ?? null,
					canGenerateLinkCode: !providerVerificationFailed,
				}
			: null;

		const available =
			Boolean(activeInst) ||
			Boolean(remediationInst) ||
			Boolean(candidateEnrollment) ||
			providerVerificationFailed;

		return {
			provider,
			available,
			status: derived.status,
			installationId: activeInst?.id ?? remediationInst?.id ?? null,
			installationLabel,
			botUsername,
			externalUsername,
			externalDisplayName,
			canGenerateLinkCode:
				provider === "telegram" && Boolean(activeInst) && !providerVerificationFailed,
			canUnlink: Boolean(activeInst) && hasLiveLink,
			recoveryHint: derived.recoveryHint,
			...(candidateEnrollment ? { candidateEnrollment } : {}),
		};
	});

	return {
		organizationId: trimmedOrgId,
		hasOrganizationContext: true,
		channels,
	};
}

/**
 * Resolves the organization's active/legacy Telegram installation (backfilling if needed)
 * and issues a short-lived, digest-only `member_link` proof for the employee.
 */
export async function issueMemberTelegramLinkCode(
	input: { userId: string; organizationId: string },
	deps?: ChatLinkRuntimeDeps,
): Promise<IssueChatLinkProofResult> {
	const db = deps?.db ?? defaultDb;
	if (deps?.syncLegacy !== false) {
		await backfillOrganizationChatInstallations(input.organizationId, deps);
	}

	const rows = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, input.organizationId),
				eq(chatInstallation.provider, "telegram"),
				inArray(chatInstallation.status, ["active", "legacy_active"]),
			),
		)
		.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id));

	const target = rows.find((row) => row.status === "active") ?? rows[0] ?? null;
	if (!target) {
		return { status: "installation_unavailable" };
	}

	return issueChatLinkProof(
		{
			organizationId: input.organizationId,
			installationId: target.id,
			userId: input.userId,
			purpose: "member_link",
		},
		deps,
	);
}

/**
 * Issues a short-lived, digest-only `candidate_enrollment` link proof bound to the
 * organization's staged candidate Telegram bot so employees can enroll ahead of a switch
 * without altering their current live Telegram link or delivery.
 */
export async function issueMemberTelegramCandidateLinkCode(
	input: { userId: string; organizationId: string; installationId?: string },
	deps?: ChatLinkRuntimeDeps,
): Promise<IssueChatLinkProofResult> {
	const db = deps?.db ?? defaultDb;

	const conditions = [
		eq(chatInstallation.organizationId, input.organizationId),
		eq(chatInstallation.provider, "telegram"),
		eq(chatInstallation.status, "candidate"),
	];
	if (input.installationId) {
		conditions.push(eq(chatInstallation.id, input.installationId));
	}

	const [target] = await db
		.select()
		.from(chatInstallation)
		.where(and(...conditions))
		.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id))
		.limit(1);

	if (!target) {
		return { status: "installation_unavailable" };
	}

	return issueChatLinkProof(
		{
			organizationId: input.organizationId,
			installationId: target.id,
			userId: input.userId,
			purpose: "candidate_enrollment",
		},
		deps,
	);
}

/**
 * Resolves the Telegram chat_installation row corresponding to an inbound webhook bot.
 * Matches explicit installationId or numeric bot ID extracted from the bot token so
 * proofs issued for another bot or organization cannot be redeemed on this bot.
 */
export async function resolveTelegramInstallationForBot(
	input: {
		organizationId: string;
		botToken?: string | null;
		installationId?: string | null;
	},
	deps?: ChatLinkRuntimeDeps,
): Promise<typeof chatInstallation.$inferSelect | null> {
	const db = deps?.db ?? defaultDb;
	if (deps?.syncLegacy !== false) {
		await backfillOrganizationChatInstallations(input.organizationId, deps);
	}

	if (input.installationId) {
		const [exact] = await db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.id, input.installationId),
					eq(chatInstallation.organizationId, input.organizationId),
					eq(chatInstallation.provider, "telegram"),
				),
			)
			.limit(1);
		return exact ?? null;
	}

	const numericBotId = input.botToken ? extractTelegramNumericBotId(input.botToken) : null;
	const rows = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, input.organizationId),
				eq(chatInstallation.provider, "telegram"),
				inArray(chatInstallation.status, ["active", "legacy_active", "candidate"]),
			),
		)
		.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id));

	if (numericBotId) {
		const byBotId = rows.find((row) => row.externalBotId === numericBotId);
		if (byBotId) {
			return byBotId;
		}
		// Never silently match a different bot when we know the inbound bot's numeric ID.
		return null;
	}

	return (
		rows.find((row) => row.status === "active") ??
		rows.find((row) => row.status === "legacy_active") ??
		null
	);
}

/**
 * Unlinks a member's chat connection within a single organization without affecting
 * any other organization the user belongs to.
 */
export async function unlinkMemberChatLink(
	input: {
		userId: string;
		organizationId: string;
		provider: ChatInstallationProvider;
		installationId?: string;
	},
	deps?: Pick<ChatLinkRuntimeDeps, "db" | "now">,
): Promise<{ unlinked: boolean }> {
	const db = deps?.db ?? defaultDb;
	const now = deps?.now ? deps.now() : new Date();

	let installationIds: string[] = [];
	if (input.installationId) {
		const [inst] = await db
			.select({ id: chatInstallation.id })
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.id, input.installationId),
					eq(chatInstallation.organizationId, input.organizationId),
					eq(chatInstallation.provider, input.provider),
				),
			)
			.limit(1);
		if (inst) {
			installationIds = [inst.id];
		}
	} else {
		const insts = await db
			.select({ id: chatInstallation.id })
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, input.organizationId),
					eq(chatInstallation.provider, input.provider),
				),
			);
		installationIds = insts.map((row) => row.id);
	}

	let unlinkedCount = 0;

	if (installationIds.length > 0) {
		const updatedLinks = await db
			.update(chatInstallationMemberLink)
			.set({
				isActive: false,
				unlinkedAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(chatInstallationMemberLink.organizationId, input.organizationId),
					eq(chatInstallationMemberLink.userId, input.userId),
					inArray(chatInstallationMemberLink.installationId, installationIds),
					eq(chatInstallationMemberLink.isCandidateEnrollment, false),
					eq(chatInstallationMemberLink.isActive, true),
				),
			)
			.returning({ id: chatInstallationMemberLink.id });
		unlinkedCount += updatedLinks.length;

		// Revoke any outstanding unconsumed member_link proofs for these installations.
		await db
			.update(chatInstallationLinkProof)
			.set({ revokedAt: now })
			.where(
				and(
					eq(chatInstallationLinkProof.organizationId, input.organizationId),
					eq(chatInstallationLinkProof.userId, input.userId),
					inArray(chatInstallationLinkProof.installationId, installationIds),
					eq(chatInstallationLinkProof.purpose, "member_link"),
					isNull(chatInstallationLinkProof.consumedAt),
					isNull(chatInstallationLinkProof.revokedAt),
				),
			);
	}

	// Deactivate the corresponding legacy mapping for this organization & user only.
	if (input.provider === "telegram") {
		const legacy = await db
			.update(telegramUserMapping)
			.set({ isActive: false })
			.where(
				and(
					eq(telegramUserMapping.organizationId, input.organizationId),
					eq(telegramUserMapping.userId, input.userId),
					eq(telegramUserMapping.isActive, true),
				),
			)
			.returning({ id: telegramUserMapping.id });
		unlinkedCount += legacy.length;
	} else if (input.provider === "slack") {
		const legacy = await db
			.update(slackUserMapping)
			.set({ isActive: false })
			.where(
				and(
					eq(slackUserMapping.organizationId, input.organizationId),
					eq(slackUserMapping.userId, input.userId),
					eq(slackUserMapping.isActive, true),
				),
			)
			.returning({ id: slackUserMapping.id });
		unlinkedCount += legacy.length;
	} else if (input.provider === "discord") {
		const legacy = await db
			.update(discordUserMapping)
			.set({ isActive: false })
			.where(
				and(
					eq(discordUserMapping.organizationId, input.organizationId),
					eq(discordUserMapping.userId, input.userId),
					eq(discordUserMapping.isActive, true),
				),
			)
			.returning({ id: discordUserMapping.id });
		unlinkedCount += legacy.length;
	} else if (input.provider === "teams") {
		const legacy = await db
			.update(teamsUserMapping)
			.set({ isActive: false })
			.where(
				and(
					eq(teamsUserMapping.organizationId, input.organizationId),
					eq(teamsUserMapping.userId, input.userId),
					eq(teamsUserMapping.isActive, true),
				),
			)
			.returning({ id: teamsUserMapping.id });
		unlinkedCount += legacy.length;
	}

	return { unlinked: unlinkedCount > 0 };
}
