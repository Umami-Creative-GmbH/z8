import type { ChatVerificationEvidence } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import { verifySlackSignature } from "@/lib/slack/signature";
import { readInstallationCredentialRevision } from "./credential-revisions";
import {
	computeSlackCandidateSetupStatus,
	resolveSlackSetupRepository,
	SLACK_VERIFICATION_FRESHNESS_MS,
	type SlackCandidateInstallationRecord,
	type SlackSetupRuntimeDeps,
} from "./slack-setup";

const logger = createLogger("SlackCandidateRoutes");

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

type AuthenticatedCandidateResult =
	| {
			kind: "ok";
			installation: SlackCandidateInstallationRecord;
			revisionId: string;
	  }
	| {
			kind: "reject";
			response: SlackCandidateHttpResponse;
	  };

/**
 * Selects the Slack verifier strictly by the installation's non-secret `routeId`
 * (never global `env.SLACK_SIGNING_SECRET`), reads the candidate's revisioned signing secret,
 * and verifies the Slack HMAC-SHA256 signature.
 */
async function authenticateCandidateByRouteId(
	input: SlackCandidateHttpRequestInput,
	deps?: SlackSetupRuntimeDeps,
): Promise<AuthenticatedCandidateResult> {
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

	if (installation.status !== "candidate") {
		return {
			kind: "reject",
			response: {
				status: 403,
				body: { error: "This Slack endpoint is not accepting candidate setup requests" },
			},
		};
	}

	if (!installation.activeCredentialRevisionId) {
		return {
			kind: "reject",
			response: {
				status: 401,
				body: { error: "Candidate Slack credentials are not configured" },
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
			"Secret store unavailable while verifying candidate Slack signature",
		);
		return {
			kind: "reject",
			response: { status: 503, body: { error: "Secret store unavailable" } },
		};
	}

	if (credentialResult.kind !== "ok" || !credentialResult.secrets.signing_secret) {
		return {
			kind: "reject",
			response: { status: 401, body: { error: "Candidate credentials are unavailable" } },
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
			"Rejected candidate Slack callback with invalid signature",
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

/**
 * Handles `POST /api/slack/installations/[routeId]/events` for candidate Slack installations.
 *
 * Scoped strictly to:
 * - Signed `url_verification` challenge (so Slack accepts the Request URL)
 * - Signed `event_callback` matching both `team_id` and `api_app_id`, recording fresh
 *   app-and-workspace inbound verification proof (and optional segregated enrollment proof)
 *
 * Never runs production commands, approval handlers, or legacy `slack_*` mutations.
 */
export async function handleSlackCandidateEventRequest(
	input: SlackCandidateHttpRequestInput,
	deps?: SlackSetupRuntimeDeps,
): Promise<SlackCandidateHttpResponse> {
	const auth = await authenticateCandidateByRouteId(input, deps);
	if (auth.kind === "reject") {
		return auth.response;
	}

	let body: {
		type?: string;
		challenge?: string;
		team_id?: string;
		api_app_id?: string;
		event?: {
			type?: string;
			channel_type?: string;
			user?: string;
			text?: string;
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

	const repository = resolveSlackSetupRepository(deps);
	const now = deps?.now ? deps.now() : new Date();
	const ttlMs = deps?.verificationTtlMs ?? SLACK_VERIFICATION_FRESHNESS_MS;

	if (body.type === "event_callback") {
		if (!matchesExpectedIdentity(auth.installation, body.team_id, body.api_app_id, true)) {
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

	return {
		status: 403,
		body: { error: "Unsupported Slack event type for candidate installation" },
	};
}

/**
 * Handles `POST /api/slack/installations/[routeId]/interactions` for candidate Slack installations.
 * Authenticates the signature and identity, then strictly rejects production interactions/approvals.
 */
export async function handleSlackCandidateInteractionRequest(
	input: SlackCandidateHttpRequestInput,
	deps?: SlackSetupRuntimeDeps,
): Promise<SlackCandidateHttpResponse> {
	const auth = await authenticateCandidateByRouteId(input, deps);
	if (auth.kind === "reject") {
		return auth.response;
	}

	const params = new URLSearchParams(input.rawBody);
	const payloadStr = params.get("payload");
	if (!payloadStr) {
		return { status: 400, body: { error: "Missing payload" } };
	}

	let payload: { team?: { id?: string }; api_app_id?: string };
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

	return {
		status: 403,
		body: {
			error:
				"Candidate Slack installation cannot process production interactions or approval actions.",
		},
	};
}

/**
 * Handles `POST /api/slack/installations/[routeId]/commands` for candidate Slack installations.
 * Authenticates the signature and identity, then strictly rejects production slash commands.
 */
export async function handleSlackCandidateCommandRequest(
	input: SlackCandidateHttpRequestInput,
	deps?: SlackSetupRuntimeDeps,
): Promise<SlackCandidateHttpResponse> {
	const auth = await authenticateCandidateByRouteId(input, deps);
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

	return {
		status: 403,
		body: {
			error: "Candidate Slack installation cannot execute production slash commands.",
			response_type: "ephemeral",
			text: "This organization-owned Slack app is still in candidate verification mode and cannot execute production Z8 commands yet.",
		},
	};
}
