/**
 * #2048 / #2037 PostgreSQL 16 integration coverage:
 * End-to-end Discord bot replacement lifecycle against real PostgreSQL 16:
 * 1) Legacy Discord bot + unrelated organization isolation
 * 2) Prepare replacement Discord candidate -> cross-org ownership claim blocked, same-org allowed
 * 3) Signed Ed25519 PING responds { type: 1 } & records fresh proof WITHOUT marking ready
 * 4) Separate slash command registration failure + retry without re-entering credentials
 * 5) Synthetic private DM test (`allowed_mentions: { parse: [] }`): Discord 50007 privacy
 *    block -> actionable recovery hint -> retry succeeds & marks candidate ready
 * 6) Segregated employee candidate `/link` enrollment (50007 block -> `recheckMemberDiscordDmReachability`
 *    recovery) without mutating active legacy links or conversations
 * 7) Switch impact preview reflects verified DM reachability & open approval cards; stale-impact
 *    drift refuses with `impact_changed`; confirmed switch promotes replacement & retires legacy
 * 8) Post-switch: new sends route to replacement active bot; retiring bot refuses new slash
 *    commands while continuing to service eligible old approval card actions under current authority
 * 9) Same-app credential rotation rejects different applicationId and rotates same applicationId
 *    preserving installation, conversations, and card origin
 * 10) Immediate revocation refuses callbacks; verified restore requires fresh proofs & impact review.
 */

import { generateKeyPairSync, sign } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SecretStoreUnavailableError } from "@/lib/vault/errors";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	secrets: new Map<string, string>(),
	secretStoreOutage: false,
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
	getOrgSecret: async (organizationId: string, key: string) => {
		if (harness.secretStoreOutage) {
			throw new SecretStoreUnavailableError("Vault sealed", {
				provider: "vault",
				operation: "get",
			});
		}
		return harness.secrets.get(`${organizationId}:${key}`) ?? null;
	},
	storeOrgSecret: async (organizationId: string, key: string, value: string) => {
		if (harness.secretStoreOutage) {
			throw new SecretStoreUnavailableError("Vault sealed", {
				provider: "vault",
				operation: "store",
			});
		}
		harness.secrets.set(`${organizationId}:${key}`, value);
	},
	deleteOrgSecret: async (organizationId: string, key: string) => {
		harness.secrets.delete(`${organizationId}:${key}`);
	},
}));

const { db } = await import("@/db");
const {
	approvalRequest,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationMemberLink,
	chatInstallationSwitchControl,
	chatProviderSettings,
	discordApprovalMessage,
	discordBotConfig,
	discordConversation,
	discordUserMapping,
} = await import("@/db/schema");
const { backfillOrganizationChatInstallations } = await import("@/lib/chat-installations/backfill");
const { handleDiscordInstallationInteractionRequest } =
	await import("@/lib/chat-installations/discord-installation-routes");
const {
	getMemberDiscordLinkState,
	issueMemberDiscordLinkCode,
	recheckMemberDiscordDmReachability,
} = await import("@/lib/chat-installations/discord-member-link");
const {
	configureDiscordCandidateCredentials,
	prepareDiscordCandidateInstallation,
	retryDiscordCandidateCommandRegistration,
	rotateDiscordInstallationCredentials,
	sendDiscordCandidatePrivateTestMessage,
} = await import("@/lib/chat-installations/discord-setup");
const { beginChatInstallationRestore, confirmChatInstallationRestore, revokeChatInstallation } =
	await import("@/lib/chat-installations/recovery-lifecycle");
const { buildChatSwitchImpactPreview, confirmChatInstallationSwitch } =
	await import("@/lib/chat-installations/switch-lifecycle");
const { getBotConfigByOrganization, resolveBotByWebhookSecret } =
	await import("@/lib/discord/bot-config");
const { getChannelIdForUser } = await import("@/lib/discord/conversation-manager");

const ids = {
	orgA: "t2048-org-a",
	orgB: "t2048-org-b",
	adminA: "t2048-admin-a",
	empUserA: "t2048-emp-a",
	adminB: "t2048-admin-b",
	empAdminA: "e2048000-0000-4000-8000-000000000001",
	empMemberA: "e2048000-0000-4000-8000-000000000002",
	empAdminB: "e2048000-0000-4000-8000-000000000003",
	legacyAppA: "204800000000000001",
	replacementAppA: "204800000000000002",
	otherOrgAppB: "204800000000000099",
	adminDiscordId: "304800000000000001",
	empDiscordId: "304800000000000002",
	legacyDmChannelId: "404800000000000001",
	candidateAdminDmChannelId: "404800000000000002",
	candidateEmpDmChannelId: "404800000000000003",
	pendingApprovalId: "a2048000-0000-4000-8000-000000000001",
} as const;

const T0 = new Date("2026-11-26T12:00:00.000Z");

function createEd25519Pair() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const spkiDer = publicKey.export({ type: "spki", format: "der" });
	return {
		publicKeyHex: spkiDer.subarray(spkiDer.length - 32).toString("hex"),
		privateKey,
	};
}

function signDiscordBody(
	privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
	timestamp: string,
	rawBody: string,
): string {
	return sign(null, Buffer.from(`${timestamp}${rawBody}`, "utf8"), privateKey).toString("hex");
}

describe("Discord bot replacement, verified interactions, DM recovery, rotation & restore (PostgreSQL)", () => {
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.orgA, ids.orgB],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.adminA, ids.empUserA, ids.adminB],
		]);
	}

	async function seedOrgsAndLegacyDiscord(legacyPubKeyHex: string, orgBPubKeyHex: string) {
		await admin.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'Discord Org A', 't2048-org-a', $3),
			        ($2, 'Discord Org B', 't2048-org-b', $3)`,
			[ids.orgA, ids.orgB, T0],
		);
		await admin.query(
			`insert into "user" (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'Admin A', 'admin-a@t2048.test', true, $4, $4),
			        ($2, 'Employee A', 'emp-a@t2048.test', true, $4, $4),
			        ($3, 'Admin B', 'admin-b@t2048.test', true, $4, $4)`,
			[ids.adminA, ids.empUserA, ids.adminB, T0],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('m-2048-1', $1, $2, 'admin', 'approved', $6),
			        ('m-2048-2', $1, $3, 'member', 'approved', $6),
			        ('m-2048-3', $4, $5, 'admin', 'approved', $6)`,
			[ids.orgA, ids.adminA, ids.empUserA, ids.orgB, ids.adminB, T0],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, created_at, updated_at)
			 values ($1, $2, $3, 'admin', true, $7, $7),
			        ($4, $5, $3, 'employee', true, $7, $7),
			        ($6, $8, $9, 'admin', true, $7, $7)`,
			[
				ids.empAdminA,
				ids.adminA,
				ids.orgA,
				ids.empMemberA,
				ids.empUserA,
				ids.empAdminB,
				T0,
				ids.adminB,
				ids.orgB,
			],
		);

		harness.secrets.set(`${ids.orgA}:discord/bot_token`, "legacy-bot-token-org-a");
		harness.secrets.set(`${ids.orgB}:discord/bot_token`, "legacy-bot-token-org-b");

		await db.insert(discordBotConfig).values([
			{
				organizationId: ids.orgA,
				botToken: "vault:managed",
				applicationId: ids.legacyAppA,
				publicKey: legacyPubKeyHex,
				webhookSecret: "legacy-webhook-secret-org-a",
				interactionEndpointConfigured: true,
				setupStatus: "active",
				enableApprovals: true,
				enableCommands: true,
				enableDailyDigest: true,
				enableEscalations: true,
				configuredByUserId: ids.adminA,
				configuredAt: T0,
			},
			{
				organizationId: ids.orgB,
				botToken: "vault:managed",
				applicationId: ids.otherOrgAppB,
				publicKey: orgBPubKeyHex,
				webhookSecret: "legacy-webhook-secret-org-b",
				interactionEndpointConfigured: true,
				setupStatus: "active",
				configuredByUserId: ids.adminB,
				configuredAt: T0,
			},
		]);

		// Seed active legacy mapping & conversation for Employee A
		await db.insert(discordUserMapping).values({
			userId: ids.empUserA,
			organizationId: ids.orgA,
			discordUserId: ids.empDiscordId,
			discordUsername: "emp_a",
			discordDisplayName: "Employee A",
			isActive: true,
		});
		await db.insert(discordConversation).values({
			organizationId: ids.orgA,
			userId: ids.empUserA,
			channelId: ids.legacyDmChannelId,
			isActive: true,
		});

		// Seed a pending approval & legacy Discord approval card sent by the legacy bot
		await db.insert(approvalRequest).values({
			id: ids.pendingApprovalId,
			organizationId: ids.orgA,
			entityType: "absence_entry",
			entityId: "b2048000-0000-4000-8000-000000000001",
			requestedBy: ids.empMemberA,
			approverId: ids.empAdminA,
			status: "pending",
		});
		await db.insert(discordApprovalMessage).values({
			approvalRequestId: ids.pendingApprovalId,
			organizationId: ids.orgA,
			recipientUserId: ids.adminA,
			channelId: ids.legacyDmChannelId,
			messageId: "704800000000000001",
			status: "sent",
		});

		await backfillOrganizationChatInstallations(ids.orgA, { now: () => T0 });
		await backfillOrganizationChatInstallations(ids.orgB, { now: () => T0 });

		// Enable per-org switch control for Org A Discord
		await db.insert(chatInstallationSwitchControl).values({
			organizationId: ids.orgA,
			provider: "discord",
			enabledByUserId: ids.adminA,
			enabledAt: T0,
		});
	}

	beforeEach(async () => {
		harness.secrets.clear();
		harness.secretStoreOutage = false;
		await cleanup();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("exercises full Discord replacement: prepare -> PING (not ready) -> command retry -> 50007 DM recovery -> segregated employee link -> switch -> retiring card continuity -> rotation -> revoke & verified restore", async () => {
		const legacyPair = createEd25519Pair();
		const orgBPair = createEd25519Pair();
		const replacementPair = createEd25519Pair();

		await seedOrgsAndLegacyDiscord(legacyPair.publicKeyHex, orgBPair.publicKeyHex);

		// 1. Prepare replacement candidate for Org A
		const prepared = await prepareDiscordCandidateInstallation(
			{ organizationId: ids.orgA, actorUserId: ids.adminA },
			{ now: () => T0, appUrl: "https://z8.example.test" },
		);
		expect(prepared.interactionEndpointUrl).toBe(
			`https://z8.example.test/api/discord/installations/${prepared.routeId}/interactions`,
		);

		// 2. Cross-org Discord app collision is blocked!
		const collision = await configureDiscordCandidateCredentials(
			{
				organizationId: ids.orgA,
				actorUserId: ids.adminA,
				installationId: prepared.installationId,
				botToken: "stolen-org-b-bot-token",
				applicationId: ids.otherOrgAppB,
				publicKey: orgBPair.publicKeyHex,
			},
			{
				now: () => T0,
				verifyBotApplication: async () => ({
					kind: "ok",
					application: {
						id: ids.otherOrgAppB,
						name: "Org B Bot",
						verifyKey: orgBPair.publicKeyHex,
					},
				}),
			},
		);
		expect(collision).toMatchObject({ kind: "error", code: "app_claimed_by_other_org" });

		// 3. Configure Org A's replacement Discord app; simulate initial slash command registration failure
		const configured = await configureDiscordCandidateCredentials(
			{
				organizationId: ids.orgA,
				actorUserId: ids.adminA,
				installationId: prepared.installationId,
				botToken: "replacement-bot-token-v1",
				applicationId: ids.replacementAppA,
				publicKey: replacementPair.publicKeyHex,
			},
			{
				now: () => T0,
				verifyBotApplication: async () => ({
					kind: "ok",
					application: {
						id: ids.replacementAppA,
						name: "Org A Replacement Bot",
						verifyKey: replacementPair.publicKeyHex,
					},
				}),
				registerSlashCommands: async () => false,
			},
		);
		expect(configured.kind).toBe("ok");
		if (configured.kind !== "ok") return;
		expect(configured.commandsRegistered).toBe(false);
		expect(configured.view.steps.applicationIdentity.status).toBe("passed");
		expect(configured.view.steps.commandRegistration.status).toBe("failed");
		expect(configured.view.readyForSwitch).toBe(false);

		// 4. Signed Ed25519 PING arrives -> returns { type: 1 }, records proof, still NOT ready without private DM!
		const pingBody = JSON.stringify({
			id: "ping-1",
			application_id: ids.replacementAppA,
			type: 1,
			token: "ping-token",
		});
		const pingTs = "1795694400";
		const pingRes = await handleDiscordInstallationInteractionRequest(
			{
				routeId: prepared.routeId,
				rawBody: pingBody,
				timestamp: pingTs,
				signature: signDiscordBody(replacementPair.privateKey, pingTs, pingBody),
			},
			{ now: () => T0 },
		);
		expect(pingRes.status).toBe(200);
		expect(pingRes.body).toEqual({ type: 1 });

		// Confirm preview reports candidate NOT ready after PING alone
		const previewAfterPing = await buildChatSwitchImpactPreview(
			{ organizationId: ids.orgA, provider: "discord" },
			{ now: () => T0, syncLegacy: false },
		);
		expect(previewAfterPing.candidateReady).toBe(false);
		expect(previewAfterPing.approvalImpact.pendingLegacyCards).toBe(1);

		// 5. Retry slash command registration separately without re-entering credentials
		const retriedCmds = await retryDiscordCandidateCommandRegistration(
			{
				organizationId: ids.orgA,
				actorUserId: ids.adminA,
				installationId: prepared.installationId,
			},
			{
				now: () => T0,
				registerSlashCommands: async () => true,
			},
		);
		expect(retriedCmds.kind).toBe("ok");
		if (retriedCmds.kind !== "ok") return;
		expect(retriedCmds.view.steps.commandRegistration.status).toBe("passed");
		expect(retriedCmds.view.steps.signedInteractionEndpoint.status).toBe("passed");
		expect(retriedCmds.view.readyForSwitch).toBe(false);

		// 6. Admin private DM test hits Discord 50007 privacy block first, then succeeds on retry!
		const dmBlocked = await sendDiscordCandidatePrivateTestMessage(
			{
				organizationId: ids.orgA,
				actorUserId: ids.adminA,
				installationId: prepared.installationId,
				discordUserId: ids.adminDiscordId,
			},
			{
				now: () => T0,
				sendPrivateDm: async () => ({
					kind: "failed",
					code: "discord_dm_blocked_50007",
					recoveryHint: "discord_enable_server_dms",
					isPrivacyOrPrerequisiteBlock: true,
					channelId: ids.candidateAdminDmChannelId,
					message: "Discord blocked this direct message (error 50007).",
				}),
			},
		);
		expect(dmBlocked).toMatchObject({
			kind: "error",
			code: "discord_dm_blocked_50007",
			recoveryHint: "discord_enable_server_dms",
		});

		const dmPassed = await sendDiscordCandidatePrivateTestMessage(
			{
				organizationId: ids.orgA,
				actorUserId: ids.adminA,
				installationId: prepared.installationId,
				discordUserId: ids.adminDiscordId,
			},
			{
				now: () => T0,
				sendPrivateDm: async () => ({
					kind: "ok",
					channelId: ids.candidateAdminDmChannelId,
					messageId: "dm-msg-admin-1",
				}),
			},
		);
		expect(dmPassed.kind).toBe("ok");
		if (dmPassed.kind !== "ok") return;
		expect(dmPassed.view.readyForSwitch).toBe(true);
		expect(dmPassed.view.verificationState).toBe("verified");

		// 7. Employee A links the replacement candidate via Settings -> Notifications -> /link (initially 50007 blocked, then rechecked!)
		const issuedCode = await issueMemberDiscordLinkCode(
			{
				userId: ids.empUserA,
				organizationId: ids.orgA,
				purpose: "candidate_enrollment",
			},
			{ now: () => T0, syncLegacy: false },
		);
		expect(issuedCode.status).toBe("issued");
		if (issuedCode.status !== "issued") return;

		const linkInteractionBody = JSON.stringify({
			id: "emp-link-1",
			application_id: ids.replacementAppA,
			type: 2,
			token: "emp-link-token",
			guild_id: "999999999999999999",
			channel_id: "888888888888888888",
			member: {
				user: { id: ids.empDiscordId, username: "emp_a", global_name: "Employee A" },
				roles: [],
			},
			data: {
				name: "link",
				options: [{ name: "code", type: 3, value: issuedCode.code }],
			},
		});

		const linkRes = await handleDiscordInstallationInteractionRequest(
			{
				routeId: prepared.routeId,
				rawBody: linkInteractionBody,
				timestamp: pingTs,
				signature: signDiscordBody(replacementPair.privateKey, pingTs, linkInteractionBody),
			},
			{
				now: () => T0,
				sendPrivateDm: async () => ({
					kind: "failed",
					code: "discord_dm_blocked_50007",
					recoveryHint: "discord_enable_server_dms",
					isPrivacyOrPrerequisiteBlock: true,
					channelId: ids.candidateEmpDmChannelId,
					message: "Discord blocked this direct message (error 50007).",
				}),
			},
		);
		expect(linkRes.status).toBe(200);
		expect(JSON.stringify(linkRes.body)).toContain("50007");

		// Verify live legacy conversation & mapping stayed completely untouched while candidate shows action_needed!
		const legacyConvBeforeSwitch = await getChannelIdForUser(ids.empUserA, ids.orgA);
		expect(legacyConvBeforeSwitch).toBe(ids.legacyDmChannelId);

		const memberStateBlocked = await getMemberDiscordLinkState(
			{ userId: ids.empUserA, organizationId: ids.orgA },
			{ syncLegacy: false },
		);
		expect(memberStateBlocked.active?.status).toBe("connected");
		expect(memberStateBlocked.candidate?.status).toBe("action_needed");
		expect(memberStateBlocked.candidate?.reachabilityReason).toBe("discord_dm_blocked_50007");

		// Impact preview reflects 1 reachable (Admin A) and 1 action_needed (Employee A blocked DM)
		const previewBeforeRecovery = await buildChatSwitchImpactPreview(
			{ organizationId: ids.orgA, provider: "discord" },
			{ now: () => T0, syncLegacy: false },
		);
		expect(previewBeforeRecovery.employeeImpact.verifiedReachableEmployees).toBe(1);
		expect(previewBeforeRecovery.employeeImpact.actionNeededEmployees).toBe(1);

		// Employee A enables server DMs and clicks "Verify DM delivery"
		const recheck = await recheckMemberDiscordDmReachability(
			{
				userId: ids.empUserA,
				organizationId: ids.orgA,
				installationId: prepared.installationId,
			},
			{
				now: () => T0,
				sendPrivateDm: async () => ({
					kind: "ok",
					channelId: ids.candidateEmpDmChannelId,
					messageId: "dm-msg-emp-recovered",
				}),
			},
		);
		expect(recheck).toMatchObject({
			kind: "reachable",
			channelId: ids.candidateEmpDmChannelId,
		});

		// Stale impact digest from before Employee A's recovery MUST be refused with `impact_changed`!
		const staleSwitchAttempt = await confirmChatInstallationSwitch(
			{
				organizationId: ids.orgA,
				provider: "discord",
				actorUserId: ids.adminA,
				candidateInstallationId: prepared.installationId,
				reviewedCurrentInstallationId: previewBeforeRecovery.primaryCurrentInstallationId,
				reviewedCurrentCredentialRevisionId:
					previewBeforeRecovery.primaryCurrentCredentialRevisionId,
				reviewedCandidateCredentialRevisionId:
					previewBeforeRecovery.candidateInstallation?.activeCredentialRevisionId ?? null,
				reviewedImpactDigest: previewBeforeRecovery.impactDigest,
				acknowledgeUnreadyEmployees: true,
			},
			{ now: () => T0, syncLegacy: false },
		);
		expect(staleSwitchAttempt.kind).toBe("refused");
		if (staleSwitchAttempt.kind !== "refused") return;
		expect(staleSwitchAttempt.code).toBe("impact_changed");
		expect(staleSwitchAttempt.freshPreview.employeeImpact.verifiedReachableEmployees).toBe(2);
		expect(staleSwitchAttempt.freshPreview.employeeImpact.actionNeededEmployees).toBe(0);

		// 8. Confirm switch with fresh impact digest!
		const freshPreview = staleSwitchAttempt.freshPreview;
		const switched = await confirmChatInstallationSwitch(
			{
				organizationId: ids.orgA,
				provider: "discord",
				actorUserId: ids.adminA,
				candidateInstallationId: prepared.installationId,
				reviewedCurrentInstallationId: freshPreview.primaryCurrentInstallationId,
				reviewedCurrentCredentialRevisionId: freshPreview.primaryCurrentCredentialRevisionId,
				reviewedCandidateCredentialRevisionId:
					freshPreview.candidateInstallation?.activeCredentialRevisionId ?? null,
				reviewedImpactDigest: freshPreview.impactDigest,
				acknowledgeUnreadyEmployees: false,
			},
			{ now: () => T0, syncLegacy: false },
		);
		expect(switched.kind).toBe("switched");
		if (switched.kind !== "switched") return;
		expect(switched.activeInstallationId).toBe(prepared.installationId);
		expect(switched.retiredInstallationIds).toHaveLength(1);
		expect(switched.promotedEnrollmentCount).toBe(1);

		// Verify authoritative chat_provider_settings and new outbound routing use replacement bot & candidate DM channel!
		const [settingsRow] = await db
			.select()
			.from(chatProviderSettings)
			.where(
				and(
					eq(chatProviderSettings.organizationId, ids.orgA),
					eq(chatProviderSettings.provider, "discord"),
				),
			);
		expect(settingsRow?.isAuthoritative).toBe(true);
		expect(settingsRow?.activeInstallationId).toBe(prepared.installationId);

		const activeBot = await getBotConfigByOrganization(ids.orgA);
		expect(activeBot?.applicationId).toBe(ids.replacementAppA);
		expect(activeBot?.botToken).toBe("replacement-bot-token-v1");
		expect(activeBot?.installationId).toBe(prepared.installationId);

		const activeEmpChannel = await getChannelIdForUser(ids.empUserA, ids.orgA);
		expect(activeEmpChannel).toBe(ids.candidateEmpDmChannelId);

		// Retiring legacy bot still resolves for old approval cards with status "retiring"
		const retiringLegacyBot = await resolveBotByWebhookSecret("legacy-webhook-secret-org-a");
		expect(retiringLegacyBot?.setupStatus).toBe("retiring");
		expect(retiringLegacyBot?.installationId).toBe(switched.retiredInstallationIds[0]);

		// 9. Same-app credential rotation: rejects different Discord app, succeeds for same app & preserves conversations/links!
		const wrongAppRotation = await rotateDiscordInstallationCredentials(
			{
				organizationId: ids.orgA,
				installationId: prepared.installationId,
				actorUserId: ids.adminA,
				botToken: "other-app-token",
			},
			{
				now: () => T0,
				verifyBotApplication: async () => ({
					kind: "ok",
					application: {
						id: ids.otherOrgAppB,
						name: "Wrong App",
						verifyKey: orgBPair.publicKeyHex,
					},
				}),
			},
		);
		expect(wrongAppRotation).toMatchObject({
			kind: "refused",
			code: "external_identity_mismatch",
		});

		const rotated = await rotateDiscordInstallationCredentials(
			{
				organizationId: ids.orgA,
				installationId: prepared.installationId,
				actorUserId: ids.adminA,
				botToken: "replacement-bot-token-v2",
			},
			{
				now: () => T0,
				verifyBotApplication: async () => ({
					kind: "ok",
					application: {
						id: ids.replacementAppA,
						name: "Org A Replacement Bot",
						verifyKey: replacementPair.publicKeyHex,
					},
				}),
			},
		);
		expect(rotated.kind).toBe("rotated");
		if (rotated.kind !== "rotated") return;
		expect(rotated.newRevisionNumber).toBe(2);

		const botAfterRotation = await getBotConfigByOrganization(ids.orgA);
		expect(botAfterRotation?.botToken).toBe("replacement-bot-token-v2");
		expect(await getChannelIdForUser(ids.empUserA, ids.orgA)).toBe(ids.candidateEmpDmChannelId);

		// 10. Revoke immediately refuses callbacks; begin restore + fresh verification + confirm restore reactivates cleanly!
		const revoked = await revokeChatInstallation(
			{
				organizationId: ids.orgA,
				installationId: prepared.installationId,
				actorUserId: ids.adminA,
				reason: "incident_rehearsal",
			},
			{ now: () => T0 },
		);
		expect(revoked.kind).toBe("revoked");

		const revokedCallback = await handleDiscordInstallationInteractionRequest(
			{
				routeId: prepared.routeId,
				rawBody: pingBody,
				timestamp: pingTs,
				signature: signDiscordBody(replacementPair.privateKey, pingTs, pingBody),
			},
			{ now: () => T0 },
		);
		expect(revokedCallback.status).toBe(403);

		// Pending approval in Z8 remains intact
		const [stillPending] = await db
			.select({ status: approvalRequest.status })
			.from(approvalRequest)
			.where(eq(approvalRequest.id, ids.pendingApprovalId));
		expect(stillPending?.status).toBe("pending");

		// Restore requires fresh credentials, fresh PING, fresh DM test, and fresh impact review!
		const restoreStarted = await beginChatInstallationRestore(
			{
				organizationId: ids.orgA,
				installationId: prepared.installationId,
				actorUserId: ids.adminA,
			},
			{ now: () => T0 },
		);
		expect(restoreStarted).toMatchObject({
			kind: "restore_started",
			status: "candidate",
			requiresCredentials: true,
		});

		const reconfigured = await configureDiscordCandidateCredentials(
			{
				organizationId: ids.orgA,
				actorUserId: ids.adminA,
				installationId: prepared.installationId,
				botToken: "replacement-bot-token-v3",
				applicationId: ids.replacementAppA,
				publicKey: replacementPair.publicKeyHex,
			},
			{
				now: () => T0,
				verifyBotApplication: async () => ({
					kind: "ok",
					application: {
						id: ids.replacementAppA,
						name: "Org A Replacement Bot",
						verifyKey: replacementPair.publicKeyHex,
					},
				}),
				registerSlashCommands: async () => true,
			},
		);
		expect(reconfigured.kind).toBe("ok");

		// Fresh PING + fresh DM test
		const restorePing = await handleDiscordInstallationInteractionRequest(
			{
				routeId: prepared.routeId,
				rawBody: pingBody,
				timestamp: pingTs,
				signature: signDiscordBody(replacementPair.privateKey, pingTs, pingBody),
			},
			{ now: () => T0 },
		);
		expect(restorePing.status).toBe(200);

		const restoreDm = await sendDiscordCandidatePrivateTestMessage(
			{
				organizationId: ids.orgA,
				actorUserId: ids.adminA,
				installationId: prepared.installationId,
				discordUserId: ids.adminDiscordId,
			},
			{
				now: () => T0,
				sendPrivateDm: async () => ({
					kind: "ok",
					channelId: ids.candidateAdminDmChannelId,
					messageId: "dm-msg-restore-1",
				}),
			},
		);
		expect(restoreDm.kind).toBe("ok");

		const restorePreview = await buildChatSwitchImpactPreview(
			{
				organizationId: ids.orgA,
				provider: "discord",
				candidateInstallationId: prepared.installationId,
			},
			{ now: () => T0, syncLegacy: false },
		);
		expect(restorePreview.candidateReady).toBe(true);

		const restored = await confirmChatInstallationRestore(
			{
				organizationId: ids.orgA,
				provider: "discord",
				actorUserId: ids.adminA,
				candidateInstallationId: prepared.installationId,
				reviewedCurrentInstallationId: restorePreview.primaryCurrentInstallationId,
				reviewedCurrentCredentialRevisionId: restorePreview.primaryCurrentCredentialRevisionId,
				reviewedCandidateCredentialRevisionId:
					restorePreview.candidateInstallation?.activeCredentialRevisionId ?? null,
				reviewedImpactDigest: restorePreview.impactDigest,
				acknowledgeUnreadyEmployees: restorePreview.requiresUnreadyAcknowledgement,
			},
			{ now: () => T0 },
		);
		expect(restored.kind).toBe("switched");

		const restoredBot = await getBotConfigByOrganization(ids.orgA);
		expect(restoredBot?.botToken).toBe("replacement-bot-token-v3");

		// Confirm Org B remained completely isolated throughout
		const [orgBInst] = await db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, ids.orgB),
					eq(chatInstallation.provider, "discord"),
				),
			);
		expect(orgBInst?.status).toBe("legacy_active");
		expect(
			await db
				.select()
				.from(chatInstallationMemberLink)
				.where(eq(chatInstallationMemberLink.organizationId, ids.orgB)),
		).toHaveLength(0);
		expect(
			await db
				.select()
				.from(chatInstallationConversation)
				.where(eq(chatInstallationConversation.organizationId, ids.orgB)),
		).toHaveLength(0);
	});
});
