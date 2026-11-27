/**
 * #2046 / #2037 PostgreSQL 16 integration coverage:
 * - Full Slack mixed-version lifecycle rehearsal:
 *   legacy Slack + unrelated org isolation -> switch to org-owned Slack app ->
 *   same-identity credential rotation preserving installation, conversations, and card origin ->
 *   immediate local revocation stopping auth while pending Z8 approvals and unrelated org stay intact ->
 *   verified restore incrementing endpoint_generation and requiring fresh verification + impact review ->
 *   delayed stale endpoint cleanup job after reactivation skips mutating the live endpoint.
 * - Reference-deferred credential cleanup, secret-store outage retryability, and exhausted cleanup
 *   redacted operational diagnostics.
 * - Uncertain provider endpoint timeout requiring explicit provider reconciliation before restore.
 * - Maintenance job wiring (`runDurableChatDispatchMaintenance`).
 */

import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SecretStoreUnavailableError } from "@/lib/vault/errors";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	secrets: new Map<string, string>(),
	failDeleteForKey: null as string | null,
	failDeleteErrorMessage: "Vault sealed",
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getActiveSecretStoreProvider: () => "vault" as const,
	getOrgSecret: async (organizationId: string, key: string) =>
		harness.secrets.get(`${organizationId}:${key}`) ?? null,
	storeOrgSecret: async (organizationId: string, key: string, value: string) => {
		harness.secrets.set(`${organizationId}:${key}`, value);
	},
	deleteOrgSecret: async (organizationId: string, key: string) => {
		if (harness.failDeleteForKey && key.includes(harness.failDeleteForKey)) {
			throw new SecretStoreUnavailableError(harness.failDeleteErrorMessage, {
				provider: "vault",
				operation: "delete",
			});
		}
		harness.secrets.delete(`${organizationId}:${key}`);
	},
}));

const { db } = await import("@/db");
const {
	approvalRequest,
	chatInstallation,
	chatInstallationCleanupJob,
	chatInstallationConversation,
	chatInstallationCredentialRevision,
	chatInstallationSwitchControl,
	chatNotificationDispatchAttempt,
	chatProviderSettings,
	slackWorkspaceConfig,
} = await import("@/db/schema");
const {
	beginChatInstallationRestore,
	confirmChatInstallationRestore,
	processChatInstallationCleanupJobs,
	revokeChatInstallation,
	rotateChatInstallationCredentials,
	verifyRestoredChatInstallation,
} = await import("@/lib/chat-installations/recovery-lifecycle");
const { handleSlackInstallationEventRequest } =
	await import("@/lib/chat-installations/slack-candidate-routes");
const { buildChatSwitchImpactPreview, confirmChatInstallationSwitch } =
	await import("@/lib/chat-installations/switch-lifecycle");
const { runDurableChatDispatchMaintenance } =
	await import("@/lib/jobs/durable-chat-dispatch-maintenance");
const { instantFromDate } = await import("@/lib/datetime/temporal-core");

const ids = {
	orgA: "t2046-org-a",
	orgB: "t2046-org-b",
	adminA: "t2046-admin-a",
	empUserA: "t2046-emp-a",
	adminB: "t2046-admin-b",
	empA: "e2046000-0000-4000-8000-000000000001",
	empA2: "e2046000-0000-4000-8000-000000000002",
	empB: "e2046000-0000-4000-8000-000000000003",
	approvalReqId: "a2046000-0000-4000-8000-000000000001",
	teamA: "T2046ORGA",
	teamB: "T2046ORGB",
	appA: "A2046ORGA",
} as const;

const T0 = new Date("2026-11-26T12:00:00.000Z");

function signSlackRequest(signingSecret: string, timestamp: string, rawBody: string): string {
	const base = `v0:${timestamp}:${rawBody}`;
	return `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
}

describe("chat installation rotation, revocation, generation-fenced cleanup & restore (PostgreSQL)", () => {
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.orgA, ids.orgB],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.adminA, ids.empUserA, ids.adminB],
		]);
	}

	async function seedOrgsAndSlackLifecycle() {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'Org A 2046', $1, $3),
			 ($2, 'Org B 2046', $2, $3)`,
			[ids.orgA, ids.orgB, T0],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Admin A', 't2046-admin-a@example.test', $4, $4),
			 ($2, 'Alice A', 't2046-alice-a@example.test', $4, $4),
			 ($3, 'Admin B', 't2046-admin-b@example.test', $4, $4)`,
			[ids.adminA, ids.empUserA, ids.adminB, T0],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('m2046-admin-a', $1, $3, 'admin', 'approved', $6),
			 ('m2046-emp-a', $1, $4, 'member', 'approved', $6),
			 ('m2046-admin-b', $2, $5, 'admin', 'approved', $6)`,
			[ids.orgA, ids.orgB, ids.adminA, ids.empUserA, ids.adminB, T0],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $4, $7, 'admin', true, $9),
			 ($2, $5, $7, 'employee', true, $9),
			 ($3, $6, $8, 'admin', true, $9)`,
			[ids.empA, ids.empA2, ids.empB, ids.adminA, ids.empUserA, ids.adminB, ids.orgA, ids.orgB, T0],
		);

		// Enable switch control for Org A Slack
		await db.insert(chatInstallationSwitchControl).values({
			organizationId: ids.orgA,
			provider: "slack",
			enabledByUserId: ids.adminA,
		});

		// Legacy Slack workspace configs for BOTH Org A and unrelated Org B
		const [legacyA] = await db
			.insert(slackWorkspaceConfig)
			.values({
				organizationId: ids.orgA,
				slackTeamId: ids.teamA,
				slackTeamName: "Org A Slack",
				botAccessToken: "vault:managed",
				botUserId: "U_LEGACY_A",
				setupStatus: "active",
			})
			.returning();

		const [legacyB] = await db
			.insert(slackWorkspaceConfig)
			.values({
				organizationId: ids.orgB,
				slackTeamId: ids.teamB,
				slackTeamName: "Org B Slack",
				botAccessToken: "vault:managed",
				botUserId: "U_LEGACY_B",
				setupStatus: "active",
			})
			.returning();

		harness.secrets.set(`${ids.orgA}:slack/bot_access_token`, "xoxb-legacy-a");
		harness.secrets.set(`${ids.orgB}:slack/bot_access_token`, "xoxb-legacy-b");

		const [legacyInstA] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.orgA,
				provider: "slack",
				credentialSource: "deployment_managed",
				status: "legacy_active",
				routeId: "route-2046-legacy-a",
				externalBotId: "U_LEGACY_A",
				externalSpaceId: ids.teamA,
				externalSpaceName: "Org A Slack",
				receiverScope: `slack-team:${ids.teamA}`,
				legacyTable: "slack_workspace_config",
				legacyRecordId: legacyA.id,
				legacyStatus: "active",
			})
			.returning();

		const [legacyInstB] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.orgB,
				provider: "slack",
				credentialSource: "deployment_managed",
				status: "legacy_active",
				routeId: "route-2046-legacy-b",
				externalBotId: "U_LEGACY_B",
				externalSpaceId: ids.teamB,
				externalSpaceName: "Org B Slack",
				receiverScope: `slack-team:${ids.teamB}`,
				legacyTable: "slack_workspace_config",
				legacyRecordId: legacyB.id,
				legacyStatus: "active",
			})
			.returning();

		// Verified candidate org-owned Slack installation for Org A
		const [orgOwnedInstA] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.orgA,
				provider: "slack",
				credentialSource: "organization_owned",
				status: "candidate",
				routeId: "route-2046-org-a",
				externalAppId: ids.appA,
				externalBotId: "U_ORG_BOT_A",
				externalBotUsername: "z8-org-a",
				externalDisplayName: "Z8 Org A",
				externalSpaceId: ids.teamA,
				externalSpaceName: "Org A Slack",
				receiverScope: `slack-app:${ids.appA}:team:${ids.teamA}`,
				verificationState: "verified",
				lastVerifiedAt: T0,
			})
			.returning();

		const [rev1] = await db
			.insert(chatInstallationCredentialRevision)
			.values({
				installationId: orgOwnedInstA.id,
				organizationId: ids.orgA,
				revisionNumber: 1,
				secretStoreProvider: "vault",
				secretKeyPrefix: `chat/slack/installations/${orgOwnedInstA.id}/revisions/v1`,
				secretKeys: ["bot_token", "signing_secret"],
				status: "verified",
				verifiedAt: T0,
			})
			.returning();

		const v1SigningSecret = "v1_signing_secret_0123456789abcdef";
		harness.secrets.set(
			`${ids.orgA}:${rev1.secretKeyPrefix}/bot_token`,
			"xoxb-org-a-v1-token-111111",
		);
		harness.secrets.set(`${ids.orgA}:${rev1.secretKeyPrefix}/signing_secret`, v1SigningSecret);

		const expiresIso = new Date(T0.getTime() + 24 * 60 * 60 * 1000).toISOString();
		await db
			.update(chatInstallation)
			.set({
				activeCredentialRevisionId: rev1.id,
				verificationEvidence: {
					source: "verified_setup",
					identityVerifiedAt: T0.toISOString(),
					identityRevisionId: rev1.id,
					signedEventVerifiedAt: T0.toISOString(),
					signedEventRevisionId: rev1.id,
					signedEventType: "app_mention",
					signedEventExpiresAt: expiresIso,
					privateDeliveryVerifiedAt: T0.toISOString(),
					privateDeliveryRevisionId: rev1.id,
					privateDeliveryTargetUserId: "U_ADMIN_A",
					privateDeliveryChannelId: "D_ORG_A_ADMIN",
					privateDeliveryExpiresAt: expiresIso,
				},
			})
			.where(eq(chatInstallation.id, orgOwnedInstA.id));

		// Seed DM conversation on orgOwnedInstA to verify rotation preserves it
		const [convA] = await db
			.insert(chatInstallationConversation)
			.values({
				organizationId: ids.orgA,
				installationId: orgOwnedInstA.id,
				userId: ids.adminA,
				employeeId: ids.empA,
				externalUserId: "U_ADMIN_A",
				externalConversationId: "D_ORG_A_ADMIN",
				conversationType: "private",
				reachabilityStatus: "reachable",
				verifiedAt: T0,
				isActive: true,
			})
			.returning();

		// Seed a pending approval request for Org A to verify Z8 inbox continuity across revoke
		await db.insert(approvalRequest).values({
			id: ids.approvalReqId,
			organizationId: ids.orgA,
			entityType: "absence_entry",
			entityId: "b2046000-0000-4000-8000-000000000001",
			requestedBy: ids.empA2,
			approverId: ids.empA,
			status: "pending",
		});

		return {
			legacyA,
			legacyB,
			legacyInstA,
			legacyInstB,
			orgOwnedInstA,
			rev1,
			v1SigningSecret,
			convA,
		};
	}

	beforeEach(async () => {
		harness.secrets.clear();
		harness.failDeleteForKey = null;
		harness.failDeleteErrorMessage = "Vault sealed";
		await seedOrgsAndSlackLifecycle();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("rehearses full Slack lifecycle: switch -> same-identity rotation -> immediate revoke (isolating Org B & Z8 inbox) -> verified restore fencing delayed stale cleanup", async () => {
		const { legacyInstA, legacyInstB, orgOwnedInstA, rev1, v1SigningSecret, convA } =
			await seedOrgsAndSlackLifecycle();

		// 1. Switch Org A to its verified organization-owned Slack installation
		const preview1 = await buildChatSwitchImpactPreview(
			{ organizationId: ids.orgA, provider: "slack", candidateInstallationId: orgOwnedInstA.id },
			{ now: () => T0, syncLegacy: false },
		);
		const switched = await confirmChatInstallationSwitch(
			{
				organizationId: ids.orgA,
				provider: "slack",
				actorUserId: ids.adminA,
				candidateInstallationId: orgOwnedInstA.id,
				reviewedCurrentInstallationId: legacyInstA.id,
				reviewedCurrentCredentialRevisionId: null,
				reviewedCandidateCredentialRevisionId: rev1.id,
				reviewedImpactDigest: preview1.impactDigest,
				acknowledgeUnreadyEmployees: true,
			},
			{ now: () => T0, syncLegacy: false },
		);
		expect(switched.kind).toBe("switched");

		// 2. Same-identity rotation: mismatch rejected, matching identity writes v2 & preserves conversation
		const mismatch = await rotateChatInstallationCredentials(
			{
				organizationId: ids.orgA,
				installationId: orgOwnedInstA.id,
				actorUserId: ids.adminA,
				secrets: {
					bot_token: "xoxb-wrong-app-token-9999",
					signing_secret: "wrong_signing_secret_0123456789",
				},
			},
			{
				now: () => T0,
				verifySlackBotMetadata: async () => ({
					kind: "ok",
					identity: {
						appId: "A_DIFFERENT_APP",
						teamId: ids.teamA,
						teamName: "Org A Slack",
						botId: "B_WRONG",
						botUserId: "U_WRONG",
						botUsername: "wrong",
					},
				}),
			},
		);
		expect(mismatch).toMatchObject({ kind: "refused", code: "external_identity_mismatch" });

		const v2SigningSecret = "v2_signing_secret_fedcba9876543210";
		const rotated = await rotateChatInstallationCredentials(
			{
				organizationId: ids.orgA,
				installationId: orgOwnedInstA.id,
				actorUserId: ids.adminA,
				secrets: {
					bot_token: "xoxb-org-a-v2-token-222222",
					signing_secret: v2SigningSecret,
				},
			},
			{
				now: () => T0,
				verifySlackBotMetadata: async () => ({
					kind: "ok",
					identity: {
						appId: ids.appA,
						teamId: ids.teamA,
						teamName: "Org A Slack",
						botId: "B_A",
						botUserId: "U_ORG_BOT_A",
						botUsername: "z8-org-a",
					},
				}),
			},
		);
		expect(rotated.kind).toBe("rotated");
		if (rotated.kind !== "rotated") return;
		expect(rotated.installationId).toBe(orgOwnedInstA.id);
		expect(rotated.routeId).toBe("route-2046-org-a");
		expect(rotated.newRevisionNumber).toBe(2);

		// Conversation record on same installation stays intact!
		const [preservedConv] = await db
			.select()
			.from(chatInstallationConversation)
			.where(eq(chatInstallationConversation.id, convA.id));
		expect(preservedConv?.installationId).toBe(orgOwnedInstA.id);
		expect(preservedConv?.externalConversationId).toBe("D_ORG_A_ADMIN");

		// Inbound verification uses v2 signing secret and rejects old v1 signing secret!
		const ts = String(Math.floor(Date.now() / 1000));
		const challengeBody = JSON.stringify({ type: "url_verification", challenge: "chal-v2" });
		const rejectedV1 = await handleSlackInstallationEventRequest({
			routeId: orgOwnedInstA.routeId,
			rawBody: challengeBody,
			timestamp: ts,
			signature: signSlackRequest(v1SigningSecret, ts, challengeBody),
		});
		expect(rejectedV1.status).toBe(401);

		const acceptedV2 = await handleSlackInstallationEventRequest({
			routeId: orgOwnedInstA.routeId,
			rawBody: challengeBody,
			timestamp: ts,
			signature: signSlackRequest(v2SigningSecret, ts, challengeBody),
		});
		expect(acceptedV2).toEqual({ status: 200, body: { challenge: "chal-v2" } });

		// 3. Immediate local revocation of Org A's active installation
		const revoked = await revokeChatInstallation(
			{
				organizationId: ids.orgA,
				installationId: orgOwnedInstA.id,
				actorUserId: ids.adminA,
				reason: "incident_response",
			},
			{ now: () => T0 },
		);
		expect(revoked).toMatchObject({
			kind: "revoked",
			endpointGeneration: 1,
			queuedEndpointCleanup: true,
		});

		// Signed Slack request is IMMEDIATELY rejected locally!
		const afterRevoke = await handleSlackInstallationEventRequest({
			routeId: orgOwnedInstA.routeId,
			rawBody: challengeBody,
			timestamp: ts,
			signature: signSlackRequest(v2SigningSecret, ts, challengeBody),
		});
		expect(afterRevoke.status).toBe(403);

		// Org A active_installation_id cleared, pending approval remains untouched in Z8 inbox,
		// and unrelated Org B remains completely active & usable!
		const [settingsA] = await db
			.select()
			.from(chatProviderSettings)
			.where(
				and(
					eq(chatProviderSettings.organizationId, ids.orgA),
					eq(chatProviderSettings.provider, "slack"),
				),
			);
		expect(settingsA?.activeInstallationId).toBeNull();

		const [pendingApproval] = await db
			.select()
			.from(approvalRequest)
			.where(eq(approvalRequest.id, ids.approvalReqId));
		expect(pendingApproval?.status).toBe("pending");

		const [orgBInst] = await db
			.select()
			.from(chatInstallation)
			.where(eq(chatInstallation.id, legacyInstB.id));
		expect(orgBInst?.status).toBe("legacy_active");
		expect(harness.secrets.get(`${ids.orgB}:slack/bot_access_token`)).toBe("xoxb-legacy-b");

		// 4. Begin restore on Org A's revoked installation (generation advances 1 -> 2, fencing delayed cleanup!)
		const startedRestore = await beginChatInstallationRestore(
			{
				organizationId: ids.orgA,
				installationId: orgOwnedInstA.id,
				actorUserId: ids.adminA,
			},
			{ now: () => T0 },
		);
		expect(startedRestore).toMatchObject({
			kind: "restore_started",
			endpointGeneration: 2,
			requiresCredentials: true,
			status: "candidate",
		});

		// 5. Delayed stale provider_endpoint_cleanup job (authorizedGeneration=1) runs AFTER reactivation
		//    -> MUST SKIP cleanly and NOT invoke provider endpoint teardown!
		const endpointCleanupSpy = vi.fn(async () => ({ kind: "ok" as const }));
		const cleanupRun = await processChatInstallationCleanupJobs(
			{ now: T0, organizationId: ids.orgA },
			{ providerEndpointCleanup: endpointCleanupSpy },
		);
		expect(cleanupRun.skippedStale).toBe(1);
		expect(endpointCleanupSpy).not.toHaveBeenCalled();

		const endpointJobs = await db
			.select()
			.from(chatInstallationCleanupJob)
			.where(
				and(
					eq(chatInstallationCleanupJob.installationId, orgOwnedInstA.id),
					eq(chatInstallationCleanupJob.kind, "provider_endpoint_cleanup"),
				),
			);
		expect(endpointJobs[0]?.status).toBe("skipped_stale_generation");

		// 6. Confirming restore BEFORE fresh verification refuses!
		const unverifiedPreview = await buildChatSwitchImpactPreview(
			{ organizationId: ids.orgA, provider: "slack", candidateInstallationId: orgOwnedInstA.id },
			{ now: () => T0, syncLegacy: false },
		);
		expect(unverifiedPreview.candidateReady).toBe(false);
		const refusedEarly = await confirmChatInstallationRestore(
			{
				organizationId: ids.orgA,
				provider: "slack",
				actorUserId: ids.adminA,
				candidateInstallationId: orgOwnedInstA.id,
				reviewedCurrentInstallationId: null,
				reviewedCurrentCredentialRevisionId: null,
				reviewedCandidateCredentialRevisionId: null,
				reviewedImpactDigest: unverifiedPreview.impactDigest,
				acknowledgeUnreadyEmployees: true,
			},
			{ now: () => T0 },
		);
		expect(refusedEarly).toMatchObject({ kind: "refused", code: "candidate_not_ready" });

		// 7. Complete fresh verification: credentials v3 + signed inbound event + synthetic private DM
		const v3SigningSecret = "v3_signing_secret_0011223344556677";
		const verifiedCreds = await verifyRestoredChatInstallation(
			{
				organizationId: ids.orgA,
				installationId: orgOwnedInstA.id,
				actorUserId: ids.adminA,
				botToken: "xoxb-org-a-v3-token-333333",
				signingSecret: v3SigningSecret,
				slackUserId: "U01234567A",
			},
			{
				now: () => T0,
				verifySlackBotMetadata: async () => ({
					kind: "ok",
					identity: {
						appId: ids.appA,
						teamId: ids.teamA,
						teamName: "Org A Slack",
						botId: "B_A",
						botUserId: "U_ORG_BOT_A",
						botUsername: "z8-org-a",
					},
				}),
				sendPrivateDm: async () => ({
					kind: "ok",
					channelId: "D_ORG_A_ADMIN",
					messageTs: "1732622400.000200",
				}),
			},
		);
		expect(verifiedCreds.kind).toBe("verified_step");
		if (verifiedCreds.kind !== "verified_step") return;
		expect(verifiedCreds.readyForSwitch).toBe(false); // Still needs fresh signed inbound event!

		const signedEventBody = JSON.stringify({
			type: "event_callback",
			team_id: ids.teamA,
			api_app_id: ids.appA,
			event: { type: "app_mention", user: "U_ADMIN_A", channel: "D_ORG_A_ADMIN", text: "verify" },
		});
		const inboundProof = await handleSlackInstallationEventRequest(
			{
				routeId: orgOwnedInstA.routeId,
				rawBody: signedEventBody,
				timestamp: ts,
				signature: signSlackRequest(v3SigningSecret, ts, signedEventBody),
			},
			{ now: () => T0 },
		);
		expect(inboundProof.status).toBe(200);

		// Fresh impact review & restore confirmation succeeds!
		const freshPreview = await buildChatSwitchImpactPreview(
			{ organizationId: ids.orgA, provider: "slack", candidateInstallationId: orgOwnedInstA.id },
			{ now: () => T0, syncLegacy: false },
		);
		expect(freshPreview.candidateReady).toBe(true);

		const restoredConfirm = await confirmChatInstallationRestore(
			{
				organizationId: ids.orgA,
				provider: "slack",
				actorUserId: ids.adminA,
				candidateInstallationId: orgOwnedInstA.id,
				reviewedCurrentInstallationId: freshPreview.primaryCurrentInstallationId,
				reviewedCurrentCredentialRevisionId: freshPreview.primaryCurrentCredentialRevisionId,
				reviewedCandidateCredentialRevisionId: verifiedCreds.activeCredentialRevisionId,
				reviewedImpactDigest: freshPreview.impactDigest,
				acknowledgeUnreadyEmployees: true,
			},
			{ now: () => T0 },
		);
		expect(restoredConfirm.kind).toBe("switched");

		const [restoredRow] = await db
			.select()
			.from(chatInstallation)
			.where(eq(chatInstallation.id, orgOwnedInstA.id));
		expect(restoredRow?.status).toBe("active");
		expect(restoredRow?.endpointGeneration).toBe(2);
	});

	it("defers referenced revision cleanup, retries across secret-store outages with redacted exhaustion diagnostics, and blocks restore on uncertain endpoint until reconciled", async () => {
		const { orgOwnedInstA, rev1 } = await seedOrgsAndSlackLifecycle();

		// Activate orgOwnedInstA and rotate to create an unreferenced superseded rev1
		await db
			.update(chatInstallation)
			.set({ status: "active", endpointGeneration: 1 })
			.where(eq(chatInstallation.id, orgOwnedInstA.id));

		const rotated = await rotateChatInstallationCredentials(
			{
				organizationId: ids.orgA,
				installationId: orgOwnedInstA.id,
				actorUserId: ids.adminA,
				secrets: {
					bot_token: "xoxb-org-a-v2-token-222222",
					signing_secret: "v2_signing_secret_0123456789abcdef",
				},
			},
			{
				now: () => T0,
				verifySlackBotMetadata: async () => ({
					kind: "ok",
					identity: {
						appId: ids.appA,
						teamId: ids.teamA,
						teamName: "Org A Slack",
						botId: "B_A",
						botUserId: "U_ORG_BOT_A",
						botUsername: "z8-org-a",
					},
				}),
			},
		);
		expect(rotated.kind).toBe("rotated");
		if (rotated.kind !== "rotated") return;

		// Reference rev1 via an in-flight durable chat dispatch attempt
		const [dispatchRow] = await db
			.insert(chatNotificationDispatchAttempt)
			.values({
				organizationId: ids.orgA,
				provider: "slack",
				sourceKind: "persistent_notification",
				sourceRefId: "notif-2046-1",
				dedupeKey: "dedupe-2046-1",
				installationId: orgOwnedInstA.id,
				credentialRevisionId: rev1.id,
				status: "intent_recorded",
			})
			.returning();

		// Lower maxAttempts on the queued cleanup job to 2 for deterministic exhaustion test
		await db
			.update(chatInstallationCleanupJob)
			.set({ maxAttempts: 2 })
			.where(eq(chatInstallationCleanupJob.id, rotated.queuedCleanupJobId!));

		// 1. Referenced -> deferred (rev1 secret still in Vault!)
		const deferred = await processChatInstallationCleanupJobs({
			now: T0,
			organizationId: ids.orgA,
		});
		expect(deferred.deferredReferenced).toBe(1);
		expect(harness.secrets.has(`${ids.orgA}:${rev1.secretKeyPrefix}/bot_token`)).toBe(true);

		// 2. Unreference rev1 and inject Vault outage containing raw secret in error message
		await db
			.update(chatNotificationDispatchAttempt)
			.set({ status: "sent", completedAt: T0 })
			.where(eq(chatNotificationDispatchAttempt.id, dispatchRow.id));

		harness.failDeleteForKey = "/revisions/v1/";
		harness.failDeleteErrorMessage = "Vault unavailable for xoxb-org-a-v1-token-111111";

		const opsAlerts: Array<{ message: string; context: Record<string, unknown> }> = [];
		const t1 = new Date(T0.getTime() + 10 * 60_000);
		const retry1 = await processChatInstallationCleanupJobs(
			{ now: t1, organizationId: ids.orgA },
			{ reportOpsAlert: (message, context) => opsAlerts.push({ message, context }) },
		);
		expect(retry1.retried).toBe(1);

		const t2 = new Date(t1.getTime() + 10 * 60_000);
		const exhausted = await processChatInstallationCleanupJobs(
			{ now: t2, organizationId: ids.orgA },
			{ reportOpsAlert: (message, context) => opsAlerts.push({ message, context }) },
		);
		expect(exhausted.exhausted).toBe(1);
		expect(opsAlerts).toHaveLength(1);
		expect(JSON.stringify(opsAlerts[0])).not.toContain("xoxb-org-a-v1-token-111111");

		const [jobRow] = await db
			.select()
			.from(chatInstallationCleanupJob)
			.where(eq(chatInstallationCleanupJob.id, rotated.queuedCleanupJobId!));
		expect(jobRow?.status).toBe("exhausted");
		expect(JSON.stringify(jobRow?.redactedDiagnostics)).not.toContain("xoxb-org-a-v1-token-111111");

		// 3. Revoke, simulate provider endpoint timeout -> endpoint_state='uncertain' -> restore blocked until reconciled
		await revokeChatInstallation(
			{ organizationId: ids.orgA, installationId: orgOwnedInstA.id, actorUserId: ids.adminA },
			{ now: () => t2 },
		);

		// Restore Vault availability so credential cleanup completes through maintenance cron too
		harness.failDeleteForKey = null;

		const timeoutRun = await processChatInstallationCleanupJobs(
			{ now: t2, organizationId: ids.orgA },
			{
				providerEndpointCleanup: async () => ({
					kind: "timeout_uncertain",
					errorCode: "provider_timeout",
				}),
			},
		);
		expect(timeoutRun.retried).toBeGreaterThanOrEqual(1);

		const [uncertainInst] = await db
			.select()
			.from(chatInstallation)
			.where(eq(chatInstallation.id, orgOwnedInstA.id));
		expect(uncertainInst?.endpointState).toBe("uncertain");

		// Restore without reconciliation refuses
		const blockedRestore = await beginChatInstallationRestore(
			{ organizationId: ids.orgA, installationId: orgOwnedInstA.id, actorUserId: ids.adminA },
			{ now: () => t2 },
		);
		expect(blockedRestore).toMatchObject({
			kind: "refused",
			code: "endpoint_reconciliation_required",
		});

		// Reconcile endpoint and verify maintenance job runs cleanly
		const reconciledRestore = await beginChatInstallationRestore(
			{ organizationId: ids.orgA, installationId: orgOwnedInstA.id, actorUserId: ids.adminA },
			{
				now: () => t2,
				reconcileProviderEndpoint: async () => ({ kind: "reconciled" }),
			},
		);
		expect(reconciledRestore).toMatchObject({
			kind: "restore_started",
			endpointState: "synced",
		});

		const maintenanceResult = await runDurableChatDispatchMaintenance({
			clock: {
				nowInstant: () => instantFromDate(new Date(t2.getTime() + 60 * 60_000)),
			},
			organizationId: ids.orgA,
		});
		expect(maintenanceResult.cleanupJobs.skippedStale).toBeGreaterThanOrEqual(1);
	});
});
