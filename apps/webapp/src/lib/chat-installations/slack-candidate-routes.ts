import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db as defaultDb } from "@/db";
import { type ChatVerificationEvidence, chatProviderSettings } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { handleEvent, handleInteraction, handleSlashCommand } from "@/lib/slack/bot-handler";
import { verifySlackSignature } from "@/lib/slack/signature";
import type {
	ResolvedSlackBot,
	SlackEventCallback,
	SlackInteractionPayload,
	SlackSlashCommandPayload,
} from "@/lib/slack/types";
import { readInstallationCredentialRevision } from "./credential-revisions";
import {
	computeSlackCandidateSetupStatus,
	resolveSlackSetupRepository,
	SLACK_VERIFICATION_FRESHNESS_MS,
	type SlackCandidateInstallationRecord,
	type SlackSetupRuntimeDeps,
} from "./slack-setup";
import type { ChatEffectiveSettings } from "./types";

const logger = createLogger("SlackInstallationRoutes");

const DEFAULT_EFFECTIVE_SETTINGS: ChatEffectiveSettings = {
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: true,
	enableEscalations: true,
	digestTime: "08:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
};

export interface SlackCandidateHttpRequestInput {
	routeId: string;
	rawBody: string;
	timestamp: string;
	signature: string;
}

export interface SlackCandidateHttpResponse {
	status: number;
	body: Record<string, unknown>;
}

export interface SlackInstallationRouteDeps extends SlackSetupRuntimeDeps {
	loadEffectiveSettings?: (organizationId: string) => Promise<ChatEffectiveSettings>;
	handleActiveEvent?: (event: SlackEventCallback, bot: ResolvedSlackBot) => Promise<void>;
	handleActiveInteraction?: (
		payload: SlackInteractionPayload,
		bot: ResolvedSlackBot,
	) => Promise<void>;
	handleActiveCommand?: (
		payload: SlackSlashCommandPayload,
		bot: ResolvedSlackBot,
	) => Promise<{ text: string }>;
}

type AuthenticatedInstallationResult =
	| {
			kind: "ok";
			installation: SlackCandidateInstallationRecord;
			revisionId: string;
			secrets: Record<string, string>;
	  }
	| {
			kind: "reject";
			response: SlackCandidateHttpResponse;
	  };

function isRetiringInstallationExpired(
	installation: SlackCandidateInstallationRecord,
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

/**
 * Selects the Slack verifier strictly by the installation's non-secret `routeId`
 * (never global `env.SLACK_SIGNING_SECRET`), reads the installation's revisioned
 * signing secret, and verifies the Slack HMAC-SHA256 signature.
 */
async function authenticateInstallationByRouteId(
	input: SlackCandidateHttpRequestInput,
	deps?: SlackInstallationRouteDeps,
): Promise<AuthenticatedInstallationResult> {
	const routeId = input.routeId.trim();
	if (!routeId) {
		return {
			kind: "reject",
			response: { status: 404, body: { error: "Installation not found" } },
		};
	}

	const repository = resolveSlackSetupRepository(deps);
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
				body: { error: "This Slack endpoint is not accepting requests" },
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
						"This retiring Slack installation has expired or been revoked. Open Z8 to review pending approvals.",
				},
			},
		};
	}

	if (!installation.activeCredentialRevisionId) {
		return {
			kind: "reject",
			response: {
				status: 401,
				body: { error: "Slack installation credentials are not configured" },
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
			"Secret store unavailable while verifying Slack installation signature",
		);
		return {
			kind: "reject",
			response: { status: 503, body: { error: "Secret store unavailable" } },
		};
	}

	if (credentialResult.kind !== "ok" || !credentialResult.secrets.signing_secret) {
		return {
			kind: "reject",
			response: { status: 401, body: { error: "Installation credentials are unavailable" } },
		};
	}

	const valid = verifySlackSignature(
		credentialResult.secrets.signing_secret,
		input.timestamp,
		input.rawBody,
		input.signature,
	);
	if (!valid) {
		logger.warn(
			{ organizationId: installation.organizationId, installationId: installation.id },
			"Rejected Slack installation callback with invalid signature",
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

function matchesExpectedIdentity(
	installation: SlackCandidateInstallationRecord,
	payloadTeamId: string | null | undefined,
	payloadAppId: string | null | undefined,
	requireAppId: boolean,
): boolean {
	const teamId = payloadTeamId?.trim() ?? "";
	const appId = payloadAppId?.trim() ?? "";
	if (!installation.externalSpaceId || !teamId || teamId !== installation.externalSpaceId) {
		return false;
	}
	if (requireAppId) {
		return Boolean(installation.externalAppId && appId && appId === installation.externalAppId);
	}
	if (appId && installation.externalAppId && appId !== installation.externalAppId) {
		return false;
	}
	return true;
}

async function loadAuthoritativeSlackSettings(
	organizationId: string,
	deps?: SlackInstallationRouteDeps,
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
				eq(chatProviderSettings.provider, "slack"),
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

async function buildResolvedSlackBotForInstallation(
	installation: SlackCandidateInstallationRecord,
	secrets: Record<string, string>,
	deps?: SlackInstallationRouteDeps,
): Promise<ResolvedSlackBot | null> {
	const botAccessToken = secrets.bot_access_token ?? secrets.bot_token;
	if (!botAccessToken || !installation.externalSpaceId) {
		return null;
	}
	const settings = await loadAuthoritativeSlackSettings(installation.organizationId, deps);
	return {
		organizationId: installation.organizationId,
		installationId: installation.id,
		botAccessToken,
		slackTeamId: installation.externalSpaceId,
		slackTeamName: installation.externalSpaceName,
		botUserId: installation.externalBotId,
		setupStatus: installation.status === "active" ? "active" : installation.status,
		...settings,
	};
}

/**
 * Handles `POST /api/slack/installations/[routeId]/events`:
 * - `candidate`: strictly scoped to signed `url_verification` and signed `event_callback`
 *   recording fresh app-and-workspace inbound verification proof (zero production traffic).
 * - `active`: verifies `team_id` + `api_app_id` and dispatches production Slack events to the
 *   active organization-owned installation.
 * - `retiring`: allows `url_verification` only; refuses new production events/DMs.
 */
export async function handleSlackCandidateEventRequest(
	input: SlackCandidateHttpRequestInput,
	deps?: SlackInstallationRouteDeps,
): Promise<SlackCandidateHttpResponse> {
	const auth = await authenticateInstallationByRouteId(input, deps);
	if (auth.kind === "reject") {
		return auth.response;
	}

	let body: {
		type?: string;
		challenge?: string;
		token?: string;
		team_id?: string;
		api_app_id?: string;
		event?: {
			type?: string;
			channel?: string;
			channel_type?: string;
			user?: string;
			text?: string;
			ts?: string;
		};
	};
	try {
		body = JSON.parse(input.rawBody);
	} catch {
		return { status: 400, body: { error: "Invalid JSON body" } };
	}

	if (body.type === "url_verification") {
		if (typeof body.challenge !== "string" || !body.challenge) {
			return { status: 400, body: { error: "Missing challenge" } };
		}
		return { status: 200, body: { challenge: body.challenge } };
	}

	if (body.type !== "event_callback") {
		return {
			status: 403,
			body: { error: "Unsupported Slack event type for this installation" },
		};
	}

	const identityMatches = matchesExpectedIdentity(
		auth.installation,
		body.team_id,
		body.api_app_id,
		true,
	);

	// Candidate mode: setup verification & segregated enrollment only.
	if (auth.installation.status === "candidate") {
		const repository = resolveSlackSetupRepository(deps);
		const now = deps?.now ? deps.now() : new Date();
		const ttlMs = deps?.verificationTtlMs ?? SLACK_VERIFICATION_FRESHNESS_MS;

		if (!identityMatches) {
			const failedEvidence: ChatVerificationEvidence = {
				...(auth.installation.verificationEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
				lastFailureStep: "signed_event",
				lastFailureCode: "identity_mismatch",
				lastFailureAt: now.toISOString(),
			};
			await repository.updateCandidate(auth.installation.organizationId, auth.installation.id, {
				verificationState: "failed",
				verificationEvidence: failedEvidence,
			});
			if (deps?.recordAudit) {
				await deps.recordAudit({
					action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
					actorId: auth.installation.createdByUserId ?? "system",
					organizationId: auth.installation.organizationId,
					targetId: auth.installation.id,
					metadata: {
						provider: "slack",
						step: "signed_event",
						failureCode: "identity_mismatch",
					},
				});
			}
			logger.warn(
				{
					organizationId: auth.installation.organizationId,
					installationId: auth.installation.id,
				},
				"Rejected candidate Slack event with mismatched team_id or api_app_id",
			);
			return {
				status: 403,
				body: { error: "Slack app or workspace identity mismatch" },
			};
		}

		const isSegregatedEnrollmentDm =
			body.event?.type === "message" &&
			body.event?.channel_type === "im" &&
			typeof body.event?.text === "string" &&
			body.event.text.trim().toLowerCase().startsWith("enroll ");

		const previousEvidence = auth.installation.verificationEvidence;
		const nextEvidence: ChatVerificationEvidence = {
			...(previousEvidence ?? { source: "verified_setup" }),
			source: "verified_setup",
			signedEventVerifiedAt: now.toISOString(),
			signedEventRevisionId: auth.revisionId,
			signedEventType: body.event?.type ?? "event_callback",
			signedEventExpiresAt: new Date(now.getTime() + ttlMs).toISOString(),
			...(isSegregatedEnrollmentDm
				? {
						enrollmentProofCount: (previousEvidence?.enrollmentProofCount ?? 0) + 1,
						lastEnrollmentProofAt: now.toISOString(),
					}
				: {}),
			...(previousEvidence?.lastFailureStep === "signed_event"
				? { lastFailureStep: null, lastFailureCode: null, lastFailureAt: null }
				: {}),
		};

		const nextStatus = computeSlackCandidateSetupStatus(
			{
				...auth.installation,
				verificationEvidence: nextEvidence,
			},
			now,
			ttlMs,
		);

		await repository.updateCandidate(auth.installation.organizationId, auth.installation.id, {
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
					provider: "slack",
					revisionId: auth.revisionId,
					eventType: body.event?.type ?? "event_callback",
					readyForSwitch: nextStatus.readyForSwitch,
				},
			});
		}

		return {
			status: 200,
			body: {
				ok: true,
				mode: "candidate",
				verificationRecorded: true,
			},
		};
	}

	if (!identityMatches) {
		return {
			status: 403,
			body: { error: "Slack app or workspace identity mismatch" },
		};
	}

	if (auth.installation.status === "retiring") {
		return {
			status: 403,
			body: {
				error: "Retiring Slack installation does not accept new commands or events.",
			},
		};
	}

	// Active organization-owned Slack installation: route event to production handler.
	const bot = await buildResolvedSlackBotForInstallation(auth.installation, auth.secrets, deps);
	if (!bot) {
		return {
			status: 503,
			body: { error: "Active Slack bot credentials are unavailable" },
		};
	}

	const eventPayload: SlackEventCallback = {
		type: "event_callback",
		token: body.token ?? "",
		team_id: body.team_id ?? bot.slackTeamId,
		event: {
			type: body.event?.type ?? "",
			channel: body.event?.channel,
			channel_type: body.event?.channel_type,
			user: body.event?.user,
			text: body.event?.text,
			ts: body.event?.ts,
		},
	};

	const dispatchEvent = deps?.handleActiveEvent ?? handleEvent;
	await dispatchEvent(eventPayload, bot);

	return {
		status: 200,
		body: { ok: true, mode: "active" },
	};
}

/**
 * Handles `POST /api/slack/installations/[routeId]/interactions`:
 * - `candidate`: strictly rejects production interactions/approvals.
 * - `active`: routes review-card interactions through the active organization-owned installation.
 * - `retiring` (before deadline & not revoked): continues servicing eligible old-card
 *   interactions originating from this installation.
 */
export async function handleSlackCandidateInteractionRequest(
	input: SlackCandidateHttpRequestInput,
	deps?: SlackInstallationRouteDeps,
): Promise<SlackCandidateHttpResponse> {
	const auth = await authenticateInstallationByRouteId(input, deps);
	if (auth.kind === "reject") {
		return auth.response;
	}

	const params = new URLSearchParams(input.rawBody);
	const payloadStr = params.get("payload");
	if (!payloadStr) {
		return { status: 400, body: { error: "Missing payload" } };
	}

	let payload: SlackInteractionPayload & { api_app_id?: string };
	try {
		payload = JSON.parse(payloadStr);
	} catch {
		return { status: 400, body: { error: "Invalid payload JSON" } };
	}

	if (!matchesExpectedIdentity(auth.installation, payload.team?.id, payload.api_app_id, false)) {
		return {
			status: 403,
			body: { error: "Slack app or workspace identity mismatch" },
		};
	}

	if (auth.installation.status === "candidate") {
		return {
			status: 403,
			body: {
				error:
					"Candidate Slack installation cannot process production interactions or approval actions.",
			},
		};
	}

	const bot = await buildResolvedSlackBotForInstallation(auth.installation, auth.secrets, deps);
	if (!bot) {
		return {
			status: 503,
			body: { error: "Slack bot credentials are unavailable" },
		};
	}

	const dispatchInteraction = deps?.handleActiveInteraction ?? handleInteraction;
	await dispatchInteraction(payload, bot);

	return {
		status: 200,
		body: { ok: true, mode: auth.installation.status },
	};
}

/**
 * Handles `POST /api/slack/installations/[routeId]/commands`:
 * - `candidate`: strictly rejects production slash commands.
 * - `active`: routes slash commands through the active organization-owned installation.
 * - `retiring`: refuses new slash commands (returns ephemeral guidance).
 */
export async function handleSlackCandidateCommandRequest(
	input: SlackCandidateHttpRequestInput,
	deps?: SlackInstallationRouteDeps,
): Promise<SlackCandidateHttpResponse> {
	const auth = await authenticateInstallationByRouteId(input, deps);
	if (auth.kind === "reject") {
		return auth.response;
	}

	const params = new URLSearchParams(input.rawBody);
	const teamId = params.get("team_id");
	const appId = params.get("api_app_id");

	if (!matchesExpectedIdentity(auth.installation, teamId, appId, false)) {
		return {
			status: 403,
			body: { error: "Slack app or workspace identity mismatch" },
		};
	}

	if (auth.installation.status === "candidate") {
		return {
			status: 403,
			body: {
				error: "Candidate Slack installation cannot execute production slash commands.",
				response_type: "ephemeral",
				text: "This organization-owned Slack app is still in candidate verification mode and cannot execute production Z8 commands yet.",
			},
		};
	}

	if (auth.installation.status === "retiring") {
		return {
			status: 403,
			body: {
				error: "Retiring Slack installation cannot execute production slash commands.",
				response_type: "ephemeral",
				text: "This Slack app is retiring. Please use your organization's active Z8 Slack app or open Z8 directly.",
			},
		};
	}

	const bot = await buildResolvedSlackBotForInstallation(auth.installation, auth.secrets, deps);
	if (!bot) {
		return {
			status: 503,
			body: { error: "Active Slack bot credentials are unavailable" },
		};
	}

	const payload: SlackSlashCommandPayload = {
		token: params.get("token") ?? "",
		team_id: teamId ?? bot.slackTeamId,
		team_domain: params.get("team_domain") ?? undefined,
		channel_id: params.get("channel_id") ?? "",
		channel_name: params.get("channel_name") ?? undefined,
		user_id: params.get("user_id") ?? "",
		user_name: params.get("user_name") ?? undefined,
		command: params.get("command") ?? "",
		text: params.get("text") ?? "",
		response_url: params.get("response_url") ?? "",
		trigger_id: params.get("trigger_id") ?? "",
	};

	const dispatchCommand = deps?.handleActiveCommand ?? handleSlashCommand;
	const response = await dispatchCommand(payload, bot);

	return {
		status: 200,
		body: {
			response_type: "ephemeral",
			text: response.text,
		},
	};
}

export {
	handleSlackCandidateCommandRequest as handleSlackInstallationCommandRequest,
	handleSlackCandidateEventRequest as handleSlackInstallationEventRequest,
	handleSlackCandidateInteractionRequest as handleSlackInstallationInteractionRequest,
};
