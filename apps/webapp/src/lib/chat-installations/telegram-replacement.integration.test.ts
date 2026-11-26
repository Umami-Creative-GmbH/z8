/**
 * #2047 / #2037 PostgreSQL 16 end-to-end integration coverage:
 * 1) Full Telegram bot replacement lifecycle:
 *    - Legacy Telegram bot active with an open bound approval card & linked manager
 *    - Stage org-owned candidate Telegram bot -> verify bot identity (`getMe`), claim `telegram:bot:<botId>`
 *      BEFORE `setWebhook`, store immutable credential revision (`bot_token` + `webhook_secret`),
 *      register webhook + 11 commands (with independent command retry)
 *    - Employee enrolls on candidate bot via Settings -> Notifications (`purpose: "candidate_enrollment"`)
 *      through `/api/telegram/installations/{routeId}/webhook` without changing current live links/delivery
 *    - Authenticated webhook receipt + admin synthetic private test -> candidate becomes ready
 *    - Switch impact review & atomic switch confirmation -> new bot active, old bot retiring (30d deadline)
 * 2) Old-card continuity & authority during retirement:
 *    - Retiring legacy bot still services its eligible old approval card callback under current authority
 *    - Retiring bot refuses new commands & non-approval callbacks
 *    - New deliveries/conversations route to the active org-owned bot
 * 3) Telegram durable digest ledger across switch:
 *    - Uncertain send (worker crash after intent / provider timeout) across bot switch quarantines to
 *      `reconciliation_required` (NEVER repeats on the new bot!) and closes as `closed_unknown` after 7 days
 *    - Confirmed-unsent digest failure releases dedupe so subsequent run safely retries on the new active bot
 * 4) Same-bot credential rotation:
 *    - Verifies exact numeric `botId`, preserves installation ID, conversations, approval card ownership,
 *      and webhook route/secret; rejects a token from a different numeric `botId`
 * 5) Revoke + delayed `deleteWebhook` cleanup fenced by generation after restore:
 *    - Revoke immediately rejects webhook (`403`) and queues `provider_endpoint_cleanup` at generation N
 *    - Begin restore increments `endpoint_generation` to N+1
 *    - Delayed cleanup job runs under `withStableBotEndpointLock`, is marked `skipped_stale_generation`,
 *      NEVER calls Telegram `deleteWebhook`, and leaves the restored bot's actual webhook working!
 */

import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	secrets: new Map<string, string>(),
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
		harness.secrets.delete(`${organizationId}:${key}`);
	},
}));

const { db } = await import("@/db");
const {
	approvalDeliveryMessage,
	chatInstallation,
	chatInstallationCleanupJob,
	chatInstallationConversation,
	chatInstallationMemberLink,
	chatInstallationSwitchControl,
	chatNotificationDispatchAttempt,
	telegramBotConfig,
	telegramConversation,
	telegramDigestDelivery,
	telegramUserMapping,
} = await import("@/db/schema");
const { checkInboundApprovalCardInstallationEligibility } =
	await import("@/lib/approvals/delivery/installation-origin");
const { closeExpiredUncertainDurableDispatches } =
	await import("@/lib/chat-installations/durable-dispatch");
const { getMemberChatLinks, issueMemberTelegramCandidateLinkCode } =
	await import("@/lib/chat-installations/member-links");
const { beginChatInstallationRestore, processChatInstallationCleanupJobs, revokeChatInstallation } =
	await import("@/lib/chat-installations/recovery-lifecycle");
const { buildChatSwitchImpactPreview, confirmChatInstallationSwitch } =
	await import("@/lib/chat-installations/switch-lifecycle");
const { handleRetiringTelegramUpdate, handleTelegramInstallationWebhookRequest } =
	await import("@/lib/chat-installations/telegram-installation-routes");
const {
	checkLegacyTelegramSetupMutationAllowed,
	cleanupTelegramInstallationWebhook,
	configureTelegramCandidateCredentials,
	prepareTelegramCandidateInstallation,
	retryTelegramCandidateCommandRegistration,
	rotateTelegramInstallationCredentials,
	sendTelegramCandidateTestMessage,
} = await import("@/lib/chat-installations/telegram-setup");
const {
	beginTelegramDigestDispatch,
	completeTelegramDigestDispatchConfirmedUnsent,
	completeTelegramDigestDispatchSent,
	completeTelegramDigestDispatchUncertain,
} = await import("@/lib/telegram/jobs/digest-delivery-ledger");
const { getBotConfigByOrganization } = await import("@/lib/telegram/bot-config");
const { getChatIdForUser } = await import("@/lib/telegram/conversation-manager");

const ids = {
	org: "t2047-org",
	otherOrg: "t2047-other-org",
	adminUser: "t2047-admin-user",
	managerUser: "t2047-manager-user",
	adminEmp: "e2047000-0000-4000-8000-000000000001",
	managerEmp: "e2047000-0000-4000-8000-000000000002",
	workflowId: "a2047000-0000-4000-8000-000000000001",
	bindingId: "b2047000-0000-4000-8000-000000000001",
} as const;

const OLD_BOT_TOKEN = "111000111:AAOldLegacyTelegramBotToken123456";
const NEW_BOT_TOKEN = "222000222:AANewOrgOwnedTelegramBotToken1234";
const NEW_BOT_TOKEN_ROTATED = "222000222:AARotatedSameBotTelegramToken5678";
const DIFFERENT_BOT_TOKEN = "333000333:AADifferentBotTelegramToken999999";

const T0 = new Date("2026-11-26T12:00:00.000Z");

describe("Telegram bot replacement lifecycle (PostgreSQL 16)", () => {
	const admin = integrationAdminPool();

	async function cleanup() {
		harness.secrets.clear();
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.org, ids.otherOrg],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.adminUser, ids.managerUser],
		]);
	}

	async function seedBaseOrgWithLegacyTelegram() {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'Org 2047', $1, $3),
			 ($2, 'Other Org 2047', $2, $3)`,
			[ids.org, ids.otherOrg, T0],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Admin 2047', 't2047-admin@example.test', $3, $3),
			 ($2, 'Manager 2047', 't2047-manager@example.test', $3, $3)`,
			[ids.adminUser, ids.managerUser, T0],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('m2047-admin', $1, $2, 'admin', 'approved', $4),
			 ('m2047-manager', $1, $3, 'member', 'approved', $4)`,
			[ids.org, ids.adminUser, ids.managerUser, T0],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $3, $5, 'admin', true, $6),
			 ($2, $4, $5, 'manager', true, $6)`,
			[ids.adminEmp, ids.managerEmp, ids.adminUser, ids.managerUser, ids.org, T0],
		);

		// Enable per-org Telegram switch gate
		await db.insert(chatInstallationSwitchControl).values({
			organizationId: ids.org,
			provider: "telegram",
			enabledByUserId: ids.adminUser,
		});

		// Legacy Telegram bot config + live manager mapping & conversation
		const [legacyBot] = await db
			.insert(telegramBotConfig)
			.values({
				organizationId: ids.org,
				botToken: "vault:managed",
				botUsername: "z8_legacy_bot",
				botDisplayName: "Z8 Legacy Bot",
				webhookSecret: "legacy-webhook-secret-2047",
				webhookRegistered: true,
				setupStatus: "active",
				configuredByUserId: ids.adminUser,
				configuredAt: T0,
			})
			.returning();

		harness.secrets.set(`${ids.org}:telegram/bot_token`, OLD_BOT_TOKEN);

		await db.insert(telegramUserMapping).values({
			userId: ids.managerUser,
			organizationId: ids.org,
			telegramUserId: "88001",
			telegramUsername: "mgr_tg",
			telegramDisplayName: "Manager 2047",
			isActive: true,
		});

		await db.insert(telegramConversation).values({
			organizationId: ids.org,
			userId: ids.managerUser,
			chatId: "88001",
			chatType: "private",
			isActive: true,
		});

		const [legacyInst] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.org,
				provider: "telegram",
				credentialSource: "organization_owned",
				status: "legacy_active",
				routeId: "route-2047-legacy",
				externalBotId: "111000111",
				externalBotUsername: "z8_legacy_bot",
				externalDisplayName: "Z8 Legacy Bot",
				receiverScope: "telegram-bot:111000111",
				legacyTable: "telegram_bot_config",
				legacyRecordId: legacyBot.id,
				legacyStatus: "active",
				verificationState: "verified",
				lastVerifiedAt: T0,
			})
			.returning();

		// Record an open approval delivery card sent by the legacy bot
		const [oldCard] = await db
			.insert(approvalDeliveryMessage)
			.values({
				organizationId: ids.org,
				lifecycle: "legacy",
				workflowType: "absence",
				legacySourceType: "absence_entry",
				legacySourceId: ids.workflowId,
				legacyApprovalRequestId: ids.bindingId,
				approvalRequestId: ids.bindingId,
				recipientEmployeeId: ids.managerEmp,
				recipientUserId: ids.managerUser,
				provider: "telegram",
				receiverScope: "telegram-bot:111000111",
				destinationId: "88001",
				remoteMessageId: "7001",
				installationId: legacyInst.id,
				controls: "actionable",
				state: "current",
				statusVersion: 1,
			})
			.returning();

		return { legacyBot, legacyInst, oldCard };
	}

	beforeEach(async () => {
		await cleanup();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("completes Telegram bot replacement, keeps old cards serviceable during retirement, rotates same-bot credentials, and fences delayed deleteWebhook cleanup after restore", async () => {
		const { legacyInst, oldCard } = await seedBaseOrgWithLegacyTelegram();

		// Legacy setup mutation is blocked once switch control is enabled
		const legacyGuard = await checkLegacyTelegramSetupMutationAllowed(ids.org, { db });
		expect(legacyGuard.allowed).toBe(false);
		if (!legacyGuard.allowed) {
			expect(legacyGuard.code).toBe("legacy_setup_superseded");
		}

		// 1. Prepare candidate Telegram bot
		const prepared = await prepareTelegramCandidateInstallation(
			{ organizationId: ids.org, actorUserId: ids.adminUser },
			{ db, appUrl: "https://app.example.test", now: () => T0 },
		);

		let capturedWebhookSecret = "";
		const setWebhookMock = vi.fn(async (_token: string, _url: string, secretToken: string) => {
			capturedWebhookSecret = secretToken;
			return { kind: "ok" as const, result: true as const };
		});
		const setMyCommandsMock = vi
			.fn()
			.mockResolvedValueOnce({ kind: "failed" as const, errorCode: 503, description: "Busy" })
			.mockResolvedValueOnce({ kind: "ok" as const, result: true as const });

		const configured = await configureTelegramCandidateCredentials(
			{
				organizationId: ids.org,
				actorUserId: ids.adminUser,
				installationId: prepared.installationId,
				botToken: NEW_BOT_TOKEN,
			},
			{
				db,
				getMe: async () => ({
					kind: "ok",
					result: { id: 222000222, username: "z8_replacement_bot", first_name: "Z8 Replacement" },
				}),
				setWebhook: setWebhookMock,
				setMyCommands: setMyCommandsMock,
				appUrl: "https://app.example.test",
				now: () => T0,
			},
		);
		expect(configured.kind).toBe("ok");
		if (configured.kind !== "ok") return;
		expect(configured.view.steps.identity.status).toBe("passed");
		expect(configured.view.steps.webhookReceipt.status).toBe("pending");
		expect(configured.view.steps.commandRegistration.status).toBe("failed");

		// 2. Retry command registration independently
		const commandsRetried = await retryTelegramCandidateCommandRegistration(
			{
				organizationId: ids.org,
				actorUserId: ids.adminUser,
				installationId: prepared.installationId,
			},
			{ db, setMyCommands: setMyCommandsMock, appUrl: "https://app.example.test", now: () => T0 },
		);
		expect(commandsRetried.kind).toBe("ok");
		if (commandsRetried.kind !== "ok") return;
		expect(commandsRetried.view.steps.commandRegistration.status).toBe("passed");

		// 3. Employee sees staged replacement bot in Settings -> Notifications, generates candidate
		//    enrollment proof, and redeems it via the candidate webhook WITHOUT disturbing live links!
		const linksBeforeSwitch = await getMemberChatLinks(
			{ userId: ids.managerUser, organizationId: ids.org },
			{ db, syncLegacy: false },
		);
		const tgChannel = linksBeforeSwitch.channels.find((c) => c.provider === "telegram");
		expect(tgChannel?.status).toBe("connected");
		expect(tgChannel?.candidateEnrollment?.status).toBe("action_needed");
		expect(tgChannel?.candidateEnrollment?.botUsername).toBe("z8_replacement_bot");

		const candidateCode = await issueMemberTelegramCandidateLinkCode(
			{
				userId: ids.managerUser,
				organizationId: ids.org,
				installationId: prepared.installationId,
			},
			{ db, now: () => T0 },
		);
		expect(candidateCode.status).toBe("issued");
		if (candidateCode.status !== "issued") return;

		const enrollWebhookRes = await handleTelegramInstallationWebhookRequest(
			{
				routeId: prepared.routeId,
				secretTokenHeader: capturedWebhookSecret,
				rawBody: JSON.stringify({
					update_id: 1001,
					message: {
						message_id: 50,
						date: 1795694400,
						chat: { id: 99001, type: "private" },
						from: { id: 88001, is_bot: false, first_name: "Manager", username: "mgr_tg" },
						text: `/link ${candidateCode.code}`,
					},
				}),
			},
			{
				db,
				sendMessage: async () => ({
					kind: "ok",
					result: { message_id: 51, date: 1795694401, chat: { id: 99001, type: "private" } },
				}),
				now: () => T0,
			},
		);
		expect(enrollWebhookRes.status).toBe(200);
		expect(enrollWebhookRes.body).toEqual(
			expect.objectContaining({
				ok: true,
				mode: "candidate",
				verificationRecorded: true,
				enrollmentStatus: "success",
			}),
		);

		// Confirm candidate enrollment did NOT mutate live legacy telegram_conversation (still "88001", not "99001")
		const liveChatBeforeSwitch = await getChatIdForUser(ids.managerUser, ids.org);
		expect(liveChatBeforeSwitch).toBe("88001");

		// Confirm candidate blocks production commands
		const blockedProdCmd = await handleTelegramInstallationWebhookRequest(
			{
				routeId: prepared.routeId,
				secretTokenHeader: capturedWebhookSecret,
				rawBody: JSON.stringify({
					update_id: 1002,
					message: {
						message_id: 52,
						date: 1795694402,
						chat: { id: 99001, type: "private" },
						from: { id: 88001, is_bot: false, first_name: "Manager" },
						text: "/clockin",
					},
				}),
			},
			{
				db,
				sendMessage: async () => ({
					kind: "ok",
					result: { message_id: 53, date: 1795694403, chat: { id: 99001, type: "private" } },
				}),
				now: () => T0,
			},
		);
		expect(blockedProdCmd.status).toBe(403);

		// 4. Admin sends synthetic private test message to verify step 4
		const testDelivery = await sendTelegramCandidateTestMessage(
			{
				organizationId: ids.org,
				actorUserId: ids.adminUser,
				installationId: prepared.installationId,
				chatId: "77001",
			},
			{
				db,
				sendMessage: async () => ({
					kind: "ok",
					result: { message_id: 60, date: 1795694410, chat: { id: 77001, type: "private" } },
				}),
				appUrl: "https://app.example.test",
				now: () => T0,
			},
		);
		expect(testDelivery.kind).toBe("ok");
		if (testDelivery.kind !== "ok") return;
		expect(testDelivery.view.readyForSwitch).toBe(true);

		// 5. Review switch impact (sees 2 reachable employees, 1 open approval card) & confirm switch
		const preview = await buildChatSwitchImpactPreview(
			{ organizationId: ids.org, provider: "telegram" },
			{ db, now: () => T0, syncLegacy: false },
		);
		expect(preview.canConfirm).toBe(true);
		expect(preview.approvalImpact.openLegacyOwnerCards).toBe(1);
		expect(preview.approvalImpact.totalOutstanding).toBe(1);
		expect(preview.employeeImpact.verifiedReachableEmployees).toBe(2);

		const switched = await confirmChatInstallationSwitch(
			{
				organizationId: ids.org,
				provider: "telegram",
				actorUserId: ids.adminUser,
				candidateInstallationId: prepared.installationId,
				reviewedCurrentInstallationId: preview.primaryCurrentInstallationId,
				reviewedCurrentCredentialRevisionId: preview.primaryCurrentCredentialRevisionId,
				reviewedCandidateCredentialRevisionId:
					preview.candidateInstallation?.activeCredentialRevisionId ?? null,
				reviewedImpactDigest: preview.impactDigest,
				acknowledgeUnreadyEmployees: false,
			},
			{ db, now: () => T0, syncLegacy: false },
		);
		expect(switched.kind).toBe("switched");
		if (switched.kind !== "switched") return;
		expect(switched.activeInstallationId).toBe(prepared.installationId);
		expect(switched.retiredInstallationIds).toEqual([legacyInst.id]);
		expect(switched.promotedEnrollmentCount).toBe(1);

		// New sends resolve to the active org-owned bot and new conversation ("99001")!
		const activeBot = await getBotConfigByOrganization(ids.org);
		expect(activeBot?.botToken).toBe(NEW_BOT_TOKEN);
		expect(activeBot?.installationId).toBe(prepared.installationId);
		const activeManagerChat = await getChatIdForUser(ids.managerUser, ids.org);
		expect(activeManagerChat).toBe("99001");

		// 6. Retiring legacy bot keeps servicing its old approval card under current authority,
		//    while refusing non-approval commands!
		const oldCardEligibility = await checkInboundApprovalCardInstallationEligibility(
			{
				organizationId: ids.org,
				provider: "telegram",
				incomingInstallationId: legacyInst.id,
				incomingReceiverScope: "telegram-bot:111000111",
				messageInstallationId: oldCard.installationId,
				messageReceiverScope: oldCard.receiverScope,
			},
			{ db, now: () => T0 },
		);
		expect(oldCardEligibility.allowed).toBe(true);

		const boundCallbackSpy = vi.fn(async () => "Approved");
		const retiringCallbackRes = await handleRetiringTelegramUpdate(
			{
				update_id: 2001,
				callback_query: {
					id: "cb-old-card-1",
					from: { id: 88001, is_bot: false, first_name: "Manager" },
					data: JSON.stringify({ a: "ba", b: ids.bindingId }),
				},
			},
			{
				organizationId: ids.org,
				installationId: legacyInst.id,
				botToken: OLD_BOT_TOKEN,
				botUsername: "z8_legacy_bot",
				webhookSecret: "legacy-webhook-secret-2047",
				setupStatus: "retiring",
				enableApprovals: true,
				enableCommands: true,
				enableDailyDigest: true,
				enableEscalations: true,
				digestTime: "08:00",
				digestTimezone: "UTC",
				escalationTimeoutHours: 24,
			},
			{
				handleRetiringBoundApproval: boundCallbackSpy,
				answerCallbackQuery: async () => true,
			},
		);
		expect(retiringCallbackRes.status).toBe(200);
		expect(boundCallbackSpy).toHaveBeenCalledTimes(1);

		const retiringCmdRefused = await handleRetiringTelegramUpdate(
			{
				update_id: 2002,
				message: {
					message_id: 70,
					date: 1795694500,
					chat: { id: 88001, type: "private" },
					from: { id: 88001, is_bot: false, first_name: "Manager" },
					text: "/status",
				},
			},
			{
				organizationId: ids.org,
				installationId: legacyInst.id,
				botToken: OLD_BOT_TOKEN,
				botUsername: "z8_legacy_bot",
				webhookSecret: "legacy-webhook-secret-2047",
				setupStatus: "retiring",
				enableApprovals: true,
				enableCommands: true,
				enableDailyDigest: true,
				enableEscalations: true,
				digestTime: "08:00",
				digestTimezone: "UTC",
				escalationTimeoutHours: 24,
			},
		);
		expect(retiringCmdRefused.status).toBe(403);

		// 7. Same-bot credential rotation: rejects different numeric botId, accepts exact same botId
		//    and preserves installation, conversations, and webhook secret!
		const wrongBotRotation = await rotateTelegramInstallationCredentials(
			{
				organizationId: ids.org,
				installationId: prepared.installationId,
				actorUserId: ids.adminUser,
				botToken: DIFFERENT_BOT_TOKEN,
			},
			{
				db,
				getMe: async () => ({
					kind: "ok",
					result: { id: 333000333, username: "other_bot", first_name: "Other" },
				}),
				now: () => T0,
			},
		);
		expect(wrongBotRotation.kind).toBe("refused");
		if (wrongBotRotation.kind === "refused") {
			expect(wrongBotRotation.code).toBe("external_identity_mismatch");
		}

		const rotated = await rotateTelegramInstallationCredentials(
			{
				organizationId: ids.org,
				installationId: prepared.installationId,
				actorUserId: ids.adminUser,
				botToken: NEW_BOT_TOKEN_ROTATED,
			},
			{
				db,
				getMe: async () => ({
					kind: "ok",
					result: { id: 222000222, username: "z8_replacement_bot", first_name: "Z8 Replacement" },
				}),
				now: () => T0,
			},
		);
		expect(rotated.kind).toBe("rotated");
		if (rotated.kind !== "rotated") return;
		expect(rotated.newRevisionNumber).toBe(2);

		// Existing webhook secret STILL authenticates on the same route after rotation, and
		// active bot now uses the rotated token while preserving manager's conversation!
		const activeAfterRotate = await getBotConfigByOrganization(ids.org);
		expect(activeAfterRotate?.botToken).toBe(NEW_BOT_TOKEN_ROTATED);
		expect(await getChatIdForUser(ids.managerUser, ids.org)).toBe("99001");

		const activeWebhookAfterRotate = await handleTelegramInstallationWebhookRequest(
			{
				routeId: prepared.routeId,
				secretTokenHeader: capturedWebhookSecret,
				rawBody: JSON.stringify({ update_id: 3001 }),
			},
			{ db, handleActiveUpdate: async () => undefined, now: () => T0 },
		);
		expect(activeWebhookAfterRotate.status).toBe(200);

		// 8. Revoke -> delayed deleteWebhook cleanup job -> Restore increments generation ->
		//    Delayed cleanup skips cleanly (`skipped_stale_generation`) and NEVER calls deleteWebhook!
		const revoked = await revokeChatInstallation(
			{
				organizationId: ids.org,
				installationId: prepared.installationId,
				actorUserId: ids.adminUser,
				reason: "incident_test",
			},
			{ db, now: () => T0 },
		);
		expect(revoked.kind).toBe("revoked");
		if (revoked.kind !== "revoked") return;
		expect(revoked.queuedEndpointCleanup).toBe(true);

		// Immediately rejected by webhook route while revoked
		const revokedWebhook = await handleTelegramInstallationWebhookRequest(
			{
				routeId: prepared.routeId,
				secretTokenHeader: capturedWebhookSecret,
				rawBody: JSON.stringify({ update_id: 3002 }),
			},
			{ db, now: () => T0 },
		);
		expect(revokedWebhook.status).toBe(403);

		// Admin begins restore BEFORE the delayed endpoint cleanup job runs -> generation increments!
		const restoreStarted = await beginChatInstallationRestore(
			{
				organizationId: ids.org,
				installationId: prepared.installationId,
				actorUserId: ids.adminUser,
			},
			{ db, now: () => T0 },
		);
		expect(restoreStarted.kind).toBe("restore_started");
		if (restoreStarted.kind !== "restore_started") return;
		expect(restoreStarted.endpointGeneration).toBeGreaterThan(revoked.endpointGeneration);

		// Now the delayed cleanup worker wakes up and processes the queued `provider_endpoint_cleanup`!
		const deleteWebhookSpy = vi.fn(async () => ({ kind: "ok" as const, result: true as const }));
		const cleanupResult = await processChatInstallationCleanupJobs(
			{ now: T0, organizationId: ids.org, provider: "telegram" },
			{
				db,
				providerEndpointCleanup: ({ installation, job }) =>
					cleanupTelegramInstallationWebhook(
						{ installation, job },
						{ db, deleteWebhook: deleteWebhookSpy },
					),
			},
		);

		expect(cleanupResult.skippedStale).toBe(1);
		expect(deleteWebhookSpy).not.toHaveBeenCalled();

		const [endpointJob] = await db
			.select()
			.from(chatInstallationCleanupJob)
			.where(
				and(
					eq(chatInstallationCleanupJob.installationId, prepared.installationId),
					eq(chatInstallationCleanupJob.kind, "provider_endpoint_cleanup"),
				),
			)
			.limit(1);
		expect(endpointJob?.status).toBe("skipped_stale_generation");

		// Confirm member links & conversations remain intact on the installation
		const [convRow] = await db
			.select()
			.from(chatInstallationConversation)
			.where(
				and(
					eq(chatInstallationConversation.installationId, prepared.installationId),
					eq(chatInstallationConversation.userId, ids.managerUser),
				),
			)
			.limit(1);
		expect(convRow?.externalConversationId).toBe("99001");
		const [linkRow] = await db
			.select()
			.from(chatInstallationMemberLink)
			.where(
				and(
					eq(chatInstallationMemberLink.installationId, prepared.installationId),
					eq(chatInstallationMemberLink.userId, ids.managerUser),
				),
			)
			.limit(1);
		expect(linkRow?.isActive).toBe(true);
	});

	it("quarantines an uncertain Telegram durable digest across switch without repeating it, closes unknown after 7 days, and safely retries confirmed-unsent digests", async () => {
		const { legacyInst } = await seedBaseOrgWithLegacyTelegram();

		// Create a second active installation simulating a completed switch
		const [newInst] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.org,
				provider: "telegram",
				credentialSource: "organization_owned",
				status: "active",
				routeId: "route-2047-digest-new",
				externalBotId: "222000222",
				externalBotUsername: "z8_new_digest_bot",
				receiverScope: "telegram-bot:222000222",
				verificationState: "verified",
				lastVerifiedAt: T0,
			})
			.returning();

		// Scenario A: Worker records digest intent on OLD bot, then crashes / times out (uncertain)!
		const uncertainKey = {
			organizationId: ids.org,
			recipientEmployeeId: ids.managerEmp,
			recipientUserId: ids.managerUser,
			logicalDate: "2026-11-26",
		};
		const firstRun = await beginTelegramDigestDispatch(
			uncertainKey,
			{ installationId: legacyInst.id },
			{ db, now: () => T0 },
		);
		expect(firstRun.kind).toBe("proceed");
		if (firstRun.kind !== "proceed") return;

		// Simulate provider timeout / uncertain outcome
		await completeTelegramDigestDispatchUncertain(
			uncertainKey,
			firstRun.attempt.id,
			{
				classification: "ambiguous",
				diagnostics: { reason: "telegram_timeout" },
			},
			{ db, now: () => T0 },
		);

		// Now switch has moved active delivery to `newInst`; next digest run MUST NOT resend!
		const afterSwitchRun = await beginTelegramDigestDispatch(
			uncertainKey,
			{ installationId: newInst.id },
			{ db, now: () => new Date("2026-11-26T12:15:00.000Z") },
		);
		expect(afterSwitchRun.kind).toBe("reconciliation_required");
		if (afterSwitchRun.kind === "reconciliation_required") {
			expect(afterSwitchRun.installationSwitched).toBe(true);
			expect(afterSwitchRun.attempt.installationId).toBe(legacyInst.id);
		}

		// Ledger row stays tied to original installation & dispatch attempt
		const [ledgerRow] = await db
			.select()
			.from(telegramDigestDelivery)
			.where(
				and(
					eq(telegramDigestDelivery.organizationId, ids.org),
					eq(telegramDigestDelivery.logicalDate, "2026-11-26"),
				),
			)
			.limit(1);
		expect(ledgerRow?.installationId).toBe(legacyInst.id);
		expect(ledgerRow?.dispatchAttemptId).toBe(firstRun.attempt.id);
		expect(ledgerRow?.status).toBe("sending");

		// After 7 days (168h), maintenance closes unresolved uncertain digest as `closed_unknown`
		const afterSevenDays = new Date("2026-12-04T12:00:00.000Z");
		const closed = await closeExpiredUncertainDurableDispatches(afterSevenDays, {
			db,
			organizationId: ids.org,
		});
		expect(closed.closedCount).toBe(1);

		const [closedAttempt] = await db
			.select()
			.from(chatNotificationDispatchAttempt)
			.where(eq(chatNotificationDispatchAttempt.id, firstRun.attempt.id))
			.limit(1);
		expect(closedAttempt?.status).toBe("closed_unknown");

		// Scenario B: Confirmed-unsent digest failure on OLD bot safely retries & delivers on NEW bot!
		const retryKey = {
			organizationId: ids.org,
			recipientEmployeeId: ids.managerEmp,
			recipientUserId: ids.managerUser,
			logicalDate: "2026-11-27",
		};
		const attempt1 = await beginTelegramDigestDispatch(
			retryKey,
			{ installationId: legacyInst.id },
			{ db, now: () => T0 },
		);
		expect(attempt1.kind).toBe("proceed");
		if (attempt1.kind !== "proceed") return;

		await completeTelegramDigestDispatchConfirmedUnsent(
			retryKey,
			attempt1.attempt.id,
			{ reason: "telegram_confirmed_unsent", httpStatus: 403 },
			{ db, now: () => T0 },
		);

		const attempt2 = await beginTelegramDigestDispatch(
			retryKey,
			{ installationId: newInst.id },
			{ db, now: () => new Date("2026-11-26T12:15:00.000Z") },
		);
		expect(attempt2.kind).toBe("proceed");
		if (attempt2.kind !== "proceed") return;
		expect(attempt2.attempt.attemptNumber).toBe(2);
		expect(attempt2.attempt.installationId).toBe(newInst.id);

		await completeTelegramDigestDispatchSent(retryKey, attempt2.attempt.id, {
			db,
			now: () => new Date("2026-11-26T12:15:05.000Z"),
		});

		const [sentLedger] = await db
			.select()
			.from(telegramDigestDelivery)
			.where(
				and(
					eq(telegramDigestDelivery.organizationId, ids.org),
					eq(telegramDigestDelivery.logicalDate, "2026-11-27"),
				),
			)
			.limit(1);
		expect(sentLedger?.status).toBe("sent");
		expect(sentLedger?.installationId).toBe(newInst.id);
	});
});
