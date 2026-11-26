/**
 * #2045 / #2037 PostgreSQL 16 integration coverage:
 * - Per-organization switch gate enforcement (`chat_installation_switch_control` required).
 * - Material impact change between preview and confirm refuses with `impact_changed` + fresh preview.
 * - Concurrent switch confirmations are serialized via Postgres advisory lock + FOR UPDATE so
 *   only ONE confirmation activates the candidate.
 * - Atomic switch moves old Slack installation to `retiring` (30-day Temporal UTC deadline),
 *   promotes candidate to `active`, marks `chat_provider_settings.isAuthoritative = true`,
 *   carries forward proven same-workspace identities via `reuseVerifiedExternalIdentity` while
 *   keeping replacement DM conversation reachability separate.
 * - New Slack notifications route to the active organization-owned installation while old
 *   approval cards still refresh through their originating retiring installation.
 * - Automatic retirement sweep settles retiring installations when open cards/work reach 0
 *   OR after 30 days, while pending approvals remain accessible in the Z8 inbox.
 */

import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	secrets: new Map<string, string>(),
	postCalls: [] as Array<{ token: string; channel: string; text?: string }>,
	updateCalls: [] as Array<{ token: string; channel: string; ts: string }>,
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
	getOrgSecret: async (organizationId: string, key: string) =>
		harness.secrets.get(`${organizationId}:${key}`) ?? null,
	storeOrgSecret: async (organizationId: string, key: string, value: string) => {
		harness.secrets.set(`${organizationId}:${key}`, value);
	},
	deleteOrgSecret: async (organizationId: string, key: string) => {
		harness.secrets.delete(`${organizationId}:${key}`);
	},
}));

vi.mock("@/lib/slack/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/slack/api")>()),
	postMessage: async (token: string, payload: { channel: string; text?: string }) => {
		harness.postCalls.push({ token, channel: payload.channel, text: payload.text });
		return { ok: true, ts: "1732622400.000100" };
	},
	updateMessageWithOutcome: async (token: string, payload: { channel: string; ts: string }) => {
		harness.updateCalls.push({ token, channel: payload.channel, ts: payload.ts });
		return { kind: "ok" as const, result: { channel: payload.channel, ts: payload.ts } };
	},
}));

const { db } = await import("@/db");
const {
	approvalRequest,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationCredentialRevision,
	chatInstallationMemberLink,
	chatInstallationSwitchControl,
	chatProviderSettings,
	slackApprovalMessage,
	slackConversation,
	slackUserMapping,
	slackWorkspaceConfig,
} = await import("@/db/schema");
const {
	buildChatSwitchImpactPreview,
	confirmChatInstallationSwitch,
	isChatInstallationSwitchEnabled,
	retireSettledChatInstallations,
} = await import("@/lib/chat-installations/switch-lifecycle");
const { runDurableChatDispatchMaintenance } =
	await import("@/lib/jobs/durable-chat-dispatch-maintenance");
const { sendSlackNotification } = await import("@/lib/notifications/slack-channel");
const { slackApprovalDeliveryAdapter } = await import("@/lib/slack/approval-delivery");
const { loadOrganizationInstallationById } =
	await import("@/lib/approvals/delivery/installation-origin");

const ids = {
	orgA: "t2045-org-a",
	adminUser: "t2045-admin-u",
	empUser1: "t2045-emp-u1",
	empUser2: "t2045-emp-u2",
	adminEmp: "e2045000-0000-4000-8000-000000000001",
	emp1: "e2045000-0000-4000-8000-000000000002",
	emp2: "e2045000-0000-4000-8000-000000000003",
	slackTeam: "T2045ACME",
} as const;

const T0 = new Date("2026-11-26T12:00:00.000Z");

describe("Slack switch impact review, atomic activation, & retirement (PostgreSQL)", () => {
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.orgA]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.adminUser, ids.empUser1, ids.empUser2],
		]);
	}

	async function seedBaseOrgAndSlackInstallations() {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'Acme 2045', $1, $2)`,
			[ids.orgA, T0],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Admin', 't2045-admin@example.test', $4, $4),
			 ($2, 'Alice', 't2045-alice@example.test', $4, $4),
			 ($3, 'Bob', 't2045-bob@example.test', $4, $4)`,
			[ids.adminUser, ids.empUser1, ids.empUser2, T0],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('m2045-admin', $1, $2, 'admin', 'approved', $5),
			 ('m2045-u1', $1, $3, 'member', 'approved', $5),
			 ('m2045-u2', $1, $4, 'member', 'approved', $5)`,
			[ids.orgA, ids.adminUser, ids.empUser1, ids.empUser2, T0],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $4, $7, 'admin', true, $8),
			 ($2, $5, $7, 'employee', true, $8),
			 ($3, $6, $7, 'employee', true, $8)`,
			[ids.adminEmp, ids.emp1, ids.emp2, ids.adminUser, ids.empUser1, ids.empUser2, ids.orgA, T0],
		);

		// Seed legacy Slack workspace config + legacy conversation + legacy user mapping for Alice.
		const [legacyConfig] = await db
			.insert(slackWorkspaceConfig)
			.values({
				organizationId: ids.orgA,
				slackTeamId: ids.slackTeam,
				slackTeamName: "Acme Slack",
				botAccessToken: "vault:managed",
				botUserId: "U_LEGACY_BOT",
				setupStatus: "active",
				enableApprovals: true,
				enableCommands: true,
				enableDailyDigest: true,
				enableEscalations: true,
				digestTime: "08:30",
				digestTimezone: "Europe/Berlin",
				escalationTimeoutHours: 12,
			})
			.returning();

		harness.secrets.set(`${ids.orgA}:slack/bot_access_token`, "xoxb-legacy-slack-token");

		await db.insert(slackUserMapping).values({
			organizationId: ids.orgA,
			userId: ids.empUser1,
			slackUserId: "U_ALICE_SLACK",
			slackTeamId: ids.slackTeam,
			slackUsername: "alice",
			slackDisplayName: "Alice",
			isActive: true,
		});
		await db.insert(slackConversation).values({
			organizationId: ids.orgA,
			userId: ids.empUser1,
			channelId: "D_LEGACY_ALICE",
			channelType: "im",
			isActive: true,
		});

		const [legacyInst] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.orgA,
				provider: "slack",
				credentialSource: "deployment_managed",
				status: "legacy_active",
				routeId: "route-2045-legacy",
				externalBotId: "U_LEGACY_BOT",
				externalSpaceId: ids.slackTeam,
				externalSpaceName: "Acme Slack",
				receiverScope: `slack-team:${ids.slackTeam}`,
				legacyTable: "slack_workspace_config",
				legacyRecordId: legacyConfig.id,
				legacyStatus: "active",
				verificationState: "unverified",
			})
			.returning();

		// Seed verified candidate organization-owned Slack installation in the SAME workspace.
		const [candidateInst] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.orgA,
				provider: "slack",
				credentialSource: "organization_owned",
				status: "candidate",
				routeId: "route-2045-candidate",
				externalAppId: "A_ORG_NEW",
				externalBotId: "U_ORG_NEW_BOT",
				externalBotUsername: "z8-acme",
				externalDisplayName: "Z8 Acme",
				externalSpaceId: ids.slackTeam,
				externalSpaceName: "Acme Slack",
				receiverScope: `slack-team:${ids.slackTeam}`,
				verificationState: "verified",
				lastVerifiedAt: T0,
			})
			.returning();

		const [candidateRev] = await db
			.insert(chatInstallationCredentialRevision)
			.values({
				installationId: candidateInst.id,
				organizationId: ids.orgA,
				revisionNumber: 1,
				secretStoreProvider: "vault",
				secretKeyPrefix: `chat/slack/${candidateInst.id}/rev-1`,
				secretKeys: ["bot_access_token", "signing_secret"],
				status: "verified",
				verifiedAt: T0,
			})
			.returning();

		harness.secrets.set(
			`${ids.orgA}:chat/slack/${candidateInst.id}/rev-1/bot_access_token`,
			"xoxb-new-org-slack-token",
		);
		harness.secrets.set(
			`${ids.orgA}:chat/slack/${candidateInst.id}/rev-1/signing_secret`,
			"new_signing_secret_0123456789abcdef",
		);

		const expiresIso = new Date(T0.getTime() + 24 * 60 * 60 * 1000).toISOString();
		await db
			.update(chatInstallation)
			.set({
				activeCredentialRevisionId: candidateRev.id,
				verificationEvidence: {
					source: "verified_setup",
					identityVerifiedAt: T0.toISOString(),
					identityRevisionId: candidateRev.id,
					signedEventVerifiedAt: T0.toISOString(),
					signedEventRevisionId: candidateRev.id,
					signedEventType: "app_mention",
					signedEventExpiresAt: expiresIso,
					privateDeliveryVerifiedAt: T0.toISOString(),
					privateDeliveryRevisionId: candidateRev.id,
					privateDeliveryTargetUserId: "U_ADMIN_SLACK",
					privateDeliveryChannelId: "D_CANDIDATE_ADMIN",
					privateDeliveryExpiresAt: expiresIso,
				},
			})
			.where(eq(chatInstallation.id, candidateInst.id));

		// Admin already has verified reachable DM on candidate (from private test)
		await db.insert(chatInstallationConversation).values({
			organizationId: ids.orgA,
			installationId: candidateInst.id,
			userId: ids.adminUser,
			employeeId: ids.adminEmp,
			externalUserId: "U_ADMIN_SLACK",
			externalConversationId: "D_CANDIDATE_ADMIN",
			conversationType: "private",
			reachabilityStatus: "reachable",
			verifiedAt: T0,
			isActive: true,
		});

		return { legacyConfig, legacyInst, candidateInst, candidateRev };
	}

	beforeEach(async () => {
		harness.secrets.clear();
		harness.postCalls.length = 0;
		harness.updateCalls.length = 0;
		await seedBaseOrgAndSlackInstallations();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("enforces the per-organization switch gate, detects material impact drift, and serializes concurrent confirmations", async () => {
		const previewBeforeGate = await buildChatSwitchImpactPreview(
			{ organizationId: ids.orgA, provider: "slack" },
			{ now: () => T0, syncLegacy: false },
		);

		expect(await isChatInstallationSwitchEnabled(db, ids.orgA, "slack")).toBe(false);
		expect(previewBeforeGate.switchControlEnabled).toBe(false);
		expect(previewBeforeGate.canConfirm).toBe(false);
		// Admin = verifiedReachable (1), Alice = carry-forward -> unknownReachability (1), Bob = actionNeeded (1)
		expect(previewBeforeGate.employeeImpact).toEqual({
			totalActiveEmployees: 3,
			verifiedReachableEmployees: 1,
			actionNeededEmployees: 1,
			unknownReachabilityEmployees: 1,
			carryForwardIdentityEmployees: 1,
			unreadyEmployees: 2,
		});

		const candidate = previewBeforeGate.candidateInstallation!;
		// Refused without switch control row!
		const gatedRefusal = await confirmChatInstallationSwitch(
			{
				organizationId: ids.orgA,
				provider: "slack",
				actorUserId: ids.adminUser,
				candidateInstallationId: candidate.id,
				reviewedCurrentInstallationId: previewBeforeGate.primaryCurrentInstallationId,
				reviewedCurrentCredentialRevisionId: previewBeforeGate.primaryCurrentCredentialRevisionId,
				reviewedCandidateCredentialRevisionId: candidate.activeCredentialRevisionId,
				reviewedImpactDigest: previewBeforeGate.impactDigest,
				acknowledgeUnreadyEmployees: true,
			},
			{ now: () => T0 },
		);
		expect(gatedRefusal).toMatchObject({ kind: "refused", code: "switch_not_enabled" });

		// Enable switch gate for (orgA, "slack")
		await db.insert(chatInstallationSwitchControl).values({
			organizationId: ids.orgA,
			provider: "slack",
			enabledByUserId: ids.adminUser,
		});
		expect(await isChatInstallationSwitchEnabled(db, ids.orgA, "slack")).toBe(true);

		const previewEnabled = await buildChatSwitchImpactPreview(
			{ organizationId: ids.orgA, provider: "slack" },
			{ now: () => T0, syncLegacy: false },
		);
		expect(previewEnabled.canConfirm).toBe(true);

		// Material change arrives between preview and confirm (new pending legacy Slack approval card!)
		const [driftReq] = await db
			.insert(approvalRequest)
			.values({
				organizationId: ids.orgA,
				entityType: "absence_entry",
				entityId: "a2045000-0000-4000-8000-000000000099",
				requestedBy: ids.emp1,
				approverId: ids.adminEmp,
				status: "pending",
			})
			.returning();

		await db.insert(slackApprovalMessage).values({
			approvalRequestId: driftReq.id,
			organizationId: ids.orgA,
			recipientUserId: ids.adminUser,
			channelId: "D_LEGACY_ADMIN",
			messageTs: "1732622400.999999",
			installationId: previewEnabled.primaryCurrentInstallationId!,
			status: "sent",
		});

		const driftRefusal = await confirmChatInstallationSwitch(
			{
				organizationId: ids.orgA,
				provider: "slack",
				actorUserId: ids.adminUser,
				candidateInstallationId: candidate.id,
				reviewedCurrentInstallationId: previewEnabled.primaryCurrentInstallationId,
				reviewedCurrentCredentialRevisionId: previewEnabled.primaryCurrentCredentialRevisionId,
				reviewedCandidateCredentialRevisionId: candidate.activeCredentialRevisionId,
				reviewedImpactDigest: previewEnabled.impactDigest,
				acknowledgeUnreadyEmployees: true,
			},
			{ now: () => T0 },
		);
		expect(driftRefusal.kind).toBe("refused");
		if (driftRefusal.kind !== "refused") return;
		expect(driftRefusal.code).toBe("impact_changed");
		expect(driftRefusal.freshPreview.approvalImpact.pendingLegacyCards).toBe(1);
		expect(driftRefusal.freshPreview.impactDigest).not.toBe(previewEnabled.impactDigest);

		// Now run TWO concurrent confirmations with the fresh preview -> ONLY ONE activates!
		const fresh = driftRefusal.freshPreview;
		const [res1, res2] = await Promise.all([
			confirmChatInstallationSwitch(
				{
					organizationId: ids.orgA,
					provider: "slack",
					actorUserId: ids.adminUser,
					candidateInstallationId: fresh.candidateInstallation!.id,
					reviewedCurrentInstallationId: fresh.primaryCurrentInstallationId,
					reviewedCurrentCredentialRevisionId: fresh.primaryCurrentCredentialRevisionId,
					reviewedCandidateCredentialRevisionId:
						fresh.candidateInstallation!.activeCredentialRevisionId,
					reviewedImpactDigest: fresh.impactDigest,
					acknowledgeUnreadyEmployees: true,
				},
				{ now: () => T0 },
			),
			confirmChatInstallationSwitch(
				{
					organizationId: ids.orgA,
					provider: "slack",
					actorUserId: ids.adminUser,
					candidateInstallationId: fresh.candidateInstallation!.id,
					reviewedCurrentInstallationId: fresh.primaryCurrentInstallationId,
					reviewedCurrentCredentialRevisionId: fresh.primaryCurrentCredentialRevisionId,
					reviewedCandidateCredentialRevisionId:
						fresh.candidateInstallation!.activeCredentialRevisionId,
					reviewedImpactDigest: fresh.impactDigest,
					acknowledgeUnreadyEmployees: true,
				},
				{ now: () => T0 },
			),
		]);

		const switchedResults = [res1, res2].filter((r) => r.kind === "switched");
		const refusedResults = [res1, res2].filter((r) => r.kind === "refused");
		expect(switchedResults).toHaveLength(1);
		expect(refusedResults).toHaveLength(1);
	});

	it("performs atomic switch, carries forward same-workspace identity without mixing DM reachability, routes new sends to active while old cards refresh via retiring, and auto-retires on settle or 30d limit", async () => {
		await db.insert(chatInstallationSwitchControl).values({
			organizationId: ids.orgA,
			provider: "slack",
			enabledByUserId: ids.adminUser,
		});

		const preview = await buildChatSwitchImpactPreview(
			{ organizationId: ids.orgA, provider: "slack" },
			{ now: () => T0, syncLegacy: false },
		);
		const oldInstId = preview.primaryCurrentInstallationId!;
		const newInstId = preview.candidateInstallation!.id;

		// Seed a pending approval request + legacy Slack approval card bound to oldInstId.
		const [pendingReq] = await db
			.insert(approvalRequest)
			.values({
				organizationId: ids.orgA,
				entityType: "absence_entry",
				entityId: "a2045000-0000-4000-8000-000000000001",
				requestedBy: ids.emp1,
				approverId: ids.adminEmp,
				status: "pending",
			})
			.returning();

		await db.insert(slackApprovalMessage).values({
			approvalRequestId: pendingReq.id,
			organizationId: ids.orgA,
			recipientUserId: ids.adminUser,
			channelId: "D_LEGACY_ADMIN",
			messageTs: "1732622400.111111",
			installationId: oldInstId,
			status: "sent",
		});

		// Refresh preview to capture the pending legacy card in the digest.
		const previewWithCard = await buildChatSwitchImpactPreview(
			{ organizationId: ids.orgA, provider: "slack" },
			{ now: () => T0, syncLegacy: false },
		);
		expect(previewWithCard.approvalImpact.pendingLegacyCards).toBe(1);

		const switched = await confirmChatInstallationSwitch(
			{
				organizationId: ids.orgA,
				provider: "slack",
				actorUserId: ids.adminUser,
				candidateInstallationId: newInstId,
				reviewedCurrentInstallationId: oldInstId,
				reviewedCurrentCredentialRevisionId: previewWithCard.primaryCurrentCredentialRevisionId,
				reviewedCandidateCredentialRevisionId:
					previewWithCard.candidateInstallation!.activeCredentialRevisionId,
				reviewedImpactDigest: previewWithCard.impactDigest,
				acknowledgeUnreadyEmployees: true,
			},
			{ now: () => T0 },
		);

		expect(switched.kind).toBe("switched");
		if (switched.kind !== "switched") return;
		expect(switched.activeInstallationId).toBe(newInstId);
		expect(switched.retiredInstallationIds).toEqual([oldInstId]);
		expect(switched.retirementDeadlineAt).toBe("2026-12-26T12:00:00.000Z");
		expect(switched.carriedForwardIdentityCount).toBe(1); // Alice's same-workspace identity

		// Verify DB state: old is retiring (30d deadline), new is active, settings authoritative.
		const [oldRow] = await db
			.select()
			.from(chatInstallation)
			.where(eq(chatInstallation.id, oldInstId));
		const [newRow] = await db
			.select()
			.from(chatInstallation)
			.where(eq(chatInstallation.id, newInstId));
		const [settingsRow] = await db
			.select()
			.from(chatProviderSettings)
			.where(
				and(
					eq(chatProviderSettings.organizationId, ids.orgA),
					eq(chatProviderSettings.provider, "slack"),
				),
			);

		expect(oldRow.status).toBe("retiring");
		expect(oldRow.retirementDeadlineAt?.toISOString()).toBe("2026-12-26T12:00:00.000Z");
		expect(newRow.status).toBe("active");
		expect(settingsRow.isAuthoritative).toBe(true);
		expect(settingsRow.activeInstallationId).toBe(newInstId);
		expect(settingsRow.digestTime).toBe("08:30");

		// Alice's identity carried forward to newInstId, while her DM conversation stays SEPARATE (absent on newInstId)!
		const aliceNewLinks = await db
			.select()
			.from(chatInstallationMemberLink)
			.where(
				and(
					eq(chatInstallationMemberLink.organizationId, ids.orgA),
					eq(chatInstallationMemberLink.installationId, newInstId),
					eq(chatInstallationMemberLink.userId, ids.empUser1),
					eq(chatInstallationMemberLink.isCandidateEnrollment, false),
					eq(chatInstallationMemberLink.isActive, true),
				),
			);
		expect(aliceNewLinks).toHaveLength(1);
		expect(aliceNewLinks[0]).toMatchObject({
			externalUserId: "U_ALICE_SLACK",
			provenance: "verified_same_scope_reuse",
		});

		const aliceNewConvs = await db
			.select()
			.from(chatInstallationConversation)
			.where(
				and(
					eq(chatInstallationConversation.organizationId, ids.orgA),
					eq(chatInstallationConversation.installationId, newInstId),
					eq(chatInstallationConversation.userId, ids.empUser1),
				),
			);
		expect(aliceNewConvs).toHaveLength(0);

		// New Slack notification for Admin routes to the NEW active org-owned Slack installation!
		await sendSlackNotification({
			userId: ids.adminUser,
			organizationId: ids.orgA,
			type: "team_member_added",
			title: "Switched notification",
			message: "Delivered via org-owned Slack app",
		});
		expect(harness.postCalls).toHaveLength(1);
		expect(harness.postCalls[0]).toMatchObject({
			token: "xoxb-new-org-slack-token",
			channel: "D_CANDIDATE_ADMIN",
		});

		// Old card refresh STILL uses the originating retiring legacy installation token!
		const retiringOrigin = await loadOrganizationInstallationById(ids.orgA, oldInstId);
		const refreshResult = await slackApprovalDeliveryAdapter.refresh({
			organizationId: ids.orgA,
			originInstallation: retiringOrigin,
			message: {
				id: "m2045000-0000-4000-8000-000000000001",
				organizationId: ids.orgA,
				provider: "slack",
				receiverScope: `slack-team:${ids.slackTeam}`,
				destinationId: "D_LEGACY_ADMIN",
				remoteMessageId: "1732622400.111111",
			},
			notice: {
				title: "Approval resolved",
				body: "Approved in Z8",
				reviewUrl: "https://z8.test/approvals",
			} as never,
		});
		expect(refreshResult).toEqual({ kind: "accepted" });
		expect(harness.updateCalls).toHaveLength(1);
		expect(harness.updateCalls[0]).toMatchObject({
			token: "xoxb-legacy-slack-token",
			channel: "D_LEGACY_ADMIN",
			ts: "1732622400.111111",
		});

		// Before 30 days with 1 pending legacy card: sweep keeps it `retiring`.
		const midWindow = new Date("2026-12-10T12:00:00.000Z");
		const midSweep = await retireSettledChatInstallations(midWindow, { organizationId: ids.orgA });
		expect(midSweep.retiredCount).toBe(0);

		// At 30 days even while pending legacy card remains: maintenance sweep retires it,
		// AND the pending approval_request remains untouched in Z8 inbox!
		const atDeadline = new Date("2026-12-26T12:00:00.000Z");
		const deadlineSweep = await runDurableChatDispatchMaintenance({
			clock: { nowInstant: () => instantFromDate(atDeadline) },
			organizationId: ids.orgA,
		});
		expect(deadlineSweep.retiredInstallations.retiredCount).toBe(1);
		expect(deadlineSweep.retiredInstallations.retiredByReason.deadlineReached).toBe(1);

		const [retiredRow] = await db
			.select()
			.from(chatInstallation)
			.where(eq(chatInstallation.id, oldInstId));
		expect(retiredRow.status).toBe("retired");
		expect(retiredRow.retiredAt?.toISOString()).toBe(atDeadline.toISOString());

		const [stillPendingApproval] = await db
			.select()
			.from(approvalRequest)
			.where(eq(approvalRequest.id, pendingReq.id));
		expect(stillPendingApproval.status).toBe("pending");
	});

	it("auto-retires a retiring installation early as work_settled once open cards reach 0", async () => {
		await db.insert(chatInstallationSwitchControl).values({
			organizationId: ids.orgA,
			provider: "slack",
			enabledByUserId: ids.adminUser,
		});

		const preview = await buildChatSwitchImpactPreview(
			{ organizationId: ids.orgA, provider: "slack" },
			{ now: () => T0, syncLegacy: false },
		);

		const switched = await confirmChatInstallationSwitch(
			{
				organizationId: ids.orgA,
				provider: "slack",
				actorUserId: ids.adminUser,
				candidateInstallationId: preview.candidateInstallation!.id,
				reviewedCurrentInstallationId: preview.primaryCurrentInstallationId,
				reviewedCurrentCredentialRevisionId: preview.primaryCurrentCredentialRevisionId,
				reviewedCandidateCredentialRevisionId:
					preview.candidateInstallation!.activeCredentialRevisionId,
				reviewedImpactDigest: preview.impactDigest,
				acknowledgeUnreadyEmployees: true,
			},
			{ now: () => T0 },
		);
		expect(switched.kind).toBe("switched");

		// Zero open cards -> retires immediately on sweep well before the 30-day deadline!
		const oneDayLater = new Date("2026-11-27T12:00:00.000Z");
		const settledSweep = await retireSettledChatInstallations(oneDayLater, {
			organizationId: ids.orgA,
		});
		expect(settledSweep.retiredCount).toBe(1);
		expect(settledSweep.retiredByReason.workSettled).toBe(1);
	});
});
