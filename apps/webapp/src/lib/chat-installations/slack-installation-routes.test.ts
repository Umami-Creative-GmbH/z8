import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
	CredentialRevisionRecord,
	CredentialRevisionRepository,
} from "./credential-revisions";
import {
	handleSlackInstallationCommandRequest,
	handleSlackInstallationEventRequest,
	handleSlackInstallationInteractionRequest,
	type SlackInstallationRouteDeps,
} from "./slack-candidate-routes";
import type { SlackCandidateInstallationRecord, SlackSetupRepository } from "./slack-setup";

function signSlackRequest(signingSecret: string, timestamp: string, rawBody: string): string {
	const digest = createHmac("sha256", signingSecret)
		.update(`v0:${timestamp}:${rawBody}`)
		.digest("hex");
	return `v0=${digest}`;
}

function makeInstallation(
	overrides: Partial<SlackCandidateInstallationRecord>,
): SlackCandidateInstallationRecord {
	const now = new Date("2026-11-26T12:00:00.000Z");
	return {
		id: "inst-1",
		organizationId: "org-1",
		provider: "slack",
		credentialSource: "organization_owned",
		status: "active",
		routeId: "route-active-1",
		externalAppId: "A_ORG_APP",
		externalBotId: "U_ORG_BOT",
		externalBotUsername: "z8-org",
		externalDisplayName: "Z8 Org Slack",
		externalSpaceId: "T_ORG_SPACE",
		externalSpaceName: "Acme",
		receiverScope: "slack-team:T_ORG_SPACE",
		spaceClaimId: "claim-space",
		botClaimId: "claim-bot",
		activeCredentialRevisionId: "rev-1",
		verificationState: "verified",
		verificationEvidence: { source: "verified_setup" },
		lastVerifiedAt: now,
		retirementDeadlineAt: null,
		retiredAt: null,
		revokedAt: null,
		endpointGeneration: 0,
		createdByUserId: "user-admin",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function createDeps(
	installation: SlackCandidateInstallationRecord,
	overrides?: Partial<SlackInstallationRouteDeps>,
): SlackInstallationRouteDeps {
	const signingSecret = "test_signing_secret_0123456789abcdef";
	const botToken = "fixture-active-installation-token";
	const revision: CredentialRevisionRecord = {
		id: installation.activeCredentialRevisionId ?? "rev-1",
		installationId: installation.id,
		organizationId: installation.organizationId,
		revisionNumber: 1,
		secretStoreProvider: "vault",
		secretKeyPrefix: `chat/slack/${installation.id}/rev-1`,
		secretKeys: ["bot_access_token", "signing_secret"],
		status: "active",
		externalIdentityFingerprint: null,
		verifiedAt: new Date("2026-11-26T12:00:00.000Z"),
		revokedAt: null,
		createdByUserId: "user-admin",
		createdAt: new Date("2026-11-26T12:00:00.000Z"),
	};

	const repository: SlackSetupRepository = {
		findCandidateByOrg: vi.fn(async () => null),
		findCandidateById: vi.fn(async () => null),
		findInstallationByRouteId: vi.fn(async (routeId) =>
			routeId === installation.routeId ? installation : null,
		),
		insertCandidate: vi.fn(),
		updateCandidate: vi.fn(async () => installation),
		acquireClaim: vi.fn(),
		upsertCandidateConversation: vi.fn(),
		getRevisionNumber: vi.fn(async () => 1),
	};

	const revisionRepository: CredentialRevisionRepository = {
		getNextRevisionNumber: vi.fn(async () => 2),
		insertRevision: vi.fn(),
		findRevision: vi.fn(async () => revision),
		isRevisionReferenced: vi.fn(async () => true),
		markRevisionStatus: vi.fn(),
	};

	return {
		repository,
		revisionRepository,
		readSecret: vi.fn(async (_orgId, key) => {
			if (key.endsWith("/signing_secret")) return signingSecret;
			if (key.endsWith("/bot_access_token")) return botToken;
			return null;
		}),
		loadEffectiveSettings: vi.fn(async () => ({
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: true,
			digestTime: "08:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		})),
		now: () => new Date("2026-11-26T12:00:00.000Z"),
		...overrides,
	};
}

describe("Slack installation-scoped route lifecycle routing (#2045)", () => {
	const signingSecret = "test_signing_secret_0123456789abcdef";
	const timestamp = String(Math.floor(Date.now() / 1000));

	it("routes signed events, commands, and interactions for an active installation with installationId attached", async () => {
		const activeInst = makeInstallation({ status: "active" });
		const handleActiveEvent = vi.fn(async () => {});
		const handleActiveCommand = vi.fn(async () => ({ text: "Clocked in via org-owned app!" }));
		const handleActiveInteraction = vi.fn(async () => {});
		const deps = createDeps(activeInst, {
			handleActiveEvent,
			handleActiveCommand,
			handleActiveInteraction,
		});

		const eventBody = JSON.stringify({
			type: "event_callback",
			team_id: "T_ORG_SPACE",
			api_app_id: "A_ORG_APP",
			event: { type: "message", channel_type: "im", channel: "D123", user: "U1", text: "hi" },
		});
		const eventRes = await handleSlackInstallationEventRequest(
			{
				routeId: activeInst.routeId,
				rawBody: eventBody,
				timestamp,
				signature: signSlackRequest(signingSecret, timestamp, eventBody),
			},
			deps,
		);
		expect(eventRes).toEqual({ status: 200, body: { ok: true, mode: "active" } });
		expect(handleActiveEvent).toHaveBeenCalledWith(
			expect.objectContaining({ team_id: "T_ORG_SPACE" }),
			expect.objectContaining({
				organizationId: "org-1",
				installationId: "inst-1",
				botAccessToken: "fixture-active-installation-token",
			}),
		);

		const cmdBody = new URLSearchParams({
			team_id: "T_ORG_SPACE",
			api_app_id: "A_ORG_APP",
			channel_id: "D123",
			user_id: "U1",
			command: "/z8",
			text: "status",
		}).toString();
		const cmdRes = await handleSlackInstallationCommandRequest(
			{
				routeId: activeInst.routeId,
				rawBody: cmdBody,
				timestamp,
				signature: signSlackRequest(signingSecret, timestamp, cmdBody),
			},
			deps,
		);
		expect(cmdRes).toEqual({
			status: 200,
			body: { response_type: "ephemeral", text: "Clocked in via org-owned app!" },
		});
		expect(handleActiveCommand).toHaveBeenCalledTimes(1);

		const interactionBody = new URLSearchParams({
			payload: JSON.stringify({
				type: "block_actions",
				api_app_id: "A_ORG_APP",
				team: { id: "T_ORG_SPACE" },
				user: { id: "U1" },
				actions: [{ action_id: "approval_approve", value: "apr-1", type: "button" }],
			}),
		}).toString();
		const intRes = await handleSlackInstallationInteractionRequest(
			{
				routeId: activeInst.routeId,
				rawBody: interactionBody,
				timestamp,
				signature: signSlackRequest(signingSecret, timestamp, interactionBody),
			},
			deps,
		);
		expect(intRes).toEqual({ status: 200, body: { ok: true, mode: "active" } });
		expect(handleActiveInteraction).toHaveBeenCalledTimes(1);
	});

	it("rejects mismatched team_id or api_app_id on active installations", async () => {
		const activeInst = makeInstallation({ status: "active" });
		const handleActiveCommand = vi.fn(async () => ({ text: "nope" }));
		const deps = createDeps(activeInst, { handleActiveCommand });

		const wrongAppCmd = new URLSearchParams({
			team_id: "T_ORG_SPACE",
			api_app_id: "A_WRONG_APP",
			command: "/z8",
			text: "status",
		}).toString();
		const res = await handleSlackInstallationCommandRequest(
			{
				routeId: activeInst.routeId,
				rawBody: wrongAppCmd,
				timestamp,
				signature: signSlackRequest(signingSecret, timestamp, wrongAppCmd),
			},
			deps,
		);
		expect(res.status).toBe(403);
		expect(handleActiveCommand).not.toHaveBeenCalled();
	});

	it("keeps candidate installations strictly limited to verification and refuses production commands/interactions", async () => {
		const candidateInst = makeInstallation({ status: "candidate" });
		const handleActiveCommand = vi.fn();
		const handleActiveInteraction = vi.fn();
		const deps = createDeps(candidateInst, { handleActiveCommand, handleActiveInteraction });

		const cmdBody = new URLSearchParams({
			team_id: "T_ORG_SPACE",
			api_app_id: "A_ORG_APP",
			command: "/z8",
			text: "status",
		}).toString();
		const cmdRes = await handleSlackInstallationCommandRequest(
			{
				routeId: candidateInst.routeId,
				rawBody: cmdBody,
				timestamp,
				signature: signSlackRequest(signingSecret, timestamp, cmdBody),
			},
			deps,
		);
		expect(cmdRes.status).toBe(403);
		expect(handleActiveCommand).not.toHaveBeenCalled();

		const interactionBody = new URLSearchParams({
			payload: JSON.stringify({
				type: "block_actions",
				api_app_id: "A_ORG_APP",
				team: { id: "T_ORG_SPACE" },
				user: { id: "U1" },
			}),
		}).toString();
		const intRes = await handleSlackInstallationInteractionRequest(
			{
				routeId: candidateInst.routeId,
				rawBody: interactionBody,
				timestamp,
				signature: signSlackRequest(signingSecret, timestamp, interactionBody),
			},
			deps,
		);
		expect(intRes.status).toBe(403);
		expect(handleActiveInteraction).not.toHaveBeenCalled();
	});

	it("allows retiring installations before deadline to service old-card interactions while refusing new commands and events", async () => {
		const retiringInst = makeInstallation({
			status: "retiring",
			retirementDeadlineAt: new Date("2026-12-26T12:00:00.000Z"),
		});
		const handleActiveEvent = vi.fn();
		const handleActiveCommand = vi.fn();
		const handleActiveInteraction = vi.fn(async () => {});
		const deps = createDeps(retiringInst, {
			handleActiveEvent,
			handleActiveCommand,
			handleActiveInteraction,
			now: () => new Date("2026-12-01T12:00:00.000Z"),
		});

		const interactionBody = new URLSearchParams({
			payload: JSON.stringify({
				type: "block_actions",
				api_app_id: "A_ORG_APP",
				team: { id: "T_ORG_SPACE" },
				user: { id: "U1" },
				actions: [{ action_id: "approval_approve", value: "apr-old", type: "button" }],
			}),
		}).toString();
		const intRes = await handleSlackInstallationInteractionRequest(
			{
				routeId: retiringInst.routeId,
				rawBody: interactionBody,
				timestamp,
				signature: signSlackRequest(signingSecret, timestamp, interactionBody),
			},
			deps,
		);
		expect(intRes).toEqual({ status: 200, body: { ok: true, mode: "retiring" } });
		expect(handleActiveInteraction).toHaveBeenCalledTimes(1);

		const cmdBody = new URLSearchParams({
			team_id: "T_ORG_SPACE",
			api_app_id: "A_ORG_APP",
			command: "/z8",
			text: "status",
		}).toString();
		const cmdRes = await handleSlackInstallationCommandRequest(
			{
				routeId: retiringInst.routeId,
				rawBody: cmdBody,
				timestamp,
				signature: signSlackRequest(signingSecret, timestamp, cmdBody),
			},
			deps,
		);
		expect(cmdRes.status).toBe(403);
		expect(handleActiveCommand).not.toHaveBeenCalled();

		const eventBody = JSON.stringify({
			type: "event_callback",
			team_id: "T_ORG_SPACE",
			api_app_id: "A_ORG_APP",
			event: { type: "message", channel_type: "im", user: "U1", text: "hi" },
		});
		const eventRes = await handleSlackInstallationEventRequest(
			{
				routeId: retiringInst.routeId,
				rawBody: eventBody,
				timestamp,
				signature: signSlackRequest(signingSecret, timestamp, eventBody),
			},
			deps,
		);
		expect(eventRes.status).toBe(403);
		expect(handleActiveEvent).not.toHaveBeenCalled();
	});

	it("rejects interactions on a retiring installation once the 30-day retirement deadline is reached", async () => {
		const expiredRetiring = makeInstallation({
			status: "retiring",
			retirementDeadlineAt: new Date("2026-12-26T12:00:00.000Z"),
		});
		const handleActiveInteraction = vi.fn();
		const deps = createDeps(expiredRetiring, {
			handleActiveInteraction,
			now: () => new Date("2026-12-26T12:00:00.000Z"),
		});

		const interactionBody = new URLSearchParams({
			payload: JSON.stringify({
				type: "block_actions",
				api_app_id: "A_ORG_APP",
				team: { id: "T_ORG_SPACE" },
				user: { id: "U1" },
			}),
		}).toString();
		const intRes = await handleSlackInstallationInteractionRequest(
			{
				routeId: expiredRetiring.routeId,
				rawBody: interactionBody,
				timestamp,
				signature: signSlackRequest(signingSecret, timestamp, interactionBody),
			},
			deps,
		);
		expect(intRes.status).toBe(403);
		expect(handleActiveInteraction).not.toHaveBeenCalled();
	});
});
