import { describe, expect, it, vi } from "vitest";
import { SecretStoreUnavailableError } from "@/lib/vault/errors";
import type {
	CredentialRevisionRecord,
	CredentialRevisionRepository,
} from "./credential-revisions";
import {
	buildDiscordInteractionEndpointUrl,
	computeDiscordCandidateSetupStatus,
	configureDiscordCandidateCredentials,
	DISCORD_VERIFICATION_FRESHNESS_MS,
	type DiscordCandidateInstallationRecord,
	type DiscordSetupRepository,
	type DiscordSetupRuntimeDeps,
	prepareDiscordCandidateInstallation,
	retryDiscordCandidateCommandRegistration,
	sendDiscordCandidatePrivateTestMessage,
} from "./discord-setup";

const VALID_APP_ID = "123456789012345678";
const VALID_PUBLIC_KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const VALID_BOT_TOKEN = "MTIzNDU2Nzg5MDEyMzQ1Njc4.mock.discord-bot-token";
const ADMIN_DISCORD_USER_ID = "987654321098765432";

function createInMemoryHarness() {
	const installations = new Map<string, DiscordCandidateInstallationRecord>();
	const revisions = new Map<string, CredentialRevisionRecord>();
	const secrets = new Map<string, string>();
	const claims = new Map<string, { claimId: string; organizationId: string }>();
	const conversations: Array<Record<string, unknown>> = [];
	const audits: Array<{ action: string; metadata: Record<string, unknown> }> = [];
	let revSeq = 0;

	const repository: DiscordSetupRepository = {
		async findCandidateByOrg(organizationId) {
			for (const row of installations.values()) {
				if (row.organizationId === organizationId && row.status === "candidate") {
					return row;
				}
			}
			return null;
		},
		async findInstallationById(organizationId, installationId) {
			const row = installations.get(installationId);
			return row && row.organizationId === organizationId ? row : null;
		},
		async findCandidateById(organizationId, installationId) {
			const row = installations.get(installationId);
			return row && row.organizationId === organizationId && row.status === "candidate"
				? row
				: null;
		},
		async findInstallationByRouteId(routeId) {
			for (const row of installations.values()) {
				if (row.routeId === routeId) return row;
			}
			return null;
		},
		async insertCandidate({ organizationId, routeId, createdByUserId }) {
			const now = new Date("2026-11-26T12:00:00.000Z");
			const row: DiscordCandidateInstallationRecord = {
				id: `00000000-0000-4000-8000-${String(installations.size + 1).padStart(12, "0")}`,
				organizationId,
				provider: "discord",
				credentialSource: "organization_owned",
				status: "candidate",
				routeId,
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
				createdByUserId,
				createdAt: now,
				updatedAt: now,
			};
			installations.set(row.id, row);
			return row;
		},
		async updateInstallation(organizationId, installationId, patch) {
			const existing = installations.get(installationId);
			if (!existing || existing.organizationId !== organizationId) {
				throw new Error("not found");
			}
			const updated = { ...existing, ...patch, updatedAt: new Date("2026-11-26T12:01:00.000Z") };
			installations.set(installationId, updated);
			return updated;
		},
		async acquireClaim({ organizationId, claimKind, externalId }) {
			const key = `${claimKind}:${externalId}`;
			const existing = claims.get(key);
			if (existing && existing.organizationId !== organizationId) {
				return { kind: "conflict" };
			}
			if (existing) {
				return { kind: "acquired", claimId: existing.claimId };
			}
			const claimId = `claim-${claims.size + 1}`;
			claims.set(key, { claimId, organizationId });
			return { kind: "acquired", claimId };
		},
		async upsertCandidateConversation(input) {
			conversations.push(input);
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
			revSeq += 1;
			const record: CredentialRevisionRecord = {
				id: `10000000-0000-4000-8000-${String(revSeq).padStart(12, "0")}`,
				organizationId: input.organizationId,
				installationId: input.installationId,
				revisionNumber: input.revisionNumber,
				secretStoreProvider: input.secretStoreProvider,
				secretKeyPrefix: input.secretKeyPrefix,
				secretKeys: input.secretKeys,
				status: input.status,
				externalIdentityFingerprint: input.externalIdentityFingerprint,
				verifiedAt: input.verifiedAt,
				revokedAt: null,
				createdByUserId: input.createdByUserId,
				createdAt: new Date("2026-11-26T12:00:00.000Z"),
			};
			revisions.set(record.id, record);
			return record;
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
			return inst && inst.organizationId === organizationId
				? inst.activeCredentialRevisionId
				: null;
		},
		async updateRevisionStatus(organizationId, installationId, revisionId, status) {
			const rev = revisions.get(revisionId);
			if (rev && rev.organizationId === organizationId && rev.installationId === installationId) {
				revisions.set(revisionId, { ...rev, status });
			}
		},
	};

	const baseDeps: DiscordSetupRuntimeDeps = {
		repository,
		revisionRepository,
		secretStoreProvider: "vault",
		appUrl: "https://z8.example.test",
		now: () => new Date("2026-11-26T12:00:00.000Z"),
		storeSecret: async (orgId, key, value) => {
			secrets.set(`${orgId}:${key}`, value);
		},
		readSecret: async (orgId, key) => secrets.get(`${orgId}:${key}`) ?? null,
		deleteSecret: async (orgId, key) => {
			secrets.delete(`${orgId}:${key}`);
		},
		verifyBotApplication: vi.fn(async () => ({
			kind: "ok" as const,
			application: {
				id: VALID_APP_ID,
				name: "Acme Z8 Discord Bot",
				verifyKey: VALID_PUBLIC_KEY,
			},
		})),
		registerSlashCommands: vi.fn(async () => true),
		sendPrivateDm: vi.fn(async () => ({
			kind: "ok" as const,
			channelId: "555555555555555555",
			messageId: "666666666666666666",
		})),
		recordAudit: async (event) => {
			audits.push({ action: event.action, metadata: event.metadata });
		},
	};

	return {
		installations,
		revisions,
		secrets,
		claims,
		conversations,
		audits,
		baseDeps,
	};
}

describe("discord candidate setup lifecycle", () => {
	it("prepares an installation-scoped Discord interaction endpoint URL", async () => {
		const h = createInMemoryHarness();
		const prepared = await prepareDiscordCandidateInstallation(
			{ organizationId: "org-1", actorUserId: "admin-1" },
			h.baseDeps,
		);

		expect(prepared.interactionEndpointUrl).toBe(
			buildDiscordInteractionEndpointUrl(prepared.routeId, "https://z8.example.test"),
		);
		expect(prepared.interactionEndpointUrl).toBe(
			`https://z8.example.test/api/discord/installations/${prepared.routeId}/interactions`,
		);
		expect(prepared.readyForSwitch).toBe(false);
		expect(prepared.steps.applicationIdentity.status).toBe("pending");
		expect(prepared.steps.signedInteractionEndpoint.status).toBe("pending");
		expect(prepared.steps.commandRegistration.status).toBe("pending");
		expect(prepared.steps.privateDmDelivery.status).toBe("pending");
	});

	it("tracks command registration failure separately and allows explicit retry without re-entering credentials", async () => {
		const h = createInMemoryHarness();
		const registerMock = vi
			.fn<() => Promise<boolean>>()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const deps = { ...h.baseDeps, registerSlashCommands: registerMock };

		const prepared = await prepareDiscordCandidateInstallation(
			{ organizationId: "org-1", actorUserId: "admin-1" },
			deps,
		);

		const configured = await configureDiscordCandidateCredentials(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: VALID_BOT_TOKEN,
				applicationId: VALID_APP_ID,
				publicKey: VALID_PUBLIC_KEY,
			},
			deps,
		);

		expect(configured.kind).toBe("ok");
		if (configured.kind !== "ok") return;
		expect(configured.view.steps.applicationIdentity.status).toBe("passed");
		expect(configured.view.steps.commandRegistration.status).toBe("failed");
		expect(configured.view.steps.commandRegistration.canRetry).toBe(true);
		expect(configured.view.hasStoredCredentials).toBe(true);
		expect(configured.view.readyForSwitch).toBe(false);

		const retried = await retryDiscordCandidateCommandRegistration(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
			},
			deps,
		);

		expect(retried.kind).toBe("ok");
		if (retried.kind !== "ok") return;
		expect(retried.view.steps.commandRegistration.status).toBe("passed");
		expect(retried.view.steps.applicationIdentity.status).toBe("passed");
		expect(registerMock).toHaveBeenCalledTimes(2);
	});

	it("blocks cross-organization Discord application claims while allowing same-org staging", async () => {
		const h = createInMemoryHarness();
		h.claims.set(`bot:${VALID_APP_ID}`, { claimId: "claim-other", organizationId: "org-other" });

		const prepared = await prepareDiscordCandidateInstallation(
			{ organizationId: "org-1", actorUserId: "admin-1" },
			h.baseDeps,
		);

		const result = await configureDiscordCandidateCredentials(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: VALID_BOT_TOKEN,
				applicationId: VALID_APP_ID,
				publicKey: VALID_PUBLIC_KEY,
			},
			h.baseDeps,
		);

		expect(result.kind).toBe("error");
		if (result.kind !== "error") return;
		expect(result.code).toBe("app_claimed_by_other_org");
	});

	it("never marks candidate ready from a signed PING alone — requires fresh private DM delivery", () => {
		const now = new Date("2026-11-26T12:00:00.000Z");
		const revId = "10000000-0000-4000-8000-000000000001";
		const statusOnlyPing = computeDiscordCandidateSetupStatus(
			{
				activeCredentialRevisionId: revId,
				externalAppId: VALID_APP_ID,
				externalDisplayName: "Acme Bot",
				verificationEvidence: {
					source: "verified_setup",
					identityVerifiedAt: now.toISOString(),
					identityRevisionId: revId,
					signedEventVerifiedAt: now.toISOString(),
					signedEventRevisionId: revId,
					signedEventType: "PING",
					signedEventExpiresAt: new Date(
						now.getTime() + DISCORD_VERIFICATION_FRESHNESS_MS,
					).toISOString(),
					commandsRegistrationStatus: "registered",
					commandsRegisteredAt: now.toISOString(),
					commandsRegisteredRevisionId: revId,
				},
			},
			now,
		);

		expect(statusOnlyPing.steps.applicationIdentity.status).toBe("passed");
		expect(statusOnlyPing.steps.signedInteractionEndpoint.status).toBe("passed");
		expect(statusOnlyPing.steps.commandRegistration.status).toBe("passed");
		expect(statusOnlyPing.steps.privateDmDelivery.status).toBe("pending");
		expect(statusOnlyPing.readyForSwitch).toBe(false);
		expect(statusOnlyPing.effectiveVerificationState).toBe("pending");
	});

	it("classifies Discord 50007 blocked DMs with actionable recovery hint and records action_needed conversation", async () => {
		const h = createInMemoryHarness();
		const deps: DiscordSetupRuntimeDeps = {
			...h.baseDeps,
			sendPrivateDm: vi.fn(async () => ({
				kind: "failed" as const,
				code: "discord_dm_blocked_50007" as const,
				recoveryHint: "discord_enable_server_dms" as const,
				isPrivacyOrPrerequisiteBlock: true,
				channelId: "555555555555555555",
				message: "Discord blocked this direct message (error 50007).",
			})),
		};

		const prepared = await prepareDiscordCandidateInstallation(
			{ organizationId: "org-1", actorUserId: "admin-1" },
			deps,
		);
		await configureDiscordCandidateCredentials(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: VALID_BOT_TOKEN,
				applicationId: VALID_APP_ID,
				publicKey: VALID_PUBLIC_KEY,
			},
			deps,
		);

		const dmResult = await sendDiscordCandidatePrivateTestMessage(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				discordUserId: ADMIN_DISCORD_USER_ID,
			},
			deps,
		);

		expect(dmResult.kind).toBe("error");
		if (dmResult.kind !== "error") return;
		expect(dmResult.code).toBe("discord_dm_blocked_50007");
		expect(dmResult.recoveryHint).toBe("discord_enable_server_dms");
		expect(h.conversations).toHaveLength(1);
		expect(h.conversations[0]).toMatchObject({
			reachabilityStatus: "action_needed",
			reachabilityReason: "discord_dm_blocked_50007",
		});
	});

	it("distinguishes secret store outage during credential save without losing existing state", async () => {
		const h = createInMemoryHarness();
		const deps: DiscordSetupRuntimeDeps = {
			...h.baseDeps,
			storeSecret: async () => {
				throw new SecretStoreUnavailableError("Vault sealed", {
					provider: "vault",
					operation: "store",
				});
			},
		};

		const prepared = await prepareDiscordCandidateInstallation(
			{ organizationId: "org-1", actorUserId: "admin-1" },
			deps,
		);
		const result = await configureDiscordCandidateCredentials(
			{
				organizationId: "org-1",
				actorUserId: "admin-1",
				installationId: prepared.installationId,
				botToken: VALID_BOT_TOKEN,
				applicationId: VALID_APP_ID,
				publicKey: VALID_PUBLIC_KEY,
			},
			deps,
		);

		expect(result.kind).toBe("error");
		if (result.kind !== "error") return;
		expect(result.code).toBe("secret_store_unavailable");
	});
});
