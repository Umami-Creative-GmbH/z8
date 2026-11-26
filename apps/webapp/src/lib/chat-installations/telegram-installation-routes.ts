import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db as defaultDb } from "@/db";
import { type ChatVerificationEvidence, chatProviderSettings } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { dateFromInstant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	answerCallbackQuery,
	sendMessageWithOutcome,
	type TelegramCallOutcome,
} from "@/lib/telegram/api";
import {
	handleApprovalCallback,
	handleBoundApprovalCallback,
} from "@/lib/telegram/approval-handler";
import { handleTelegramUpdate } from "@/lib/telegram/bot-handler";
import { parseBoundApprovalCallback } from "@/lib/telegram/bound-approval";
import type {
	ApprovalCallbackData,
	ResolvedTelegramBot,
	TelegramCallbackQuery,
	TelegramMessage,
	TelegramSendMessageParams,
	TelegramUpdate,
} from "@/lib/telegram/types";
import { readInstallationCredentialRevision } from "./credential-revisions";
import {
	type RedeemChatLinkProofInput,
	type RedeemChatLinkProofResult,
	redeemChatLinkProof,
} from "./member-links";
import {
	computeTelegramCandidateSetupStatus,
	resolveTelegramSetupRepository,
	TELEGRAM_VERIFICATION_FRESHNESS_MS,
	type TelegramCandidateInstallationRecord,
	type TelegramSetupRuntimeDeps,
} from "./telegram-setup";
import type { ChatEffectiveSettings } from "./types";

const logger = createLogger("TelegramInstallationRoutes");

const DEFAULT_EFFECTIVE_SETTINGS: ChatEffectiveSettings = {
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: true,
	enableEscalations: true,
	digestTime: "08:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
};

export interface TelegramInstallationWebhookRequestInput {
	routeId: string;
	secretTokenHeader: string | null;
	rawBody: string;
}

export interface TelegramInstallationWebhookResponse {
	status: number;
	body: Record<string, unknown>;
}

export interface TelegramInstallationRouteDeps extends TelegramSetupRuntimeDeps {
	loadEffectiveSettings?: (organizationId: string) => Promise<ChatEffectiveSettings>;
	handleActiveUpdate?: (update: TelegramUpdate, bot: ResolvedTelegramBot) => Promise<void>;
	handleRetiringBoundApproval?: (
		query: TelegramCallbackQuery,
		callback: { action: "approve" | "reject"; bindingId: string },
		updateId: number | undefined,
		bot: ResolvedTelegramBot,
	) => Promise<string | undefined>;
	handleRetiringLegacyApproval?: (
		query: TelegramCallbackQuery,
		data: ApprovalCallbackData,
		telegramUserId: string,
		bot: ResolvedTelegramBot,
	) => Promise<string | undefined>;
	redeemCandidateLinkProof?: (
		input: RedeemChatLinkProofInput,
	) => Promise<RedeemChatLinkProofResult>;
	answerCallbackQuery?: (
		botToken: string,
		callbackQueryId: string,
		text?: string,
	) => Promise<boolean>;
	sendMessage?: (
		botToken: string,
		params: TelegramSendMessageParams,
	) => Promise<TelegramCallOutcome<TelegramMessage>>;
}

function constantTimeEquals(a: string, b: string): boolean {
	const bufA = Buffer.from(a, "utf8");
	const bufB = Buffer.from(b, "utf8");
	if (bufA.length !== bufB.length) {
		return false;
	}
	return timingSafeEqual(bufA, bufB);
}

function getNow(deps?: Pick<TelegramSetupRuntimeDeps, "now">): Date {
	return deps?.now ? deps.now() : dateFromInstant(systemClock.nowInstant());
}

export function isRetiringTelegramInstallationExpired(
	installation: Pick<
		TelegramCandidateInstallationRecord,
		"revokedAt" | "retiredAt" | "retirementDeadlineAt"
	>,
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

async function loadAuthoritativeTelegramSettings(
	organizationId: string,
	deps?: TelegramInstallationRouteDeps,
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
				eq(chatProviderSettings.provider, "telegram"),
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

async function recordInboundAudit(
	installation: TelegramCandidateInstallationRecord,
	revisionId: string,
	eventType: string,
	readyForSwitch: boolean,
	deps?: TelegramInstallationRouteDeps,
): Promise<void> {
	const metadata = {
		provider: "telegram",
		revisionId,
		eventType,
		readyForSwitch,
	};
	if (deps?.recordAudit) {
		await deps.recordAudit({
			action: AuditAction.CHAT_INSTALLATION_INBOUND_VERIFIED,
			actorId: installation.createdByUserId ?? "system",
			organizationId: installation.organizationId,
			targetId: installation.id,
			metadata,
		});
		return;
	}
	try {
		await logAudit({
			action: AuditAction.CHAT_INSTALLATION_INBOUND_VERIFIED,
			actorId: installation.createdByUserId ?? "system",
			organizationId: installation.organizationId,
			targetId: installation.id,
			targetType: "chat_installation",
			metadata,
			timestamp: new Date(),
		});
	} catch (error) {
		logger.warn(
			{ error, organizationId: installation.organizationId, installationId: installation.id },
			"Failed to record redacted Telegram inbound webhook verification audit",
		);
	}
}

/**
 * Handles retiring-mode Telegram updates (shared by both installation-scoped and legacy
 * webhook routes): services eligible approval-card callback queries under current decision
 * authority, while refusing new commands, linking, and non-approval callbacks.
 */
export async function handleRetiringTelegramUpdate(
	update: TelegramUpdate,
	bot: ResolvedTelegramBot,
	deps?: Pick<
		TelegramInstallationRouteDeps,
		"handleRetiringBoundApproval" | "handleRetiringLegacyApproval" | "answerCallbackQuery"
	>,
): Promise<TelegramInstallationWebhookResponse> {
	const answerCb = deps?.answerCallbackQuery ?? answerCallbackQuery;

	if (update.callback_query) {
		const query = update.callback_query;
		if (!query.data || !query.from) {
			return {
				status: 403,
				body: {
					ok: false,
					mode: "retiring",
					error: "Retiring Telegram bot only services existing approval cards.",
				},
			};
		}

		let parsedData: unknown;
		try {
			parsedData = JSON.parse(query.data);
		} catch {
			return {
				status: 403,
				body: {
					ok: false,
					mode: "retiring",
					error: "Retiring Telegram bot only services existing approval cards.",
				},
			};
		}

		const bound = parseBoundApprovalCallback(parsedData);
		if (bound) {
			const boundHandler = deps?.handleRetiringBoundApproval ?? handleBoundApprovalCallback;
			const acknowledgment = await boundHandler(query, bound, update.update_id, bot);
			await answerCb(bot.botToken, query.id, acknowledgment);
			return { status: 200, body: { ok: true, mode: "retiring" } };
		}

		if (
			typeof parsedData === "object" &&
			parsedData !== null &&
			"a" in parsedData &&
			(parsedData.a === "ap" || parsedData.a === "rj") &&
			"id" in parsedData &&
			typeof parsedData.id === "string"
		) {
			const legacyHandler = deps?.handleRetiringLegacyApproval ?? handleApprovalCallback;
			const acknowledgment = await legacyHandler(
				query,
				parsedData as ApprovalCallbackData,
				String(query.from.id),
				bot,
			);
			await answerCb(bot.botToken, query.id, acknowledgment);
			return { status: 200, body: { ok: true, mode: "retiring" } };
		}

		await answerCb(
			bot.botToken,
			query.id,
			"This Telegram bot is retiring. Open your organization's active Z8 bot or Z8 web app.",
		);
		return {
			status: 403,
			body: {
				ok: false,
				mode: "retiring",
				error: "Retiring Telegram bot only services existing approval cards.",
			},
		};
	}

	return {
		status: 403,
		body: {
			ok: false,
			mode: "retiring",
			error: "Retiring Telegram bot does not accept new commands or messages.",
		},
	};
}

/**
 * Handles `POST /api/telegram/installations/[routeId]/webhook`:
 * - Resolves installation strictly by non-secret `routeId`.
 * - Verifies `x-telegram-bot-api-secret-token` against the active credential revision's
 *   `webhook_secret` (`503` on secret-store outage, `401` on invalid/missing secret).
 * - `candidate`: records authenticated webhook receipt, redeems `/link CODE` STRICTLY via
 *   `purpose: "candidate_enrollment"`, and blocks production commands & approval callbacks.
 * - `active`: dispatches full updates to `handleTelegramUpdate` using the active installation's
 *   credentials, `installationId`, and authoritative settings.
 * - `retiring` (before `retirementDeadlineAt` & not revoked): continues servicing eligible
 *   approval-card callback queries while refusing new commands/delivery.
 * - `revoked` / `retired`: immediately refuses local authorization (`403`).
 */
export async function handleTelegramInstallationWebhookRequest(
	input: TelegramInstallationWebhookRequestInput,
	deps?: TelegramInstallationRouteDeps,
): Promise<TelegramInstallationWebhookResponse> {
	const routeId = input.routeId.trim();
	if (!routeId) {
		return { status: 404, body: { ok: false, error: "Installation not found" } };
	}

	const repository = resolveTelegramSetupRepository(deps);
	const installation = await repository.findInstallationByRouteId(routeId);
	if (!installation) {
		return { status: 404, body: { ok: false, error: "Installation not found" } };
	}

	const now = getNow(deps);

	if (
		installation.status !== "candidate" &&
		installation.status !== "active" &&
		installation.status !== "retiring"
	) {
		return {
			status: 403,
			body: { ok: false, error: "This Telegram installation endpoint is not accepting requests" },
		};
	}

	if (
		installation.status === "retiring" &&
		isRetiringTelegramInstallationExpired(installation, now)
	) {
		return {
			status: 403,
			body: {
				ok: false,
				error:
					"This retiring Telegram installation has expired or been revoked. Open Z8 to review pending approvals.",
			},
		};
	}

	if (!installation.activeCredentialRevisionId) {
		return {
			status: 401,
			body: { ok: false, error: "Telegram installation credentials are not configured" },
		};
	}

	const credResult = await readInstallationCredentialRevision(
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

	if (credResult.kind === "unavailable") {
		logger.warn(
			{ organizationId: installation.organizationId, installationId: installation.id },
			"Secret store unavailable while verifying Telegram installation webhook secret",
		);
		return { status: 503, body: { ok: false, error: "Secret store unavailable" } };
	}

	if (
		credResult.kind !== "ok" ||
		!credResult.secrets.webhook_secret ||
		!credResult.secrets.bot_token
	) {
		return {
			status: 401,
			body: { ok: false, error: "Installation credentials are unavailable" },
		};
	}

	const providedSecret = input.secretTokenHeader ?? "";
	if (!providedSecret || !constantTimeEquals(providedSecret, credResult.secrets.webhook_secret)) {
		logger.warn(
			{ organizationId: installation.organizationId, installationId: installation.id },
			"Rejected Telegram installation webhook with invalid secret token header",
		);
		return { status: 401, body: { ok: false, error: "Invalid webhook secret token" } };
	}

	let update: TelegramUpdate;
	try {
		update = JSON.parse(input.rawBody) as TelegramUpdate;
		if (typeof update !== "object" || update === null) {
			return { status: 400, body: { ok: false, error: "Invalid Telegram update payload" } };
		}
	} catch {
		return { status: 400, body: { ok: false, error: "Invalid JSON body" } };
	}

	const botToken = credResult.secrets.bot_token;
	const revisionId = installation.activeCredentialRevisionId;

	// 1. Candidate mode: setup verification + segregated candidate_enrollment ONLY!
	if (installation.status === "candidate") {
		const ttlMs = deps?.verificationTtlMs ?? TELEGRAM_VERIFICATION_FRESHNESS_MS;
		const eventType = update.callback_query
			? "callback_query"
			: update.message
				? "message"
				: "update";
		const prevEvidence = installation.verificationEvidence;
		const expiresAt = dateFromInstant(
			instantFromDate(now).add({ milliseconds: ttlMs }),
		).toISOString();

		const nextEvidence: ChatVerificationEvidence = {
			...(prevEvidence ?? { source: "verified_setup" }),
			source: "verified_setup",
			signedEventVerifiedAt: now.toISOString(),
			signedEventRevisionId: revisionId,
			signedEventType: eventType,
			signedEventExpiresAt: expiresAt,
			...(prevEvidence?.lastFailureStep === "signed_event" ||
			prevEvidence?.lastFailureStep === "webhook"
				? { lastFailureStep: null, lastFailureCode: null, lastFailureAt: null }
				: {}),
		};

		const computed = computeTelegramCandidateSetupStatus(
			{ ...installation, verificationEvidence: nextEvidence },
			now,
			ttlMs,
		);

		await repository.updateInstallation(installation.organizationId, installation.id, {
			verificationEvidence: nextEvidence,
			verificationState: computed.effectiveVerificationState,
			lastVerifiedAt: computed.readyForSwitch ? now : installation.lastVerifiedAt,
		});

		await recordInboundAudit(installation, revisionId, eventType, computed.readyForSwitch, deps);

		const callSendMessage = deps?.sendMessage ?? sendMessageWithOutcome;
		const answerCb = deps?.answerCallbackQuery ?? answerCallbackQuery;

		if (update.callback_query) {
			await answerCb(
				botToken,
				update.callback_query.id,
				"This replacement bot is in setup mode and cannot process approvals yet.",
			);
			return {
				status: 403,
				body: {
					ok: false,
					mode: "candidate",
					verificationRecorded: true,
					error: "Candidate Telegram bot cannot process production approval actions.",
				},
			};
		}

		const message = update.message;
		const text = message?.text?.trim() ?? "";

		if (message && message.chat.type === "private" && message.from && text.startsWith("/link")) {
			const code = text.split(/\s+/)[1]?.trim() ?? "";
			const chatId = String(message.chat.id);
			if (!code) {
				await callSendMessage(botToken, {
					chat_id: chatId,
					text: "Please provide your replacement link code from Settings -> Notifications: /link YOUR_CODE",
				});
				return {
					status: 200,
					body: { ok: true, mode: "candidate", verificationRecorded: true },
				};
			}

			const displayName = [message.from.first_name, message.from.last_name]
				.filter(Boolean)
				.join(" ");
			const redeem =
				deps?.redeemCandidateLinkProof ??
				((redeemInput: RedeemChatLinkProofInput) =>
					redeemChatLinkProof(redeemInput, {
						db: deps?.db as typeof defaultDb | undefined,
						now: () => now,
					}));

			const redeemResult = await redeem({
				organizationId: installation.organizationId,
				installationId: installation.id,
				purpose: "candidate_enrollment",
				code,
				externalUserId: String(message.from.id),
				externalUsername: message.from.username ?? null,
				externalDisplayName: displayName || null,
				externalConversationId: chatId,
				conversationType: "private",
			});

			let replyText: string;
			switch (redeemResult.status) {
				case "success":
					replyText =
						"You are enrolled for the replacement Z8 Telegram bot! Your current Telegram connection remains active until an administrator completes the switch.";
					break;
				case "expired":
					replyText =
						"This link code has expired. Generate a new replacement link code in Z8 under Settings -> Notifications.";
					break;
				case "already_linked":
					replyText = "This Telegram account is already enrolled for another Z8 account.";
					break;
				case "rate_limited":
					replyText = "Too many attempts. Wait a few minutes before trying again.";
					break;
				case "ineligible":
					replyText = "Your Z8 account is not eligible to enroll in this organization.";
					break;
				default:
					replyText =
						"Invalid replacement link code. Check the code generated in Settings -> Notifications and try again.";
					break;
			}

			await callSendMessage(botToken, { chat_id: chatId, text: replyText });

			if (redeemResult.status === "success") {
				const latest =
					(await repository.findInstallationById(installation.organizationId, installation.id)) ??
					installation;
				const latestEvidence = latest.verificationEvidence ?? nextEvidence;
				await repository.updateInstallation(installation.organizationId, installation.id, {
					verificationEvidence: {
						...latestEvidence,
						enrollmentProofCount: (latestEvidence.enrollmentProofCount ?? 0) + 1,
						lastEnrollmentProofAt: now.toISOString(),
					},
				});
			}

			return {
				status: 200,
				body: {
					ok: true,
					mode: "candidate",
					verificationRecorded: true,
					enrollmentStatus: redeemResult.status,
				},
			};
		}

		if (
			message &&
			message.chat.type === "private" &&
			(text === "/start" || text === "/verify" || text === "/test")
		) {
			const chatId = String(message.chat.id);
			await callSendMessage(botToken, {
				chat_id: chatId,
				text: `Webhook receipt verified for this staged Z8 replacement bot. To link your account ahead of the switch, generate a replacement link code in Settings -> Notifications and send: /link YOUR_CODE (Chat ID: ${chatId})`,
			});
			return {
				status: 200,
				body: { ok: true, mode: "candidate", verificationRecorded: true },
			};
		}

		if (message && message.chat.type === "private") {
			await callSendMessage(botToken, {
				chat_id: String(message.chat.id),
				text: "This Telegram bot is in setup verification mode and cannot run Z8 commands until an administrator completes the switch.",
			});
		}

		return {
			status: 403,
			body: {
				ok: false,
				mode: "candidate",
				verificationRecorded: true,
				error: "Candidate Telegram bot cannot execute production commands.",
			},
		};
	}

	// Build ResolvedTelegramBot for `active` or `retiring`
	const settings = await loadAuthoritativeTelegramSettings(installation.organizationId, deps);
	const bot: ResolvedTelegramBot = {
		organizationId: installation.organizationId,
		installationId: installation.id,
		credentialRevisionId: revisionId,
		botToken,
		botUsername: installation.externalBotUsername,
		webhookSecret: installation.routeId,
		setupStatus: installation.status === "active" ? "active" : installation.status,
		...settings,
	};

	// 2. Retiring mode: approval-card callbacks ONLY!
	if (installation.status === "retiring") {
		return handleRetiringTelegramUpdate(update, bot, deps);
	}

	// 3. Active mode: full production Telegram updates
	const dispatchUpdate = deps?.handleActiveUpdate ?? handleTelegramUpdate;
	await dispatchUpdate(update, bot);

	return {
		status: 200,
		body: { ok: true, mode: "active" },
	};
}
