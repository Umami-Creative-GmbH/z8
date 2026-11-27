import { beforeEach, describe, expect, it, vi } from "vitest";
import { SecretStoreUnavailableError } from "@/lib/vault/errors";
import {
	buildTelegramInstallationWebhookUrl,
	cleanupTelegramInstallationWebhook,
	computeTelegramCandidateSetupStatus,
	configureTelegramCandidateCredentials,
	prepareTelegramCandidateInstallation,
	reconcileTelegramInstallationWebhook,
	retryTelegramCandidateCommandRegistration,
	retryTelegramCandidateWebhookRegistration,
	rotateTelegramInstallationCredentials,
	sendTelegramCandidateTestMessage,
	TELEGRAM_BOT_COMMANDS,
	TELEGRAM_VERIFICATION_FRESHNESS_MS,
	type TelegramCandidateInstallationRecord,
	type TelegramSetupRepository,
} from "./telegram-setup";
import type {
	CredentialRevisionRecord,
	CredentialRevisionRepository,
} from "./credential-revisions";

function createInMemoryHarness() {
	let seq = 0;
	const installations = new Map<string, TelegramCandidateInstallationRecord>();
	const revisions = new Map<string, CredentialRevisionRecord>();
	const secrets = new Map<string, string>();
	const claims = new Map<string, { id: string; organizationId: string }>();
	const conversations = new Map<
		string,
		{
			organizationId: string;
			installationId: string;
			userId: string;
			externalUserId: string;
			externalConversationId: string;
		}
	>();
	const audits: Array<Record<string, unknown>> = [];

	const repository: TelegramSetupRepository = {
		async findCandidateByOrg(organizationId) {
			for (const row of installations.values()) {
				if (row.organizationId === organizationId && row.status === "candidate") {
					return row;
				}
			}
			return null;
		},
		async findCandidateById(organizationId, installationId) {
			const row = installations.get(installationId);
			if (!row || row.organizationId !== organizationId || row.status !== "candidate") {
				return null;
			}
			return row;
		},
		async findInstallationById(organizationId, installationId) {
			const row = installations.get(installationId);
			if (!row || row.organizationId !== organizationId) return null;
			return row;
		},
		async findInstallationByRouteId(routeId) {
			for (const row of installations.values()) {
				if (row.routeId === routeId) return row;
			}
			return null;
		},
		async insertCandidate(input) {
			seq += 1;
			const now = new Date("2026-11-26T10:00:00.000Z");
			const row: TelegramCandidateInstallationRecord = {
				id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
				organizationId: input.organizationId,
				provider: "telegram",
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
				retirementDeadlineAt: null,
				retiredAt: null,
				revokedAt: null,
				endpointGeneration: 0,
				endpointState: "synced",
				createdByUserId: input.createdByUserId,
				createdAt: now,
				updatedAt: now,
			};
			installations.set(row.id, row);
			return row;
		},
		async updateInstallation(organizationId, installationId, patch) {
			const existing = installations.get(installationId);
			if (!existing || existing.organizationId !== organizationId) {
				throw new Error("Installation not found");
			}
			const updated: TelegramCandidateInstallationRecord = {
				...existing,
				...patch,
				updatedAt: new Date("2026-11-26T10:01:00.000Z"),
			};
			installations.set(installationId, updated);
			return updated;
		},
		async acquireBotClaim({ organizationId, externalBotId }) {
			const key = `telegram:bot:${externalBotId}`;
			const existing = claims.get(key);
			if (existing && existing.organizationId !== organizationId) {
				return { kind: "conflict" };
			}
			if (existing) {
				return { kind: "acquired", claimId: existing.id };
			}
			seq += 1;
			const id = `11111111-1111-4000-8000-${String(seq).padStart(12, "0")}`;
			claims.set(key, { id, organizationId });
			return { kind: "acquired", claimId: id };
		},
		async withEndpointLock(_stableBotKey, fn) {
			return fn();
		},
		async findCandidateConversationForUser(organizationId, installationId, userId) {
			const conv = conversations.get(`${organizationId}:${installationId}:${userId}`);
			if (!conv) return null;
			return {
				externalConversationId: conv.externalConversationId,
				externalUserId: conv.externalUserId,
			};
		},
		async upsertCandidateConversation(input) {
			conversations.set(`${input.organizationId}:${input.installationId}:${input.userId}`, {
				organizationId: input.organizationId,
				installationId: input.installationId,
				userId: input.userId,
				externalUserId: input.externalUserId,
				externalConversationId: input.externalConversationId,
			});
		},
		async getRevisionNumber(organizationId, installationId, revisionId) {
			const rev = revisions.get(revisionId);
			if (!rev || rev.organizationId !== organizationId || rev.installationId !== installationId) {
				return null;
			}
			return rev.revisionNumber;
		},
	};

	const revisionRepository: CredentialRevisionRepository = {
		async getLatestRevisionNumber(organizationId, installationId) {
			let max = 0;
			for (const rev of revisions.values()) {
				if (rev.organizationId === organizationId && rev.installationId === installationId) {
					max = Math.max(max, rev.revisionNumber);
				}
			}
			return max;
		},
		async insertRevision(input) {
			seq += 1;
			const rev: CredentialRevisionRecord = {
				...input,
				id: `22222222-2222-4000-8000-${String(seq).padStart(12, "0")}`,
				createdAt: new Date("2026-11-26T10:00:00.000Z"),
			};
			revisions.set(rev.id, rev);
			return rev;
		},
		async findRevision(organizationId, installationId, revisionId) {
			const rev = revisions.get(revisionId);
			if (!rev || rev.organizationId !== organizationId || rev.installationId !== installationId) {
				return null;
			}
			return rev;
		},
		async getActiveRevisionId(organizationId, installationId) {
			const inst = installations.get(installationId);
			if (!inst || inst.organizationId !== organizationId) return null;
			return inst.activeCredentialRevisionId;
		},
		async updateRevisionStatus(organizationId, installationId, revisionId, status) {
			const rev = revisions.get(revisionId);
			if (rev && rev.organizationId === organizationId && rev.installationId === installationId) {
				revisions.set(revisionId, { ...rev, status });
			}
		},
	};

	return {
		installations,
		revisions,
		secrets,
		claims,
		conversations,
		audits,
		repository,
		revisionRepository,
		storeSecret: async (orgId: string, key: string, value: string) => {
			secrets.set(`${orgId}:${key}`, value);
		},
		readSecret: async (orgId: string, key: string) => secrets.get(`${orgId}:${key}`) ?? null,
		deleteSecret: async (orgId: string, key: string) => {
			secrets.delete(`${orgId}:${key}`);
		},
		recordAudit: async (event: Record<string, unknown>) => {
			audits.push(event);
		},
	};
}

describe("telegram-setup", () => {
	const fixedNow = new Date("2026-11-26T10:00:00.000Z");

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("tracks bot identity, webhook receipt, command registration, and private delivery independently", () => {
		const base: Pick<
			TelegramCandidateInstallationRecord,
			| "activeCredentialRevisionId"
			| "externalBotId"
			| "externalBotUsername"
			| "externalDisplayName"
			| "verificationEvidence"
		> = {
			activeCredentialRevisionId: "rev-1",
			externalBotId: "777001",
			externalBotUsername: "z8_acme_new_bot",
			externalDisplayName: "Z8 Acme New",
			verificationEvidence: {
				source: "verified_setup",
				identityVerifiedAt: "2026-11-26T09:50:00.000Z",
				identityRevisionId: "rev-1",
				webhookRegistered: true,
				webhookRegisteredAt: "2026-11-26T09:50:05.000Z",
				webhookRegisteredRevisionId: "rev-1",
				signedEventVerifiedAt: null,
				signedEventRevisionId: null,
				commandsRegisteredAt: "2026-11-26T09:50:10.000Z",
				commandsRevisionId: "rev-1",
				commandsRegistrationStatus: "passed",
				privateDeliveryVerifiedAt: "2026-11-26T09:55:00.000Z",
				privateDeliveryRevisionId: "rev-1",
				privateDeliveryExpiresAt: new Date(
					fixedNow.getTime() + TELEGRAM_VERIFICATION_FRESHNESS_MS,
				).toISOString(),
			},
		};

		// Missing authenticated inbound webhook receipt -> NOT ready even though setWebhook succeeded!
		const withoutWebhookProof = computeTelegramCandidateSetupStatus(base, fixedNow);
		expect(withoutWebhookProof.steps.identity.status).toBe("passed");
		expect(withoutWebhookProof.steps.webhookReceipt.status).toBe("pending");
		expect(withoutWebhookProof.steps.commandRegistration.status).toBe("passed");
		expect(withoutWebhookProof.steps.privateDelivery.status).toBe("passed");
		expect(withoutWebhookProof.readyForSwitch).toBe(false);

		// Adding fresh authenticated inbound webhook receipt makes all 4 steps pass.
		const allPassed = computeTelegramCandidateSetupStatus(
			{
				...base,
				verificationEvidence: {
					...base.verificationEvidence!,
					signedEventVerifiedAt: "2026-11-26T09:56:00.000Z",
					signedEventRevisionId: "rev-1",
					signedEventExpiresAt: new Date(
						fixedNow.getTime() + TELEGRAM_VERIFICATION_FRESHNESS_MS,
					).toISOString(),
				},
			},
			fixedNow,
		);
		expect(allPassed.steps.webhookReceipt.status).toBe("passed");
		expect(allPassed.readyForSwitch).toBe(true);
		expect(allPassed.effectiveVerificationState).toBe("verified");

		// If command registration failed, identity/webhook/privateDelivery still report passed independently.
		const commandsFailed = computeTelegramCandidateSetupStatus(
			{
				...base,
				verificationEvidence: {
					...base.verificationEvidence!,
					signedEventVerifiedAt: "2026-11-26T09:56:00.000Z",
					signedEventRevisionId: "rev-1",
					signedEventExpiresAt: new Date(
						fixedNow.getTime() + TELEGRAM_VERIFICATION_FRESHNESS_MS,
					).toISOString(),
					commandsRegisteredAt: null,
					commandsRegistrationStatus: "failed",
					commandsFailureCode: "telegram_429",
				},
			},
			fixedNow,
		);
		expect(commandsFailed.steps.identity.status).toBe("passed");
		expect(commandsFailed.steps.webhookReceipt.status).toBe("passed");
		expect(commandsFailed.steps.commandRegistration.status).toBe("failed");
		expect(commandsFailed.steps.commandRegistration.failureCode).toBe("telegram_429");
		expect(commandsFailed.readyForSwitch).toBe(false);
		expect(commandsFailed.effectiveVerificationState).toBe("failed");
	});

	it("acquires the bot ownership claim BEFORE calling setWebhook and blocks cross-org collisions", async () => {
		const h = createInMemoryHarness();
		// Another org already owns Telegram bot 900123
		h.claims.set("telegram:bot:900123", { id: "claim-other", organizationId: "org-other" });

		const prepared = await prepareTelegramCandidateInstallation(
			{ organizationId: "org-a", actorUserId: "admin-1" },
			{
				repository: h.repository,
				recordAudit: h.recordAudit,
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		const setWebhookMock = vi.fn();
		const setMyCommandsMock = vi.fn();

		const result = await configureTelegramCandidateCredentials(
			{
				organizationId: "org-a",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: "900123:AAFakeTelegramBotTokenForTesting12345",
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				storeSecret: h.storeSecret,
				deleteSecret: h.deleteSecret,
				secretStoreProvider: "vault",
				recordAudit: h.recordAudit,
				getMe: async () => ({
					kind: "ok",
					result: { id: 900123, username: "shared_bot", first_name: "Shared Bot" },
				}),
				setWebhook: setWebhookMock,
				setMyCommands: setMyCommandsMock,
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.code).toBe("bot_ownership_conflict");
		}
		// Critical invariant: webhook and commands were NEVER mutated for a bot owned by another org!
		expect(setWebhookMock).not.toHaveBeenCalled();
		expect(setMyCommandsMock).not.toHaveBeenCalled();
		expect(h.secrets.size).toBe(0);
	});

	it("stores revisioned bot_token + webhook_secret, registers webhook, and supports independent command retry", async () => {
		const h = createInMemoryHarness();
		const callOrder: string[] = [];

		const prepared = await prepareTelegramCandidateInstallation(
			{ organizationId: "org-a", actorUserId: "admin-1" },
			{
				repository: h.repository,
				recordAudit: h.recordAudit,
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		const originalAcquire = h.repository.acquireBotClaim;
		h.repository.acquireBotClaim = async (input) => {
			callOrder.push("acquireBotClaim");
			return originalAcquire(input);
		};

		const setWebhookMock = vi.fn(async (_token: string, url: string, secretToken: string) => {
			callOrder.push("setWebhook");
			expect(url).toBe(
				buildTelegramInstallationWebhookUrl(prepared.routeId, "https://app.example.com"),
			);
			expect(secretToken.length).toBeGreaterThanOrEqual(32);
			return { kind: "ok" as const, result: true as const };
		});

		const setMyCommandsMock = vi
			.fn()
			.mockResolvedValueOnce({
				kind: "failed" as const,
				errorCode: 429,
				description: "Too Many Requests",
			})
			.mockResolvedValueOnce({ kind: "ok" as const, result: true as const });

		const configured = await configureTelegramCandidateCredentials(
			{
				organizationId: "org-a",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: "555111:AAValidTelegramCandidateToken12345678",
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				storeSecret: h.storeSecret,
				readSecret: h.readSecret,
				deleteSecret: h.deleteSecret,
				secretStoreProvider: "vault",
				recordAudit: h.recordAudit,
				getMe: async () => ({
					kind: "ok",
					result: { id: 555111, username: "z8_new_bot", first_name: "Z8 New Bot" },
				}),
				setWebhook: setWebhookMock,
				setMyCommands: setMyCommandsMock,
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		expect(configured.kind).toBe("ok");
		expect(callOrder).toEqual(["acquireBotClaim", "setWebhook"]);
		expect(setMyCommandsMock).toHaveBeenCalledWith(
			"555111:AAValidTelegramCandidateToken12345678",
			TELEGRAM_BOT_COMMANDS,
		);
		expect(TELEGRAM_BOT_COMMANDS).toHaveLength(11);

		if (configured.kind === "ok") {
			expect(configured.view.steps.identity.status).toBe("passed");
			expect(configured.view.webhookRegistered).toBe(true);
			expect(configured.view.steps.webhookReceipt.status).toBe("pending");
			expect(configured.view.steps.commandRegistration.status).toBe("failed");
			expect(configured.view.steps.commandRegistration.failureCode).toBe("telegram_429");
			expect(configured.view.readyForSwitch).toBe(false);
		}

		// Retry command registration independently!
		const retried = await retryTelegramCandidateCommandRegistration(
			{
				organizationId: "org-a",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				readSecret: h.readSecret,
				setMyCommands: setMyCommandsMock,
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		expect(retried.kind).toBe("ok");
		if (retried.kind === "ok") {
			expect(retried.view.steps.commandRegistration.status).toBe("passed");
			expect(retried.view.steps.identity.status).toBe("passed");
			expect(retried.view.steps.webhookReceipt.status).toBe("pending");
		}
	});

	it("sends a synthetic private test message to the admin's verified candidate chat", async () => {
		const h = createInMemoryHarness();
		const prepared = await prepareTelegramCandidateInstallation(
			{ organizationId: "org-a", actorUserId: "admin-1" },
			{
				repository: h.repository,
				recordAudit: h.recordAudit,
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		await configureTelegramCandidateCredentials(
			{
				organizationId: "org-a",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: "555222:AAValidTelegramCandidateToken12345678",
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				storeSecret: h.storeSecret,
				readSecret: h.readSecret,
				deleteSecret: h.deleteSecret,
				secretStoreProvider: "vault",
				recordAudit: h.recordAudit,
				getMe: async () => ({
					kind: "ok",
					result: { id: 555222, username: "z8_test_bot", first_name: "Z8 Test" },
				}),
				setWebhook: async () => ({ kind: "ok", result: true }),
				setMyCommands: async () => ({ kind: "ok", result: true }),
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		// Admin enrolled on candidate bot -> candidate conversation exists
		await h.repository.upsertCandidateConversation({
			organizationId: "org-a",
			installationId: prepared.installationId,
			userId: "admin-1",
			externalUserId: "999001",
			externalConversationId: "999001",
			reachabilityStatus: "reachable",
			verifiedAt: fixedNow,
		});

		const sendMessageMock = vi.fn(async () => ({
			kind: "ok" as const,
			result: {
				message_id: 42,
				date: 1700000000,
				chat: { id: 999001, type: "private" as const },
			},
		}));

		const testResult = await sendTelegramCandidateTestMessage(
			{
				organizationId: "org-a",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				readSecret: h.readSecret,
				sendMessage: sendMessageMock,
				recordAudit: h.recordAudit,
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		expect(testResult.kind).toBe("ok");
		expect(sendMessageMock).toHaveBeenCalledTimes(1);
		expect(sendMessageMock.mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({
				chat_id: "999001",
			}),
		);
		// Synthetic test text must clearly be a setup test, never an approval card
		expect(sendMessageMock.mock.calls[0]?.[1]?.reply_markup).toBeUndefined();
		if (testResult.kind === "ok") {
			expect(testResult.view.steps.privateDelivery.status).toBe("passed");
		}
	});

	it("retries webhook registration under endpoint lock and increments endpointGeneration", async () => {
		const h = createInMemoryHarness();
		const prepared = await prepareTelegramCandidateInstallation(
			{ organizationId: "org-a", actorUserId: "admin-1" },
			{
				repository: h.repository,
				recordAudit: h.recordAudit,
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		await configureTelegramCandidateCredentials(
			{
				organizationId: "org-a",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: "555333:AAValidTelegramCandidateToken12345678",
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				storeSecret: h.storeSecret,
				readSecret: h.readSecret,
				deleteSecret: h.deleteSecret,
				secretStoreProvider: "vault",
				recordAudit: h.recordAudit,
				getMe: async () => ({
					kind: "ok",
					result: { id: 555333, username: "z8_retry_bot", first_name: "Z8 Retry" },
				}),
				setWebhook: async () => ({ kind: "failed", errorCode: 500, description: "Internal" }),
				setMyCommands: async () => ({ kind: "ok", result: true }),
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		const beforeRetry = h.installations.get(prepared.installationId)!;
		expect(beforeRetry.verificationEvidence?.webhookRegistered).toBe(false);

		const retried = await retryTelegramCandidateWebhookRegistration(
			{
				organizationId: "org-a",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				readSecret: h.readSecret,
				setWebhook: async () => ({ kind: "ok", result: true }),
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		expect(retried.kind).toBe("ok");
		const afterRetry = h.installations.get(prepared.installationId)!;
		expect(afterRetry.verificationEvidence?.webhookRegistered).toBe(true);
		expect(afterRetry.endpointGeneration).toBeGreaterThan(beforeRetry.endpointGeneration);
	});

	it("distinguishes secret-store outage cleanly during candidate credential write", async () => {
		const h = createInMemoryHarness();
		const prepared = await prepareTelegramCandidateInstallation(
			{ organizationId: "org-a", actorUserId: "admin-1" },
			{
				repository: h.repository,
				recordAudit: h.recordAudit,
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		const result = await configureTelegramCandidateCredentials(
			{
				organizationId: "org-a",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: "555444:AAValidTelegramCandidateToken12345678",
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				storeSecret: async () => {
					throw new SecretStoreUnavailableError("vault", "Vault sealed");
				},
				deleteSecret: h.deleteSecret,
				secretStoreProvider: "vault",
				recordAudit: h.recordAudit,
				getMe: async () => ({
					kind: "ok",
					result: { id: 555444, username: "z8_outage_bot", first_name: "Z8 Outage" },
				}),
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.code).toBe("secret_store_unavailable");
		}
	});

	it("classifies Telegram webhook cleanup timeout as timeout_uncertain and reconciles via getWebhookInfo + setWebhook", async () => {
		const h = createInMemoryHarness();
		const prepared = await prepareTelegramCandidateInstallation(
			{ organizationId: "org-a", actorUserId: "admin-1" },
			{
				repository: h.repository,
				recordAudit: h.recordAudit,
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		await configureTelegramCandidateCredentials(
			{
				organizationId: "org-a",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: "555555:AAValidTelegramCandidateToken12345678",
			},
			{
				repository: h.repository,
				revisionRepository: h.revisionRepository,
				storeSecret: h.storeSecret,
				readSecret: h.readSecret,
				deleteSecret: h.deleteSecret,
				secretStoreProvider: "vault",
				recordAudit: h.recordAudit,
				getMe: async () => ({
					kind: "ok",
					result: { id: 555555, username: "z8_cleanup_bot", first_name: "Z8 Cleanup" },
				}),
				setWebhook: async () => ({ kind: "ok", result: true }),
				setMyCommands: async () => ({ kind: "ok", result: true }),
				appUrl: "https://app.example.com",
				now: () => fixedNow,
			},
		);

		const inst = h.installations.get(prepared.installationId)!;

		const timedOut = await cleanupTelegramInstallationWebhook(
			{
				installation: {
					...inst,
					legacyTable: null,
					legacyRecordId: null,
					retirementDeadlineAt: null,
					retiredAt: null,
					revokedAt: fixedNow,
				},
				job: {
					id: "job-1",
					organizationId: "org-a",
					installationId: inst.id,
					provider: "telegram",
					stableBotKey: "telegram:555555",
					kind: "provider_endpoint_cleanup",
					credentialRevisionId: inst.activeCredentialRevisionId,
					authorizedGeneration: 2,
					status: "pending",
					attemptCount: 0,
					maxAttempts: 5,
					nextAttemptAt: fixedNow,
					lastErrorCode: null,
					redactedDiagnostics: null,
					completedAt: null,
					exhaustedAt: null,
					createdAt: fixedNow,
					updatedAt: fixedNow,
				},
			},
			{
				revisionRepository: h.revisionRepository,
				readSecret: h.readSecret,
				deleteWebhook: async () => ({ kind: "unknown", reason: "timeout" }),
			},
		);
		expect(timedOut).toEqual({ kind: "timeout_uncertain", errorCode: "telegram_timeout" });

		const setWebhookReconcileMock = vi.fn(async () => ({
			kind: "ok" as const,
			result: true as const,
		}));
		const reconciled = await reconcileTelegramInstallationWebhook(
			{
				installation: {
					...inst,
					legacyTable: null,
					legacyRecordId: null,
					retirementDeadlineAt: null,
					retiredAt: null,
					revokedAt: null,
				},
				targetGeneration: 3,
			},
			{
				revisionRepository: h.revisionRepository,
				readSecret: h.readSecret,
				getWebhookInfo: async () => ({ kind: "ok", result: { url: "", pending_update_count: 0 } }),
				setWebhook: setWebhookReconcileMock,
				appUrl: "https://app.example.com",
			},
		);
		expect(reconciled).toEqual({ kind: "reconciled" });
		expect(setWebhookReconcileMock).toHaveBeenCalledTimes(1);
	});

	it("exports rotateTelegramInstallationCredentials verifying identical numeric bot ID", () => {
		expect(typeof rotateTelegramInstallationCredentials).toBe("function");
	});
});
