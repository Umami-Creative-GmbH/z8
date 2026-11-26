/**
 * #2049 / #2037 PostgreSQL 16 integration coverage:
 * - Staging a single-tenant replacement in the SAME Teams tenant as an active legacy Teams installation
 * - Blocking another organization from claiming that Teams tenant or app ID
 * - Segregating candidate conversations & candidate enrollment (proven same-tenant Entra identity AND link proof)
 *   from active legacy Teams links and conversations
 * - Confirming legacy Teams tenant config & delivery resolvers remain uninterrupted throughout setup
 * - Blocking cross-organization email matching in legacy user resolution
 */

import type { CloudAdapter, TurnContext } from "botbuilder";
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

const { db } = await import("@/db");
const {
	chatInstallation,
	chatInstallationConversation,
	chatInstallationMemberLink,
	teamsConversation,
	teamsTenantConfig,
	teamsUserMapping,
} = await import("@/db/schema");
const {
	backfillOrganizationChatInstallations,
	configureTeamsCandidateCredentials,
	handleTeamsCandidateMessageRequest,
	issueChatLinkProof,
	prepareTeamsCandidateInstallation,
	sendTeamsCandidateProactiveTestMessage,
} = await import("@/lib/chat-installations");
const { getConversationReferenceForUser } = await import("@/lib/teams/conversation-manager");
const { getAllActiveTenants, getTenantConfigByOrganization, resolveTenant } =
	await import("@/lib/teams/tenant-resolver");
const { resolveTeamsUser } = await import("@/lib/teams/user-resolver");

const ids = {
	orgA: "t2049-org-a",
	orgB: "t2049-org-b",
	adminA: "t2049-admin-a",
	adminB: "t2049-admin-b",
	empEntraUser: "t2049-emp-entra",
	empProofUser: "t2049-emp-proof",
	empAdminA: "e2049000-0000-4000-8000-000000000001",
	empAdminB: "e2049000-0000-4000-8000-000000000002",
	empEntraId: "e2049000-0000-4000-8000-000000000003",
	empProofId: "e2049000-0000-4000-8000-000000000004",
	legacyAppId: "11111111-2222-4333-8444-555555555000",
	candidateAppIdA: "11111111-2222-4333-8444-555555555001",
	candidateAppIdB: "11111111-2222-4333-8444-555555555002",
	tenantA: "aaaa1111-2222-4333-8444-555555555001",
	tenantB: "bbbb1111-2222-4333-8444-555555555002",
	aadEntra: "dddd1111-2222-4333-8444-555555555001",
	aadProof: "dddd1111-2222-4333-8444-555555555002",
} as const;

function makeVerifiedAdapter(claimsAppId: string, claimsTenantId: string): CloudAdapter {
	const BotIdentityKey = Symbol("BotIdentity");
	return {
		BotIdentityKey,
		async process(
			req: { body: Record<string, unknown>; headers: Record<string, string> },
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

describe("single-tenant Teams prepare, verify, & test (PostgreSQL)", () => {
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.orgA, ids.orgB],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.adminA, ids.adminB, ids.empEntraUser, ids.empProofUser],
		]);
	}

	async function seedFixtures() {
		await cleanup();
		const ts = new Date("2026-11-20T10:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'Teams Org A', $1, $3),
			 ($2, 'Teams Org B', $2, $3)`,
			[ids.orgA, ids.orgB, ts],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Admin A', 't2049-admin-a@example.test', $5, $5),
			 ($2, 'Admin B', 't2049-admin-b@example.test', $5, $5),
			 ($3, 'Entra Emp', 't2049-entra@example.test', $5, $5),
			 ($4, 'Proof Emp', 't2049-proof@example.test', $5, $5)`,
			[ids.adminA, ids.adminB, ids.empEntraUser, ids.empProofUser, ts],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t2049-m-1', $1, $3, 'admin', 'approved', $7),
			 ('t2049-m-2', $2, $4, 'admin', 'approved', $7),
			 ('t2049-m-3', $1, $5, 'member', 'approved', $7),
			 ('t2049-m-4', $1, $6, 'member', 'approved', $7)`,
			[ids.orgA, ids.orgB, ids.adminA, ids.adminB, ids.empEntraUser, ids.empProofUser, ts],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $5, $9, 'admin', true, $11),
			 ($2, $6, $10, 'admin', true, $11),
			 ($3, $7, $9, 'employee', true, $11),
			 ($4, $8, $9, 'employee', true, $11)`,
			[
				ids.empAdminA,
				ids.empAdminB,
				ids.empEntraId,
				ids.empProofId,
				ids.adminA,
				ids.adminB,
				ids.empEntraUser,
				ids.empProofUser,
				ids.orgA,
				ids.orgB,
				ts,
			],
		);
		// Seed active legacy Teams tenant, legacy user mapping, and legacy conversation for Org A
		await db.insert(teamsTenantConfig).values({
			organizationId: ids.orgA,
			tenantId: ids.tenantA,
			tenantName: "Contoso Legacy M365",
			setupStatus: "active",
			configuredByUserId: ids.adminA,
			configuredAt: ts,
			serviceUrl: "https://smba.trafficmanager.net/emea/",
		});
		await db.insert(teamsUserMapping).values({
			organizationId: ids.orgA,
			userId: ids.empEntraUser,
			teamsUserId: ids.aadEntra,
			teamsEmail: "t2049-entra@example.test",
			teamsTenantId: ids.tenantA,
			teamsDisplayName: "Entra Emp",
			isActive: true,
		});
		await db.insert(teamsConversation).values({
			organizationId: ids.orgA,
			userId: ids.empEntraUser,
			teamsConversationId: "a:legacy-personal-conv-1",
			teamsServiceUrl: "https://smba.trafficmanager.net/emea/",
			teamsTenantId: ids.tenantA,
			conversationType: "personal",
			conversationReference: JSON.stringify({
				serviceUrl: "https://smba.trafficmanager.net/emea/",
				channelId: "msteams",
				conversation: { id: "a:legacy-personal-conv-1", tenantId: ids.tenantA },
				bot: { id: `28:${ids.legacyAppId}` },
			}),
			isActive: true,
		});

		await backfillOrganizationChatInstallations(ids.orgA, {
			db,
			deploymentConfig: {
				microsoftAppId: ids.legacyAppId,
				microsoftAppPassword: "legacy-shared-secret",
			},
		});
	}

	beforeEach(async () => {
		harness.secrets.clear();
		await seedFixtures();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("stages a single-tenant replacement in the SAME Teams tenant, blocks competing org claims, segregates candidate enrollment/conversations, and keeps legacy Teams uninterrupted", async () => {
		// 1. Prepare & save credentials for Org A in the SAME Teams tenant as its active legacy installation
		const preparedA = await prepareTeamsCandidateInstallation(
			{ organizationId: ids.orgA, actorUserId: ids.adminA, organizationName: "Teams Org A" },
			{ db, appUrl: "https://app.z8-time.test" },
		);

		const savedA = await configureTeamsCandidateCredentials(
			{
				organizationId: ids.orgA,
				actorUserId: ids.adminA,
				installationId: preparedA.installationId,
				microsoftAppId: ids.candidateAppIdA,
				microsoftTenantId: ids.tenantA,
				microsoftAppPassword: "single-tenant-secret-org-a",
				tenantDisplayName: "Contoso Single-Tenant",
			},
			{ db, appUrl: "https://app.z8-time.test" },
		);
		expect(savedA.kind).toBe("ok");
		if (savedA.kind !== "ok") return;
		expect(savedA.view.microsoftTenantId).toBe(ids.tenantA);
		expect(savedA.view.microsoftAppId).toBe(ids.candidateAppIdA);

		// 2. Org B is BLOCKED from claiming Org A's Teams tenant or App ID
		const preparedB = await prepareTeamsCandidateInstallation(
			{ organizationId: ids.orgB, actorUserId: ids.adminB },
			{ db },
		);
		const orgBClaimTenant = await configureTeamsCandidateCredentials(
			{
				organizationId: ids.orgB,
				actorUserId: ids.adminB,
				installationId: preparedB.installationId,
				microsoftAppId: ids.candidateAppIdB,
				microsoftTenantId: ids.tenantA,
				microsoftAppPassword: "single-tenant-secret-org-b",
			},
			{ db },
		);
		expect(orgBClaimTenant).toMatchObject({ kind: "error", code: "tenant_claimed_by_other_org" });

		const orgBClaimApp = await configureTeamsCandidateCredentials(
			{
				organizationId: ids.orgB,
				actorUserId: ids.adminB,
				installationId: preparedB.installationId,
				microsoftAppId: ids.candidateAppIdA,
				microsoftTenantId: ids.tenantB,
				microsoftAppPassword: "single-tenant-secret-org-b",
			},
			{ db },
		);
		expect(orgBClaimApp).toMatchObject({ kind: "error", code: "app_claimed_by_other_org" });

		// 3. Proven same-tenant Entra employee opens a private chat with the candidate bot
		const verifiedAdapter = makeVerifiedAdapter(ids.candidateAppIdA, ids.tenantA);
		const entraResp = await handleTeamsCandidateMessageRequest(
			{
				routeId: preparedA.routeId,
				rawBody: JSON.stringify({
					type: "message",
					id: "cand-act-1",
					text: "verify",
					channelId: "msteams",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: {
						id: "a:candidate-personal-entra",
						tenantId: ids.tenantA,
						conversationType: "personal",
					},
					recipient: { id: `28:${ids.candidateAppIdA}`, name: "Z8 Single-Tenant" },
					from: { id: "29:entra", aadObjectId: ids.aadEntra, name: "Entra Emp" },
				}),
				authorizationHeader: "Bearer verified-bot-jwt",
			},
			{ db, getAdapter: () => verifiedAdapter },
		);
		expect(entraResp.status).toBe(200);

		// 4. Other employee (no prior Entra link) enrolls via candidate_enrollment link proof
		const issued = await issueChatLinkProof(
			{
				organizationId: ids.orgA,
				installationId: preparedA.installationId,
				userId: ids.empProofUser,
				purpose: "candidate_enrollment",
			},
			{ db },
		);
		expect(issued.status).toBe("issued");
		if (issued.status !== "issued") return;

		const proofResp = await handleTeamsCandidateMessageRequest(
			{
				routeId: preparedA.routeId,
				rawBody: JSON.stringify({
					type: "message",
					id: "cand-act-2",
					text: `link ${issued.code}`,
					channelId: "msteams",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: {
						id: "a:candidate-personal-proof",
						tenantId: ids.tenantA,
						conversationType: "personal",
					},
					recipient: { id: `28:${ids.candidateAppIdA}`, name: "Z8 Single-Tenant" },
					from: { id: "29:proof", aadObjectId: ids.aadProof, name: "Proof Emp" },
				}),
				authorizationHeader: "Bearer verified-bot-jwt",
			},
			{ db, getAdapter: () => verifiedAdapter },
		);
		expect(proofResp.status).toBe(200);

		// 5. Proactive private test succeeds and marks candidate readyForSwitch
		const proactive = await sendTeamsCandidateProactiveTestMessage(
			{
				organizationId: ids.orgA,
				actorUserId: ids.adminA,
				installationId: preparedA.installationId,
			},
			{
				db,
				getAdapter: () => verifiedAdapter,
				sendProactiveTest: async () => ({ kind: "ok", activityId: "proactive-pg-1" }),
			},
		);
		expect(proactive.kind).toBe("ok");
		if (proactive.kind !== "ok") return;
		expect(proactive.view.readyForSwitch).toBe(true);
		expect(proactive.view.verificationState).toBe("verified");

		// 6. Verify candidate member links & conversations are strictly segregated from legacy tables
		const candidateLinks = await db
			.select()
			.from(chatInstallationMemberLink)
			.where(
				and(
					eq(chatInstallationMemberLink.organizationId, ids.orgA),
					eq(chatInstallationMemberLink.installationId, preparedA.installationId),
				),
			);
		expect(candidateLinks).toHaveLength(2);
		expect(candidateLinks.every((row) => row.isCandidateEnrollment === true)).toBe(true);
		expect(candidateLinks.map((row) => row.provenance).toSorted()).toEqual([
			"link_proof",
			"verified_same_scope_reuse",
		]);

		const candidateConvs = await db
			.select()
			.from(chatInstallationConversation)
			.where(
				and(
					eq(chatInstallationConversation.organizationId, ids.orgA),
					eq(chatInstallationConversation.installationId, preparedA.installationId),
				),
			);
		expect(candidateConvs.map((c) => c.externalConversationId).toSorted()).toEqual([
			"a:candidate-personal-entra",
			"a:candidate-personal-proof",
		]);

		// Legacy teams_user_mapping was NOT touched by candidate enrollment for empProofUser
		const legacyMappings = await db
			.select()
			.from(teamsUserMapping)
			.where(eq(teamsUserMapping.organizationId, ids.orgA));
		expect(legacyMappings).toHaveLength(1);
		expect(legacyMappings[0]?.userId).toBe(ids.empEntraUser);

		// 7. Legacy Teams tenant config, conversation reference, and active tenant delivery remain uninterrupted
		const resolvedLegacy = await resolveTenant(ids.tenantA);
		expect(resolvedLegacy.status).toBe("configured");
		const orgTenant = await getTenantConfigByOrganization(ids.orgA);
		expect(orgTenant?.tenantId).toBe(ids.tenantA);
		const legacyRef = await getConversationReferenceForUser(ids.empEntraUser, ids.orgA);
		expect(legacyRef?.conversation?.id).toBe("a:legacy-personal-conv-1");
		const allActive = await getAllActiveTenants();
		expect(allActive.some((t) => t.organizationId === ids.orgA && t.tenantId === ids.tenantA)).toBe(
			true,
		);

		// Candidate row coexists alongside legacy_active row for the same tenant without activating early
		const orgInstallations = await db
			.select({
				status: chatInstallation.status,
				externalSpaceId: chatInstallation.externalSpaceId,
			})
			.from(chatInstallation)
			.where(
				and(eq(chatInstallation.organizationId, ids.orgA), eq(chatInstallation.provider, "teams")),
			);
		expect(orgInstallations.map((i) => i.status).toSorted()).toEqual([
			"candidate",
			"legacy_active",
		]);

		// 8. Cross-organization email matching cannot establish member identity
		const emailMatchAttempt = await resolveTeamsUser(
			"dddd9999-2222-4333-8444-555555555999",
			"t2049-admin-b@example.test",
			ids.tenantA,
			"Cross Org Email",
			ids.orgA,
		);
		expect(emailMatchAttempt).toEqual({
			status: "not_linked",
			teamsUserId: "dddd9999-2222-4333-8444-555555555999",
			teamsEmail: null,
		});
	});
});
