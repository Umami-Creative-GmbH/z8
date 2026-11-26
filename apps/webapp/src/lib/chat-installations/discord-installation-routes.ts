import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db as defaultDb } from "@/db";
import { type ChatVerificationEvidence, chatProviderSettings } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { handleDiscordInteraction } from "@/lib/discord/bot-handler";
import { verifyDiscordSignature } from "@/lib/discord/signature";
import {
	type DiscordInteraction,
	InteractionResponseType,
	InteractionType,
	type ResolvedDiscordBot,
} from "@/lib/discord/types";
import { createLogger } from "@/lib/logger";
import { readInstallationCredentialRevision } from "./credential-revisions";
import {
	type DiscordMemberLinkDeps,
	type RedeemDiscordMemberLinkResult,
	redeemDiscordMemberLinkCode,
} from "./discord-member-link";
import {
	computeDiscordCandidateSetupStatus,
	DISCORD_VERIFICATION_FRESHNESS_MS,
	type DiscordCandidateInstallationRecord,
	type DiscordSetupRuntimeDeps,
	resolveDiscordSetupRepository,
} from "./discord-setup";
import type { ChatEffectiveSettings } from "./types";

const logger = createLogger("DiscordInstallationRoutes");

const EPHEMERAL_FLAG = 64;

const DEFAULT_EFFECTIVE_SETTINGS: ChatEffectiveSettings = {
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: true,
	enableEscalations: true,
	digestTime: "08:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
};

export interface DiscordInstallationHttpRequestInput {
	routeId: string;
	rawBody: string;
	timestamp: string;
	signature: string;
}

export interface DiscordInstallationHttpResponse {
	status: number;
	body: Record<string, unknown> | null;
}

export interface DiscordInstallationRouteDeps extends DiscordSetupRuntimeDeps {
	loadEffectiveSettings?: (organizationId: string) => Promise<ChatEffectiveSettings>;
	handleActiveInteraction?: (
		interaction: DiscordInteraction,
		bot: ResolvedDiscordBot,
	) => Promise<void>;
	redeemMemberLinkCode?: (
		input: Parameters<typeof redeemDiscordMemberLinkCode>[0],
	) => Promise<RedeemDiscordMemberLinkResult>;
	memberLinkDeps?: DiscordMemberLinkDeps;
}

type AuthenticatedDiscordInstallation =
	| {
			kind: "ok";
			installation: DiscordCandidateInstallationRecord;
			revisionId: string;
			secrets: Record<string, string>;
	  }
	| {
			kind: "reject";
			response: DiscordInstallationHttpResponse;
	  };

function isRetiringInstallationExpired(
	installation: DiscordCandidateInstallationRecord,
	now: Date,
): boolean {
	if (installation.revokedAt) return true;
	if (installation.retiredAt) return true;
	if (
		installation.retirementDeadlineAt &&
		Temporal.Instant.compare(
			instantFromDate(installation.retirementDeadlineAt),
			instantFromDate(now),
		) <= 0
	) {
		return true;
	}
	return false;
}

async function authenticateDiscordInstallationByRouteId(
	input: DiscordInstallationHttpRequestInput,
	deps?: DiscordInstallationRouteDeps,
): Promise<AuthenticatedDiscordInstallation> {
	const routeId = input.routeId.trim();
	if (!routeId) {
		return {
			kind: "reject",
			response: { status: 404, body: { error: "Installation not found" } },
		};
	}

	const repository = resolveDiscordSetupRepository(deps);
	const installation = await repository.findInstallationByRouteId(routeId);
	if (!installation) {
		return {
			kind: "reject",
			response: { status: 404, body: { error: "Installation not found" } },
		};
	}

	const now = deps?.now ? deps.now() : new Date();

	if (
		installation.status !== "candidate" &&
		installation.status !== "active" &&
		installation.status !== "retiring"
	) {
		return {
			kind: "reject",
			response: {
				status: 403,
				body: { error: "This Discord endpoint is not accepting requests" },
			},
		};
	}

	if (installation.status === "retiring" && isRetiringInstallationExpired(installation, now)) {
		return {
			kind: "reject",
			response: {
				status: 403,
				body: {
					error:
						"This retiring Discord installation has expired or been revoked. Open Z8 to review pending approvals.",
				},
			},
		};
	}

	if (!installation.activeCredentialRevisionId) {
		return {
			kind: "reject",
			response: {
				status: 401,
				body: { error: "Discord installation credentials are not configured" },
			},
		};
	}

	const credentialResult = await readInstallationCredentialRevision(
		{
			organizationId: installation.organizationId,
			installationId: installation.id,
			revisionId: installation.activeCredentialRevisionId,
		},
		{
			db: deps?.db,
			repository: deps?.revisionRepository,
			readSecret: deps?.readSecret,
		},
	);

	if (credentialResult.kind === "unavailable") {
		logger.warn(
			{ organizationId: installation.organizationId, installationId: installation.id },
			"Secret store unavailable while verifying Discord interaction signature",
		);
		return {
			kind: "reject",
			response: { status: 503, body: { error: "Secret store unavailable" } },
		};
	}

	if (credentialResult.kind !== "ok" || !credentialResult.secrets.public_key) {
		return {
			kind: "reject",
			response: { status: 401, body: { error: "Installation credentials are unavailable" } },
		};
	}

	const valid = await verifyDiscordSignature(
		credentialResult.secrets.public_key,
		input.signature,
		input.timestamp,
		input.rawBody,
	);
	if (!valid) {
		logger.warn(
			{ organizationId: installation.organizationId, installationId: installation.id },
			"Rejected Discord installation interaction with invalid Ed25519 signature",
		);
		return {
			kind: "reject",
			response: { status: 401, body: { error: "Invalid signature" } },
		};
	}

	return {
		kind: "ok",
		installation,
		revisionId: installation.activeCredentialRevisionId,
		secrets: credentialResult.secrets,
	};
}

async function loadAuthoritativeDiscordSettings(
	organizationId: string,
	deps?: DiscordInstallationRouteDeps,
): Promise<ChatEffectiveSettings> {
	if (deps?.loadEffectiveSettings) {
		return deps.loadEffectiveSettings(organizationId);
	}
	const db = deps?.db ?? defaultDb;
	const [row] = await db
		.select()
		.from(chatProviderSettings)
		.where(
			and(
				eq(chatProviderSettings.organizationId, organizationId),
				eq(chatProviderSettings.provider, "discord"),
			),
		)
		.limit(1);
	if (!row) {
		return { ...DEFAULT_EFFECTIVE_SETTINGS };
	}
	return {
		enableApprovals: row.enableApprovals,
		enableCommands: row.enableCommands,
		enableDailyDigest: row.enableDailyDigest,
		enableEscalations: row.enableEscalations,
		digestTime: row.digestTime,
		digestTimezone: row.digestTimezone,
		escalationTimeoutHours: row.escalationTimeoutHours,
	};
}

async function buildResolvedDiscordBotForInstallation(
	installation: DiscordCandidateInstallationRecord,
	secrets: Record<string, string>,
	deps?: DiscordInstallationRouteDeps,
): Promise<ResolvedDiscordBot | null> {
	const botToken = secrets.bot_token;
	const publicKey = secrets.public_key;
	if (!botToken || !publicKey || !installation.externalAppId) {
		return null;
	}
	const settings = await loadAuthoritativeDiscordSettings(installation.organizationId, deps);
	return {
		organizationId: installation.organizationId,
		installationId: installation.id,
		botToken,
		applicationId: installation.externalAppId,
		publicKey,
		webhookSecret: installation.routeId,
		setupStatus: installation.status,
		...settings,
	};
}

function ephemeralMessageResponse(content: string): DiscordInstallationHttpResponse {
	return {
		status: 200,
		body: {
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content,
				flags: EPHEMERAL_FLAG,
				allowed_mentions: { parse: [] },
			},
		},
	};
}

function formatLinkRedemptionReply(
	result: RedeemDiscordMemberLinkResult,
	isCandidate: boolean,
): string {
	switch (result.status) {
		case "linked_verified":
			return isCandidate
				? "Linked to your organization's replacement Discord bot and verified direct message delivery. Your current live Discord connection remains unchanged until your admin switches."
				: "Your Discord account is now linked to Z8 and direct message delivery is verified.";
		case "linked_dm_blocked":
			return `Your Discord account is linked, but Z8 could not send you a direct message (${result.recoveryCode}). ${result.recoveryMessage} After updating your Discord privacy settings, open Settings -> Notifications in Z8 to verify DM delivery.`;
		case "invalid_code":
			return "Invalid link code. Generate a fresh code in Z8 under Settings -> Notifications and try again.";
		case "expired":
			return "This link code has expired. Generate a new code in Z8 under Settings -> Notifications.";
		case "already_used":
			return "This link code has already been used. Generate a new code in Z8 under Settings -> Notifications.";
		case "already_linked":
			return "This Discord account is already linked to another Z8 member in this organization.";
		case "ineligible":
			return "Your Z8 account is not currently eligible to link Discord in this organization.";
		case "rate_limited":
			return `Too many link attempts. Please wait ${result.retryAfterSeconds} seconds and try again.`;
		case "installation_unavailable":
			return "This Discord bot installation is not currently available for account linking.";
	}
}

/**
 * Handles `POST /api/discord/installations/[routeId]/interactions`:
 * - Verifies Ed25519 signature against the installation's immutable credential revision `public_key`
 *   (`503` on secret-store outage, `401` on invalid signature) and checks `application_id` (`403` on mismatch).
 * - `candidate`: responds `{ type: 1 }` to `PING` (recording fresh signed endpoint proof without
 *   marking private DM reachability ready!), supports segregated `candidate_enrollment` `/link`
 *   redemption, and blocks production commands & approval actions.
 * - `active`: services `/link` proof redemption, slash commands, and approval button interactions.
 * - `retiring` (before `retirementDeadlineAt` and not revoked): continues servicing eligible old
 *   approval card button presses (`MESSAGE_COMPONENT`) under current authority, while refusing
 *   new slash commands (`APPLICATION_COMMAND`).
 * - `revoked` / `retired`: immediately refuses local authorization (`403`).
 */
export async function handleDiscordInstallationInteractionRequest(
	input: DiscordInstallationHttpRequestInput,
	deps?: DiscordInstallationRouteDeps,
): Promise<DiscordInstallationHttpResponse> {
	const auth = await authenticateDiscordInstallationByRouteId(input, deps);
	if (auth.kind === "reject") {
		return auth.response;
	}

	let interaction: DiscordInteraction;
	try {
		interaction = JSON.parse(input.rawBody) as DiscordInteraction;
	} catch {
		return { status: 400, body: { error: "Invalid JSON body" } };
	}

	const now = deps?.now ? deps.now() : new Date();
	const ttlMs = deps?.verificationTtlMs ?? DISCORD_VERIFICATION_FRESHNESS_MS;

	// Verify application_id inside the authenticated Ed25519 context.
	const payloadAppId =
		typeof interaction.application_id === "string" ? interaction.application_id.trim() : "";
	if (
		!auth.installation.externalAppId ||
		!payloadAppId ||
		payloadAppId !== auth.installation.externalAppId
	) {
		if (auth.installation.status === "candidate") {
			const repository = resolveDiscordSetupRepository(deps);
			await repository.updateInstallation(auth.installation.organizationId, auth.installation.id, {
				verificationState: "failed",
				verificationEvidence: {
					...(auth.installation.verificationEvidence ?? { source: "verified_setup" }),
					source: "verified_setup",
					lastFailureStep: "signed_event",
					lastFailureCode: "application_id_mismatch",
					lastFailureAt: now.toISOString(),
				},
			});
			if (deps?.recordAudit) {
				await deps.recordAudit({
					action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
					actorId: auth.installation.createdByUserId ?? "system",
					organizationId: auth.installation.organizationId,
					targetId: auth.installation.id,
					metadata: {
						provider: "discord",
						step: "signed_event",
						failureCode: "application_id_mismatch",
					},
				});
			}
		}
		return { status: 403, body: { error: "Discord application ID mismatch" } };
	}

	// PING verification (type === 1)
	if (interaction.type === InteractionType.PING) {
		if (auth.installation.status === "candidate") {
			const repository = resolveDiscordSetupRepository(deps);
			const previousEvidence = auth.installation.verificationEvidence;
			const nextEvidence: ChatVerificationEvidence = {
				...(previousEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
				interactionEndpointConfigured: true,
				signedEventVerifiedAt: now.toISOString(),
				signedEventRevisionId: auth.revisionId,
				signedEventType: "PING",
				signedEventExpiresAt: new Date(now.getTime() + ttlMs).toISOString(),
				...(previousEvidence?.lastFailureStep === "signed_event"
					? { lastFailureStep: null, lastFailureCode: null, lastFailureAt: null }
					: {}),
			};

			const nextStatus = computeDiscordCandidateSetupStatus(
				{
					...auth.installation,
					verificationEvidence: nextEvidence,
				},
				now,
				ttlMs,
			);

			await repository.updateInstallation(auth.installation.organizationId, auth.installation.id, {
				verificationEvidence: nextEvidence,
				verificationState: nextStatus.effectiveVerificationState,
				lastVerifiedAt: nextStatus.readyForSwitch ? now : auth.installation.lastVerifiedAt,
			});

			if (deps?.recordAudit) {
				await deps.recordAudit({
					action: AuditAction.CHAT_INSTALLATION_INBOUND_VERIFIED,
					actorId: auth.installation.createdByUserId ?? "system",
					organizationId: auth.installation.organizationId,
					targetId: auth.installation.id,
					metadata: {
						provider: "discord",
						revisionId: auth.revisionId,
						eventType: "PING",
						readyForSwitch: nextStatus.readyForSwitch,
					},
				});
			}
		}

		return {
			status: 200,
			body: { type: InteractionResponseType.PONG },
		};
	}

	// Candidate lane: segregated enrollment /link ONLY; block all production commands & buttons.
	if (auth.installation.status === "candidate") {
		if (
			interaction.type === InteractionType.APPLICATION_COMMAND &&
			interaction.data?.name === "link"
		) {
			const discordUser = interaction.member?.user ?? interaction.user;
			const codeOption = interaction.data.options?.find((opt) => opt.name === "code");
			const code = codeOption?.value?.trim() ?? "";

			if (!discordUser || !code) {
				return ephemeralMessageResponse(
					"Provide your candidate link code from Z8 Settings -> Notifications: `/link code:YOUR_CODE`.",
				);
			}

			const botToken = auth.secrets.bot_token;
			if (!botToken) {
				return { status: 503, body: { error: "Candidate Discord bot token unavailable" } };
			}

			const redeemFn =
				deps?.redeemMemberLinkCode ??
				((args: Parameters<typeof redeemDiscordMemberLinkCode>[0]) =>
					redeemDiscordMemberLinkCode(args, {
						...deps?.memberLinkDeps,
						db: deps?.memberLinkDeps?.db ?? (deps?.db as typeof defaultDb | undefined),
						now: () => now,
						sendPrivateDm: deps?.sendPrivateDm,
					}));

			const outcome = await redeemFn({
				organizationId: auth.installation.organizationId,
				installationId: auth.installation.id,
				purpose: "candidate_enrollment",
				code,
				discordUserId: discordUser.id,
				discordUsername: discordUser.username,
				discordDisplayName: discordUser.global_name ?? discordUser.username,
				botToken,
			});

			if (outcome.status === "linked_verified" || outcome.status === "linked_dm_blocked") {
				const repository = resolveDiscordSetupRepository(deps);
				const prev = auth.installation.verificationEvidence;
				await repository.updateInstallation(
					auth.installation.organizationId,
					auth.installation.id,
					{
						verificationEvidence: {
							...(prev ?? { source: "verified_setup" }),
							source: "verified_setup",
							enrollmentProofCount: (prev?.enrollmentProofCount ?? 0) + 1,
							lastEnrollmentProofAt: now.toISOString(),
						},
					},
				);
			}

			return ephemeralMessageResponse(formatLinkRedemptionReply(outcome, true));
		}

		return {
			status: 403,
			body: {
				error:
					"Candidate Discord installation cannot execute production commands or approval actions.",
			},
		};
	}

	// Retiring lane: refuse new slash commands; continue servicing eligible old approval buttons.
	if (auth.installation.status === "retiring") {
		if (interaction.type === InteractionType.APPLICATION_COMMAND) {
			return ephemeralMessageResponse(
				"This Discord bot is retiring. Please use your organization's active Z8 Discord bot or open Z8 directly.",
			);
		}
		if (interaction.type !== InteractionType.MESSAGE_COMPONENT) {
			return {
				status: 403,
				body: {
					error: "Retiring Discord installation only services existing approval card actions.",
				},
			};
		}
	}

	const bot = await buildResolvedDiscordBotForInstallation(auth.installation, auth.secrets, deps);
	if (!bot) {
		return {
			status: 503,
			body: { error: "Discord bot credentials are unavailable" },
		};
	}

	// Active lane: handle installation-bound `/link` proof redemption synchronously with DM check.
	if (
		auth.installation.status === "active" &&
		interaction.type === InteractionType.APPLICATION_COMMAND &&
		interaction.data?.name === "link"
	) {
		const discordUser = interaction.member?.user ?? interaction.user;
		const codeOption = interaction.data.options?.find((opt) => opt.name === "code");
		const code = codeOption?.value?.trim() ?? "";

		if (!discordUser || !code) {
			return ephemeralMessageResponse(
				"Provide your link code from Z8 Settings -> Notifications: `/link code:YOUR_CODE`.",
			);
		}

		const redeemFn =
			deps?.redeemMemberLinkCode ??
			((args: Parameters<typeof redeemDiscordMemberLinkCode>[0]) =>
				redeemDiscordMemberLinkCode(args, {
					...deps?.memberLinkDeps,
					db: deps?.memberLinkDeps?.db ?? (deps?.db as typeof defaultDb | undefined),
					now: () => now,
					sendPrivateDm: deps?.sendPrivateDm,
				}));

		const outcome = await redeemFn({
			organizationId: auth.installation.organizationId,
			installationId: auth.installation.id,
			purpose: "member_link",
			code,
			discordUserId: discordUser.id,
			discordUsername: discordUser.username,
			discordDisplayName: discordUser.global_name ?? discordUser.username,
			botToken: bot.botToken,
		});

		return ephemeralMessageResponse(formatLinkRedemptionReply(outcome, false));
	}

	// Active slash commands & active/retiring approval card button interactions.
	const dispatch = deps?.handleActiveInteraction ?? handleDiscordInteraction;
	await dispatch(interaction, bot);

	return { status: 202, body: null };
}
