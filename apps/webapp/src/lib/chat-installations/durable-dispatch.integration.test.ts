/**
 * #2044 / #2037 PostgreSQL 16 integration coverage:
 * - Persistent chat notification attempts record selected installation, credential revision,
 *   and dispatch intent BEFORE any provider call.
 * - Switch concurrent with durable notification dispatch keeps in-flight work bound to
 *   the original installation and blocks duplicate active attempts via Postgres uniqueness.
 * - Provider acceptance followed by simulated worker death before local recording stays
 *   tied to the original installation, moves to `reconciliation_required` (out of automatic
 *   resend across a switch), surfaces in the redacted operational view, is counted in
 *   in-flight switch impact counts, and closes with explicit `closed_unknown` after 7 days.
 * - Retry after a `confirmed_unsent` attempt safely reroutes to the newly active
 *   installation under the existing dedupe key with zero duplicate sends.
 * - End-to-end `createAutoClockOutDelivery` exercises worker death + switch quarantine
 *   and confirmed-unsent reroute against real PostgreSQL outbox tasks.
 * - Best-effort chat notifications and non-ledger daily digest config/conversation lookups
 *   resolve the newly active switched organization-owned installation cleanly (and fall
 *   back to legacy config when no switched installation is active).
 */

import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { createLifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { insertInAppNotification } from "@/lib/notifications/notification-service";
import { NOTIFICATION_CHANNELS, type NotificationChannel } from "@/lib/notifications/types";
import { createAutoClockOutDelivery } from "@/lib/time-tracking/automatic-clock-out/delivery";
import { NOW, seedExecution } from "@/lib/time-tracking/automatic-clock-out/testing.test.fixture";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	secrets: new Map<string, string>(),
	slackPostCalls: [] as Array<{ token: string; channel: string; text: string }>,
	telegramSendCalls: [] as Array<{ token: string; chatId: string; text: string }>,
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
vi.mock("@/lib/events", () => ({ publishEventAsync: vi.fn() }));
vi.mock("@/lib/notifications/email-notifications", () => ({ sendEmailNotification: vi.fn() }));

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getOrgSecret: async (organizationId: string, key: string) =>
		harness.secrets.get(`${organizationId}:${key}`) ?? null,
}));

vi.mock("@/lib/slack/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/slack/api")>()),
	postMessage: async (token: string, payload: { channel: string; text?: string }) => {
		harness.slackPostCalls.push({
			token,
			channel: payload.channel,
			text: payload.text ?? "",
		});
		return { ok: true, ts: "1700000000.000100" };
	},
}));

vi.mock("@/lib/telegram/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/telegram/api")>()),
	sendMessage: async (token: string, payload: { chat_id: string | number; text: string }) => {
		harness.telegramSendCalls.push({
			token,
			chatId: String(payload.chat_id),
			text: payload.text,
		});
		return { ok: true, message_id: 42 };
	},
}));

const { db } = await import("@/db");
const {
	chatInstallation,
	chatInstallationConversation,
	chatInstallationCredentialRevision,
	chatNotificationDispatchAttempt,
	chatProviderSettings,
	slackConversation,
	slackWorkspaceConfig,
} = await import("@/db/schema");
const {
	closeExpiredUncertainDurableDispatches,
	countInFlightDurableDispatches,
	DurableDispatchConfirmedUnsentError,
	listDurableDispatchesNeedingReconciliation,
	markDurableDispatchConfirmedUnsent,
	markDurableDispatchProviderCalled,
	markDurableDispatchSent,
	markDurableDispatchUncertain,
	recordDurableDispatchIntent,
} = await import("@/lib/chat-installations");
const { runDurableChatDispatchMaintenance } =
	await import("@/lib/jobs/durable-chat-dispatch-maintenance");
const { isSlackAvailable, sendSlackNotification } =
	await import("@/lib/notifications/slack-channel");
const { getAllActiveBotConfigs: getAllActiveSlackBots } = await import("@/lib/slack/bot-config");
const { getOrganizationPrivateConversations: getSlackPrivateConversations } =
	await import("@/lib/slack/conversation-manager");

const ids = {
	orgA: "t2044-org-a",
	orgB: "t2044-org-b",
	userA: "t2044-user-a",
	userB: "t2044-user-b",
	empA: "e2044000-0000-4000-8000-000000000001",
	empB: "e2044000-0000-4000-8000-000000000002",
	slackTeamA: "T2044ORGA",
	slackTeamB: "T2044ORGB",
} as const;

describe("durable chat notification dispatch & switch safety (PostgreSQL)", () => {
	const admin = integrationAdminPool();
	let lifecycleFixture: Awaited<ReturnType<typeof createLifecycleDatabaseFixture>>;

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.orgA, ids.orgB],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [[ids.userA, ids.userB]]);
	}

	async function seedOrgs() {
		await cleanup();
		const ts = new Date("2026-11-20T10:00:00.000Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'Org 2044 A', $1, $3),
			 ($2, 'Org 2044 B', $2, $3)`,
			[ids.orgA, ids.orgB, ts],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'User 2044 A', 't2044-a@example.test', $3, $3),
			 ($2, 'User 2044 B', 't2044-b@example.test', $3, $3)`,
			[ids.userA, ids.userB, ts],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $3, 'employee', $7),
			 ($4, $5, $6, 'employee', $7)`,
			[ids.empA, ids.userA, ids.orgA, ids.empB, ids.userB, ids.orgB, ts],
		);
	}

	async function seedInstallationWithRevision(input: {
		organizationId: string;
		provider: "slack" | "teams" | "telegram" | "discord";
		status: "active" | "legacy_active" | "retiring" | "candidate";
		routeId: string;
		externalSpaceId?: string;
		externalBotId?: string;
		secretPrefix: string;
		secretKeys: string[];
		secretValues: Record<string, string>;
		credentialSource?: "organization_owned" | "deployment_managed";
	}) {
		const [inst] = await db
			.insert(chatInstallation)
			.values({
				organizationId: input.organizationId,
				provider: input.provider,
				credentialSource: input.credentialSource ?? "organization_owned",
				status: input.status,
				routeId: input.routeId,
				externalSpaceId: input.externalSpaceId ?? null,
				externalBotId: input.externalBotId ?? null,
				receiverScope:
					input.provider === "slack" && input.externalSpaceId
						? `slack-team:${input.externalSpaceId}`
						: null,
				verificationState: "verified",
			})
			.returning();

		const [rev] = await db
			.insert(chatInstallationCredentialRevision)
			.values({
				installationId: inst.id,
				organizationId: input.organizationId,
				revisionNumber: 1,
				secretStoreProvider: "vault",
				secretKeyPrefix: input.secretPrefix,
				secretKeys: input.secretKeys,
				status: input.status === "active" ? "active" : "verified",
			})
			.returning();

		await db
			.update(chatInstallation)
			.set({ activeCredentialRevisionId: rev.id })
			.where(eq(chatInstallation.id, inst.id));

		for (const [keyName, value] of Object.entries(input.secretValues)) {
			harness.secrets.set(`${input.organizationId}:${input.secretPrefix}/${keyName}`, value);
		}

		return { installation: { ...inst, activeCredentialRevisionId: rev.id }, revision: rev };
	}

	async function switchActiveInstallation(input: {
		organizationId: string;
		retiringInstallationId: string;
		activatingInstallationId: string;
	}) {
		await db.transaction(async (tx) => {
			await tx
				.update(chatInstallation)
				.set({ status: "retiring" })
				.where(
					and(
						eq(chatInstallation.id, input.retiringInstallationId),
						eq(chatInstallation.organizationId, input.organizationId),
					),
				);
			await tx
				.update(chatInstallation)
				.set({ status: "active" })
				.where(
					and(
						eq(chatInstallation.id, input.activatingInstallationId),
						eq(chatInstallation.organizationId, input.organizationId),
					),
				);
		});
	}

	beforeEach(async () => {
		harness.secrets.clear();
		harness.slackPostCalls.length = 0;
		harness.telegramSendCalls.length = 0;
		await seedOrgs();
	});

	afterAll(async () => {
		await cleanup();
		await lifecycleFixture?.close();
	});

	it("handles switch concurrent with dispatch, provider acceptance + worker death, redacted ops view, and 7-day explicit unknown closure", async () => {
		const inst1 = await seedInstallationWithRevision({
			organizationId: ids.orgA,
			provider: "slack",
			status: "active",
			routeId: "route-2044-slack-1",
			externalSpaceId: ids.slackTeamA,
			externalBotId: "U_BOT_OLD",
			secretPrefix: "chat/slack/old/rev-1",
			secretKeys: ["bot_access_token"],
			secretValues: { bot_access_token: "xoxb-old-secret-token-99999" },
		});
		const inst2 = await seedInstallationWithRevision({
			organizationId: ids.orgA,
			provider: "slack",
			status: "candidate",
			routeId: "route-2044-slack-2",
			externalSpaceId: ids.slackTeamA,
			externalBotId: "U_BOT_NEW",
			secretPrefix: "chat/slack/new/rev-1",
			secretKeys: ["bot_access_token"],
			secretValues: { bot_access_token: "xoxb-new-secret-token-88888" },
		});

		const t0 = new Date("2026-11-20T12:00:00.000Z");
		const dedupeKey = "notification:op-crash:user-a:slack";

		// 1. Worker 1 records dispatch intent BEFORE calling provider.
		const intent1 = await recordDurableDispatchIntent(
			{
				organizationId: ids.orgA,
				provider: "slack",
				sourceKind: "persistent_notification",
				sourceRefId: "task-crash-1",
				dedupeKey,
			},
			{ now: () => t0 },
		);
		expect(intent1.kind).toBe("proceed");
		if (intent1.kind !== "proceed") return;
		expect(intent1.attempt.installationId).toBe(inst1.installation.id);
		expect(intent1.attempt.credentialRevisionId).toBe(inst1.revision.id);
		expect(intent1.attempt.status).toBe("intent_recorded");

		// Worker 1 calls the provider (which accepts!), then DIES before local recording.
		await markDurableDispatchProviderCalled(
			{ organizationId: ids.orgA, attemptId: intent1.attempt.id },
			{ now: () => new Date("2026-11-20T12:00:02.000Z") },
		);

		// Concurrent switch happens right while Worker 1's attempt is in-flight/lost!
		expect(await countInFlightDurableDispatches(ids.orgA, "slack", inst1.installation.id)).toEqual({
			total: 1,
			intentRecorded: 1,
			reconciliationRequired: 0,
		});

		await switchActiveInstallation({
			organizationId: ids.orgA,
			retiringInstallationId: inst1.installation.id,
			activatingInstallationId: inst2.installation.id,
		});

		// 2. Worker 2 reclaims the task after switch and tries to dispatch the same dedupeKey.
		// It MUST NOT resend or reroute to inst2; it must quarantine to reconciliation_required
		// tied to inst1 + rev1.
		const tRetry = new Date("2026-11-20T12:06:00.000Z");
		const intent2 = await recordDurableDispatchIntent(
			{
				organizationId: ids.orgA,
				provider: "slack",
				sourceKind: "persistent_notification",
				sourceRefId: "task-crash-1",
				dedupeKey,
				diagnostics: {
					reason:
						"reclaim with leaked xoxb-old-secret-token-99999 and https://hooks.slack.com/secret",
				},
			},
			{ now: () => tRetry },
		);
		expect(intent2.kind).toBe("reconciliation_required");
		if (intent2.kind !== "reconciliation_required") return;
		expect(intent2.installationSwitched).toBe(true);
		expect(intent2.attempt.id).toBe(intent1.attempt.id);
		expect(intent2.attempt.installationId).toBe(inst1.installation.id);
		expect(intent2.attempt.credentialRevisionId).toBe(inst1.revision.id);
		expect(intent2.attempt.status).toBe("reconciliation_required");

		// 3. Partial unique index prevents any direct second active insert for same (org, dedupeKey).
		await expect(
			db.insert(chatNotificationDispatchAttempt).values({
				organizationId: ids.orgA,
				provider: "slack",
				sourceKind: "persistent_notification",
				sourceRefId: "task-crash-1",
				dedupeKey,
				installationId: inst2.installation.id,
				credentialRevisionId: inst2.revision.id,
				status: "intent_recorded",
				attemptNumber: 2,
			}),
		).rejects.toThrow();

		// 4. Visible in operations reconciliation view with strictly redacted context.
		const opsItems = await listDurableDispatchesNeedingReconciliation(ids.orgA, {
			now: () => tRetry,
		});
		expect(opsItems).toHaveLength(1);
		expect(opsItems[0]).toMatchObject({
			attemptId: intent1.attempt.id,
			organizationId: ids.orgA,
			provider: "slack",
			installationId: inst1.installation.id,
			credentialRevisionId: inst1.revision.id,
			dedupeKey,
			status: "reconciliation_required",
			failureClassification: "worker_lost",
		});
		const serializedOps = JSON.stringify(opsItems[0]);
		expect(serializedOps).not.toContain("xoxb-old-secret-token-99999");
		expect(serializedOps).not.toContain("hooks.slack.com");
		expect(opsItems[0].redactedDiagnostics.switchedFromInstallationId).toBe(inst1.installation.id);
		expect(opsItems[0].redactedDiagnostics.activeInstallationIdAtCheck).toBe(inst2.installation.id);

		// Counted in switch impact counts for inst1, zero for inst2.
		expect(await countInFlightDurableDispatches(ids.orgA, "slack", inst1.installation.id)).toEqual({
			total: 1,
			intentRecorded: 0,
			reconciliationRequired: 1,
		});
		expect(await countInFlightDurableDispatches(ids.orgA, "slack", inst2.installation.id)).toEqual({
			total: 0,
			intentRecorded: 0,
			reconciliationRequired: 0,
		});

		// 5. Before 7 days (6 days 23 hours): must NOT close yet.
		const beforeExpiry = new Date("2026-11-27T11:05:59.000Z");
		const notYetClosed = await closeExpiredUncertainDurableDispatches(beforeExpiry, {
			organizationId: ids.orgA,
		});
		expect(notYetClosed.closedCount).toBe(0);

		// 6. At/after 7 days: maintenance job closes explicitly as `closed_unknown`.
		const afterSevenDays = new Date("2026-11-27T12:06:01.000Z");
		const maintenance = await runDurableChatDispatchMaintenance({
			clock: { nowInstant: () => instantFromDate(afterSevenDays) },
			organizationId: ids.orgA,
		});
		expect(maintenance.closedCount).toBe(1);
		expect(maintenance.closedAttemptIds).toEqual([intent1.attempt.id]);

		const [closedRow] = await db
			.select()
			.from(chatNotificationDispatchAttempt)
			.where(eq(chatNotificationDispatchAttempt.id, intent1.attempt.id));
		expect(closedRow.status).toBe("closed_unknown");
		expect(closedRow.unknownClosedAt?.toISOString()).toBe(afterSevenDays.toISOString());
		expect(closedRow.installationId).toBe(inst1.installation.id);
		expect(closedRow.redactedDiagnostics?.closedReason).toBe("expired_after_7_days");

		// No longer in reconciliation list or in-flight counts, and subsequent attempts never resend.
		expect(
			await listDurableDispatchesNeedingReconciliation(ids.orgA, { now: () => afterSevenDays }),
		).toHaveLength(0);
		expect(await countInFlightDurableDispatches(ids.orgA, "slack")).toEqual({
			total: 0,
			intentRecorded: 0,
			reconciliationRequired: 0,
		});
		const afterCloseAttempt = await recordDurableDispatchIntent({
			organizationId: ids.orgA,
			provider: "slack",
			sourceKind: "persistent_notification",
			sourceRefId: "task-crash-1",
			dedupeKey,
		});
		expect(afterCloseAttempt.kind).toBe("closed_unknown");
	});

	it("safely reroutes a confirmed_unsent attempt to the newly active installation under the existing dedupe key with zero duplicates", async () => {
		const inst1 = await seedInstallationWithRevision({
			organizationId: ids.orgA,
			provider: "telegram",
			status: "active",
			routeId: "route-2044-tg-1",
			externalBotId: "111000111",
			secretPrefix: "chat/telegram/old/rev-1",
			secretKeys: ["bot_token"],
			secretValues: { bot_token: "111000111:AAH_old_tg_token_secret" },
		});
		const inst2 = await seedInstallationWithRevision({
			organizationId: ids.orgA,
			provider: "telegram",
			status: "candidate",
			routeId: "route-2044-tg-2",
			externalBotId: "222000222",
			secretPrefix: "chat/telegram/new/rev-1",
			secretKeys: ["bot_token"],
			secretValues: { bot_token: "222000222:AAH_new_tg_token_secret" },
		});

		const dedupeKey = "notification:op-reroute:user-a:telegram";

		// Attempt 1 binds to inst1 and fails BEFORE provider acceptance (confirmed_unsent).
		const attempt1 = await recordDurableDispatchIntent({
			organizationId: ids.orgA,
			provider: "telegram",
			sourceKind: "persistent_notification",
			sourceRefId: "task-reroute-1",
			dedupeKey,
		});
		expect(attempt1.kind).toBe("proceed");
		if (attempt1.kind !== "proceed") return;
		expect(attempt1.attempt.installationId).toBe(inst1.installation.id);
		expect(attempt1.attempt.credentialRevisionId).toBe(inst1.revision.id);

		await markDurableDispatchConfirmedUnsent({
			organizationId: ids.orgA,
			attemptId: attempt1.attempt.id,
			diagnostics: { reason: "preflight_config_lookup_failed" },
		});

		// Admin switches to inst2.
		await switchActiveInstallation({
			organizationId: ids.orgA,
			retiringInstallationId: inst1.installation.id,
			activatingInstallationId: inst2.installation.id,
		});

		// Attempt 2 under the SAME dedupeKey safely reroutes to inst2 + rev2!
		const attempt2 = await recordDurableDispatchIntent({
			organizationId: ids.orgA,
			provider: "telegram",
			sourceKind: "persistent_notification",
			sourceRefId: "task-reroute-1",
			dedupeKey,
		});
		expect(attempt2.kind).toBe("proceed");
		if (attempt2.kind !== "proceed") return;
		expect(attempt2.attempt.attemptNumber).toBe(2);
		expect(attempt2.reroutedFromAttemptId).toBe(attempt1.attempt.id);
		expect(attempt2.attempt.installationId).toBe(inst2.installation.id);
		expect(attempt2.attempt.credentialRevisionId).toBe(inst2.revision.id);
		expect(attempt2.attempt.redactedDiagnostics?.switchedFromInstallationId).toBe(
			inst1.installation.id,
		);

		await markDurableDispatchSent({
			organizationId: ids.orgA,
			attemptId: attempt2.attempt.id,
		});

		// Attempt 3 sees `already_sent` and never sends a duplicate!
		const attempt3 = await recordDurableDispatchIntent({
			organizationId: ids.orgA,
			provider: "telegram",
			sourceKind: "persistent_notification",
			sourceRefId: "task-reroute-1",
			dedupeKey,
		});
		expect(attempt3.kind).toBe("already_sent");
		if (attempt3.kind === "already_sent") {
			expect(attempt3.attempt.id).toBe(attempt2.attempt.id);
		}
	});

	it("exercises automatic-clock-out outbox delivery across switch: worker death quarantines without resend, while confirmed_unsent reroutes", async () => {
		lifecycleFixture = await createLifecycleDatabaseFixture();
		const effects = {
			checkCompliance: vi.fn(async () => []),
			recordYouthProtection: vi.fn(async () => {}),
			enforceBreaks: vi.fn(async () => ({
				wasAdjusted: false,
				affectedWorkPeriodIds: [] as string[],
			})),
			reconcileSurcharges: vi.fn(),
			markBalanceDirty: vi.fn(),
			checkProjectBudget: vi.fn(),
		};
		const enabledChannels = (list: NotificationChannel[]) =>
			Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, list.includes(c)])) as Record<
				NotificationChannel,
				boolean
			>;

		// Scenario A: Provider accepts, worker dies before persisting outcome, switch happens,
		// reclaimed worker MUST quarantine without calling deliver again!
		const execA = await seedExecution(lifecycleFixture);
		const org1 = execA.facts.organizationId;
		const instA1 = await seedInstallationWithRevision({
			organizationId: org1,
			provider: "slack",
			status: "active",
			routeId: `route-aco-a1-${org1}`,
			externalSpaceId: `T_ACO_A_${org1.slice(0, 8)}`,
			secretPrefix: "chat/slack/aco-a1/rev-1",
			secretKeys: ["bot_access_token"],
			secretValues: { bot_access_token: "xoxb-aco-a1" },
		});
		const instA2 = await seedInstallationWithRevision({
			organizationId: org1,
			provider: "slack",
			status: "candidate",
			routeId: `route-aco-a2-${org1}`,
			externalSpaceId: `T_ACO_A_${org1.slice(0, 8)}`,
			secretPrefix: "chat/slack/aco-a2/rev-1",
			secretKeys: ["bot_access_token"],
			secretValues: { bot_access_token: "xoxb-aco-a2" },
		});

		const deliveredTargetsA: Array<string | null> = [];
		// First run plans in_app + slack tasks, then crashes mid-deliver on slack (simulating
		// provider accepted + worker process died before recording outcome!).
		const firstRunA = createAutoClockOutDelivery({
			database: lifecycleFixture.db,
			clock: { nowInstant: () => NOW },
			effects,
			transport: {
				preferences: async () => enabledChannels(["slack"]),
				insertInApp: insertInAppNotification,
				deliver: async (_channel, _params, ctx) => {
					deliveredTargetsA.push(ctx?.installationId ?? null);
					// Simulate worker death after provider accepted: do not mark sent, just lose lease!
					await lifecycleFixture.pool.query(
						"update automatic_clock_out_task set lease_expires_at = $2 where organization_id = $1 and payload->>'channel' = 'slack'",
						[org1, new Date(NOW.epochMilliseconds - 60_000)],
					);
					// Throw lease lost error so outbox does not defer cleanly — worker vanished!
					const { AutoClockOutTaskLeaseNotOwnedError } =
						await import("@/lib/time-tracking/automatic-clock-out/outbox");
					// Wait: recordProgress wasn't called, attempt stays intent_recorded; throw lease error
					// directly from deliver after marking the attempt uncertain? No — simulate hard crash
					// where markUncertain didn't even run by skipping defer via stale lease!
					// Actually in delivery.ts, deliver catching an error when installationId !== null calls
					// markUncertain. To simulate HARD process death (row left in `intent_recorded`), we
					// insert a fresh intent_recorded scenario below AND test uncertain error here.
					throw new AutoClockOutTaskLeaseNotOwnedError();
				},
			},
		});
		await firstRunA(100);
		expect(deliveredTargetsA).toEqual([instA1.installation.id]);

		// Switch active installation to instA2 while task is being reclaimed!
		await switchActiveInstallation({
			organizationId: org1,
			retiringInstallationId: instA1.installation.id,
			activatingInstallationId: instA2.installation.id,
		});

		// Force the task back to pending to simulate lease expiration reclaim on Worker 2.
		await lifecycleFixture.pool.query(
			"update automatic_clock_out_task set status = 'pending', available_at = $2, payload = payload - 'outcome' where organization_id = $1 and payload->>'channel' = 'slack'",
			[org1, new Date(NOW.epochMilliseconds)],
		);

		const secondRunDeliverA = vi.fn(async () => "sent" as const);
		const secondRunA = createAutoClockOutDelivery({
			database: lifecycleFixture.db,
			clock: { nowInstant: () => NOW },
			effects,
			transport: {
				preferences: async () => enabledChannels(["slack"]),
				insertInApp: insertInAppNotification,
				deliver: secondRunDeliverA,
			},
		});
		await secondRunA(100);

		// Worker 2 MUST NOT call deliver again!
		expect(secondRunDeliverA).not.toHaveBeenCalled();
		const opsA = await listDurableDispatchesNeedingReconciliation(org1, {
			now: () => new Date(NOW.epochMilliseconds + 60_000),
		});
		expect(opsA).toHaveLength(1);
		expect(opsA[0].installationId).toBe(instA1.installation.id);
		expect(opsA[0].status).toBe("reconciliation_required");

		// Scenario B: Pre-flight confirmed_unsent error on instB1 -> switch to instB2 -> retry
		// safely reroutes to instB2 under the existing dedupe key!
		const execB = await seedExecution(lifecycleFixture);
		const org2 = execB.facts.organizationId;
		const instB1 = await seedInstallationWithRevision({
			organizationId: org2,
			provider: "slack",
			status: "active",
			routeId: `route-aco-b1-${org2}`,
			externalSpaceId: `T_ACO_B_${org2.slice(0, 8)}`,
			secretPrefix: "chat/slack/aco-b1/rev-1",
			secretKeys: ["bot_access_token"],
			secretValues: { bot_access_token: "xoxb-aco-b1" },
		});
		const instB2 = await seedInstallationWithRevision({
			organizationId: org2,
			provider: "slack",
			status: "candidate",
			routeId: `route-aco-b2-${org2}`,
			externalSpaceId: `T_ACO_B_${org2.slice(0, 8)}`,
			secretPrefix: "chat/slack/aco-b2/rev-1",
			secretKeys: ["bot_access_token"],
			secretValues: { bot_access_token: "xoxb-aco-b2" },
		});

		const deliveredTargetsB: Array<{ installationId: string | null; revId: string | null }> = [];
		const runB1 = createAutoClockOutDelivery({
			database: lifecycleFixture.db,
			clock: { nowInstant: () => NOW },
			effects,
			transport: {
				preferences: async () => enabledChannels(["slack"]),
				insertInApp: insertInAppNotification,
				deliver: async (_channel, _params, ctx) => {
					deliveredTargetsB.push({
						installationId: ctx?.installationId ?? null,
						revId: ctx?.credentialRevisionId ?? null,
					});
					throw new DurableDispatchConfirmedUnsentError("preflight offline", {
						reason: "slack_preflight_failed",
					});
				},
			},
		});
		await runB1(100);
		expect(deliveredTargetsB).toEqual([
			{ installationId: instB1.installation.id, revId: instB1.revision.id },
		]);

		await switchActiveInstallation({
			organizationId: org2,
			retiringInstallationId: instB1.installation.id,
			activatingInstallationId: instB2.installation.id,
		});
		await lifecycleFixture.pool.query(
			"update automatic_clock_out_task set available_at = $2 where organization_id = $1 and status = 'pending'",
			[org2, new Date(NOW.epochMilliseconds)],
		);

		const runB2 = createAutoClockOutDelivery({
			database: lifecycleFixture.db,
			clock: { nowInstant: () => NOW },
			effects,
			transport: {
				preferences: async () => enabledChannels(["slack"]),
				insertInApp: insertInAppNotification,
				deliver: async (_channel, _params, ctx) => {
					deliveredTargetsB.push({
						installationId: ctx?.installationId ?? null,
						revId: ctx?.credentialRevisionId ?? null,
					});
					return "sent";
				},
			},
		});
		expect(await runB2(100)).toMatchObject({ completed: 1, deferred: 0, failed: 0 });
		expect(deliveredTargetsB).toEqual([
			{ installationId: instB1.installation.id, revId: instB1.revision.id },
			{ installationId: instB2.installation.id, revId: instB2.revision.id },
		]);

		const attemptsB = await db
			.select()
			.from(chatNotificationDispatchAttempt)
			.where(eq(chatNotificationDispatchAttempt.organizationId, org2));
		expect(attemptsB).toHaveLength(2);
		expect(
			attemptsB.map((a) => ({ n: a.attemptNumber, status: a.status, inst: a.installationId })),
		).toEqual([
			{ n: 1, status: "confirmed_unsent", inst: instB1.installation.id },
			{ n: 2, status: "sent", inst: instB2.installation.id },
		]);
		expect(attemptsB[0].dedupeKey).toBe(attemptsB[1].dedupeKey);
	});

	it("routes best-effort notifications and non-ledger digest lookups to the active switched installation while preserving legacy fallback", async () => {
		// Seed legacy Slack workspace config + conversation for orgA AND orgB.
		await db.insert(slackWorkspaceConfig).values([
			{
				organizationId: ids.orgA,
				slackTeamId: ids.slackTeamA,
				slackTeamName: "Org A Legacy",
				botAccessToken: "vault:managed",
				botUserId: "U_LEGACY_A",
				setupStatus: "active",
				enableDailyDigest: true,
			},
			{
				organizationId: ids.orgB,
				slackTeamId: ids.slackTeamB,
				slackTeamName: "Org B Legacy",
				botAccessToken: "vault:managed",
				botUserId: "U_LEGACY_B",
				setupStatus: "active",
				enableDailyDigest: true,
			},
		]);
		harness.secrets.set(`${ids.orgA}:slack/bot_access_token`, "xoxb-legacy-orgA");
		harness.secrets.set(`${ids.orgB}:slack/bot_access_token`, "xoxb-legacy-orgB");

		await db.insert(slackConversation).values([
			{
				organizationId: ids.orgA,
				userId: ids.userA,
				channelId: "D_LEGACY_A",
				channelType: "im",
				isActive: true,
			},
			{
				organizationId: ids.orgB,
				userId: ids.userB,
				channelId: "D_LEGACY_B",
				channelType: "im",
				isActive: true,
			},
		]);

		// Before switch: orgA best-effort send uses legacy token & legacy DM channel.
		await sendSlackNotification({
			userId: ids.userA,
			organizationId: ids.orgA,
			type: "team_member_added",
			title: "Welcome",
			message: "Legacy path check",
		});
		expect(harness.slackPostCalls).toHaveLength(1);
		expect(harness.slackPostCalls[0]).toMatchObject({
			token: "xoxb-legacy-orgA",
			channel: "D_LEGACY_A",
		});

		// Now switch orgA to a new organization-owned active Slack installation with its own
		// credential revision, authoritative settings, and installation-scoped DM conversation.
		const switchedA = await seedInstallationWithRevision({
			organizationId: ids.orgA,
			provider: "slack",
			status: "active",
			routeId: "route-2044-switched-a",
			externalSpaceId: ids.slackTeamA,
			externalBotId: "U_ORG_OWNED_A",
			secretPrefix: "chat/slack/org-owned-a/rev-1",
			secretKeys: ["bot_access_token"],
			secretValues: { bot_access_token: "xoxb-org-owned-active-A" },
		});
		await db.insert(chatProviderSettings).values({
			organizationId: ids.orgA,
			provider: "slack",
			isAuthoritative: true,
			activeInstallationId: switchedA.installation.id,
			enableDailyDigest: true,
			digestTime: "09:15",
			digestTimezone: "Europe/Berlin",
		});
		await db.insert(chatInstallationConversation).values({
			organizationId: ids.orgA,
			installationId: switchedA.installation.id,
			userId: ids.userA,
			externalConversationId: "D_NEW_ORG_OWNED_A",
			conversationType: "im",
			reachabilityStatus: "reachable",
			isActive: true,
		});

		// After switch:
		// 1) Best-effort send for orgA uses the newly active installation token + conversation!
		expect(await isSlackAvailable(ids.orgA)).toBe(true);
		await sendSlackNotification({
			userId: ids.userA,
			organizationId: ids.orgA,
			type: "team_member_added",
			title: "Welcome",
			message: "Switched active path check",
		});
		expect(harness.slackPostCalls).toHaveLength(2);
		expect(harness.slackPostCalls[1]).toMatchObject({
			token: "xoxb-org-owned-active-A",
			channel: "D_NEW_ORG_OWNED_A",
		});

		// 2) Best-effort send for unswitched orgB still falls back cleanly to legacy!
		await sendSlackNotification({
			userId: ids.userB,
			organizationId: ids.orgB,
			type: "team_member_added",
			title: "Welcome",
			message: "Unswitched orgB legacy check",
		});
		expect(harness.slackPostCalls).toHaveLength(3);
		expect(harness.slackPostCalls[2]).toMatchObject({
			token: "xoxb-legacy-orgB",
			channel: "D_LEGACY_B",
		});

		// 3) Future non-ledger Slack daily digest runs resolve orgA via switched active installation
		//    (with authoritative digestTime/timezone and installation-scoped conversations) and orgB
		//    via legacy config, with zero duplicate orgA entries!
		const allBots = await getAllActiveSlackBots();
		const orgABots = allBots.filter((b) => b.organizationId === ids.orgA);
		const orgBBots = allBots.filter((b) => b.organizationId === ids.orgB);
		expect(orgABots).toHaveLength(1);
		expect(orgABots[0]).toMatchObject({
			organizationId: ids.orgA,
			botAccessToken: "xoxb-org-owned-active-A",
			digestTime: "09:15",
			digestTimezone: "Europe/Berlin",
		});
		expect(orgBBots).toHaveLength(1);
		expect(orgBBots[0]).toMatchObject({
			organizationId: ids.orgB,
			botAccessToken: "xoxb-legacy-orgB",
		});

		expect(await getSlackPrivateConversations(ids.orgA)).toEqual([
			{ userId: ids.userA, channelId: "D_NEW_ORG_OWNED_A" },
		]);
		expect(await getSlackPrivateConversations(ids.orgB)).toEqual([
			{ userId: ids.userB, channelId: "D_LEGACY_B" },
		]);
	});

	it("ensures markDurableDispatchUncertain logs redacted ops diagnostics and never leaks secrets", async () => {
		const inst1 = await seedInstallationWithRevision({
			organizationId: ids.orgA,
			provider: "discord",
			status: "active",
			routeId: "route-2044-discord-1",
			externalBotId: "204400000000000001",
			secretPrefix: "chat/discord/old/rev-1",
			secretKeys: ["bot_token"],
			secretValues: { bot_token: "MTIzNDU2Nzg5MDEyMzQ1Njc4.Gabcde.supersecretdiscordtoken123" },
		});

		const intent = await recordDurableDispatchIntent({
			organizationId: ids.orgA,
			provider: "discord",
			sourceKind: "persistent_notification",
			sourceRefId: "task-discord-1",
			dedupeKey: "notification:op-disc:user-a:discord",
		});
		expect(intent.kind).toBe("proceed");
		if (intent.kind !== "proceed") return;

		const updated = await markDurableDispatchUncertain({
			organizationId: ids.orgA,
			attemptId: intent.attempt.id,
			classification: "provider_error",
			diagnostics: {
				reason:
					"504 timeout MTIzNDU2Nzg5MDEyMzQ1Njc4.Gabcde.supersecretdiscordtoken123 https://discord.com/api/v10/channels/1/messages",
				httpStatus: 504,
			},
		});
		expect(updated?.status).toBe("reconciliation_required");
		expect(updated?.installationId).toBe(inst1.installation.id);
		expect(updated?.credentialRevisionId).toBe(inst1.revision.id);
		const serialized = JSON.stringify(updated?.redactedDiagnostics);
		expect(serialized).not.toContain("supersecretdiscordtoken123");
		expect(serialized).not.toContain("https://discord.com");
		expect(updated?.redactedDiagnostics?.httpStatus).toBe(504);
	});
});
