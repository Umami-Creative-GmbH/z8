import { beforeEach, describe, expect, it, vi } from "vitest";
import { SecretStoreUnavailableError } from "@/lib/vault/errors";
import type {
	CredentialRevisionRecord,
	CredentialRevisionRepository,
} from "./credential-revisions";
import {
	handleTelegramInstallationWebhookRequest,
	type TelegramInstallationRouteDeps,
} from "./telegram-installation-routes";
import type {
	TelegramCandidateInstallationRecord,
	TelegramSetupRepository,
} from "./telegram-setup";

function createRouteHarness(overrides?: Partial<TelegramCandidateInstallationRecord>) {
	const now = new Date("2026-11-26T12:00:00.000Z");
	const revId = "22222222-2222-4000-8000-000000000001";
	const instId = "11111111-1111-4000-8000-000000000001";

	let installation: TelegramCandidateInstallationRecord = {
		id: instId,
		organizationId: "org-1",
		provider: "telegram",
		credentialSource: "organization_owned",
		status: "candidate",
		routeId: "tg-route-abc123",
		externalAppId: null,
		externalBotId: "777001",
		externalBotUsername: "z8_new_bot",
		externalDisplayName: "Z8 New Bot",
		externalSpaceId: null,
		externalSpaceName: null,
		receiverScope: "telegram-bot:777001",
		spaceClaimId: null,
		botClaimId: null,
		activeCredentialRevisionId: revId,
		verificationState: "pending",
		verificationEvidence: {
			source: "verified_setup",
			identityVerifiedAt: "2026-11-26T11:00:00.000Z",
			identityRevisionId: revId,
			webhookRegistered: true,
			webhookRegisteredAt: "2026-11-26T11:00:01.000Z",
			webhookRegisteredRevisionId: revId,
			commandsRegisteredAt: "2026-11-26T11:00:02.000Z",
			commandsRevisionId: revId,
			commandsRegistrationStatus: "passed",
		},
		lastVerifiedAt: null,
		retirementDeadlineAt: null,
		retiredAt: null,
		revokedAt: null,
		endpointGeneration: 1,
		endpointState: "synced",
		createdByUserId: "admin-1",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};

	const revision: CredentialRevisionRecord = {
		id: revId,
		installationId: instId,
		organizationId: "org-1",
		revisionNumber: 1,
		secretStoreProvider: "vault",
		secretKeyPrefix: `chat/telegram/installations/${instId}/revisions/v1`,
		secretKeys: ["bot_token", "webhook_secret"],
		status: "verified",
		externalIdentityFingerprint: "telegram:777001",
		verifiedAt: now,
		revokedAt: null,
		createdByUserId: "admin-1",
		createdAt: now,
	};

	const secrets = new Map<string, string>([
		[`org-1:${revision.secretKeyPrefix}/bot_token`, "777001:AAFakeCandidateBotToken123456789"],
		[`org-1:${revision.secretKeyPrefix}/webhook_secret`, "super-secret-webhook-token-123456"],
	]);

	const repository: TelegramSetupRepository = {
		async findCandidateByOrg() {
			return installation.status === "candidate" ? installation : null;
		},
		async findCandidateById(_orgId, id) {
			return installation.id === id && installation.status === "candidate" ? installation : null;
		},
		async findInstallationById(_orgId, id) {
			return installation.id === id ? installation : null;
		},
		async findInstallationByRouteId(routeId) {
			return installation.routeId === routeId ? installation : null;
		},
		async insertCandidate() {
			return installation;
		},
		async updateInstallation(_orgId, _id, patch) {
			installation = { ...installation, ...patch };
			return installation;
		},
		async acquireBotClaim() {
			return { kind: "acquired", claimId: "claim-1" };
		},
		async withEndpointLock(_key, fn) {
			return fn();
		},
		async findCandidateConversationForUser() {
			return null;
		},
		async upsertCandidateConversation() {},
		async getRevisionNumber() {
			return 1;
		},
	};

	const revisionRepository: CredentialRevisionRepository = {
		async getLatestRevisionNumber() {
			return 1;
		},
		async insertRevision() {
			return revision;
		},
		async findRevision(_orgId, _instId, id) {
			return id === revId ? revision : null;
		},
		async getActiveRevisionId() {
			return revId;
		},
		async updateRevisionStatus() {},
	};

	return {
		now,
		getInstallation: () => installation,
		secrets,
		repository,
		revisionRepository,
		readSecret: async (orgId: string, key: string) => secrets.get(`${orgId}:${key}`) ?? null,
	};
}

describe("telegram-installation-routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 404 for unknown routeId, 401 for bad secret header, and 503 on secret-store outage", async () => {
		const h = createRouteHarness();

		const notFound = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "unknown-route",
				secretTokenHeader: "super-secret-webhook-token-123456",
				rawBody: JSON.stringify({ update_id: 1 }),
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				readSecret: h.readSecret,
			},
		);
		expect(notFound.status).toBe(404);

		const badSecret = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "tg-route-abc123",
				secretTokenHeader: "wrong-secret",
				rawBody: JSON.stringify({ update_id: 1 }),
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				readSecret: h.readSecret,
			},
		);
		expect(badSecret.status).toBe(401);

		const storeOutage = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "tg-route-abc123",
				secretTokenHeader: "super-secret-webhook-token-123456",
				rawBody: JSON.stringify({ update_id: 1 }),
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				readSecret: async () => {
					throw new SecretStoreUnavailableError("vault", "Vault sealed");
				},
			},
		);
		expect(storeOutage.status).toBe(503);
	});

	it("records authenticated webhook receipt in candidate mode, redeems candidate_enrollment only, and blocks production commands/approvals", async () => {
		const h = createRouteHarness({ status: "candidate" });
		const sendMessageMock = vi.fn(async () => ({
			kind: "ok" as const,
			result: { message_id: 1, date: 1, chat: { id: 4201, type: "private" as const } },
		}));
		const handleActiveUpdateMock = vi.fn();
		const redeemCandidateProofMock = vi.fn(async () => ({
			status: "success" as const,
			userId: "user-1",
			employeeId: "emp-1",
			linkId: "link-1",
			installationId: h.getInstallation().id,
			isCandidateEnrollment: true,
		}));
		const answerCallbackMock = vi.fn(async () => true);

		const deps: TelegramInstallationRouteDeps = {
			repository: h.repository,
			revisionRepository: h.revisionRepository,
			readSecret: h.readSecret,
			sendMessage: sendMessageMock,
			answerCallbackQuery: answerCallbackMock,
			handleActiveUpdate: handleActiveUpdateMock,
			redeemCandidateLinkProof: redeemCandidateProofMock,
			recordAudit: vi.fn(async () => undefined),
			now: () => h.now,
		};

		// 1. Authenticated /start records webhook receipt proof
		const startRes = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "tg-route-abc123",
				secretTokenHeader: "super-secret-webhook-token-123456",
				rawBody: JSON.stringify({
					update_id: 100,
					message: {
						message_id: 10,
						date: 1700000000,
						chat: { id: 4201, type: "private" },
						from: { id: 4201, is_bot: false, first_name: "Alice" },
						text: "/start",
					},
				}),
			},
			deps,
		);
		expect(startRes.status).toBe(200);
		expect(startRes.body).toEqual(
			expect.objectContaining({ ok: true, mode: "candidate", verificationRecorded: true }),
		);
		expect(h.getInstallation().verificationEvidence?.signedEventVerifiedAt).toBe(
			h.now.toISOString(),
		);
		expect(handleActiveUpdateMock).not.toHaveBeenCalled();

		// 2. /link CODE redeems STRICTLY with purpose: "candidate_enrollment"
		const linkRes = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "tg-route-abc123",
				secretTokenHeader: "super-secret-webhook-token-123456",
				rawBody: JSON.stringify({
					update_id: 101,
					message: {
						message_id: 11,
						date: 1700000001,
						chat: { id: 4201, type: "private" },
						from: { id: 4201, is_bot: false, first_name: "Alice", username: "alice_tg" },
						text: "/link ABCD-EFGH-JKLM",
					},
				}),
			},
			deps,
		);
		expect(linkRes.status).toBe(200);
		expect(redeemCandidateProofMock).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				installationId: h.getInstallation().id,
				purpose: "candidate_enrollment",
				code: "ABCD-EFGH-JKLM",
				externalUserId: "4201",
				externalConversationId: "4201",
			}),
		);

		// 3. Production command (/clockin) is blocked in candidate mode
		const cmdRes = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "tg-route-abc123",
				secretTokenHeader: "super-secret-webhook-token-123456",
				rawBody: JSON.stringify({
					update_id: 102,
					message: {
						message_id: 12,
						date: 1700000002,
						chat: { id: 4201, type: "private" },
						from: { id: 4201, is_bot: false, first_name: "Alice" },
						text: "/clockin",
					},
				}),
			},
			deps,
		);
		expect(cmdRes.status).toBe(403);
		expect(handleActiveUpdateMock).not.toHaveBeenCalled();

		// 4. Approval callback_query is blocked in candidate mode
		const cbRes = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "tg-route-abc123",
				secretTokenHeader: "super-secret-webhook-token-123456",
				rawBody: JSON.stringify({
					update_id: 103,
					callback_query: {
						id: "cb-1",
						from: { id: 4201, is_bot: false, first_name: "Alice" },
						data: JSON.stringify({
							a: "ba",
							b: "00000000-0000-4000-8000-000000000099",
						}),
					},
				}),
			},
			deps,
		);
		expect(cbRes.status).toBe(403);
		expect(handleActiveUpdateMock).not.toHaveBeenCalled();
	});

	it("dispatches full updates in active mode with installationId and authoritative settings", async () => {
		const h = createRouteHarness({ status: "active" });
		const handleActiveUpdateMock = vi.fn(async () => undefined);

		const res = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "tg-route-abc123",
				secretTokenHeader: "super-secret-webhook-token-123456",
				rawBody: JSON.stringify({
					update_id: 200,
					message: {
						message_id: 20,
						date: 1700000010,
						chat: { id: 4201, type: "private" },
						from: { id: 4201, is_bot: false, first_name: "Alice" },
						text: "/status",
					},
				}),
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				readSecret: h.readSecret,
				loadEffectiveSettings: async () => ({
					enableApprovals: true,
					enableCommands: true,
					enableDailyDigest: true,
					enableEscalations: true,
					digestTime: "08:00",
					digestTimezone: "Europe/Berlin",
					escalationTimeoutHours: 24,
				}),
				handleActiveUpdate: handleActiveUpdateMock,
				now: () => h.now,
			},
		);

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true, mode: "active" });
		expect(handleActiveUpdateMock).toHaveBeenCalledTimes(1);
		expect(handleActiveUpdateMock.mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({
				organizationId: "org-1",
				installationId: h.getInstallation().id,
				botToken: "777001:AAFakeCandidateBotToken123456789",
			}),
		);
	});

	it("services eligible approval callback queries during retiring window while refusing commands and expired/revoked installations", async () => {
		const futureDeadline = new Date("2026-12-26T12:00:00.000Z");
		const h = createRouteHarness({
			status: "retiring",
			retirementDeadlineAt: futureDeadline,
		});
		const handleRetiringBoundApprovalMock = vi.fn(async () => "Approved");
		const answerCallbackMock = vi.fn(async () => true);
		const handleActiveUpdateMock = vi.fn();

		const deps: TelegramInstallationRouteDeps = {
			repository: h.repository,
			revisionRepository: h.revisionRepository,
			readSecret: h.readSecret,
			loadEffectiveSettings: async () => ({
				enableApprovals: true,
				enableCommands: true,
				enableDailyDigest: true,
				enableEscalations: true,
				digestTime: "08:00",
				digestTimezone: "UTC",
				escalationTimeoutHours: 24,
			}),
			handleRetiringBoundApproval: handleRetiringBoundApprovalMock,
			answerCallbackQuery: answerCallbackMock,
			handleActiveUpdate: handleActiveUpdateMock,
			now: () => h.now,
		};

		// Approval callback succeeds during retiring window
		const approvalRes = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "tg-route-abc123",
				secretTokenHeader: "super-secret-webhook-token-123456",
				rawBody: JSON.stringify({
					update_id: 300,
					callback_query: {
						id: "cb-retiring-1",
						from: { id: 4201, is_bot: false, first_name: "Manager" },
						data: JSON.stringify({
							a: "ba",
							b: "00000000-0000-4000-8000-000000000099",
						}),
					},
				}),
			},
			deps,
		);
		expect(approvalRes.status).toBe(200);
		expect(handleRetiringBoundApprovalMock).toHaveBeenCalledTimes(1);
		expect(answerCallbackMock).toHaveBeenCalledWith(
			"777001:AAFakeCandidateBotToken123456789",
			"cb-retiring-1",
			"Approved",
		);

		// New command is refused during retiring window
		const cmdRes = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "tg-route-abc123",
				secretTokenHeader: "super-secret-webhook-token-123456",
				rawBody: JSON.stringify({
					update_id: 301,
					message: {
						message_id: 31,
						date: 1700000030,
						chat: { id: 4201, type: "private" },
						from: { id: 4201, is_bot: false, first_name: "Manager" },
						text: "/status",
					},
				}),
			},
			deps,
		);
		expect(cmdRes.status).toBe(403);
		expect(handleActiveUpdateMock).not.toHaveBeenCalled();

		// Past retirementDeadlineAt -> immediately refused (403)
		const pastDeadlineRes = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "tg-route-abc123",
				secretTokenHeader: "super-secret-webhook-token-123456",
				rawBody: JSON.stringify({ update_id: 302 }),
			},
			{ ...deps, now: () => new Date("2026-12-27T00:00:00.000Z") },
		);
		expect(pastDeadlineRes.status).toBe(403);

		// Revoked -> immediately refused (403)
		const hRevoked = createRouteHarness({ status: "revoked", revokedAt: h.now });
		const revokedRes = await handleTelegramInstallationWebhookRequest(
			{
				routeId: "tg-route-abc123",
				secretTokenHeader: "super-secret-webhook-token-123456",
				rawBody: JSON.stringify({ update_id: 303 }),
			},
			{
				...deps,
				repository: hRevoked.repository,
				revisionRepository: hRevoked.revisionRepository,
				readSecret: hRevoked.readSecret,
			},
		);
		expect(revokedRes.status).toBe(403);
	});
});
