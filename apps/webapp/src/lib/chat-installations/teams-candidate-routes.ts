import { type Activity, type CloudAdapter, TurnContext } from "botbuilder";
import type { db as defaultDb } from "@/db";
import type { ChatVerificationEvidence } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import { getTeamsInstallationBotAdapter } from "@/lib/teams/bot-adapter";
import { readInstallationCredentialRevision } from "./credential-revisions";
import { isValidGuid } from "./legacy-analysis";
import { redeemChatLinkProof } from "./member-links";
import {
	computeTeamsCandidateSetupStatus,
	resolveTeamsSetupRepository,
	TEAMS_VERIFICATION_FRESHNESS_MS,
	type TeamsCandidateInstallationRecord,
	type TeamsSetupRuntimeDeps,
} from "./teams-setup";

const logger = createLogger("TeamsCandidateRoutes");

export interface TeamsCandidateMessageRequestInput {
	routeId: string;
	rawBody: string;
	authorizationHeader: string;
	contentType?: string;
}

export interface TeamsCandidateHttpResponse {
	status: number;
	body: Record<string, unknown> | null;
}

interface BotClaimsLike {
	getClaimValue?: (claimType: string) => string | null | undefined;
	claims?: Array<{ type?: string; value?: string }>;
}

function readClaim(identity: BotClaimsLike | undefined, types: readonly string[]): string | null {
	if (!identity) return null;
	for (const type of types) {
		const direct = identity.getClaimValue?.(type)?.trim();
		if (direct) return direct;
		const fromList = identity.claims?.find((c) => c.type === type)?.value?.trim();
		if (fromList) return fromList;
	}
	return null;
}

function normalizeTeamsBotAppId(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	// Teams bot recipient IDs often arrive prefixed with `28:` (e.g. `28:<app-guid>`)
	const stripped = trimmed.startsWith("28:") ? trimmed.slice(3).trim() : trimmed;
	return stripped ? stripped.toLowerCase() : null;
}

function extractActivityTenantId(activity: Partial<Activity>): string | null {
	const fromConversation = activity.conversation?.tenantId?.trim();
	if (fromConversation) return fromConversation.toLowerCase();
	const channelData = activity.channelData as { tenant?: { id?: string } } | undefined;
	const fromChannelData = channelData?.tenant?.id?.trim();
	return fromChannelData ? fromChannelData.toLowerCase() : null;
}

function stripBotMention(text: string, activity: Partial<Activity>): string {
	let cleaned = text.trim();
	if (activity.entities) {
		for (const entity of activity.entities) {
			if (entity.type === "mention" && entity.mentioned?.id === activity.recipient?.id) {
				const mentionText = typeof entity.text === "string" ? entity.text : "";
				if (mentionText) {
					cleaned = cleaned.replace(mentionText, "").trim();
				}
			}
		}
	}
	return cleaned;
}

function extractCandidateLinkProofCode(text: string): string | null {
	const match = /^(?:\/?link|\/?enroll)\s+([A-Za-z0-9-\s]+)$/i.exec(text.trim());
	return match?.[1]?.trim() || null;
}

async function recordInboundVerificationFailure(
	installation: TeamsCandidateInstallationRecord,
	failureCode: "tenant_mismatch" | "app_mismatch",
	now: Date,
	deps?: TeamsSetupRuntimeDeps,
): Promise<void> {
	const repository = resolveTeamsSetupRepository(deps);
	const failedEvidence: ChatVerificationEvidence = {
		...(installation.verificationEvidence ?? { source: "verified_setup" }),
		source: "verified_setup",
		lastFailureStep: "signed_event",
		lastFailureCode: failureCode,
		lastFailureAt: now.toISOString(),
	};
	await repository.updateCandidate(installation.organizationId, installation.id, {
		verificationState: "failed",
		verificationEvidence: failedEvidence,
	});
	if (deps?.recordAudit) {
		await deps.recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: installation.createdByUserId ?? "system",
			organizationId: installation.organizationId,
			targetId: installation.id,
			metadata: {
				provider: "teams",
				step: "signed_event",
				failureCode,
			},
		});
	}
}

/**
 * Handles `GET /api/teams/installations/[routeId]/messages` health checks strictly by `routeId`.
 * Never falls back to global deployment environment variables.
 */
export async function handleTeamsCandidateHealthRequest(
	routeId: string,
	deps?: TeamsSetupRuntimeDeps,
): Promise<TeamsCandidateHttpResponse> {
	const trimmedRouteId = routeId.trim();
	if (!trimmedRouteId) {
		return { status: 404, body: { error: "Installation not found" } };
	}

	const repository = resolveTeamsSetupRepository(deps);
	const installation = await repository.findInstallationByRouteId(trimmedRouteId);
	if (!installation) {
		return { status: 404, body: { error: "Installation not found" } };
	}

	return {
		status: 200,
		body: {
			status: "ok",
			service: "Z8 Single-Tenant Teams Installation",
			mode: installation.status,
		},
	};
}

/**
 * Handles `POST /api/teams/installations/[routeId]/messages` for candidate single-tenant Teams apps.
 *
 * Security invariants:
 * - Resolves installation strictly by `routeId` (never global env vars).
 * - Requires Bot Framework JWT authentication through the installation+revision-scoped
 *   `SingleTenant` CloudAdapter; unsigned requests are rejected with `401`.
 * - Verifies authenticated `appId` AND `tenantId` match the candidate installation (`403` on mismatch).
 * - While `status === "candidate"`:
 *   - NEVER executes production commands, approval card actions, or live delivery.
 *   - Records fresh authenticated inbound verification proof and candidate-scoped personal
 *     conversation references in `chat_installation_conversation`.
 *   - Enrolls proven same-tenant Entra employees (`aadObjectId` verified in `(org, tenant)`)
 *     into the segregated candidate enrollment lane (`is_candidate_enrollment = true`).
 *   - Lets other employees redeem organization- and installation-bound link proofs
 *     (`purpose: "candidate_enrollment"`).
 *   - Never matches users by email or mutates legacy `teams_*` tables.
 */
export async function handleTeamsCandidateMessageRequest(
	input: TeamsCandidateMessageRequestInput,
	deps?: TeamsSetupRuntimeDeps,
): Promise<TeamsCandidateHttpResponse> {
	const routeId = input.routeId.trim();
	if (!routeId) {
		return { status: 404, body: { error: "Installation not found" } };
	}

	const repository = resolveTeamsSetupRepository(deps);
	const installation = await repository.findInstallationByRouteId(routeId);
	if (!installation) {
		return { status: 404, body: { error: "Installation not found" } };
	}

	if (installation.status !== "candidate") {
		return {
			status: 403,
			body: { error: "This Teams endpoint is not accepting candidate setup traffic" },
		};
	}

	if (
		!installation.activeCredentialRevisionId ||
		!isValidGuid(installation.externalAppId) ||
		!isValidGuid(installation.externalSpaceId)
	) {
		return {
			status: 401,
			body: { error: "Candidate Teams credentials are not configured" },
		};
	}

	// Explicitly refuse unsigned requests before Bot Framework processing
	const authHeader = input.authorizationHeader.trim();
	if (!authHeader || !/^Bearer\s+\S+/i.test(authHeader)) {
		logger.warn(
			{ organizationId: installation.organizationId, installationId: installation.id },
			"Rejected unsigned candidate Teams inbound request",
		);
		return {
			status: 401,
			body: { error: "Missing or invalid Bot Framework Authorization header" },
		};
	}

	let parsedBody: Partial<Activity>;
	try {
		parsedBody = JSON.parse(input.rawBody) as Partial<Activity>;
	} catch {
		return { status: 400, body: { error: "Invalid JSON body" } };
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
			"Secret store unavailable while authenticating candidate Teams activity",
		);
		return { status: 503, body: { error: "Secret store unavailable" } };
	}

	if (credentialResult.kind !== "ok" || !credentialResult.secrets.microsoft_app_password) {
		return { status: 401, body: { error: "Candidate Teams credentials are unavailable" } };
	}

	const getAdapter = deps?.getAdapter ?? getTeamsInstallationBotAdapter;
	const adapter: CloudAdapter = getAdapter({
		installationId: installation.id,
		credentialRevisionId: installation.activeCredentialRevisionId,
		appId: installation.externalAppId,
		appPassword: credentialResult.secrets.microsoft_app_password,
		tenantId: installation.externalSpaceId,
	});

	const mockReq = {
		body: parsedBody,
		headers: {
			authorization: authHeader,
			"content-type": input.contentType || "application/json",
		},
		method: "POST",
	};

	let responseStatus = 200;
	let responseBody: Record<string, unknown> | null = null;
	let overrideResponse: TeamsCandidateHttpResponse | null = null;

	const mockRes = {
		status(code: number) {
			responseStatus = code;
			return mockRes;
		},
		send(data: unknown) {
			if (typeof data === "string") {
				try {
					responseBody = JSON.parse(data) as Record<string, unknown>;
				} catch {
					responseBody = { message: data };
				}
			} else if (data && typeof data === "object") {
				responseBody = data as Record<string, unknown>;
			}
		},
		end() {},
		setHeader() {},
	};

	const now = deps?.now ? deps.now() : new Date();
	const ttlMs = deps?.verificationTtlMs ?? TEAMS_VERIFICATION_FRESHNESS_MS;
	const expectedAppId = installation.externalAppId.trim().toLowerCase();
	const expectedTenantId = installation.externalSpaceId.trim().toLowerCase();
	const activeRevisionId = installation.activeCredentialRevisionId;

	try {
		await adapter.process(mockReq as never, mockRes as never, async (turnContext: TurnContext) => {
			const activity = turnContext.activity;
			const identity = turnContext.turnState.get(adapter.BotIdentityKey) as
				| BotClaimsLike
				| undefined;

			// 1. Verify authenticated appId matches installation
			const claimAppId = normalizeTeamsBotAppId(readClaim(identity, ["appid", "azp", "aud"]));
			const recipientAppId = normalizeTeamsBotAppId(activity.recipient?.id);
			const effectiveAppId = claimAppId ?? recipientAppId;

			if (!effectiveAppId || effectiveAppId !== expectedAppId) {
				await recordInboundVerificationFailure(installation, "app_mismatch", now, deps);
				logger.warn(
					{ organizationId: installation.organizationId, installationId: installation.id },
					"Rejected candidate Teams activity with mismatched appId",
				);
				overrideResponse = {
					status: 403,
					body: { error: "Microsoft Teams application identity mismatch" },
				};
				return;
			}
			if (
				claimAppId &&
				recipientAppId &&
				isValidGuid(recipientAppId) &&
				recipientAppId !== expectedAppId
			) {
				await recordInboundVerificationFailure(installation, "app_mismatch", now, deps);
				overrideResponse = {
					status: 403,
					body: { error: "Microsoft Teams recipient application identity mismatch" },
				};
				return;
			}

			// 2. Verify authenticated tenantId matches installation
			const claimTenantId = readClaim(identity, [
				"tid",
				"http://schemas.microsoft.com/identity/claims/tenantid",
			])?.toLowerCase();
			const activityTenantId = extractActivityTenantId(activity);

			if (
				!activityTenantId ||
				activityTenantId !== expectedTenantId ||
				(claimTenantId && claimTenantId !== expectedTenantId)
			) {
				await recordInboundVerificationFailure(installation, "tenant_mismatch", now, deps);
				logger.warn(
					{ organizationId: installation.organizationId, installationId: installation.id },
					"Rejected candidate Teams activity with mismatched tenantId",
				);
				overrideResponse = {
					status: 403,
					body: { error: "Microsoft Teams tenant identity mismatch" },
				};
				return;
			}

			// 3. Strictly block production invoke / approval actions in candidate mode
			if (activity.type === "invoke") {
				await turnContext.sendActivity({
					type: "invokeResponse",
					value: {
						status: 403,
						body: {
							error:
								"Candidate Teams installation cannot process production approval or interactive actions.",
						},
					},
				});
				overrideResponse = {
					status: 403,
					body: {
						error:
							"Candidate Teams installation cannot process production approval or interactive actions.",
					},
				};
				return;
			}

			// 4. Record fresh authenticated inbound verification proof (for message, conversationUpdate, installationUpdate)
			let enrollmentProofDelta = 0;
			let replyText: string | null = null;
			const isPersonalConversation = activity.conversation?.conversationType === "personal";
			const conversationId = activity.conversation?.id?.trim() || null;
			const aadObjectId = activity.from?.aadObjectId?.trim() || null;
			const senderDisplayName = activity.from?.name?.trim() || null;

			if (isPersonalConversation && conversationId && activity.serviceUrl) {
				const conversationRef = TurnContext.getConversationReference(activity) as unknown as Record<
					string,
					unknown
				>;
				const cleanedText =
					activity.type === "message" && typeof activity.text === "string"
						? stripBotMention(activity.text, activity)
						: "";
				const linkCode = cleanedText ? extractCandidateLinkProofCode(cleanedText) : null;

				if (linkCode && aadObjectId) {
					// Organization- and installation-bound link proof redemption (segregated candidate lane)
					const redeemFn =
						deps?.redeemLinkProof ??
						((proofInput) =>
							redeemChatLinkProof(proofInput, {
								db: deps?.db as typeof defaultDb | undefined,
								now: () => now,
							}));
					const redemption = await redeemFn({
						organizationId: installation.organizationId,
						installationId: installation.id,
						purpose: "candidate_enrollment",
						code: linkCode,
						externalUserId: aadObjectId,
						externalDisplayName: senderDisplayName,
						externalConversationId: conversationId,
						conversationType: "personal",
						conversationReference: conversationRef,
					});

					if (redemption.status === "success") {
						enrollmentProofDelta = 1;
						replyText =
							"Your Teams chat is now enrolled for this candidate Z8 app. Your current live Z8 connection remains active until an admin switches.";
					} else {
						replyText =
							"Could not redeem that candidate link code. Generate a fresh code in Z8 Settings → Notifications and try again.";
					}
				} else if (aadObjectId) {
					// Check proven same-tenant Entra identity in (organizationId, tenantId) — NEVER email matching
					const provenMember = await repository.findProvenSameTenantMember({
						organizationId: installation.organizationId,
						tenantId: expectedTenantId,
						aadObjectId,
					});

					if (provenMember) {
						await repository.upsertCandidateMemberEnrollment({
							organizationId: installation.organizationId,
							installationId: installation.id,
							userId: provenMember.userId,
							employeeId: provenMember.employeeId,
							externalUserId: aadObjectId,
							externalDisplayName: senderDisplayName ?? provenMember.displayName,
							externalScope: `teams:tenant:${expectedTenantId}`,
							provenance: "verified_same_scope_reuse",
							verifiedAt: now,
						});
						await repository.upsertCandidatePersonalConversation({
							organizationId: installation.organizationId,
							installationId: installation.id,
							userId: provenMember.userId,
							employeeId: provenMember.employeeId,
							externalUserId: aadObjectId,
							externalConversationId: conversationId,
							conversationReference: conversationRef,
							reachabilityStatus: "reachable",
							verifiedAt: now,
						});
						enrollmentProofDelta = 1;
						if (activity.type === "message") {
							replyText =
								"Verified! Your proven Microsoft Entra identity is ready for this candidate Z8 Teams app. Production commands and approvals stay on your active connection until an admin switches.";
						}
					} else {
						// Record candidate personal conversation reference (userId: null) so an org admin
						// can run the synthetic proactive private test without fabricating any member link.
						await repository.upsertCandidatePersonalConversation({
							organizationId: installation.organizationId,
							installationId: installation.id,
							userId: null,
							employeeId: null,
							externalUserId: aadObjectId,
							externalConversationId: conversationId,
							conversationReference: conversationRef,
							reachabilityStatus: "reachable",
							verifiedAt: now,
						});
						if (activity.type === "message") {
							replyText =
								"Candidate Teams setup activity verified! Admins can now run the proactive private test in Z8 Settings → Chat Integrations. Employees without a prior same-tenant Entra link can enroll using a link code from Z8 Settings → Notifications (send: link <CODE>). Production commands are disabled until switch.";
						}
					}
				}
			}

			const previousEvidence = installation.verificationEvidence;
			const nextEvidence: ChatVerificationEvidence = {
				...(previousEvidence ?? { source: "verified_setup" }),
				source: "verified_setup",
				serviceUrlRecorded: Boolean(activity.serviceUrl) || previousEvidence?.serviceUrlRecorded,
				signedEventVerifiedAt: now.toISOString(),
				signedEventRevisionId: activeRevisionId,
				signedEventType: activity.type || "message",
				signedEventExpiresAt: new Date(now.getTime() + ttlMs).toISOString(),
				...(enrollmentProofDelta > 0
					? {
							enrollmentProofCount:
								(previousEvidence?.enrollmentProofCount ?? 0) + enrollmentProofDelta,
							lastEnrollmentProofAt: now.toISOString(),
						}
					: {}),
				...(previousEvidence?.lastFailureStep === "signed_event"
					? { lastFailureStep: null, lastFailureCode: null, lastFailureAt: null }
					: {}),
			};

			const nextStatus = computeTeamsCandidateSetupStatus(
				{
					...installation,
					verificationEvidence: nextEvidence,
				},
				now,
				ttlMs,
			);

			await repository.updateCandidate(installation.organizationId, installation.id, {
				verificationEvidence: nextEvidence,
				verificationState: nextStatus.effectiveVerificationState,
				lastVerifiedAt: nextStatus.readyForSwitch ? now : installation.lastVerifiedAt,
			});

			if (deps?.recordAudit) {
				await deps.recordAudit({
					action: AuditAction.CHAT_INSTALLATION_INBOUND_VERIFIED,
					actorId: installation.createdByUserId ?? "system",
					organizationId: installation.organizationId,
					targetId: installation.id,
					metadata: {
						provider: "teams",
						revisionId: activeRevisionId,
						activityType: activity.type || "message",
						readyForSwitch: nextStatus.readyForSwitch,
					},
				});
			}

			if (replyText) {
				await turnContext.sendActivity(replyText);
			}
		});
	} catch (error) {
		const statusCode =
			typeof error === "object" &&
			error !== null &&
			"statusCode" in error &&
			typeof (error as { statusCode?: unknown }).statusCode === "number"
				? (error as { statusCode: number }).statusCode
				: 401;
		logger.warn(
			{
				error,
				organizationId: installation.organizationId,
				installationId: installation.id,
				statusCode,
			},
			"Candidate Teams inbound authentication failed",
		);
		return {
			status: statusCode >= 400 && statusCode < 600 ? statusCode : 401,
			body: { error: "Teams Bot Framework authentication failed" },
		};
	}

	if (overrideResponse) {
		return overrideResponse;
	}

	return {
		status: responseStatus,
		body: responseBody ?? { ok: true, mode: "candidate", verificationRecorded: true },
	};
}
