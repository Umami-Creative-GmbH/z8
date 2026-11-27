import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatInstallationProvider, ChatInstallationStatus } from "@/db/schema";
import { SecretStoreUnavailableError } from "@/lib/vault/errors";
import {
	beginChatInstallationRestore,
	buildStableBotKey,
	type ChatRecoveryCleanupJobRecord,
	type ChatRecoveryInstallationRecord,
	type ChatRecoveryRepository,
	computeCleanupBackoffMs,
	confirmChatInstallationRestore,
	evaluateEndpointCleanupFence,
	getProviderRotationGuidance,
	processChatInstallationCleanupJobs,
	revokeChatInstallation,
	rotateChatInstallationCredentials,
	sanitizeCleanupDiagnostics,
	verifyRestoredChatInstallation,
} from "./recovery-lifecycle";

interface InMemoryRevision {
	id: string;
	installationId: string;
	organizationId: string;
	revisionNumber: number;
	secretStoreProvider: "vault" | "scaleway";
	secretKeyPrefix: string;
	secretKeys: string[];
	status:
		| "staged"
		| "verified"
		| "active"
		| "superseded"
		| "revoked"
		| "cleanup_pending"
		| "cleaned_up";
	externalIdentityFingerprint: string | null;
	verifiedAt: Date | null;
	revokedAt: Date | null;
	createdByUserId: string | null;
	createdAt: Date;
}

const T0 = new Date("2026-11-26T12:00:00.000Z");

function createInMemoryRecoveryHarness() {
	const installations = new Map<string, ChatRecoveryInstallationRecord>();
	const revisions = new Map<string, InMemoryRevision>();
	const cleanupJobs = new Map<string, ChatRecoveryCleanupJobRecord>();
	const activeByProvider = new Map<string, string | null>();
	const referencedRevisions = new Set<string>();
	const secrets = new Map<string, string>();
	const acquiredEndpointLocks: string[] = [];
	const auditEvents: Array<{
		action: string;
		targetId: string;
		metadata: Record<string, unknown>;
	}> = [];
	const opsAlerts: Array<{ message: string; context: Record<string, unknown> }> = [];
	const evictedAdapters: Array<{ installationId: string; revisionId?: string }> = [];
	let seq = 1;

	const seedInstallation = (
		overrides: Partial<ChatRecoveryInstallationRecord> & {
			id: string;
			organizationId: string;
			provider: ChatInstallationProvider;
		},
	): ChatRecoveryInstallationRecord => {
		const row: ChatRecoveryInstallationRecord = {
			credentialSource: "organization_owned",
			status: "active",
			routeId: `route-${overrides.id}`,
			externalAppId: "A_SLACK_1",
			externalBotId: "U_BOT_1",
			externalBotUsername: "z8-bot",
			externalDisplayName: "Acme Slack",
			externalSpaceId: "T_SPACE_1",
			externalSpaceName: "Acme Workspace",
			receiverScope: "slack-app:A_SLACK_1:team:T_SPACE_1",
			activeCredentialRevisionId: null,
			legacyTable: null,
			legacyRecordId: null,
			verificationState: "verified",
			verificationEvidence: {
				source: "verified_setup",
				identityVerifiedAt: T0.toISOString(),
				signedEventVerifiedAt: T0.toISOString(),
				privateDeliveryVerifiedAt: T0.toISOString(),
			},
			lastVerifiedAt: T0,
			retirementDeadlineAt: null,
			retiredAt: null,
			revokedAt: null,
			endpointGeneration: 1,
			endpointState: "synced",
			createdByUserId: "user-admin",
			createdAt: T0,
			updatedAt: T0,
			...overrides,
		};
		installations.set(row.id, row);
		if (row.status === "active") {
			activeByProvider.set(`${row.organizationId}:${row.provider}`, row.id);
		}
		return row;
	};

	const seedRevision = (
		overrides: Partial<InMemoryRevision> & {
			id: string;
			organizationId: string;
			installationId: string;
			revisionNumber: number;
		},
	): InMemoryRevision => {
		const prefix = `chat/slack/installations/${overrides.installationId}/revisions/v${overrides.revisionNumber}`;
		const row: InMemoryRevision = {
			secretStoreProvider: "vault",
			secretKeyPrefix: prefix,
			secretKeys: ["bot_token", "signing_secret"],
			status: "active",
			externalIdentityFingerprint: "slack:T_SPACE_1:A_SLACK_1:B1:U_BOT_1",
			verifiedAt: T0,
			revokedAt: null,
			createdByUserId: "user-admin",
			createdAt: T0,
			...overrides,
		};
		revisions.set(row.id, row);
		return row;
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

	const revisionRepository = {
		getLatestRevisionNumber: vi.fn(async (orgId: string, installationId: string) => {
			let max = 0;
			for (const rev of revisions.values()) {
				if (rev.organizationId === orgId && rev.installationId === installationId) {
					max = Math.max(max, rev.revisionNumber);
				}
			}
			return max;
		}),
		insertRevision: vi.fn(async (input: Omit<InMemoryRevision, "id" | "createdAt">) => {
			const row: InMemoryRevision = {
				...input,
				id: `rev-${seq++}`,
				createdAt: T0,
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
		getActiveRevisionId: vi.fn(async (orgId: string, installationId: string) => {
			const inst = installations.get(installationId);
			if (!inst || inst.organizationId !== orgId) return null;
			return inst.activeCredentialRevisionId;
		}),
		updateRevisionStatus: vi.fn(
			async (
				orgId: string,
				installationId: string,
				revisionId: string,
				status: InMemoryRevision["status"],
			) => {
				const row = revisions.get(revisionId);
				if (row && row.organizationId === orgId && row.installationId === installationId) {
					row.status = status;
				}
			},
		),
	};

	const repository: ChatRecoveryRepository = {
		async withEndpointLock(stableBotKey, fn) {
			acquiredEndpointLocks.push(stableBotKey);
			return fn(repository);
		},
		async findInstallationById(organizationId, installationId) {
			const inst = installations.get(installationId);
			if (!inst || inst.organizationId !== organizationId) return null;
			return { ...inst };
		},
		async listInstallationsByProvider(organizationId, provider) {
			return [...installations.values()]
				.filter((inst) => inst.organizationId === organizationId && inst.provider === provider)
				.map((inst) => ({ ...inst }));
		},
		async updateInstallation(organizationId, installationId, patch) {
			const existing = installations.get(installationId);
			if (!existing || existing.organizationId !== organizationId) {
				throw new Error("Installation not found");
			}
			const updated = { ...existing, ...patch };
			installations.set(installationId, updated);
			return { ...updated };
		},
		async clearActiveProviderInstallation(organizationId, provider, installationId) {
			const key = `${organizationId}:${provider}`;
			if (activeByProvider.get(key) === installationId) {
				activeByProvider.set(key, null);
			}
		},
		async markLegacyRowDisconnected() {
			// no-op in memory unless asserted
		},
		async listNonCleanedRevisions(organizationId, installationId) {
			return [...revisions.values()].filter(
				(rev) =>
					rev.organizationId === organizationId &&
					rev.installationId === installationId &&
					rev.status !== "cleaned_up",
			);
		},
		async updateRevisionStatus(organizationId, installationId, revisionId, status, extra) {
			const rev = revisions.get(revisionId);
			if (rev && rev.organizationId === organizationId && rev.installationId === installationId) {
				rev.status = status;
				if (extra?.verifiedAt !== undefined) rev.verifiedAt = extra.verifiedAt;
				if (extra?.revokedAt !== undefined) rev.revokedAt = extra.revokedAt;
			}
		},
		async isCredentialRevisionReferenced(organizationId, installationId, revisionId) {
			const inst = installations.get(installationId);
			if (
				inst &&
				inst.organizationId === organizationId &&
				inst.activeCredentialRevisionId === revisionId
			) {
				return true;
			}
			return referencedRevisions.has(revisionId);
		},
		async enqueueCleanupJob(input) {
			const job: ChatRecoveryCleanupJobRecord = {
				id: `job-${seq++}`,
				organizationId: input.organizationId,
				installationId: input.installationId,
				provider: input.provider,
				stableBotKey: input.stableBotKey,
				kind: input.kind,
				credentialRevisionId: input.credentialRevisionId ?? null,
				authorizedGeneration: input.authorizedGeneration,
				status: "pending",
				attemptCount: 0,
				maxAttempts: input.maxAttempts ?? 5,
				nextAttemptAt: input.nextAttemptAt ?? T0,
				lastErrorCode: null,
				redactedDiagnostics: null,
				completedAt: null,
				exhaustedAt: null,
				createdAt: T0,
				updatedAt: T0,
			};
			cleanupJobs.set(job.id, job);
			return { ...job };
		},
		async listDueCleanupJobs(input) {
			return [...cleanupJobs.values()]
				.filter((job) => {
					if (job.status !== "pending") return false;
					if (job.nextAttemptAt.getTime() > input.now.getTime()) return false;
					if (input.organizationId && job.organizationId !== input.organizationId) return false;
					if (input.provider && job.provider !== input.provider) return false;
					return true;
				})
				.slice(0, input.limit ?? 50)
				.map((job) => ({ ...job }));
		},
		async listCleanupJobsForProvider(organizationId, provider) {
			return [...cleanupJobs.values()]
				.filter((job) => job.organizationId === organizationId && job.provider === provider)
				.map((job) => ({ ...job }));
		},
		async updateCleanupJob(jobId, patch) {
			const existing = cleanupJobs.get(jobId);
			if (!existing) throw new Error("Job not found");
			const updated = { ...existing, ...patch };
			cleanupJobs.set(jobId, updated);
			return { ...updated };
		},
	};

	const deps = {
		repository,
		revisionRepository,
		storeSecret,
		readSecret,
		deleteSecret,
		secretStoreProvider: "vault" as const,
		now: () => T0,
		recordAudit: async (event: {
			action: string;
			targetId: string;
			metadata: Record<string, unknown>;
		}) => {
			auditEvents.push(event);
		},
		reportOpsAlert: (message: string, context: Record<string, unknown>) => {
			opsAlerts.push({ message, context });
		},
		onAdapterEvict: (installationId: string, revisionId?: string) => {
			evictedAdapters.push({ installationId, revisionId });
		},
	};

	return {
		installations,
		revisions,
		cleanupJobs,
		activeByProvider,
		referencedRevisions,
		secrets,
		acquiredEndpointLocks,
		auditEvents,
		opsAlerts,
		evictedAdapters,
		seedInstallation,
		seedRevision,
		storeSecret,
		readSecret,
		deleteSecret,
		repository,
		deps,
	};
}

describe("chat installation recovery lifecycle (#2046)", () => {
	let h: ReturnType<typeof createInMemoryRecoveryHarness>;

	beforeEach(() => {
		h = createInMemoryRecoveryHarness();
	});

	describe("pure helpers & provider rotation guidance", () => {
		it("builds deterministic stable bot keys per provider", () => {
			expect(
				buildStableBotKey({
					id: "i1",
					provider: "slack",
					externalSpaceId: "T123",
					externalAppId: "A456",
					externalBotId: "U789",
				}),
			).toBe("slack:T123:A456");

			expect(
				buildStableBotKey({
					id: "i2",
					provider: "telegram",
					externalSpaceId: null,
					externalAppId: null,
					externalBotId: "99887766",
				}),
			).toBe("telegram:99887766");

			expect(
				buildStableBotKey({
					id: "i3",
					provider: "discord",
					externalSpaceId: null,
					externalAppId: "123456789012345678",
					externalBotId: null,
				}),
			).toBe("discord:123456789012345678");

			expect(
				buildStableBotKey({
					id: "i4",
					provider: "teams",
					externalSpaceId: "tenant-guid",
					externalAppId: "app-guid",
					externalBotId: null,
				}),
			).toBe("teams:app-guid");
		});

		it("provides provider-specific interruption guidance and verification steps", () => {
			const slack = getProviderRotationGuidance("slack");
			expect(slack.hasProviderInterruption).toBe(true);
			expect(slack.interruptionKind).toBe("signing_secret_cutover");
			expect(slack.verificationSteps.length).toBeGreaterThanOrEqual(2);

			const teams = getProviderRotationGuidance("teams");
			expect(teams.hasProviderInterruption).toBe(false);
			expect(teams.interruptionKind).toBe("overlapping_secret_rollover");

			const telegram = getProviderRotationGuidance("telegram");
			expect(telegram.hasProviderInterruption).toBe(true);

			const discord = getProviderRotationGuidance("discord");
			expect(discord.hasProviderInterruption).toBe(true);
		});

		it("fences endpoint cleanup against stale generations and reactivated statuses", () => {
			expect(
				evaluateEndpointCleanupFence({
					jobAuthorizedGeneration: 2,
					installationGeneration: 2,
					installationStatus: "revoked",
				}),
			).toEqual({ proceed: true, reason: null });

			expect(
				evaluateEndpointCleanupFence({
					jobAuthorizedGeneration: 2,
					installationGeneration: 3,
					installationStatus: "revoked",
				}),
			).toEqual({ proceed: false, reason: "stale_generation" });

			for (const status of ["active", "candidate", "retiring"] as ChatInstallationStatus[]) {
				expect(
					evaluateEndpointCleanupFence({
						jobAuthorizedGeneration: 2,
						installationGeneration: 2,
						installationStatus: status,
					}),
				).toEqual({ proceed: false, reason: "installation_reactivated" });
			}
		});

		it("computes bounded exponential backoff and redacts secret-bearing diagnostics", () => {
			expect(computeCleanupBackoffMs(1)).toBe(60_000);
			expect(computeCleanupBackoffMs(2)).toBe(300_000);
			expect(computeCleanupBackoffMs(10)).toBe(43_200_000);

			const sanitized = sanitizeCleanupDiagnostics({
				reason: "secret_store_unavailable",
				errorCode: "xoxb-should-not-leak-if-in-message",
				failedKeys: ["bot_token"],
				observedGeneration: 3,
				observedStatus: "active",
			});
			expect(sanitized.errorCode).toBe("redacted");
			expect(sanitized.failedKeys).toEqual(["bot_token"]);
		});
	});

	describe("same-identity credential rotation", () => {
		it("rotates Slack credentials into a new immutable revision on the same installation when app_id & team_id match", async () => {
			const rev1 = h.seedRevision({
				id: "rev-old",
				organizationId: "org-1",
				installationId: "inst-1",
				revisionNumber: 1,
			});
			h.seedInstallation({
				id: "inst-1",
				organizationId: "org-1",
				provider: "slack",
				activeCredentialRevisionId: rev1.id,
				externalAppId: "A_SLACK_1",
				externalSpaceId: "T_SPACE_1",
			});
			h.secrets.set(`org-1::${rev1.secretKeyPrefix}/bot_token`, "xoxb-old-token-1234");
			h.secrets.set(`org-1::${rev1.secretKeyPrefix}/signing_secret`, "old_signing_secret_123456");

			const result = await rotateChatInstallationCredentials(
				{
					organizationId: "org-1",
					installationId: "inst-1",
					actorUserId: "user-admin",
					secrets: {
						bot_token: "xoxb-new-token-5678",
						signing_secret: "new_signing_secret_abcdef012345",
					},
				},
				{
					...h.deps,
					verifySlackBotMetadata: async () => ({
						kind: "ok",
						identity: {
							appId: "A_SLACK_1",
							teamId: "T_SPACE_1",
							teamName: "Acme Workspace",
							botId: "B1",
							botUserId: "U_BOT_1",
							botUsername: "z8-bot",
						},
					}),
				},
			);

			expect(result.kind).toBe("rotated");
			if (result.kind !== "rotated") return;

			expect(result.installationId).toBe("inst-1");
			expect(result.routeId).toBe("route-inst-1");
			expect(result.previousRevisionId).toBe("rev-old");
			expect(result.newRevisionNumber).toBe(2);
			expect(result.guidance.provider).toBe("slack");

			// Same installation preserved; new revision active; old revision superseded (never mutated in place!)
			const inst = h.installations.get("inst-1")!;
			expect(inst.activeCredentialRevisionId).toBe(result.newRevisionId);
			expect(h.revisions.get("rev-old")?.status).toBe("superseded");
			expect(h.revisions.get(result.newRevisionId)?.status).toBe("active");
			expect(h.secrets.get(`org-1::${rev1.secretKeyPrefix}/bot_token`)).toBe("xoxb-old-token-1234");

			// Async cleanup job queued for the superseded revision
			const jobs = [...h.cleanupJobs.values()];
			expect(jobs).toHaveLength(1);
			expect(jobs[0]).toMatchObject({
				kind: "credential_revision_cleanup",
				credentialRevisionId: "rev-old",
				status: "pending",
			});

			// Redacted audit event has zero raw secret material
			expect(h.auditEvents).toHaveLength(1);
			const serializedAudit = JSON.stringify(h.auditEvents[0]);
			expect(serializedAudit).not.toContain("xoxb-new-token-5678");
			expect(serializedAudit).not.toContain("new_signing_secret_abcdef012345");
		});

		it("rejects rotation with 'external_identity_mismatch' when Slack app_id or team_id differs", async () => {
			const rev1 = h.seedRevision({
				id: "rev-old",
				organizationId: "org-1",
				installationId: "inst-1",
				revisionNumber: 1,
			});
			h.seedInstallation({
				id: "inst-1",
				organizationId: "org-1",
				provider: "slack",
				activeCredentialRevisionId: rev1.id,
				externalAppId: "A_SLACK_1",
				externalSpaceId: "T_SPACE_1",
			});

			const result = await rotateChatInstallationCredentials(
				{
					organizationId: "org-1",
					installationId: "inst-1",
					actorUserId: "user-admin",
					secrets: {
						bot_token: "xoxb-different-app-token",
						signing_secret: "new_signing_secret_abcdef012345",
					},
				},
				{
					...h.deps,
					verifySlackBotMetadata: async () => ({
						kind: "ok",
						identity: {
							appId: "A_DIFFERENT_APP",
							teamId: "T_SPACE_1",
							teamName: "Acme Workspace",
							botId: "B2",
							botUserId: "U_BOT_2",
							botUsername: "other-bot",
						},
					}),
				},
			);

			expect(result).toMatchObject({
				kind: "refused",
				code: "external_identity_mismatch",
			});
			expect(h.installations.get("inst-1")?.activeCredentialRevisionId).toBe("rev-old");
			expect(h.cleanupJobs.size).toBe(0);
		});

		it("evicts cached installation adapter when rotating Teams credentials", async () => {
			const rev1 = h.seedRevision({
				id: "rev-teams-1",
				organizationId: "org-1",
				installationId: "inst-teams",
				revisionNumber: 1,
				secretKeys: ["app_password"],
			});
			h.seedInstallation({
				id: "inst-teams",
				organizationId: "org-1",
				provider: "teams",
				activeCredentialRevisionId: rev1.id,
				externalAppId: "11111111-1111-4111-8111-111111111111",
				externalSpaceId: "22222222-2222-4222-8222-222222222222",
			});

			const result = await rotateChatInstallationCredentials(
				{
					organizationId: "org-1",
					installationId: "inst-teams",
					actorUserId: "user-admin",
					secrets: { app_password: "new-teams-client-secret" },
					verifyIdentity: async () => ({
						kind: "matched",
						fingerprint:
							"teams:22222222-2222-4222-8222-222222222222:11111111-1111-4111-8111-111111111111",
					}),
				},
				h.deps,
			);

			expect(result.kind).toBe("rotated");
			expect(h.evictedAdapters).toContainEqual({
				installationId: "inst-teams",
				revisionId: "rev-teams-1",
			});
		});
	});

	describe("immediate revocation & generation-fenced async cleanup", () => {
		it("immediately revokes org-owned installation, increments generation, and queues generation-fenced cleanup without touching unrelated orgs", async () => {
			const rev1 = h.seedRevision({
				id: "rev-org1",
				organizationId: "org-1",
				installationId: "inst-org1",
				revisionNumber: 1,
			});
			h.seedInstallation({
				id: "inst-org1",
				organizationId: "org-1",
				provider: "slack",
				activeCredentialRevisionId: rev1.id,
				endpointGeneration: 2,
			});
			h.seedInstallation({
				id: "inst-org2",
				organizationId: "org-2",
				provider: "slack",
				externalAppId: "A_ORG_2",
				externalSpaceId: "T_ORG_2",
			});

			const result = await revokeChatInstallation(
				{
					organizationId: "org-1",
					installationId: "inst-org1",
					actorUserId: "user-admin",
				},
				h.deps,
			);

			expect(result).toMatchObject({
				kind: "revoked",
				installationId: "inst-org1",
				endpointGeneration: 3,
				queuedCredentialCleanupCount: 1,
				queuedEndpointCleanup: true,
			});

			expect(h.installations.get("inst-org1")?.status).toBe("revoked");
			expect(h.installations.get("inst-org1")?.revokedAt).toEqual(T0);
			expect(h.installations.get("inst-org1")?.endpointGeneration).toBe(3);
			expect(h.activeByProvider.get("org-1:slack")).toBeNull();
			expect(h.revisions.get("rev-org1")?.status).toBe("revoked");

			// Unrelated organization untouched
			expect(h.installations.get("inst-org2")?.status).toBe("active");
			expect(h.activeByProvider.get("org-2:slack")).toBe("inst-org2");

			const jobs = [...h.cleanupJobs.values()];
			expect(jobs.map((j) => j.kind).sort()).toEqual([
				"credential_revision_cleanup",
				"provider_endpoint_cleanup",
			]);
			const endpointJob = jobs.find((j) => j.kind === "provider_endpoint_cleanup")!;
			expect(endpointJob.authorizedGeneration).toBe(3);
			expect(endpointJob.stableBotKey).toBe("slack:T_SPACE_1:A_SLACK_1");
		});

		it("revoking a deployment-managed installation never queues shared credential or shared endpoint teardown", async () => {
			h.seedInstallation({
				id: "inst-legacy",
				organizationId: "org-1",
				provider: "slack",
				credentialSource: "deployment_managed",
				status: "legacy_active",
				endpointGeneration: 0,
			});

			const result = await revokeChatInstallation(
				{
					organizationId: "org-1",
					installationId: "inst-legacy",
					actorUserId: "user-admin",
				},
				h.deps,
			);

			expect(result).toMatchObject({
				kind: "revoked",
				endpointGeneration: 1,
				queuedCredentialCleanupCount: 0,
				queuedEndpointCleanup: false,
			});
			expect(h.cleanupJobs.size).toBe(0);
		});

		it("defers credential revision cleanup while referenced and retries across secret-store outage until exhausted with redacted ops alert", async () => {
			const revOld = h.seedRevision({
				id: "rev-old",
				organizationId: "org-1",
				installationId: "inst-1",
				revisionNumber: 1,
				status: "superseded",
			});
			h.seedInstallation({
				id: "inst-1",
				organizationId: "org-1",
				provider: "slack",
				activeCredentialRevisionId: "rev-new",
			});
			h.secrets.set(`org-1::${revOld.secretKeyPrefix}/bot_token`, "xoxb-old-secret-9999");
			h.referencedRevisions.add("rev-old");

			const job = await h.repository.enqueueCleanupJob({
				organizationId: "org-1",
				installationId: "inst-1",
				provider: "slack",
				stableBotKey: "slack:T_SPACE_1:A_SLACK_1",
				kind: "credential_revision_cleanup",
				credentialRevisionId: "rev-old",
				authorizedGeneration: 1,
				maxAttempts: 2,
				nextAttemptAt: T0,
			});

			// 1. Referenced -> deferred (not deleted, attemptCount stays 0)
			const run1 = await processChatInstallationCleanupJobs({ now: T0 }, h.deps);
			expect(run1.deferredReferenced).toBe(1);
			expect(h.deleteSecret).not.toHaveBeenCalled();
			expect(h.cleanupJobs.get(job.id)?.status).toBe("pending");
			expect(h.cleanupJobs.get(job.id)?.attemptCount).toBe(0);

			// 2. Unreferenced + Vault outage -> retryable (attempt 1)
			h.referencedRevisions.delete("rev-old");
			h.deleteSecret.mockRejectedValue(
				new SecretStoreUnavailableError("Vault sealed xoxb-old-secret-9999", {
					provider: "vault",
					operation: "delete",
				}),
			);

			const t1 = new Date(T0.getTime() + 10 * 60_000);
			const run2 = await processChatInstallationCleanupJobs({ now: t1 }, h.deps);
			expect(run2.retried).toBe(1);
			expect(h.cleanupJobs.get(job.id)?.status).toBe("pending");
			expect(h.cleanupJobs.get(job.id)?.attemptCount).toBe(1);

			// 3. Second failure reaches maxAttempts=2 -> exhausted + redacted ops alert
			const t2 = new Date(t1.getTime() + 10 * 60_000);
			const run3 = await processChatInstallationCleanupJobs({ now: t2 }, h.deps);
			expect(run3.exhausted).toBe(1);
			expect(h.cleanupJobs.get(job.id)?.status).toBe("exhausted");
			expect(h.opsAlerts).toHaveLength(1);
			expect(JSON.stringify(h.opsAlerts[0])).not.toContain("xoxb-old-secret-9999");
		});

		it("skips delayed provider endpoint cleanup when generation advanced (reactivated bot untouched) and marks endpoint uncertain on timeout", async () => {
			h.seedInstallation({
				id: "inst-tg",
				organizationId: "org-1",
				provider: "telegram",
				status: "revoked",
				externalBotId: "5551234",
				endpointGeneration: 2,
				endpointState: "synced",
			});

			const job = await h.repository.enqueueCleanupJob({
				organizationId: "org-1",
				installationId: "inst-tg",
				provider: "telegram",
				stableBotKey: "telegram:5551234",
				kind: "provider_endpoint_cleanup",
				authorizedGeneration: 2,
				maxAttempts: 3,
				nextAttemptAt: T0,
			});

			// First attempt times out -> endpoint_state becomes 'uncertain', retry scheduled
			const cleanupCb = vi.fn().mockResolvedValueOnce({
				kind: "timeout_uncertain" as const,
				errorCode: "provider_timeout",
			});

			const runTimeout = await processChatInstallationCleanupJobs(
				{ now: T0 },
				{ ...h.deps, providerEndpointCleanup: cleanupCb },
			);
			expect(runTimeout.retried).toBe(1);
			expect(h.installations.get("inst-tg")?.endpointState).toBe("uncertain");
			expect(h.acquiredEndpointLocks).toContain("telegram:5551234");

			// Now installation is reactivated (endpointGeneration advances to 3, status becomes candidate/active)
			await h.repository.updateInstallation("org-1", "inst-tg", {
				endpointGeneration: 3,
				status: "active",
				endpointState: "synced",
			});

			// Delayed retry arrives for generation 2 -> MUST SKIP without calling provider cleanup callback!
			const tLater = new Date(T0.getTime() + 10 * 60_000);
			const runStale = await processChatInstallationCleanupJobs(
				{ now: tLater },
				{ ...h.deps, providerEndpointCleanup: cleanupCb },
			);
			expect(runStale.skippedStale).toBe(1);
			expect(cleanupCb).toHaveBeenCalledTimes(1); // NOT called a second time!
			expect(h.cleanupJobs.get(job.id)?.status).toBe("skipped_stale_generation");
			expect(h.installations.get("inst-tg")?.endpointState).toBe("synced");
		});
	});

	describe("verified restore & uncertain endpoint reconciliation", () => {
		it("blocks restore while endpoint_state is uncertain until provider state is reconciled, then increments generation and requires fresh verification", async () => {
			h.seedInstallation({
				id: "inst-revoked",
				organizationId: "org-1",
				provider: "slack",
				status: "revoked",
				revokedAt: T0,
				endpointGeneration: 2,
				endpointState: "uncertain",
				activeCredentialRevisionId: null,
			});

			// Without reconciliation -> refused!
			const blocked = await beginChatInstallationRestore(
				{
					organizationId: "org-1",
					installationId: "inst-revoked",
					actorUserId: "user-admin",
				},
				h.deps,
			);
			expect(blocked).toMatchObject({
				kind: "refused",
				code: "endpoint_reconciliation_required",
			});
			expect(h.installations.get("inst-revoked")?.status).toBe("revoked");

			// With reconciliation -> reconciles endpoint_state='synced', increments generation -> 3, moves to candidate with cleared verification proofs
			const started = await beginChatInstallationRestore(
				{
					organizationId: "org-1",
					installationId: "inst-revoked",
					actorUserId: "user-admin",
				},
				{
					...h.deps,
					reconcileProviderEndpoint: async () => ({ kind: "reconciled" }),
				},
			);
			expect(started).toMatchObject({
				kind: "restore_started",
				installationId: "inst-revoked",
				endpointGeneration: 3,
				endpointState: "synced",
				requiresCredentials: true,
			});

			const restored = h.installations.get("inst-revoked")!;
			expect(restored.status).toBe("candidate");
			expect(restored.revokedAt).toBeNull();
			expect(restored.verificationState).toBe("unverified");
			expect(restored.verificationEvidence?.signedEventVerifiedAt).toBeNull();
			expect(restored.verificationEvidence?.privateDeliveryVerifiedAt).toBeNull();

			// Confirm restore refuses if endpointState is still uncertain (guard check)
			await h.repository.updateInstallation("org-1", "inst-revoked", {
				endpointState: "uncertain",
			});
			const confirmBlocked = await confirmChatInstallationRestore(
				{
					organizationId: "org-1",
					provider: "slack",
					actorUserId: "user-admin",
					candidateInstallationId: "inst-revoked",
					reviewedCurrentInstallationId: null,
					reviewedCurrentCredentialRevisionId: null,
					reviewedCandidateCredentialRevisionId: null,
					reviewedImpactDigest: "a".repeat(64),
					acknowledgeUnreadyEmployees: false,
				},
				h.deps,
			);
			expect(confirmBlocked).toMatchObject({
				kind: "refused",
				code: "endpoint_reconciliation_required",
			});
		});

		it("verifyRestoredChatInstallation rejects mismatched external identity when restoring with new Slack credentials", async () => {
			h.seedInstallation({
				id: "inst-restore",
				organizationId: "org-1",
				provider: "slack",
				status: "candidate",
				externalAppId: "A_EXPECTED",
				externalSpaceId: "T_EXPECTED",
				endpointGeneration: 3,
				endpointState: "synced",
				activeCredentialRevisionId: null,
			});

			const mismatch = await verifyRestoredChatInstallation(
				{
					organizationId: "org-1",
					installationId: "inst-restore",
					actorUserId: "user-admin",
					botToken: "xoxb-wrong-app-token",
					signingSecret: "valid_signing_secret_0123456789",
				},
				{
					...h.deps,
					verifySlackBotMetadata: async () => ({
						kind: "ok",
						identity: {
							appId: "A_OTHER",
							teamId: "T_EXPECTED",
							teamName: "Acme",
							botId: "B9",
							botUserId: "U9",
							botUsername: "wrong",
						},
					}),
				},
			);

			expect(mismatch).toMatchObject({
				kind: "refused",
				code: "external_identity_mismatch",
			});
		});
	});
});
