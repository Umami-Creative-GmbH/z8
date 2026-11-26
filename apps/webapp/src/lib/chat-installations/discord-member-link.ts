import { and, asc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	type ChatLinkProofPurpose,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationMemberLink,
	discordUserMapping,
} from "@/db/schema";
import { rearmApprovalDeliveryForRepairedDestination } from "@/lib/approvals/delivery/recovery";
import { getBotConfigByOrganization } from "@/lib/discord/bot-config";
import type { DiscordDmFailureCode, DiscordDmRecoveryHint } from "@/lib/discord/signature";
import { createLogger } from "@/lib/logger";
import { backfillOrganizationChatInstallations } from "./backfill";
import { readInstallationCredentialRevision } from "./credential-revisions";
import { defaultSendDiscordPrivateDm, type SendDiscordPrivateDmResult } from "./discord-setup";
import { upsertInstallationConversation } from "./inventory";
import {
	type ChatLinkRuntimeDeps,
	type IssueChatLinkProofResult,
	issueChatLinkProof,
	type MemberChatLinkStatus,
	redeemChatLinkProof,
	verifyEligibleChatLinkMember,
} from "./member-links";

const logger = createLogger("DiscordMemberLink");

export interface MemberDiscordLaneStatus {
	installationId: string;
	installationLabel: string | null;
	status: MemberChatLinkStatus;
	externalUserId: string | null;
	externalUsername: string | null;
	externalDisplayName: string | null;
	reachabilityStatus: "unknown" | "reachable" | "action_needed" | "unreachable" | null;
	reachabilityReason: string | null;
	recoveryHint:
		| "link_required"
		| "discord_enable_server_dms"
		| "discord_share_server_with_bot"
		| "verification_error"
		| "installation_remediation"
		| null;
	canGenerateLinkCode: boolean;
	canRecheckDm: boolean;
	canUnlink: boolean;
}

export interface MemberDiscordLinkState {
	organizationId: string;
	active: MemberDiscordLaneStatus | null;
	candidate: MemberDiscordLaneStatus | null;
}

export interface DiscordMemberLinkDeps extends ChatLinkRuntimeDeps {
	readSecret?: (organizationId: string, key: string) => Promise<string | null>;
	sendPrivateDm?: (
		botToken: string,
		input: { discordUserId: string; content: string },
	) => Promise<SendDiscordPrivateDmResult>;
	rearmApprovalDelivery?: (input: {
		organizationId: string;
		userId: string;
		provider: "discord";
	}) => Promise<unknown>;
}

function mapReasonToRecoveryHint(
	reason: string | null | undefined,
): MemberDiscordLaneStatus["recoveryHint"] {
	if (reason === "discord_dm_blocked_50007") {
		return "discord_enable_server_dms";
	}
	if (reason === "discord_missing_access") {
		return "discord_share_server_with_bot";
	}
	return "discord_enable_server_dms";
}

function labelForDiscordInstallation(inst: typeof chatInstallation.$inferSelect): string | null {
	return inst.externalDisplayName ?? inst.externalAppId ?? null;
}

/**
 * Returns the employee's Discord link state for both the live active installation
 * and any staged candidate replacement installation — keeping candidate enrollment
 * strictly segregated from live membership links and delivery.
 */
export async function getMemberDiscordLinkState(
	input: {
		userId: string;
		organizationId: string;
	},
	deps?: DiscordMemberLinkDeps,
): Promise<MemberDiscordLinkState> {
	const db = deps?.db ?? defaultDb;

	if (deps?.syncLegacy !== false) {
		try {
			await backfillOrganizationChatInstallations(input.organizationId, deps);
		} catch (error) {
			logger.warn(
				{ error, organizationId: input.organizationId },
				"Failed to sync legacy Discord installation while loading member link state",
			);
		}
	}

	const [installations, memberLinks, conversations, legacyMapping] = await Promise.all([
		db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, input.organizationId),
					eq(chatInstallation.provider, "discord"),
				),
			)
			.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id)),
		db
			.select()
			.from(chatInstallationMemberLink)
			.where(
				and(
					eq(chatInstallationMemberLink.organizationId, input.organizationId),
					eq(chatInstallationMemberLink.userId, input.userId),
					eq(chatInstallationMemberLink.isActive, true),
				),
			),
		db
			.select()
			.from(chatInstallationConversation)
			.where(
				and(
					eq(chatInstallationConversation.organizationId, input.organizationId),
					eq(chatInstallationConversation.userId, input.userId),
					eq(chatInstallationConversation.isActive, true),
				),
			),
		db
			.select()
			.from(discordUserMapping)
			.where(
				and(
					eq(discordUserMapping.organizationId, input.organizationId),
					eq(discordUserMapping.userId, input.userId),
					eq(discordUserMapping.isActive, true),
				),
			)
			.limit(1)
			.then((rows) => rows[0] ?? null),
	]);

	const activeInst =
		installations.find((row) => row.status === "active") ??
		installations.find((row) => row.status === "legacy_active") ??
		null;
	const candidateInst =
		installations.find(
			(row) => row.status === "candidate" && Boolean(row.activeCredentialRevisionId),
		) ?? null;

	const buildLane = (
		inst: typeof chatInstallation.$inferSelect,
		isCandidate: boolean,
	): MemberDiscordLaneStatus => {
		const link =
			memberLinks.find(
				(row) => row.installationId === inst.id && row.isCandidateEnrollment === isCandidate,
			) ?? null;
		const conv = conversations.find((row) => row.installationId === inst.id) ?? null;

		const hasLegacyFallback =
			!isCandidate && inst.status === "legacy_active" && Boolean(legacyMapping);
		const linked = Boolean(link) || hasLegacyFallback;
		const externalUserId =
			link?.externalUserId ?? (hasLegacyFallback ? (legacyMapping?.discordUserId ?? null) : null);
		const externalUsername =
			link?.externalUsername ??
			(hasLegacyFallback ? (legacyMapping?.discordUsername ?? null) : null);
		const externalDisplayName =
			link?.externalDisplayName ??
			(hasLegacyFallback ? (legacyMapping?.discordDisplayName ?? null) : null);

		const reachability = conv?.reachabilityStatus ?? null;
		const reachabilityReason = conv?.reachabilityReason ?? null;

		let status: MemberChatLinkStatus;
		let recoveryHint: MemberDiscordLaneStatus["recoveryHint"] = null;

		if (!linked) {
			status = "action_needed";
			recoveryHint = "link_required";
		} else if (reachability === "action_needed" || reachability === "unreachable") {
			status = "action_needed";
			recoveryHint = mapReasonToRecoveryHint(reachabilityReason);
		} else if (reachability === "reachable") {
			status = "connected";
			recoveryHint = null;
		} else if (hasLegacyFallback && !conv) {
			status = "connected";
			recoveryHint = null;
		} else {
			status = "action_needed";
			recoveryHint = "discord_enable_server_dms";
		}

		return {
			installationId: inst.id,
			installationLabel: labelForDiscordInstallation(inst),
			status,
			externalUserId,
			externalUsername,
			externalDisplayName,
			reachabilityStatus: reachability,
			reachabilityReason,
			recoveryHint,
			canGenerateLinkCode: true,
			canRecheckDm: linked && Boolean(externalUserId),
			canUnlink: !isCandidate && linked,
		};
	};

	return {
		organizationId: input.organizationId,
		active: activeInst ? buildLane(activeInst, false) : null,
		candidate: candidateInst ? buildLane(candidateInst, true) : null,
	};
}

/**
 * Issues a short-lived, single-use, installation-bound Discord link proof for either
 * the organization's live Discord installation (`purpose: "member_link"`) or its staged
 * replacement candidate (`purpose: "candidate_enrollment"`).
 */
export async function issueMemberDiscordLinkCode(
	input: {
		userId: string;
		organizationId: string;
		purpose?: ChatLinkProofPurpose;
		installationId?: string;
	},
	deps?: DiscordMemberLinkDeps,
): Promise<IssueChatLinkProofResult> {
	const db = deps?.db ?? defaultDb;
	const purpose: ChatLinkProofPurpose = input.purpose ?? "member_link";

	if (deps?.syncLegacy !== false) {
		await backfillOrganizationChatInstallations(input.organizationId, deps);
	}

	const installations = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, input.organizationId),
				eq(chatInstallation.provider, "discord"),
			),
		)
		.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id));

	let target: typeof chatInstallation.$inferSelect | undefined;
	if (input.installationId) {
		target = installations.find((row) => row.id === input.installationId);
	} else if (purpose === "candidate_enrollment") {
		target = installations.find(
			(row) => row.status === "candidate" && Boolean(row.activeCredentialRevisionId),
		);
	} else {
		target =
			installations.find((row) => row.status === "active") ??
			installations.find((row) => row.status === "legacy_active");
	}

	if (!target) {
		return { status: "installation_unavailable" };
	}

	return issueChatLinkProof(
		{
			organizationId: input.organizationId,
			installationId: target.id,
			userId: input.userId,
			purpose,
		},
		deps,
	);
}

export type RedeemDiscordMemberLinkResult =
	| {
			status: "linked_verified";
			userId: string;
			employeeId: string;
			channelId: string;
			isCandidateEnrollment: boolean;
	  }
	| {
			status: "linked_dm_blocked";
			userId: string;
			employeeId: string;
			isCandidateEnrollment: boolean;
			recoveryCode: DiscordDmFailureCode;
			recoveryHint: DiscordDmRecoveryHint;
			recoveryMessage: string;
	  }
	| { status: "invalid_code" }
	| { status: "expired" }
	| { status: "already_used" }
	| { status: "already_linked" }
	| { status: "ineligible"; reason: "not_member" | "no_employee" | "former_employee" }
	| { status: "rate_limited"; retryAfterSeconds: number }
	| { status: "installation_unavailable" };

/**
 * Redeems a Discord link proof atomically AND immediately verifies private DM delivery
 * (`allowed_mentions: { parse: [] }`).
 *
 * CRITICAL:
 * - Never treats the channel where `/link` was invoked (e.g., a Discord server channel)
 *   as verified private DM reachability.
 * - Classifies Discord `50007` (DM privacy controls) and `50001` (missing shared server)
 *   as `action_needed` with a clear recovery path.
 * - Candidate enrollments stay strictly segregated from active links and conversations.
 */
export async function redeemDiscordMemberLinkCode(
	input: {
		organizationId: string;
		installationId: string;
		purpose: ChatLinkProofPurpose;
		code: string;
		discordUserId: string;
		discordUsername?: string | null;
		discordDisplayName?: string | null;
		botToken: string;
	},
	deps?: DiscordMemberLinkDeps,
): Promise<RedeemDiscordMemberLinkResult> {
	const db = deps?.db ?? defaultDb;
	const now = deps?.now ? deps.now() : new Date();
	const sendPrivateDm = deps?.sendPrivateDm ?? defaultSendDiscordPrivateDm;

	// Redeem proof WITHOUT recording a server channel as reachable DM!
	const redeemed = await redeemChatLinkProof(
		{
			organizationId: input.organizationId,
			installationId: input.installationId,
			purpose: input.purpose,
			code: input.code,
			externalUserId: input.discordUserId,
			externalUsername: input.discordUsername ?? null,
			externalDisplayName: input.discordDisplayName ?? null,
		},
		deps,
	);

	if (redeemed.status !== "success") {
		return redeemed;
	}

	const confirmationText = redeemed.isCandidateEnrollment
		? "Your Discord account is linked to your organization's upcoming Z8 Discord bot. Direct message delivery is verified and ready for switchover."
		: "Your Discord account is linked to Z8 and direct message delivery is verified.";

	const dmCheck = await sendPrivateDm(input.botToken, {
		discordUserId: input.discordUserId,
		content: confirmationText,
	});

	if (dmCheck.kind !== "ok") {
		await upsertInstallationConversation(
			{
				organizationId: input.organizationId,
				installationId: input.installationId,
				userId: redeemed.userId,
				employeeId: redeemed.employeeId,
				externalUserId: input.discordUserId,
				externalConversationId: dmCheck.channelId ?? `dm-blocked:${input.discordUserId}`,
				conversationType: "private",
				reachabilityStatus: dmCheck.isPrivacyOrPrerequisiteBlock ? "action_needed" : "unknown",
				reachabilityReason: dmCheck.code,
				verifiedAt: null,
			},
			{ db },
		);

		return {
			status: "linked_dm_blocked",
			userId: redeemed.userId,
			employeeId: redeemed.employeeId,
			isCandidateEnrollment: redeemed.isCandidateEnrollment,
			recoveryCode: dmCheck.code,
			recoveryHint: dmCheck.recoveryHint,
			recoveryMessage: dmCheck.message,
		};
	}

	await upsertInstallationConversation(
		{
			organizationId: input.organizationId,
			installationId: input.installationId,
			userId: redeemed.userId,
			employeeId: redeemed.employeeId,
			externalUserId: input.discordUserId,
			externalConversationId: dmCheck.channelId,
			conversationType: "private",
			reachabilityStatus: "reachable",
			reachabilityReason: null,
			verifiedAt: now,
			lastUsedAt: now,
		},
		{ db },
	);

	// Only live active links re-arm approval delivery; candidate enrollments stay segregated.
	if (!redeemed.isCandidateEnrollment) {
		try {
			const rearm = deps?.rearmApprovalDelivery ?? rearmApprovalDeliveryForRepairedDestination;
			await rearm({
				organizationId: input.organizationId,
				userId: redeemed.userId,
				provider: "discord",
			});
		} catch (error) {
			logger.warn(
				{ error, organizationId: input.organizationId, userId: redeemed.userId },
				"Failed to re-arm Discord approval delivery after verified link",
			);
		}
	}

	return {
		status: "linked_verified",
		userId: redeemed.userId,
		employeeId: redeemed.employeeId,
		channelId: dmCheck.channelId,
		isCandidateEnrollment: redeemed.isCandidateEnrollment,
	};
}

export type RecheckMemberDiscordDmResult =
	| { kind: "reachable"; channelId: string; installationId: string }
	| {
			kind: "action_needed";
			installationId: string;
			code: DiscordDmFailureCode;
			recoveryHint: DiscordDmRecoveryHint;
			message: string;
	  }
	| {
			kind: "refused";
			code:
				| "ineligible"
				| "installation_unavailable"
				| "not_linked"
				| "secret_store_unavailable"
				| "credentials_missing";
			message: string;
	  };

/**
 * Re-tests private DM reachability for an already-linked employee on either the live or
 * candidate Discord installation (e.g., after the employee enables Discord server DMs to
 * resolve a `50007` privacy block).
 */
export async function recheckMemberDiscordDmReachability(
	input: {
		userId: string;
		organizationId: string;
		installationId: string;
	},
	deps?: DiscordMemberLinkDeps,
): Promise<RecheckMemberDiscordDmResult> {
	const db = deps?.db ?? defaultDb;
	const now = deps?.now ? deps.now() : new Date();
	const sendPrivateDm = deps?.sendPrivateDm ?? defaultSendDiscordPrivateDm;

	const eligibility = await verifyEligibleChatLinkMember(input.userId, input.organizationId, {
		...deps,
		db,
		now: () => now,
	});
	if (!eligibility.eligible) {
		return {
			kind: "refused",
			code: "ineligible",
			message: "You are not eligible to verify a Discord connection in this organization.",
		};
	}

	const [inst] = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.id, input.installationId),
				eq(chatInstallation.organizationId, input.organizationId),
				eq(chatInstallation.provider, "discord"),
			),
		)
		.limit(1);

	if (
		!inst ||
		(inst.status !== "active" && inst.status !== "legacy_active" && inst.status !== "candidate")
	) {
		return {
			kind: "refused",
			code: "installation_unavailable",
			message: "Discord installation is not available.",
		};
	}

	const isCandidate = inst.status === "candidate";
	const [link] = await db
		.select()
		.from(chatInstallationMemberLink)
		.where(
			and(
				eq(chatInstallationMemberLink.organizationId, input.organizationId),
				eq(chatInstallationMemberLink.installationId, inst.id),
				eq(chatInstallationMemberLink.userId, input.userId),
				eq(chatInstallationMemberLink.isCandidateEnrollment, isCandidate),
				eq(chatInstallationMemberLink.isActive, true),
			),
		)
		.limit(1);

	let discordUserId = link?.externalUserId ?? null;
	if (!discordUserId && inst.status === "legacy_active") {
		const [legacy] = await db
			.select({ discordUserId: discordUserMapping.discordUserId })
			.from(discordUserMapping)
			.where(
				and(
					eq(discordUserMapping.organizationId, input.organizationId),
					eq(discordUserMapping.userId, input.userId),
					eq(discordUserMapping.isActive, true),
				),
			)
			.limit(1);
		discordUserId = legacy?.discordUserId ?? null;
	}

	if (!discordUserId) {
		return {
			kind: "refused",
			code: "not_linked",
			message: "Link your Discord account with a link code first.",
		};
	}

	let botToken: string | null = null;
	if (inst.activeCredentialRevisionId) {
		const credResult = await readInstallationCredentialRevision(
			{
				organizationId: input.organizationId,
				installationId: inst.id,
				revisionId: inst.activeCredentialRevisionId,
			},
			{ db, readSecret: deps?.readSecret },
		);
		if (credResult.kind === "unavailable") {
			return {
				kind: "refused",
				code: "secret_store_unavailable",
				message: "The organization secret store is temporarily unavailable. Try again shortly.",
			};
		}
		if (credResult.kind === "ok") {
			botToken = credResult.secrets.bot_token ?? null;
		}
	} else if (inst.legacyTable === "discord_bot_config") {
		const legacyBot = await getBotConfigByOrganization(input.organizationId);
		botToken = legacyBot?.botToken ?? null;
	}

	if (!botToken) {
		return {
			kind: "refused",
			code: "credentials_missing",
			message: "Discord bot credentials are currently unavailable. Contact your administrator.",
		};
	}

	const check = await sendPrivateDm(botToken, {
		discordUserId,
		content:
			"Z8 direct message check — your Discord privacy settings now allow private notifications from Z8.",
	});

	if (check.kind !== "ok") {
		await upsertInstallationConversation(
			{
				organizationId: input.organizationId,
				installationId: inst.id,
				userId: input.userId,
				employeeId: eligibility.employeeId,
				externalUserId: discordUserId,
				externalConversationId: check.channelId ?? `dm-blocked:${discordUserId}`,
				conversationType: "private",
				reachabilityStatus: check.isPrivacyOrPrerequisiteBlock ? "action_needed" : "unknown",
				reachabilityReason: check.code,
				verifiedAt: null,
			},
			{ db },
		);

		return {
			kind: "action_needed",
			installationId: inst.id,
			code: check.code,
			recoveryHint: check.recoveryHint,
			message: check.message,
		};
	}

	await upsertInstallationConversation(
		{
			organizationId: input.organizationId,
			installationId: inst.id,
			userId: input.userId,
			employeeId: eligibility.employeeId,
			externalUserId: discordUserId,
			externalConversationId: check.channelId,
			conversationType: "private",
			reachabilityStatus: "reachable",
			reachabilityReason: null,
			verifiedAt: now,
			lastUsedAt: now,
		},
		{ db },
	);

	if (!isCandidate) {
		try {
			const rearm = deps?.rearmApprovalDelivery ?? rearmApprovalDeliveryForRepairedDestination;
			await rearm({
				organizationId: input.organizationId,
				userId: input.userId,
				provider: "discord",
			});
		} catch (error) {
			logger.warn(
				{ error, organizationId: input.organizationId, userId: input.userId },
				"Failed to re-arm Discord approval delivery after DM recheck",
			);
		}
	}

	return {
		kind: "reachable",
		channelId: check.channelId,
		installationId: inst.id,
	};
}
