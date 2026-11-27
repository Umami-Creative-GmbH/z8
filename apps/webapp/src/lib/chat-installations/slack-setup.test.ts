import crypto from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SecretStoreUnavailableError } from "@/lib/vault/errors";
import type {
	CredentialRevisionRecord,
	CredentialRevisionRepository,
} from "./credential-revisions";
import {
	handleSlackCandidateCommandRequest,
	handleSlackCandidateEventRequest,
	handleSlackCandidateInteractionRequest,
} from "./slack-candidate-routes";
import {
	computeSlackCandidateSetupStatus,
	configureSlackCandidateCredentials,
	generateSlackAppManifest,
	prepareSlackCandidateInstallation,
	SLACK_VERIFICATION_FRESHNESS_MS,
	type SlackCandidateInstallationRecord,
	type SlackSetupRepository,
	sendSlackCandidateTestMessage,
} from "./slack-setup";

function signSlackPayload(signingSecret: string, timestamp: string, rawBody: string): string {
	return `v0=${crypto
		.createHmac("sha256", signingSecret)
		.update(`v0:${timestamp}:${rawBody}`)
		.digest("hex")}`;
}

function createSlackSetupHarness() {
	const installations = new Map<string, SlackCandidateInstallationRecord>();
	const ownershipClaims = new Map<string, { id: string; organizationId: string }>();
	const revisions = new Map<string, CredentialRevisionRecord>();
	const secrets = new Map<string, string>();
	const conversations: Array<Record<string, unknown>> = [];
	const auditEvents: Array<Record<string, unknown>> = [];

	let seq = 1;
	let currentNow = new Date("2026-11-26T12:00:00.000Z");

	const now = () => new Date(currentNow.getTime());
	const advanceMs = (ms: number) => {
		currentNow = new Date(currentNow.getTime() + ms);
	};

	const revisionRepo: CredentialRevisionRepository = {
		getLatestRevisionNumber: vi.fn(async (orgId: string, installationId: string) => {
			let max = 0;
			for (const rev of revisions.values()) {
				if (rev.organizationId === orgId && rev.installationId === installationId) {
					max = Math.max(max, rev.revisionNumber);
				}
			}
			return max;
		}),
		insertRevision: vi.fn(async (input) => {
			const row: CredentialRevisionRecord = {
				...input,
				id: `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`,
				createdAt: now(),
			};
			revisions.set(row.id, row);
			return row;
		}),
		findRevision: vi.fn(async (orgId: string, installationId: string, revisionId: string) => {
			const row = revisions.get(revisionId);
			if (!row || row.organizationId !== orgId || row.installationId !== installationId) {
				return null;
			}
			return row;
		}),
		getActiveRevisionId: vi.fn(async (_orgId: string, installationId: string) => {
			return installations.get(installationId)?.activeCredentialRevisionId ?? null;
		}),
		updateRevisionStatus: vi.fn(async (orgId, installationId, revisionId, status) => {
			const row = revisions.get(revisionId);
			if (row && row.organizationId === orgId && row.installationId === installationId) {
				row.status = status;
			}
		}),
	};

	const repository: SlackSetupRepository = {
		findCandidateByOrg: vi.fn(async (organizationId: string) => {
			for (const inst of installations.values()) {
				if (
					inst.organizationId === organizationId &&
					inst.provider === "slack" &&
					inst.status === "candidate"
				) {
					return inst;
				}
			}
			return null;
		}),
		findCandidateById: vi.fn(async (organizationId: string, installationId: string) => {
			const inst = installations.get(installationId);
			if (
				!inst ||
				inst.organizationId !== organizationId ||
				inst.provider !== "slack" ||
				inst.status !== "candidate"
			) {
				return null;
			}
			return inst;
		}),
		findInstallationByRouteId: vi.fn(async (routeId: string) => {
			for (const inst of installations.values()) {
				if (inst.routeId === routeId && inst.provider === "slack") {
					return inst;
				}
			}
			return null;
		}),
		insertCandidate: vi.fn(async (input) => {
			const row: SlackCandidateInstallationRecord = {
				id: `10000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`,
				organizationId: input.organizationId,
				provider: "slack",
				credentialSource: "organization_owned",
				status: "candidate",
				routeId: input.routeId,
				externalAppId: null,
				externalBotId: null,
				externalBotUsername: null,
				externalDisplayName: null,
				externalSpaceId: null,
				externalSpaceName: null,
				receiverScope: null,
				spaceClaimId: null,
				botClaimId: null,
				activeCredentialRevisionId: null,
				verificationState: "unverified",
				verificationEvidence: null,
				lastVerifiedAt: null,
				endpointGeneration: 0,
				createdByUserId: input.createdByUserId,
				createdAt: now(),
				updatedAt: now(),
			};
			installations.set(row.id, row);
			return row;
		}),
		updateCandidate: vi.fn(async (organizationId, installationId, patch) => {
			const existing = installations.get(installationId);
			if (!existing || existing.organizationId !== organizationId) {
				throw new Error("Installation not found");
			}
			const updated: SlackCandidateInstallationRecord = {
				...existing,
				...patch,
				updatedAt: now(),
			};
			installations.set(installationId, updated);
			return updated;
		}),
		acquireClaim: vi.fn(async ({ organizationId, claimKind, externalId }) => {
			const key = `slack:${claimKind}:${externalId}`;
			const existing = ownershipClaims.get(key);
			if (existing) {
				if (existing.organizationId !== organizationId) {
					return { kind: "conflict" as const };
				}
				return { kind: "acquired" as const, claimId: existing.id };
			}
			const id = `20000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
			ownershipClaims.set(key, { id, organizationId });
			return { kind: "acquired" as const, claimId: id };
		}),
		upsertCandidateConversation: vi.fn(async (input) => {
			conversations.push(input);
		}),
		getRevisionNumber: vi.fn(async (_orgId, _installationId, revisionId) => {
			return revisions.get(revisionId)?.revisionNumber ?? null;
		}),
	};

	const storeSecret = vi.fn(async (orgId: string, key: string, value: string) => {
		secrets.set(`${orgId}::${key}`, value);
	});
	const readSecret = vi.fn(async (orgId: string, key: string) => {
		return secrets.get(`${orgId}::${key}`) ?? null;
	});
	const deleteSecret = vi.fn(async (orgId: string, key: string) => {
		secrets.delete(`${orgId}::${key}`);
	});

	const verifyBotMetadata = vi.fn(async () => ({
		kind: "ok" as const,
		identity: {
			appId: "A01CANDIDATE",
			teamId: "T01WORKSPACE",
			teamName: "Acme Workspace",
			botId: "B01CANDIDATE",
			botUserId: "U01BOTUSER",
			botUsername: "z8-org-bot",
		},
	}));

	const sendPrivateDm = vi.fn(async () => ({
		kind: "ok" as const,
		channelId: "D01TESTDM",
		messageTs: "1732622400.000100",
	}));

	const recordAudit = vi.fn(async (event: Record<string, unknown>) => {
		auditEvents.push(event);
	});

	return {
		installations,
		ownershipClaims,
		revisions,
		secrets,
		conversations,
		auditEvents,
		now,
		advanceMs,
		repository,
		revisionRepo,
		storeSecret,
		readSecret,
		deleteSecret,
		verifyBotMetadata,
		sendPrivateDm,
		recordAudit,
		deps: {
			repository,
			revisionRepository: revisionRepo,
			storeSecret,
			readSecret,
			deleteSecret,
			secretStoreProvider: "vault" as const,
			verifyBotMetadata,
			sendPrivateDm,
			recordAudit,
			appUrl: "https://app.z8-time.test",
			now,
		},
	};
}

describe("Slack organization-owned candidate prepare & test flow (#2041)", () => {
	let harness: ReturnType<typeof createSlackSetupHarness>;

	beforeEach(() => {
		harness = createSlackSetupHarness();
	});

	test("generates Slack app manifest with routeId-scoped callback URLs in JSON and YAML", () => {
		const result = generateSlackAppManifest({
			routeId: "route_abc123",
			appUrl: "https://app.z8-time.test/",
			organizationName: "Acme GmbH",
		});

		expect(result.urls).toEqual({
			eventsUrl: "https://app.z8-time.test/api/slack/installations/route_abc123/events",
			interactionsUrl: "https://app.z8-time.test/api/slack/installations/route_abc123/interactions",
			commandsUrl: "https://app.z8-time.test/api/slack/installations/route_abc123/commands",
		});
		expect(result.manifest.settings.event_subscriptions.request_url).toBe(result.urls.eventsUrl);
		expect(result.manifest.settings.interactivity.request_url).toBe(result.urls.interactionsUrl);
		expect(result.manifest.features.slash_commands[0]?.url).toBe(result.urls.commandsUrl);
		expect(result.manifest.oauth_config.scopes.bot).toEqual(
			expect.arrayContaining([
				"chat:write",
				"im:write",
				"im:read",
				"im:history",
				"commands",
				"users:read",
			]),
		);
		expect(JSON.parse(result.json)).toEqual(result.manifest);
		expect(result.yaml).toContain(result.urls.eventsUrl);
		expect(result.yaml).toContain(result.urls.interactionsUrl);
		expect(result.yaml).toContain(result.urls.commandsUrl);
	});

	test("allows same-org candidate staging in an already-owned workspace while blocking cross-org workspace collisions", async () => {
		// Pre-existing legacy workspace claim owned by org-1
		harness.ownershipClaims.set("slack:workspace:T01WORKSPACE", {
			id: "claim-legacy-workspace",
			organizationId: "org-1",
		});

		const preparedOrg1 = await prepareSlackCandidateInstallation(
			{ organizationId: "org-1", actorUserId: "admin-1" },
			harness.deps,
		);
		const configuredOrg1 = await configureSlackCandidateCredentials(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: preparedOrg1.installationId,
				botToken: "xoxb-1111-valid-token",
				signingSecret: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
			},
			harness.deps,
		);

		expect(configuredOrg1.kind).toBe("ok");
		if (configuredOrg1.kind !== "ok") return;
		expect(configuredOrg1.view.externalAppId).toBe("A01CANDIDATE");
		expect(configuredOrg1.view.externalSpaceId).toBe("T01WORKSPACE");
		expect(configuredOrg1.view.readyForSwitch).toBe(false);
		expect(configuredOrg1.view.steps.identity.status).toBe("passed");
		expect(configuredOrg1.view.steps.signedEvent.status).toBe("pending");
		expect(configuredOrg1.view.steps.privateTest.status).toBe("pending");
		// Never expose raw secrets in the returned view or audit logs
		expect(JSON.stringify(configuredOrg1.view)).not.toContain("xoxb-1111-valid-token");
		expect(JSON.stringify(configuredOrg1.view)).not.toContain("a1b2c3d4e5f60718293a4b5c6d7e8f90");
		expect(JSON.stringify(harness.auditEvents)).not.toContain("xoxb-1111-valid-token");
		expect(JSON.stringify(harness.auditEvents)).not.toContain("a1b2c3d4e5f60718293a4b5c6d7e8f90");

		// A second organization attempting to claim the same workspace is blocked
		const preparedOrg2 = await prepareSlackCandidateInstallation(
			{ organizationId: "org-2", actorUserId: "admin-2" },
			harness.deps,
		);
		const collision = await configureSlackCandidateCredentials(
			{
				organizationId: "org-2",
				actorUserId: "admin-2",
				installationId: preparedOrg2.installationId,
				botToken: "xoxb-2222-other-app",
				signingSecret: "b2c3d4e5f60718293a4b5c6d7e8f9011",
			},
			harness.deps,
		);

		expect(collision).toMatchObject({
			kind: "error",
			code: "workspace_claimed_by_other_org",
		});
	});

	test("rejects mismatched Slack bot metadata and leaves credentials unwritten", async () => {
		harness.verifyBotMetadata.mockResolvedValueOnce({
			kind: "identity_mismatch",
			reason: "bot_user_id_mismatch",
		});

		const prepared = await prepareSlackCandidateInstallation(
			{ organizationId: "org-1", actorUserId: "admin-1" },
			harness.deps,
		);
		const result = await configureSlackCandidateCredentials(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: "xoxb-bad-meta",
				signingSecret: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
			},
			harness.deps,
		);

		expect(result).toMatchObject({ kind: "error", code: "identity_mismatch" });
		expect(harness.storeSecret).not.toHaveBeenCalled();
	});

	test("handles failed credential write without damaging legacy secrets or prior candidate revision", async () => {
		harness.secrets.set("org-1::slack/bot_access_token", "xoxb-legacy-still-active");
		const prepared = await prepareSlackCandidateInstallation(
			{ organizationId: "org-1", actorUserId: "admin-1" },
			harness.deps,
		);

		harness.storeSecret.mockRejectedValueOnce(
			new SecretStoreUnavailableError("Vault sealed", { provider: "vault", operation: "write" }),
		);

		const failed = await configureSlackCandidateCredentials(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: "xoxb-new-candidate",
				signingSecret: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
			},
			harness.deps,
		);

		expect(failed).toMatchObject({ kind: "error", code: "secret_store_unavailable" });
		expect(harness.secrets.get("org-1::slack/bot_access_token")).toBe("xoxb-legacy-still-active");
	});

	test("authenticates candidate routes strictly by routeId, blocks production commands/approvals, and marks ready only after fresh signed event + private test", async () => {
		const signingSecret = "c3d4e5f60718293a4b5c6d7e8f901234";
		const prepared = await prepareSlackCandidateInstallation(
			{ organizationId: "org-1", actorUserId: "admin-1" },
			harness.deps,
		);
		const configured = await configureSlackCandidateCredentials(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: "xoxb-candidate-live",
				signingSecret,
			},
			harness.deps,
		);
		expect(configured.kind).toBe("ok");

		const ts = String(Math.floor(Date.now() / 1000));

		// 1. url_verification echoes challenge but does NOT satisfy app+workspace event proof
		const challengeBody = JSON.stringify({
			type: "url_verification",
			challenge: "challenge_xyz",
		});
		const challengeRes = await handleSlackCandidateEventRequest(
			{
				routeId: prepared.routeId,
				rawBody: challengeBody,
				timestamp: ts,
				signature: signSlackPayload(signingSecret, ts, challengeBody),
			},
			harness.deps,
		);
		expect(challengeRes).toEqual({ status: 200, body: { challenge: "challenge_xyz" } });
		expect(
			harness.installations.get(prepared.installationId)?.verificationEvidence
				?.signedEventVerifiedAt,
		).toBeFalsy();

		// 2. Signed event_callback with mismatched team_id or api_app_id is rejected (403)
		const mismatchBody = JSON.stringify({
			type: "event_callback",
			team_id: "T99WRONGTEAM",
			api_app_id: "A01CANDIDATE",
			event: { type: "app_mention", user: "UADMIN1234", channel: "C123" },
		});
		const mismatchRes = await handleSlackCandidateEventRequest(
			{
				routeId: prepared.routeId,
				rawBody: mismatchBody,
				timestamp: ts,
				signature: signSlackPayload(signingSecret, ts, mismatchBody),
			},
			harness.deps,
		);
		expect(mismatchRes.status).toBe(403);

		// 3. Candidate /commands and /interactions strictly reject production commands and approvals
		const cmdBody = new URLSearchParams({
			team_id: "T01WORKSPACE",
			api_app_id: "A01CANDIDATE",
			command: "/z8",
			text: "clockin",
			user_id: "UADMIN1234",
		}).toString();
		const cmdRes = await handleSlackCandidateCommandRequest(
			{
				routeId: prepared.routeId,
				rawBody: cmdBody,
				timestamp: ts,
				signature: signSlackPayload(signingSecret, ts, cmdBody),
			},
			harness.deps,
		);
		expect(cmdRes.status).toBe(403);

		const interactionBody = new URLSearchParams({
			payload: JSON.stringify({
				type: "block_actions",
				team: { id: "T01WORKSPACE" },
				api_app_id: "A01CANDIDATE",
				user: { id: "UADMIN1234" },
				actions: [{ action_id: "approval_approve", value: "req-1", type: "button" }],
			}),
		}).toString();
		const interactionRes = await handleSlackCandidateInteractionRequest(
			{
				routeId: prepared.routeId,
				rawBody: interactionBody,
				timestamp: ts,
				signature: signSlackPayload(signingSecret, ts, interactionBody),
			},
			harness.deps,
		);
		expect(interactionRes.status).toBe(403);

		// 4. Signed event_callback with matching team_id & api_app_id records fresh inbound proof
		const validEventBody = JSON.stringify({
			type: "event_callback",
			team_id: "T01WORKSPACE",
			api_app_id: "A01CANDIDATE",
			event: { type: "app_mention", user: "UADMIN1234", channel: "C123" },
		});
		const validEventRes = await handleSlackCandidateEventRequest(
			{
				routeId: prepared.routeId,
				rawBody: validEventBody,
				timestamp: ts,
				signature: signSlackPayload(signingSecret, ts, validEventBody),
			},
			harness.deps,
		);
		expect(validEventRes.status).toBe(200);

		// Not ready yet until synthetic private test succeeds
		const instAfterEvent = harness.installations.get(prepared.installationId)!;
		expect(computeSlackCandidateSetupStatus(instAfterEvent, harness.now()).readyForSwitch).toBe(
			false,
		);

		// 5. Synthetic private DM test marks candidate ready and records segregated candidate conversation
		const testResult = await sendSlackCandidateTestMessage(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				slackUserId: "UADMIN1234",
			},
			harness.deps,
		);
		expect(testResult.kind).toBe("ok");
		if (testResult.kind !== "ok") return;
		expect(testResult.view.readyForSwitch).toBe(true);
		expect(testResult.view.verificationState).toBe("verified");
		expect(harness.conversations).toHaveLength(1);
		expect(harness.conversations[0]).toMatchObject({
			organizationId: "org-1",
			installationId: prepared.installationId,
			externalUserId: "UADMIN1234",
			externalConversationId: "D01TESTDM",
			reachabilityStatus: "reachable",
		});

		// 6. Stale/expired proof flips readyForSwitch back to false and flags expired step
		harness.advanceMs(SLACK_VERIFICATION_FRESHNESS_MS + 60_000);
		const expiredStatus = computeSlackCandidateSetupStatus(
			harness.installations.get(prepared.installationId)!,
			harness.now(),
		);
		expect(expiredStatus.readyForSwitch).toBe(false);
		expect(expiredStatus.effectiveVerificationState).toBe("expired");
		expect(expiredStatus.steps.signedEvent.status).toBe("expired");
		expect(expiredStatus.steps.privateTest.status).toBe("expired");
	});

	test("returns 503 on secret-store outage during candidate inbound verification (distinct from 401)", async () => {
		const prepared = await prepareSlackCandidateInstallation(
			{ organizationId: "org-1", actorUserId: "admin-1" },
			harness.deps,
		);
		await configureSlackCandidateCredentials(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: "xoxb-candidate-live",
				signingSecret: "c3d4e5f60718293a4b5c6d7e8f901234",
			},
			harness.deps,
		);

		harness.readSecret.mockRejectedValueOnce(
			new SecretStoreUnavailableError("Scaleway KMS outage", {
				provider: "scaleway",
				operation: "read",
			}),
		);

		const res = await handleSlackCandidateEventRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({ type: "url_verification", challenge: "abc" }),
				timestamp: String(Math.floor(Date.now() / 1000)),
				signature: "v0=anything",
			},
			harness.deps,
		);
		expect(res.status).toBe(503);
	});
});
