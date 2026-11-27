import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SecretStoreUnavailableError } from "@/lib/vault/errors";
import type {
	CredentialRevisionRecord,
	CredentialRevisionRepository,
} from "./credential-revisions";
import {
	type DiscordInstallationRouteDeps,
	handleDiscordInstallationInteractionRequest,
} from "./discord-installation-routes";
import type { DiscordCandidateInstallationRecord, DiscordSetupRepository } from "./discord-setup";

const APP_ID = "123456789012345678";
const OTHER_APP_ID = "999999999999999999";

function createKeyPair() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const spkiDer = publicKey.export({ type: "spki", format: "der" });
	return {
		publicKeyHex: spkiDer.subarray(spkiDer.length - 32).toString("hex"),
		privateKey,
	};
}

function signBody(
	privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
	timestamp: string,
	rawBody: string,
): string {
	return sign(null, Buffer.from(`${timestamp}${rawBody}`, "utf8"), privateKey).toString("hex");
}

function createRouteHarness(
	overrides?: Partial<DiscordCandidateInstallationRecord>,
	secretOverride?: { unavailable?: boolean },
) {
	const pair = createKeyPair();
	const now = new Date("2026-11-26T12:00:00.000Z");
	const revId = "10000000-0000-4000-8000-000000000001";
	let record: DiscordCandidateInstallationRecord = {
		id: "20000000-0000-4000-8000-000000000001",
		organizationId: "org-1",
		provider: "discord",
		credentialSource: "organization_owned",
		status: "candidate",
		routeId: "route-discord-1",
		externalAppId: APP_ID,
		externalBotId: APP_ID,
		externalBotUsername: null,
		externalDisplayName: "Acme Bot",
		externalSpaceId: null,
		externalSpaceName: null,
		receiverScope: `discord-app:${APP_ID}`,
		spaceClaimId: null,
		botClaimId: "claim-1",
		activeCredentialRevisionId: revId,
		verificationState: "pending",
		verificationEvidence: {
			source: "verified_setup",
			identityVerifiedAt: now.toISOString(),
			identityRevisionId: revId,
		},
		lastVerifiedAt: null,
		retirementDeadlineAt: null,
		retiredAt: null,
		revokedAt: null,
		endpointGeneration: 0,
		createdByUserId: "admin-1",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};

	const revision: CredentialRevisionRecord = {
		id: revId,
		organizationId: record.organizationId,
		installationId: record.id,
		revisionNumber: 1,
		secretStoreProvider: "vault",
		secretKeyPrefix: `chat/discord/${record.id}/rev-1`,
		secretKeys: ["bot_token", "public_key"],
		status: "verified",
		externalIdentityFingerprint: `discord:${APP_ID}`,
		verifiedAt: now,
		revokedAt: null,
		createdByUserId: "admin-1",
		createdAt: now,
	};

	const repository: DiscordSetupRepository = {
		findCandidateByOrg: async () => (record.status === "candidate" ? record : null),
		findCandidateById: async (_orgId, id) =>
			record.id === id && record.status === "candidate" ? record : null,
		findInstallationById: async (_orgId, id) => (record.id === id ? record : null),
		findInstallationByRouteId: async (routeId) => (record.routeId === routeId ? record : null),
		insertCandidate: async () => record,
		updateInstallation: async (_orgId, _id, patch) => {
			record = { ...record, ...patch };
			return record;
		},
		acquireClaim: async () => ({ kind: "acquired", claimId: "claim-1" }),
		upsertCandidateConversation: async () => undefined,
		getRevisionNumber: async () => 1,
	};

	const revisionRepository: CredentialRevisionRepository = {
		getLatestRevisionNumber: async () => 1,
		insertRevision: async () => revision,
		findRevision: async () => revision,
		getActiveRevisionId: async () => record.activeCredentialRevisionId,
		updateRevisionStatus: async () => undefined,
	};

	const activeHandler = vi.fn(async () => undefined);
	const redeemCandidateLink = vi.fn(async () => ({
		status: "linked_verified" as const,
		userId: "user-1",
		employeeId: "emp-1",
		channelId: "dm-channel-1",
	}));

	const deps: DiscordInstallationRouteDeps = {
		repository,
		revisionRepository,
		now: () => now,
		readSecret: async (_orgId, key) => {
			if (secretOverride?.unavailable) {
				throw new SecretStoreUnavailableError("Vault unavailable", {
					provider: "vault",
					operation: "get",
				});
			}
			if (key.endsWith("/bot_token")) return "mock-bot-token";
			if (key.endsWith("/public_key")) return pair.publicKeyHex;
			return null;
		},
		loadEffectiveSettings: async () => ({
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: true,
			digestTime: "08:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		}),
		handleActiveInteraction: activeHandler,
		redeemMemberLinkCode: redeemCandidateLink,
	};

	return {
		pair,
		getRecord: () => record,
		deps,
		activeHandler,
		redeemCandidateLink,
	};
}

describe("Discord installation-scoped interactions route", () => {
	it("verifies Ed25519 signature, responds { type: 1 } to candidate PING, and records proof without marking ready", async () => {
		const h = createRouteHarness({ status: "candidate" });
		const rawBody = JSON.stringify({ id: "i-1", application_id: APP_ID, type: 1, token: "t" });
		const timestamp = "1732620000";

		const res = await handleDiscordInstallationInteractionRequest(
			{
				routeId: "route-discord-1",
				rawBody,
				timestamp,
				signature: signBody(h.pair.privateKey, timestamp, rawBody),
			},
			h.deps,
		);

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ type: 1 });
		expect(h.getRecord().verificationEvidence?.signedEventType).toBe("PING");
		expect(h.getRecord().verificationState).toBe("pending");
		expect(h.activeHandler).not.toHaveBeenCalled();
	});

	it("returns 503 on secret-store outage, 401 on invalid signature, and 403 on application_id mismatch", async () => {
		const rawBody = JSON.stringify({ id: "i-1", application_id: APP_ID, type: 1, token: "t" });
		const timestamp = "1732620000";

		const outage = createRouteHarness({}, { unavailable: true });
		const res503 = await handleDiscordInstallationInteractionRequest(
			{
				routeId: "route-discord-1",
				rawBody,
				timestamp,
				signature: signBody(outage.pair.privateKey, timestamp, rawBody),
			},
			outage.deps,
		);
		expect(res503.status).toBe(503);

		const badSig = createRouteHarness();
		const res401 = await handleDiscordInstallationInteractionRequest(
			{
				routeId: "route-discord-1",
				rawBody,
				timestamp,
				signature: "0".repeat(128),
			},
			badSig.deps,
		);
		expect(res401.status).toBe(401);

		const wrongApp = createRouteHarness();
		const wrongAppBody = JSON.stringify({
			id: "i-2",
			application_id: OTHER_APP_ID,
			type: 1,
			token: "t",
		});
		const res403 = await handleDiscordInstallationInteractionRequest(
			{
				routeId: "route-discord-1",
				rawBody: wrongAppBody,
				timestamp,
				signature: signBody(wrongApp.pair.privateKey, timestamp, wrongAppBody),
			},
			wrongApp.deps,
		);
		expect(res403.status).toBe(403);
	});

	it("allows candidate enrollment /link redemption while blocking production commands and approval buttons", async () => {
		const h = createRouteHarness({ status: "candidate" });
		const timestamp = "1732620000";

		// Candidate /link enrollment proof succeeds ephemerally
		const linkBody = JSON.stringify({
			id: "i-link",
			application_id: APP_ID,
			type: 2,
			token: "tok",
			user: { id: "888888888888888888", username: "alice" },
			data: { name: "link", options: [{ name: "code", type: 3, value: "ABCD-EFGH-JKLM" }] },
		});
		const linkRes = await handleDiscordInstallationInteractionRequest(
			{
				routeId: "route-discord-1",
				rawBody: linkBody,
				timestamp,
				signature: signBody(h.pair.privateKey, timestamp, linkBody),
			},
			h.deps,
		);
		expect(linkRes.status).toBe(200);
		expect(h.redeemCandidateLink).toHaveBeenCalledWith(
			expect.objectContaining({
				purpose: "candidate_enrollment",
				code: "ABCD-EFGH-JKLM",
				discordUserId: "888888888888888888",
			}),
		);
		expect(h.activeHandler).not.toHaveBeenCalled();

		// Production command blocked on candidate
		const cmdBody = JSON.stringify({
			id: "i-cmd",
			application_id: APP_ID,
			type: 2,
			token: "tok",
			user: { id: "888888888888888888", username: "alice" },
			data: { name: "pending" },
		});
		const cmdRes = await handleDiscordInstallationInteractionRequest(
			{
				routeId: "route-discord-1",
				rawBody: cmdBody,
				timestamp,
				signature: signBody(h.pair.privateKey, timestamp, cmdBody),
			},
			h.deps,
		);
		expect(cmdRes.status).toBe(403);
		expect(h.activeHandler).not.toHaveBeenCalled();

		// Approval button blocked on candidate
		const btnBody = JSON.stringify({
			id: "i-btn",
			application_id: APP_ID,
			type: 3,
			token: "tok",
			user: { id: "888888888888888888", username: "alice" },
			data: { custom_id: JSON.stringify({ a: "ba", b: "binding-1" }) },
		});
		const btnRes = await handleDiscordInstallationInteractionRequest(
			{
				routeId: "route-discord-1",
				rawBody: btnBody,
				timestamp,
				signature: signBody(h.pair.privateKey, timestamp, btnBody),
			},
			h.deps,
		);
		expect(btnRes.status).toBe(403);
		expect(h.activeHandler).not.toHaveBeenCalled();
	});

	it("routes retiring approval card buttons while refusing retiring slash commands, and immediately refuses revoked/retired", async () => {
		const timestamp = "1732620000";
		const retiring = createRouteHarness({
			status: "retiring",
			retirementDeadlineAt: new Date("2026-12-26T12:00:00.000Z"),
		});

		const btnBody = JSON.stringify({
			id: "i-ret-btn",
			application_id: APP_ID,
			type: 3,
			token: "tok",
			user: { id: "888888888888888888", username: "alice" },
			data: { custom_id: JSON.stringify({ a: "ba", b: "binding-1" }) },
		});
		const btnRes = await handleDiscordInstallationInteractionRequest(
			{
				routeId: "route-discord-1",
				rawBody: btnBody,
				timestamp,
				signature: signBody(retiring.pair.privateKey, timestamp, btnBody),
			},
			retiring.deps,
		);
		expect(btnRes.status).toBe(202);
		expect(retiring.activeHandler).toHaveBeenCalledTimes(1);

		const cmdBody = JSON.stringify({
			id: "i-ret-cmd",
			application_id: APP_ID,
			type: 2,
			token: "tok",
			user: { id: "888888888888888888", username: "alice" },
			data: { name: "pending" },
		});
		const cmdRes = await handleDiscordInstallationInteractionRequest(
			{
				routeId: "route-discord-1",
				rawBody: cmdBody,
				timestamp,
				signature: signBody(retiring.pair.privateKey, timestamp, cmdBody),
			},
			retiring.deps,
		);
		expect(cmdRes.status).toBe(200);
		expect(cmdRes.body).toMatchObject({ type: 4, data: { flags: 64 } });
		expect(retiring.activeHandler).toHaveBeenCalledTimes(1);

		// Revoked refuses immediately
		const revoked = createRouteHarness({
			status: "revoked",
			revokedAt: new Date("2026-11-26T11:00:00.000Z"),
		});
		const revokedRes = await handleDiscordInstallationInteractionRequest(
			{
				routeId: "route-discord-1",
				rawBody: btnBody,
				timestamp,
				signature: signBody(revoked.pair.privateKey, timestamp, btnBody),
			},
			revoked.deps,
		);
		expect(revokedRes.status).toBe(403);
	});
});
