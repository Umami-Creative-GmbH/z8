/**
 * #2050 / #2037 PostgreSQL 16 integration rehearsal:
 * - TWO-TENANT legacy Microsoft Teams organization (Tenant A + Tenant B) with disagreeing
 *   settings and open approval cards in BOTH tenants
 * - Impact preview enumerates every affected live tenant, highlights settings disagreements,
 *   computes per-tenant card counts and deterministic impactDigest
 * - Drift detection (`impact_changed` + `freshPreview`) when a legacy tenant's settings or
 *   status changes between preview and confirmation
 * - Atomic single-transaction cutover activating the verified single-tenant org-owned app
 *   and retiring BOTH Tenant A and Tenant B together, writing admin-confirmed authoritative
 *   settings, and promoting verified candidate enrollments & same-tenant Entra identity
 * - Organization-owned Teams operates with its own Vault credentials COMPLETELY INDEPENDENTLY
 *   of deployment env vars (`MICROSOFT_APP_ID` / `MICROSOFT_APP_PASSWORD` unset!)
 * - Retiring old approval cards in BOTH Tenant A and Tenant B route & refresh strictly to
 *   their respective originating tenant and conversation (never mixing tenants!)
 * - Separately scoped per-tenant revoke immediately stops Tenant A while Tenant B and the
 *   active org-owned Teams app continue unaffected
 * - Same-app credential rotation preserves installation, conversations, and card ownership
 * - Superseded legacy setup mutations (`POST /api/teams/setup`, `disconnectLegacyTeamsTenantInstallation`)
 *   are blocked with 410 Gone
 * - Verified switch-back / restore requires fresh verification and reactivates cleanly
 */

import type { CloudAdapter, TurnContext } from "botbuilder";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	secrets: new Map<string, string>(),
	envMicrosoftAppId: "11111111-2222-4333-8444-555555555000" as string | undefined,
	envMicrosoftAppPassword: "legacy-deployment-secret" as string | undefined,
	sentActivities: [] as Array<{
		appId: string;
		conversationId: string;
		method: "send" | "update";
		activityId?: string;
	}>,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/env", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/env")>();
	return {
		...actual,
		env: new Proxy(actual.env, {
			get(target, prop) {
				if (prop === "MICROSOFT_APP_ID") return harness.envMicrosoftAppId;
				if (prop === "MICROSOFT_APP_PASSWORD") return harness.envMicrosoftAppPassword;
				return Reflect.get(target, prop);
			},
		}),
	};
});

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getActiveSecretStoreProvider: () => "vault" as const,
	storeOrgSecret: async (organizationId: string, key: string, value: string) => {
		harness.secrets.set(`${organizationId}:${key}`, value);
	},
	getOrgSecret: async (organizationId: string, key: string) =>
		harness.secrets.get(`${organizationId}:${key}`) ?? null,
	deleteOrgSecret: async (organizationId: string, key: string) => {
		harness.secrets.delete(`${organizationId}:${key}`);
	},
}));

vi.mock("@/lib/teams/bot-adapter", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/teams/bot-adapter")>();
	const makeMockCloudAdapter = (expectedAppId: string): CloudAdapter =>
		({
			continueConversationAsync: async (
				appId: string,
				ref: { conversation?: { id?: string } },
				logic: (ctx: TurnContext) => Promise<void>,
			) => {
				const convId = ref.conversation?.id ?? "unknown";
				await logic({
					sendActivity: async () => {
						harness.sentActivities.push({
							appId: appId || expectedAppId,
							conversationId: convId,
							method: "send",
						});
						return { id: `sent-${convId}-${harness.sentActivities.length}` };
					},
					updateActivity: async (act: { id?: string }) => {
						harness.sentActivities.push({
							appId: appId || expectedAppId,
							conversationId: convId,
							method: "update",
							activityId: act.id,
						});
					},
				} as unknown as TurnContext);
			},
		}) as unknown as CloudAdapter;

	return {
		...actual,
		getBotAdapter: () => {
			if (!harness.envMicrosoftAppId || !harness.envMicrosoftAppPassword) {
				throw new Error("Deployment Teams credentials unset");
			}
			return makeMockCloudAdapter(harness.envMicrosoftAppId);
		},
		getTeamsInstallationBotAdapter: (config: { appId: string }) =>
			makeMockCloudAdapter(config.appId),
	};
});

const { db } = await import("@/db");
const {
	approvalRequest,
	chatInstallation,
	chatInstallationConversation,
	chatInstallationMemberLink,
	chatInstallationSwitchControl,
	chatProviderSettings,
	teamsApprovalCard,
	teamsConversation,
	teamsTenantConfig,
	teamsUserMapping,
} = await import("@/db/schema");
const { checkInboundApprovalCardInstallationEligibility, resolveCardOriginInstallation } =
	await import("@/lib/approvals/delivery/installation-origin");
const {
	backfillOrganizationChatInstallations,
	beginTeamsInstallationRestore,
	buildTeamsSwitchImpactPreview,
	configureTeamsCandidateCredentials,
	confirmTeamsInstallationRestore,
	confirmTeamsOrganizationSwitch,
	disconnectLegacyTeamsTenantInstallation,
	handleTeamsInstallationMessageRequest,
	issueChatLinkProof,
	prepareTeamsCandidateInstallation,
	revokeLegacyTeamsTenantInstallation,
	revokeTeamsInstallation,
	rotateTeamsInstallationCredentials,
	sendTeamsCandidateProactiveTestMessage,
	verifyRestoredTeamsInstallation,
} = await import("@/lib/chat-installations");
const { isTeamsAvailable } = await import("@/lib/notifications/teams-channel");
const { teamsApprovalDeliveryAdapter } = await import("@/lib/teams/approval-delivery");
const { resolveTeamsOutboundTransportForOrganization } = await import("@/lib/teams/bot-adapter");
const { resolveTenant } = await import("@/lib/teams/tenant-resolver");
const { POST: legacyTeamsSetupPost } = await import("@/app/api/teams/setup/route");

const ids = {
	org: "t2050-org-multi",
	adminUser: "t2050-admin",
	mgrAUser: "t2050-mgr-a",
	mgrBUser: "t2050-mgr-b",
	empReqUser: "t2050-req",
	empAdminId: "e2050000-0000-4000-8000-000000000001",
	empMgrAId: "e2050000-0000-4000-8000-000000000002",
	empMgrBId: "e2050000-0000-4000-8000-000000000003",
	empReqId: "e2050000-0000-4000-8000-000000000004",
	approvalAId: "a2050000-0000-4000-8000-000000000001",
	approvalBId: "a2050000-0000-4000-8000-000000000002",
	legacyAppId: "11111111-2222-4333-8444-555555555000",
	orgOwnedAppId: "11111111-2222-4333-8444-555555555999",
	tenantA: "aaaa1111-2222-4333-8444-555555555001",
	tenantB: "bbbb1111-2222-4333-8444-555555555002",
	aadMgrA: "dddd1111-2222-4333-8444-555555555001",
	aadMgrB: "dddd1111-2222-4333-8444-555555555002",
} as const;

function makeVerifiedInboundAdapter(claimsAppId: string, claimsTenantId: string): CloudAdapter {
	const BotIdentityKey = Symbol("BotIdentity");
	return {
		BotIdentityKey,
		async process(
			req: { body: Record<string, unknown> },
			_res: unknown,
			logic: (context: TurnContext) => Promise<void>,
		) {
			const turnState = new Map<unknown, unknown>();
			const claims = [
				{ type: "appid", value: claimsAppId },
				{ type: "tid", value: claimsTenantId },
			];
			turnState.set(BotIdentityKey, {
				isAuthenticated: true,
				claims,
				getClaimValue: (type: string) => claims.find((c) => c.type === type)?.value ?? null,
			});
			const context = {
				activity: req.body,
				turnState,
				sendActivity: async () => ({ id: "reply-1" }),
			} as unknown as TurnContext;
			await logic(context);
		},
	} as unknown as CloudAdapter;
}

describe("multi-tenant Teams switch, per-tenant revoke, rotation & restore (PostgreSQL #2050)", () => {
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.org]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.adminUser, ids.mgrAUser, ids.mgrBUser, ids.empReqUser],
		]);
	}

	async function seedTwoTenantOrg() {
		await cleanup();
		const ts = new Date("2026-11-20T10:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'Multi-Tenant Teams Org', $1, $2)`,
			[ids.org, ts],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Teams Admin', 't2050-admin@example.test', $5, $5),
			 ($2, 'Manager A', 't2050-mgra@example.test', $5, $5),
			 ($3, 'Manager B', 't2050-mgrb@example.test', $5, $5),
			 ($4, 'Requester', 't2050-req@example.test', $5, $5)`,
			[ids.adminUser, ids.mgrAUser, ids.mgrBUser, ids.empReqUser, ts],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t2050-m-1', $1, $2, 'admin', 'approved', $6),
			 ('t2050-m-2', $1, $3, 'member', 'approved', $6),
			 ('t2050-m-3', $1, $4, 'member', 'approved', $6),
			 ('t2050-m-4', $1, $5, 'member', 'approved', $6)`,
			[ids.org, ids.adminUser, ids.mgrAUser, ids.mgrBUser, ids.empReqUser, ts],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $5, $9, 'admin', true, $10),
			 ($2, $6, $9, 'manager', true, $10),
			 ($3, $7, $9, 'manager', true, $10),
			 ($4, $8, $9, 'employee', true, $10)`,
			[
				ids.empAdminId,
				ids.empMgrAId,
				ids.empMgrBId,
				ids.empReqId,
				ids.adminUser,
				ids.mgrAUser,
				ids.mgrBUser,
				ids.empReqUser,
				ids.org,
				ts,
			],
		);

		// Seed TWO legacy Teams tenants with DISAGREEING settings!
		await db.insert(teamsTenantConfig).values([
			{
				organizationId: ids.org,
				tenantId: ids.tenantA,
				tenantName: "Subsidiary A M365",
				setupStatus: "active",
				enableApprovals: true,
				enableCommands: true,
				enableDailyDigest: true,
				enableEscalations: true,
				digestTime: "08:00",
				digestTimezone: "Europe/Berlin",
				escalationTimeoutHours: 24,
				configuredByUserId: ids.adminUser,
				configuredAt: ts,
				serviceUrl: "https://smba.trafficmanager.net/emea/",
			},
			{
				organizationId: ids.org,
				tenantId: ids.tenantB,
				tenantName: "Subsidiary B M365",
				setupStatus: "active",
				enableApprovals: true,
				enableCommands: false,
				enableDailyDigest: true,
				enableEscalations: false,
				digestTime: "09:30",
				digestTimezone: "UTC",
				escalationTimeoutHours: 48,
				configuredByUserId: ids.adminUser,
				configuredAt: new Date("2026-11-21T10:00:00Z"),
				serviceUrl: "https://smba.trafficmanager.net/amer/",
			},
		]);

		// Legacy user mappings & personal conversations in BOTH tenants
		await db.insert(teamsUserMapping).values([
			{
				organizationId: ids.org,
				userId: ids.mgrAUser,
				teamsUserId: ids.aadMgrA,
				teamsEmail: "t2050-mgra@example.test",
				teamsTenantId: ids.tenantA,
				teamsDisplayName: "Manager A",
				isActive: true,
			},
			{
				organizationId: ids.org,
				userId: ids.mgrBUser,
				teamsUserId: ids.aadMgrB,
				teamsEmail: "t2050-mgrb@example.test",
				teamsTenantId: ids.tenantB,
				teamsDisplayName: "Manager B",
				isActive: true,
			},
		]);

		await db.insert(teamsConversation).values([
			{
				organizationId: ids.org,
				userId: ids.mgrAUser,
				teamsConversationId: "a:legacy-conv-tenant-a",
				teamsServiceUrl: "https://smba.trafficmanager.net/emea/",
				teamsTenantId: ids.tenantA,
				conversationType: "personal",
				conversationReference: JSON.stringify({
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					channelId: "msteams",
					conversation: { id: "a:legacy-conv-tenant-a", tenantId: ids.tenantA },
					bot: { id: `28:${ids.legacyAppId}` },
				}),
				isActive: true,
			},
			{
				organizationId: ids.org,
				userId: ids.mgrBUser,
				teamsConversationId: "a:legacy-conv-tenant-b",
				teamsServiceUrl: "https://smba.trafficmanager.net/amer/",
				teamsTenantId: ids.tenantB,
				conversationType: "personal",
				conversationReference: JSON.stringify({
					serviceUrl: "https://smba.trafficmanager.net/amer/",
					channelId: "msteams",
					conversation: { id: "a:legacy-conv-tenant-b", tenantId: ids.tenantB },
					bot: { id: `28:${ids.legacyAppId}` },
				}),
				isActive: true,
			},
		]);

		await backfillOrganizationChatInstallations(ids.org, {
			db,
			deploymentConfig: {
				microsoftAppId: ids.legacyAppId,
				microsoftAppPassword: "legacy-deployment-secret",
			},
		});

		const legacyInsts = await db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, ids.org),
					eq(chatInstallation.provider, "teams"),
					eq(chatInstallation.status, "legacy_active"),
				),
			);
		const instA = legacyInsts.find((i) => i.externalSpaceId === ids.tenantA)!;
		const instB = legacyInsts.find((i) => i.externalSpaceId === ids.tenantB)!;

		// Seed pending approval requests and open legacy approval cards in BOTH Tenant A and Tenant B!
		await db.insert(approvalRequest).values([
			{
				id: ids.approvalAId,
				organizationId: ids.org,
				entityType: "absence_entry",
				entityId: "10500000-0000-4000-8000-000000000001",
				requestedBy: ids.empReqId,
				approverId: ids.empMgrAId,
				status: "pending",
			},
			{
				id: ids.approvalBId,
				organizationId: ids.org,
				entityType: "absence_entry",
				entityId: "10500000-0000-4000-8000-000000000002",
				requestedBy: ids.empReqId,
				approverId: ids.empMgrBId,
				status: "pending",
			},
		]);

		await db.insert(teamsApprovalCard).values([
			{
				approvalRequestId: ids.approvalAId,
				organizationId: ids.org,
				recipientUserId: ids.mgrAUser,
				teamsConversationId: "a:legacy-conv-tenant-a",
				teamsActivityId: "act-tenant-a-1",
				teamsMessageId: "act-tenant-a-1",
				installationId: instA.id,
				status: "sent",
			},
			{
				approvalRequestId: ids.approvalBId,
				organizationId: ids.org,
				recipientUserId: ids.mgrBUser,
				teamsConversationId: "a:legacy-conv-tenant-b",
				teamsActivityId: "act-tenant-b-1",
				teamsMessageId: "act-tenant-b-1",
				installationId: instB.id,
				status: "sent",
			},
		]);

		return { instA, instB };
	}

	beforeEach(() => {
		harness.secrets.clear();
		harness.sentActivities.length = 0;
		harness.envMicrosoftAppId = ids.legacyAppId;
		harness.envMicrosoftAppPassword = "legacy-deployment-secret";
	});

	afterAll(async () => {
		await cleanup();
	});

	it("rehearses full two-tenant legacy switch, drift guard, org-owned independence, per-tenant old-card routing & revoke, rotation, legacy setup closure, and verified restore", async () => {
		const { instA, instB } = await seedTwoTenantOrg();

		// 1. Prepare, configure, verify inbound activity & proactive test for single-tenant org-owned Teams app (in Tenant A)
		const prepared = await prepareTeamsCandidateInstallation(
			{ organizationId: ids.org, actorUserId: ids.adminUser, organizationName: "Multi-Tenant Org" },
			{ db, appUrl: "https://app.z8-time.test" },
		);
		const saved = await configureTeamsCandidateCredentials(
			{
				organizationId: ids.org,
				actorUserId: ids.adminUser,
				installationId: prepared.installationId,
				microsoftAppId: ids.orgOwnedAppId,
				microsoftTenantId: ids.tenantA,
				microsoftAppPassword: "org-owned-secret-v1-xyz",
				tenantDisplayName: "Contoso Org-Owned Teams",
			},
			{ db, appUrl: "https://app.z8-time.test" },
		);
		expect(saved.kind).toBe("ok");

		const inboundAdapter = makeVerifiedInboundAdapter(ids.orgOwnedAppId, ids.tenantA);
		// Manager A has proven same-tenant Entra identity -> auto-enrolls in segregated candidate lane
		const inboundA = await handleTeamsInstallationMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({
					type: "message",
					id: "cand-1",
					text: "verify",
					channelId: "msteams",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: {
						id: "a:cand-personal-mgr-a",
						tenantId: ids.tenantA,
						conversationType: "personal",
					},
					recipient: { id: `28:${ids.orgOwnedAppId}` },
					from: { id: "29:mgra", aadObjectId: ids.aadMgrA, name: "Manager A" },
				}),
				authorizationHeader: "Bearer verified-jwt",
			},
			{ db, getAdapter: () => inboundAdapter },
		);
		expect(inboundA.status).toBe(200);

		// Manager B enrolls via organization- and installation-bound link proof
		const issued = await issueChatLinkProof(
			{
				organizationId: ids.org,
				installationId: prepared.installationId,
				userId: ids.mgrBUser,
				purpose: "candidate_enrollment",
			},
			{ db },
		);
		expect(issued.status).toBe("issued");
		if (issued.status !== "issued") return;

		const inboundB = await handleTeamsInstallationMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({
					type: "message",
					id: "cand-2",
					text: `link ${issued.code}`,
					channelId: "msteams",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: {
						id: "a:cand-personal-mgr-b",
						tenantId: ids.tenantA,
						conversationType: "personal",
					},
					recipient: { id: `28:${ids.orgOwnedAppId}` },
					from: { id: "29:mgrb", aadObjectId: ids.aadMgrB, name: "Manager B" },
				}),
				authorizationHeader: "Bearer verified-jwt",
			},
			{ db, getAdapter: () => inboundAdapter },
		);
		expect(inboundB.status).toBe(200);

		const proactive = await sendTeamsCandidateProactiveTestMessage(
			{
				organizationId: ids.org,
				actorUserId: ids.adminUser,
				installationId: prepared.installationId,
			},
			{
				db,
				getAdapter: () => inboundAdapter,
				sendProactiveTest: async () => ({ kind: "ok", activityId: "proactive-test-1" }),
			},
		);
		expect(proactive.kind).toBe("ok");

		// 2. Preview enumerates BOTH legacy tenants, settings disagreements, and per-tenant open card counts
		const gatedPreview = await buildTeamsSwitchImpactPreview(ids.org, prepared.installationId, {
			db,
		});
		expect(gatedPreview.switchControlEnabled).toBe(false);
		expect(gatedPreview.affectedTenants).toHaveLength(2);
		expect(gatedPreview.affectedTenants.map((t) => t.tenantId).toSorted()).toEqual([
			ids.tenantA,
			ids.tenantB,
		]);
		expect(gatedPreview.affectedTenants.every((t) => t.pendingLegacyCards === 1)).toBe(true);
		expect(gatedPreview.approvalImpact.pendingLegacyCards).toBe(2);
		expect(gatedPreview.hasSettingsDisagreements).toBe(true);
		expect(gatedPreview.settingsDisagreements.map((d) => d.field).toSorted()).toEqual([
			"digestTime",
			"digestTimezone",
			"enableCommands",
			"enableEscalations",
			"escalationTimeoutHours",
		]);
		expect(gatedPreview.employeeImpact.verifiedReachableEmployees).toBe(2);
		expect(gatedPreview.employeeImpact.unreadyEmployees).toBe(2); // adminUser + empReqUser

		// Refused when switch control is disabled
		const gatedRefusal = await confirmTeamsOrganizationSwitch(
			{
				organizationId: ids.org,
				actorUserId: ids.adminUser,
				candidateInstallationId: prepared.installationId,
				reviewedAffectedInstallationIds: [instA.id, instB.id],
				reviewedCandidateCredentialRevisionId:
					gatedPreview.candidateInstallation?.activeCredentialRevisionId ?? null,
				reviewedImpactDigest: gatedPreview.impactDigest,
				acknowledgeUnreadyEmployees: true,
				confirmedReplacementSettings: gatedPreview.proposedReplacementSettings,
			},
			{ db },
		);
		expect(gatedRefusal).toMatchObject({ kind: "refused", code: "switch_not_enabled" });

		// Enable per-org Teams switch gate
		await db.insert(chatInstallationSwitchControl).values({
			organizationId: ids.org,
			provider: "teams",
			enabledByUserId: ids.adminUser,
		});

		const previewBeforeDrift = await buildTeamsSwitchImpactPreview(
			ids.org,
			prepared.installationId,
			{ db },
		);
		expect(previewBeforeDrift.canConfirm).toBe(true);

		// Refused when settings disagree and admin did NOT confirm replacement settings
		const missingSettingsConfirm = await confirmTeamsOrganizationSwitch(
			{
				organizationId: ids.org,
				actorUserId: ids.adminUser,
				candidateInstallationId: prepared.installationId,
				reviewedAffectedInstallationIds: [instA.id, instB.id],
				reviewedCandidateCredentialRevisionId:
					previewBeforeDrift.candidateInstallation?.activeCredentialRevisionId ?? null,
				reviewedImpactDigest: previewBeforeDrift.impactDigest,
				acknowledgeUnreadyEmployees: true,
				confirmedReplacementSettings: null,
			},
			{ db },
		);
		expect(missingSettingsConfirm).toMatchObject({
			kind: "refused",
			code: "settings_confirmation_required",
		});

		// 3. Simulate live drift (Tenant B's escalationTimeoutHours changed before confirm) -> refuses with impact_changed!
		await db
			.update(teamsTenantConfig)
			.set({ escalationTimeoutHours: 72 })
			.where(
				and(
					eq(teamsTenantConfig.organizationId, ids.org),
					eq(teamsTenantConfig.tenantId, ids.tenantB),
				),
			);

		const driftedResult = await confirmTeamsOrganizationSwitch(
			{
				organizationId: ids.org,
				actorUserId: ids.adminUser,
				candidateInstallationId: prepared.installationId,
				reviewedAffectedInstallationIds: [instA.id, instB.id],
				reviewedCandidateCredentialRevisionId:
					previewBeforeDrift.candidateInstallation?.activeCredentialRevisionId ?? null,
				reviewedImpactDigest: previewBeforeDrift.impactDigest,
				acknowledgeUnreadyEmployees: true,
				confirmedReplacementSettings: previewBeforeDrift.proposedReplacementSettings,
			},
			{ db },
		);
		expect(driftedResult.kind).toBe("refused");
		if (driftedResult.kind !== "refused") return;
		expect(driftedResult.code).toBe("impact_changed");
		expect(driftedResult.freshPreview.impactDigest).not.toBe(previewBeforeDrift.impactDigest);

		// 4. Confirm atomic multi-tenant switch with freshPreview and explicit admin-confirmed settings!
		const adminConfirmedSettings = {
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: true,
			digestTime: "08:30",
			digestTimezone: "Europe/Berlin",
			escalationTimeoutHours: 12,
		};

		const switched = await confirmTeamsOrganizationSwitch(
			{
				organizationId: ids.org,
				actorUserId: ids.adminUser,
				candidateInstallationId: prepared.installationId,
				reviewedAffectedInstallationIds: driftedResult.freshPreview.affectedTenants.map(
					(t) => t.installationId,
				),
				reviewedCandidateCredentialRevisionId:
					driftedResult.freshPreview.candidateInstallation?.activeCredentialRevisionId ?? null,
				reviewedImpactDigest: driftedResult.freshPreview.impactDigest,
				acknowledgeUnreadyEmployees: true,
				confirmedReplacementSettings: adminConfirmedSettings,
			},
			{ db },
		);
		expect(switched.kind).toBe("switched");
		if (switched.kind !== "switched") return;
		expect(switched.activeInstallationId).toBe(prepared.installationId);
		expect(switched.retiredInstallationIds.toSorted()).toEqual([instA.id, instB.id].toSorted());
		expect(switched.promotedEnrollmentCount).toBe(2);
		expect(switched.effectiveSettings).toEqual(adminConfirmedSettings);

		// Verify DB state: candidate is active, BOTH legacy tenants are retiring with 30-day deadline,
		// chat_provider_settings is authoritative with admin-confirmed settings, candidate enrollments promoted
		const [settingsRow] = await db
			.select()
			.from(chatProviderSettings)
			.where(
				and(
					eq(chatProviderSettings.organizationId, ids.org),
					eq(chatProviderSettings.provider, "teams"),
				),
			);
		expect(settingsRow?.isAuthoritative).toBe(true);
		expect(settingsRow?.activeInstallationId).toBe(prepared.installationId);
		expect(settingsRow?.digestTime).toBe("08:30");
		expect(settingsRow?.escalationTimeoutHours).toBe(12);

		const promotedLinks = await db
			.select()
			.from(chatInstallationMemberLink)
			.where(
				and(
					eq(chatInstallationMemberLink.organizationId, ids.org),
					eq(chatInstallationMemberLink.installationId, prepared.installationId),
					eq(chatInstallationMemberLink.isActive, true),
				),
			);
		expect(promotedLinks).toHaveLength(2);
		expect(promotedLinks.every((l) => l.isCandidateEnrollment === false)).toBe(true);

		// 5. Prove org-owned Teams operates COMPLETELY INDEPENDENTLY of deployment env vars!
		harness.envMicrosoftAppId = undefined;
		harness.envMicrosoftAppPassword = undefined;

		expect(await isTeamsAvailable(ids.org)).toBe(true);
		const orgTransport = await resolveTeamsOutboundTransportForOrganization(ids.org, { db });
		expect(orgTransport.kind).toBe("ok");
		if (orgTransport.kind !== "ok") return;
		expect(orgTransport.source).toBe("organization_owned");
		expect(orgTransport.appId).toBe(ids.orgOwnedAppId);
		expect(orgTransport.installationId).toBe(prepared.installationId);

		// Active org-owned inbound endpoint runs production handler with deployment env vars UNSET!
		const productionSpy = vi.fn().mockResolvedValue(undefined);
		const activeInbound = await handleTeamsInstallationMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({
					type: "message",
					id: "prod-msg-1",
					text: "status",
					channelId: "msteams",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: {
						id: "a:cand-personal-mgr-a",
						tenantId: ids.tenantA,
						conversationType: "personal",
					},
					recipient: { id: `28:${ids.orgOwnedAppId}` },
					from: { id: "29:mgra", aadObjectId: ids.aadMgrA, name: "Manager A" },
				}),
				authorizationHeader: "Bearer verified-jwt",
			},
			{ db, getAdapter: () => inboundAdapter, handleProductionActivity: productionSpy },
		);
		expect(activeInbound.status).toBe(200);
		expect(productionSpy).toHaveBeenCalledTimes(1);
		expect(productionSpy.mock.calls[0]?.[1]).toMatchObject({
			installationId: prepared.installationId,
			microsoftAppId: ids.orgOwnedAppId,
			installationStatus: "active",
			digestTime: "08:30",
		});

		// 6. Restore deployment env vars to rehearse BOTH retiring legacy tenants' old cards!
		harness.envMicrosoftAppId = ids.legacyAppId;
		harness.envMicrosoftAppPassword = "legacy-deployment-secret";

		const resolvedTenantA = await resolveTenant(ids.tenantA);
		const resolvedTenantB = await resolveTenant(ids.tenantB);
		expect(resolvedTenantA.status).toBe("configured");
		expect(resolvedTenantB.status).toBe("configured");
		if (resolvedTenantA.status !== "configured" || resolvedTenantB.status !== "configured") return;
		expect(resolvedTenantA.tenant.installationStatus).toBe("retiring");
		expect(resolvedTenantA.tenant.installationId).toBe(instA.id);
		expect(resolvedTenantB.tenant.installationStatus).toBe("retiring");
		expect(resolvedTenantB.tenant.installationId).toBe(instB.id);

		// Card origin & refresh strictly isolate Tenant A vs Tenant B!
		const originA = await resolveCardOriginInstallation({
			organizationId: ids.org,
			provider: "teams",
			installationId: instA.id,
		});
		const originB = await resolveCardOriginInstallation({
			organizationId: ids.org,
			provider: "teams",
			installationId: instB.id,
		});
		expect(originA.kind).toBe("serviceable");
		expect(originB.kind).toBe("serviceable");
		if (originA.kind !== "serviceable" || originB.kind !== "serviceable") return;

		// Cross-tenant conversation refresh attempt is rejected (Tenant A origin cannot refresh Tenant B's conversation)
		const crossTenantRefresh = await teamsApprovalDeliveryAdapter.refresh({
			organizationId: ids.org,
			originInstallation: originA.installation,
			message: {
				id: "m-cross",
				receiverScope: instA.receiverScope!,
				destinationId: "a:legacy-conv-tenant-b",
				remoteMessageId: "act-tenant-b-1",
			},
			notice: {
				title: "Updated",
				text: "Done",
				reviewLabel: "Review",
				reviewUrl: "https://z8.test",
			},
		});
		expect(crossTenantRefresh).toEqual({ kind: "gone", reason: "conversation_unknown" });

		// Valid same-tenant refreshes succeed for BOTH Tenant A and Tenant B!
		const refreshA = await teamsApprovalDeliveryAdapter.refresh({
			organizationId: ids.org,
			originInstallation: originA.installation,
			message: {
				id: "m-a",
				receiverScope: instA.receiverScope!,
				destinationId: "a:legacy-conv-tenant-a",
				remoteMessageId: "act-tenant-a-1",
			},
			notice: {
				title: "Approved",
				text: "Done",
				reviewLabel: "Review",
				reviewUrl: "https://z8.test",
			},
		});
		const refreshB = await teamsApprovalDeliveryAdapter.refresh({
			organizationId: ids.org,
			originInstallation: originB.installation,
			message: {
				id: "m-b",
				receiverScope: instB.receiverScope!,
				destinationId: "a:legacy-conv-tenant-b",
				remoteMessageId: "act-tenant-b-1",
			},
			notice: {
				title: "Approved",
				text: "Done",
				reviewLabel: "Review",
				reviewUrl: "https://z8.test",
			},
		});
		expect(refreshA).toEqual({ kind: "accepted" });
		expect(refreshB).toEqual({ kind: "accepted" });

		// 7. Separately scoped per-tenant revoke: revoking Tenant A immediately blocks Tenant A while Tenant B & active org-owned app continue!
		const revokedA = await revokeLegacyTeamsTenantInstallation(ids.org, instA.id, ids.adminUser, {
			db,
		});
		expect(revokedA).toMatchObject({ kind: "revoked", installationId: instA.id });

		// Tenant A immediately ends local authorization
		expect(await resolveTenant(ids.tenantA)).toEqual({
			status: "unconfigured",
			tenantId: ids.tenantA,
		});
		const eligA = await checkInboundApprovalCardInstallationEligibility({
			organizationId: ids.org,
			provider: "teams",
			incomingInstallationId: instA.id,
			messageInstallationId: instA.id,
		});
		expect(eligA).toEqual({
			allowed: false,
			reason: "installation_revoked",
			fallback: "z8_inbox",
		});

		// Tenant B is STILL serviceable AND active org-owned Teams app is STILL active!
		const eligB = await checkInboundApprovalCardInstallationEligibility({
			organizationId: ids.org,
			provider: "teams",
			incomingInstallationId: instB.id,
			messageInstallationId: instB.id,
		});
		expect(eligB).toEqual({ allowed: true, installationId: instB.id, isRetiring: true });
		expect(await isTeamsAvailable(ids.org)).toBe(true);

		// 8. Superseded legacy setup routes are blocked (`410 Gone`)
		const legacyPostResp = await legacyTeamsSetupPost();
		expect(legacyPostResp.status).toBe(410);
		const legacyDeleteBlocked = await disconnectLegacyTeamsTenantInstallation(
			{ organizationId: ids.org, actorUserId: ids.adminUser, tenantId: ids.tenantB },
			{ db },
		);
		expect(legacyDeleteBlocked).toMatchObject({
			kind: "refused",
			code: "legacy_setup_superseded",
			status: 410,
		});

		// 9. Same-app credential rotation verifies App ID + Tenant ID, creates revision v2, and preserves installation & conversations!
		const badRotate = await rotateTeamsInstallationCredentials(
			{
				organizationId: ids.org,
				installationId: prepared.installationId,
				actorUserId: ids.adminUser,
				microsoftAppId: "99999999-2222-4333-8444-555555555999",
				microsoftTenantId: ids.tenantA,
				microsoftAppPassword: "rotated-secret-v2-xyz",
			},
			{ db },
		);
		expect(badRotate).toMatchObject({ kind: "refused", code: "external_identity_mismatch" });

		const rotated = await rotateTeamsInstallationCredentials(
			{
				organizationId: ids.org,
				installationId: prepared.installationId,
				actorUserId: ids.adminUser,
				microsoftAppId: ids.orgOwnedAppId,
				microsoftTenantId: ids.tenantA,
				microsoftAppPassword: "rotated-secret-v2-xyz",
			},
			{ db },
		);
		expect(rotated.kind).toBe("rotated");
		if (rotated.kind !== "rotated") return;
		expect(rotated.newRevisionNumber).toBe(2);
		expect(rotated.installationId).toBe(prepared.installationId);

		// Conversations on the org-owned installation are preserved after rotation
		const convsAfterRotate = await db
			.select()
			.from(chatInstallationConversation)
			.where(
				and(
					eq(chatInstallationConversation.organizationId, ids.org),
					eq(chatInstallationConversation.installationId, prepared.installationId),
				),
			);
		expect(convsAfterRotate).toHaveLength(2);

		// 10. Revoke active org-owned Teams app -> immediately refuses inbound traffic -> verified switch-back / restore!
		const revokedActive = await revokeTeamsInstallation(
			{
				organizationId: ids.org,
				installationId: prepared.installationId,
				actorUserId: ids.adminUser,
			},
			{ db },
		);
		expect(revokedActive.kind).toBe("revoked");

		const revokedInbound = await handleTeamsInstallationMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: "{}",
				authorizationHeader: "Bearer verified-jwt",
			},
			{ db, getAdapter: () => inboundAdapter },
		);
		expect(revokedInbound.status).toBe(403);

		const restoreStarted = await beginTeamsInstallationRestore(
			{
				organizationId: ids.org,
				installationId: prepared.installationId,
				actorUserId: ids.adminUser,
			},
			{ db },
		);
		expect(restoreStarted).toMatchObject({
			kind: "restore_started",
			status: "candidate",
			requiresCredentials: true,
		});

		const verifyCreds = await verifyRestoredTeamsInstallation(
			{
				organizationId: ids.org,
				installationId: prepared.installationId,
				actorUserId: ids.adminUser,
				microsoftAppId: ids.orgOwnedAppId,
				microsoftTenantId: ids.tenantA,
				microsoftAppPassword: "restored-secret-v3-xyz",
			},
			{ db },
		);
		expect(verifyCreds.kind).toBe("verified_step");
		if (verifyCreds.kind !== "verified_step") return;
		// Fresh inbound activity + proactive test are still required before restore can activate!
		expect(verifyCreds.readyForSwitch).toBe(false);

		const freshInbound = await handleTeamsInstallationMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({
					type: "message",
					id: "restore-verify-1",
					text: "verify",
					channelId: "msteams",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: {
						id: "a:cand-personal-mgr-a",
						tenantId: ids.tenantA,
						conversationType: "personal",
					},
					recipient: { id: `28:${ids.orgOwnedAppId}` },
					from: { id: "29:mgra", aadObjectId: ids.aadMgrA, name: "Manager A" },
				}),
				authorizationHeader: "Bearer verified-jwt",
			},
			{ db, getAdapter: () => inboundAdapter },
		);
		expect(freshInbound.status).toBe(200);

		const verifyProactive = await verifyRestoredTeamsInstallation(
			{
				organizationId: ids.org,
				installationId: prepared.installationId,
				actorUserId: ids.adminUser,
				sendProactiveTest: true,
			},
			{
				db,
				getAdapter: () => inboundAdapter,
				sendProactiveTest: async () => ({ kind: "ok", activityId: "restore-proactive-1" }),
			},
		);
		expect(verifyProactive.kind).toBe("verified_step");
		if (verifyProactive.kind !== "verified_step") return;
		expect(verifyProactive.readyForSwitch).toBe(true);

		const restored = await confirmTeamsInstallationRestore(
			{
				organizationId: ids.org,
				actorUserId: ids.adminUser,
				candidateInstallationId: prepared.installationId,
				reviewedAffectedInstallationIds: verifyProactive.preview.affectedTenants.map(
					(t) => t.installationId,
				),
				reviewedCandidateCredentialRevisionId:
					verifyProactive.preview.candidateInstallation?.activeCredentialRevisionId ?? null,
				reviewedImpactDigest: verifyProactive.preview.impactDigest,
				acknowledgeUnreadyEmployees: true,
			},
			{ db },
		);
		expect(restored.kind).toBe("switched");
		if (restored.kind !== "switched") return;
		expect(restored.activeInstallationId).toBe(prepared.installationId);
	});
});
