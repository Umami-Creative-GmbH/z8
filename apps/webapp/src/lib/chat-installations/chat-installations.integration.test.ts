/**
 * #2040 / #2037 PostgreSQL 16 integration coverage:
 * - Organization isolation & composite FK enforcement
 * - Competing external ownership claims across organizations
 * - Same-organization replacement staging in the same Slack workspace / Teams tenant
 * - At-most-one active installation limit vs multiple legacy_active Teams tenants
 * - Independent installation-scoped conversations for existing vs replacement apps
 * - Idempotent & resumable legacy backfill (preserving legacy rows, settings, receiver scopes)
 * - Duplicate & unknown bot identity remediation + secret store outage handling
 * - Multi-tenant legacy Teams inventory, unexpected historical statuses, & setting disagreements
 * - Legacy provider config resolver compatibility (mixed-version rollout safety)
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	secrets: new Map<string, string>(),
	secretStoreOutageOrgs: new Set<string>(),
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getOrgSecret: async (organizationId: string, key: string) => {
		if (harness.secretStoreOutageOrgs.has(organizationId)) {
			throw new Error("Vault connection refused");
		}
		return harness.secrets.get(`${organizationId}:${key}`) ?? null;
	},
}));

const { db } = await import("@/db");
const {
	chatExternalOwnershipClaim,
	chatInstallation,
	chatInstallationCredentialRevision,
	chatProviderSettings,
	discordBotConfig,
	slackWorkspaceConfig,
	teamsTenantConfig,
	telegramBotConfig,
} = await import("@/db/schema");
const {
	acquireExternalOwnershipClaim,
	backfillAllLegacyChatInstallations,
	backfillOrganizationChatInstallations,
	checkSwitchEligibility,
	getOrganizationChatInstallationsInventory,
	listInstallationConversations,
	listLegacyTeamsTenantsForOrganization,
	resolveActiveChatInstallation,
	upsertInstallationConversation,
} = await import("@/lib/chat-installations");
const { getBotConfigByOrganization: getLegacySlackBot } = await import("@/lib/slack/bot-config");
const { getBotConfigByOrganization: getLegacyTelegramBot } =
	await import("@/lib/telegram/bot-config");
const { getBotConfigByOrganization: getLegacyDiscordBot } =
	await import("@/lib/discord/bot-config");
const {
	resolveTenant: resolveLegacyTeamsTenant,
	getAllActiveTenants: getLegacyActiveTeamsTenants,
} = await import("@/lib/teams/tenant-resolver");
const { getChatInstallationsInventory, getProviderChatInstallationInventory } =
	await import("@/app/[locale]/(app)/settings/notification-channels/actions");

const ids = {
	orgA: "t2040-org-a",
	orgB: "t2040-org-b",
	userA: "t2040-user-a",
	userB: "t2040-user-b",
	memberUserA: "t2040-member-a",
	empA: "e2040000-0000-4000-8000-000000000001",
	empB: "e2040000-0000-4000-8000-000000000002",
	empMemberA: "e2040000-0000-4000-8000-000000000003",
	teamsAppId: "11111111-2222-4333-8444-555555555555",
	teamsTenantA1: "aaaa1111-2222-4333-8444-555555555551",
	teamsTenantA2: "aaaa1111-2222-4333-8444-555555555552",
	teamsTenantA3: "aaaa1111-2222-4333-8444-555555555553",
	teamsTenantB1: "bbbb1111-2222-4333-8444-555555555551",
	slackTeamA: "T2040ORGA",
	slackTeamB: "T2040ORGB",
	discordAppA: "204000000000000001",
	discordAppDuplicate: "204000000000000999",
	telegramTokenA: "204000001:AAH_mock_orgA_token_123",
	telegramTokenDuplicate: "204000999:AAH_mock_dup_token_999",
} as const;

const DEPLOYMENT_CONFIG = {
	microsoftAppId: ids.teamsAppId,
	microsoftAppPassword: "mock-deployment-password",
	slackClientId: "A2040SHARED",
};

describe("chat installations foundation & inventory (PostgreSQL)", () => {
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.orgA, ids.orgB],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.userA, ids.userB, ids.memberUserA],
		]);
	}

	async function seedOrgsAndUsers() {
		await cleanup();
		const ts = new Date("2026-11-20T10:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'Org A', $1, $3),
			 ($2, 'Org B', $2, $3)`,
			[ids.orgA, ids.orgB, ts],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Admin A', 't2040-a@example.test', $4, $4),
			 ($2, 'Admin B', 't2040-b@example.test', $4, $4),
			 ($3, 'Member A', 't2040-member-a@example.test', $4, $4)`,
			[ids.userA, ids.userB, ids.memberUserA, ts],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t2040-mem-a', $1, $3, 'admin', 'approved', $6),
			 ('t2040-mem-b', $2, $4, 'admin', 'approved', $6),
			 ('t2040-mem-a-member', $1, $5, 'member', 'approved', $6)`,
			[ids.orgA, ids.orgB, ids.userA, ids.userB, ids.memberUserA, ts],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $3, 'admin', $10),
			 ($4, $5, $6, 'admin', $10),
			 ($7, $8, $9, 'employee', $10)`,
			[
				ids.empA,
				ids.userA,
				ids.orgA,
				ids.empB,
				ids.userB,
				ids.orgB,
				ids.empMemberA,
				ids.memberUserA,
				ids.orgA,
				ts,
			],
		);
	}

	beforeEach(async () => {
		harness.userId = null;
		harness.organizationId = null;
		harness.secrets.clear();
		harness.secretStoreOutageOrgs.clear();
		await seedOrgsAndUsers();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("enforces organization isolation and competing external ownership claims in PostgreSQL", async () => {
		const orgAClaim = await acquireExternalOwnershipClaim({
			organizationId: ids.orgA,
			provider: "slack",
			claimKind: "workspace",
			externalId: ids.slackTeamA,
		});
		expect(orgAClaim.kind).toBe("acquired");
		if (orgAClaim.kind !== "acquired") return;

		// Competing org cannot acquire the same workspace claim.
		const orgBConflict = await acquireExternalOwnershipClaim({
			organizationId: ids.orgB,
			provider: "slack",
			claimKind: "workspace",
			externalId: ids.slackTeamA,
		});
		expect(orgBConflict).toEqual({ kind: "conflict" });

		// Direct DB insert of duplicate claim fails with unique constraint violation.
		await expect(
			db.insert(chatExternalOwnershipClaim).values({
				organizationId: ids.orgB,
				provider: "slack",
				claimKind: "workspace",
				externalId: ids.slackTeamA,
			}),
		).rejects.toThrow();

		// Direct DB insert attaching Org A's claim to Org B's installation fails composite FK.
		await expect(
			db.insert(chatInstallation).values({
				organizationId: ids.orgB,
				provider: "slack",
				credentialSource: "organization_owned",
				status: "candidate",
				routeId: "route-cross-org-attempt",
				spaceClaimId: orgAClaim.claim.id,
			}),
		).rejects.toThrow();
	});

	it("allows same-org staging in the same workspace/tenant, enforces at most one active installation, and keeps conversations independent", async () => {
		const spaceClaim = await acquireExternalOwnershipClaim({
			organizationId: ids.orgA,
			provider: "slack",
			claimKind: "workspace",
			externalId: ids.slackTeamA,
		});
		const legacyBotClaim = await acquireExternalOwnershipClaim({
			organizationId: ids.orgA,
			provider: "slack",
			claimKind: "bot",
			externalId: `${ids.slackTeamA}:U_OLD_BOT`,
		});
		const candidateBotClaim = await acquireExternalOwnershipClaim({
			organizationId: ids.orgA,
			provider: "slack",
			claimKind: "bot",
			externalId: `${ids.slackTeamA}:A_NEW_ORG_APP`,
		});
		if (
			spaceClaim.kind !== "acquired" ||
			legacyBotClaim.kind !== "acquired" ||
			candidateBotClaim.kind !== "acquired"
		) {
			throw new Error("Expected claims to be acquired");
		}

		// Org A holds both a live legacy installation and a staged candidate in the SAME Slack workspace.
		const [legacyInst] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.orgA,
				provider: "slack",
				credentialSource: "deployment_managed",
				status: "legacy_active",
				routeId: "route-slack-legacy-1",
				externalSpaceId: ids.slackTeamA,
				externalBotId: "U_OLD_BOT",
				receiverScope: `slack-team:${ids.slackTeamA}`,
				spaceClaimId: spaceClaim.claim.id,
				botClaimId: legacyBotClaim.claim.id,
			})
			.returning();

		const [candidateInst] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.orgA,
				provider: "slack",
				credentialSource: "organization_owned",
				status: "candidate",
				routeId: "route-slack-candidate-1",
				externalSpaceId: ids.slackTeamA,
				externalAppId: "A_NEW_ORG_APP",
				spaceClaimId: spaceClaim.claim.id,
				botClaimId: candidateBotClaim.claim.id,
			})
			.returning();

		expect(legacyInst?.spaceClaimId).toBe(spaceClaim.claim.id);
		expect(candidateInst?.spaceClaimId).toBe(spaceClaim.claim.id);

		// Attach a credential revision to the candidate and set it as active_credential_revision_id.
		const [rev1] = await db
			.insert(chatInstallationCredentialRevision)
			.values({
				installationId: candidateInst.id,
				organizationId: ids.orgA,
				revisionNumber: 1,
				secretStoreProvider: "vault",
				secretKeyPrefix: `chat/slack/${candidateInst.id}/rev-1`,
				secretKeys: ["bot_token", "signing_secret"],
				status: "verified",
			})
			.returning();

		await db
			.update(chatInstallation)
			.set({ activeCredentialRevisionId: rev1.id })
			.where(eq(chatInstallation.id, candidateInst.id));

		// Deleting a referenced credential revision is rejected by FK.
		await expect(
			db
				.delete(chatInstallationCredentialRevision)
				.where(eq(chatInstallationCredentialRevision.id, rev1.id)),
		).rejects.toThrow();

		// At most one `active` installation per (organization_id, provider).
		await db
			.update(chatInstallation)
			.set({ status: "active" })
			.where(eq(chatInstallation.id, candidateInst.id));

		await expect(
			db.insert(chatInstallation).values({
				organizationId: ids.orgA,
				provider: "slack",
				credentialSource: "organization_owned",
				status: "active",
				routeId: "route-slack-second-active",
			}),
		).rejects.toThrow();

		// Existing and replacement installations address conversations independently for the same user.
		await upsertInstallationConversation({
			organizationId: ids.orgA,
			installationId: legacyInst.id,
			userId: ids.userA,
			employeeId: ids.empA,
			externalUserId: "U_EMP_1",
			externalConversationId: "D_OLD_DM",
			conversationType: "im",
			reachabilityStatus: "reachable",
		});
		await upsertInstallationConversation({
			organizationId: ids.orgA,
			installationId: candidateInst.id,
			userId: ids.userA,
			employeeId: ids.empA,
			externalUserId: "U_EMP_1",
			externalConversationId: "D_NEW_DM",
			conversationType: "im",
			reachabilityStatus: "action_needed",
		});

		const legacyConvs = await listInstallationConversations(ids.orgA, legacyInst.id);
		const candidateConvs = await listInstallationConversations(ids.orgA, candidateInst.id);
		expect(legacyConvs).toHaveLength(1);
		expect(legacyConvs[0]?.externalConversationId).toBe("D_OLD_DM");
		expect(candidateConvs).toHaveLength(1);
		expect(candidateConvs[0]?.externalConversationId).toBe("D_NEW_DM");

		// Cross-org employee reference on conversation is rejected by composite FK.
		await expect(
			upsertInstallationConversation({
				organizationId: ids.orgA,
				installationId: candidateInst.id,
				userId: ids.userB,
				employeeId: ids.empB,
				externalConversationId: "D_CROSS_ORG",
			}),
		).rejects.toThrow();

		// Cascading delete of an organization with an active credential revision succeeds cleanly.
		await admin.query("delete from organization where id = $1", [ids.orgA]);
		const remaining = await db
			.select()
			.from(chatInstallation)
			.where(eq(chatInstallation.organizationId, ids.orgA));
		expect(remaining).toHaveLength(0);
	});

	it("runs idempotent, resumable legacy backfill preserving legacy rows, settings, receiver scopes, and legacy resolver compatibility", async () => {
		const ts = new Date("2026-11-20T12:00:00Z");
		harness.secrets.set(`${ids.orgA}:slack/bot_access_token`, "xoxb-orgA-legacy");
		harness.secrets.set(`${ids.orgA}:telegram/bot_token`, ids.telegramTokenA);
		harness.secrets.set(`${ids.orgA}:discord/bot_token`, "discord-token-orgA");

		await db.insert(slackWorkspaceConfig).values({
			organizationId: ids.orgA,
			slackTeamId: ids.slackTeamA,
			slackTeamName: "Acme Slack",
			botAccessToken: "vault:managed",
			botUserId: "U2040SLACKBOT",
			setupStatus: "active",
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: false,
			digestTime: "08:30",
			digestTimezone: "Europe/Berlin",
			escalationTimeoutHours: 12,
			configuredByUserId: ids.userA,
			configuredAt: ts,
		});
		await db.insert(telegramBotConfig).values({
			organizationId: ids.orgA,
			botToken: "vault:managed",
			botUsername: "acme_z8_bot",
			botDisplayName: "Acme Z8 Bot",
			webhookSecret: "tg-secret-org-a",
			webhookRegistered: true,
			setupStatus: "active",
			configuredByUserId: ids.userA,
			configuredAt: ts,
		});
		await db.insert(discordBotConfig).values({
			organizationId: ids.orgA,
			botToken: "vault:managed",
			applicationId: ids.discordAppA,
			publicKey: "a".repeat(64),
			webhookSecret: "dc-secret-org-a",
			interactionEndpointConfigured: true,
			setupStatus: "active",
			configuredByUserId: ids.userA,
			configuredAt: ts,
		});
		await db.insert(teamsTenantConfig).values({
			organizationId: ids.orgA,
			tenantId: ids.teamsTenantA1,
			tenantName: "Acme Corp Tenant",
			setupStatus: "active",
			serviceUrl: "https://smba.trafficmanager.net/emea/",
			configuredByUserId: ids.userA,
			configuredAt: ts,
		});

		// First backfill creates 4 installations.
		const first = await backfillOrganizationChatInstallations(ids.orgA, {
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		expect(first).toEqual({
			organizationId: ids.orgA,
			createdCount: 4,
			updatedCount: 0,
			skippedCount: 0,
			remediationCount: 0,
		});

		const afterFirst = await db
			.select()
			.from(chatInstallation)
			.where(eq(chatInstallation.organizationId, ids.orgA));
		expect(afterFirst).toHaveLength(4);
		const routeIdsBefore = new Map(afterFirst.map((row) => [row.provider, row.routeId]));

		// Repeated backfill is 100% idempotent (0 created, 0 updated, 4 skipped, same routeIds).
		const second = await backfillOrganizationChatInstallations(ids.orgA, {
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		expect(second).toEqual({
			organizationId: ids.orgA,
			createdCount: 0,
			updatedCount: 0,
			skippedCount: 4,
			remediationCount: 0,
		});

		const afterSecond = await db
			.select()
			.from(chatInstallation)
			.where(eq(chatInstallation.organizationId, ids.orgA));
		for (const row of afterSecond) {
			expect(row.routeId).toBe(routeIdsBefore.get(row.provider));
		}

		// Verify preserved receiver scopes, credential sources, and non-authoritative settings.
		const inventory = await getOrganizationChatInstallationsInventory(ids.orgA, {
			deploymentConfig: DEPLOYMENT_CONFIG,
			syncLegacy: false,
		});
		expect(inventory.providers.slack.connectionState).toBe("connected");
		expect(inventory.providers.slack.switchEnabled).toBe(false);
		expect(inventory.providers.slack.currentInstallations[0]).toMatchObject({
			credentialSource: "deployment_managed",
			status: "legacy_active",
			receiverScope: `slack-team:${ids.slackTeamA}`,
		});
		expect(inventory.providers.teams.currentInstallations[0]).toMatchObject({
			credentialSource: "deployment_managed",
			status: "legacy_active",
			receiverScope: `teams-bot:${ids.teamsAppId}:tenant:${ids.teamsTenantA1}`,
		});
		expect(inventory.providers.telegram.currentInstallations[0]).toMatchObject({
			credentialSource: "organization_owned",
			status: "legacy_active",
			receiverScope: "telegram-bot:204000001",
		});
		expect(inventory.providers.discord.currentInstallations[0]).toMatchObject({
			credentialSource: "organization_owned",
			status: "legacy_active",
			receiverScope: `discord-app:${ids.discordAppA}`,
		});

		// chat_provider_settings remains non-authoritative before switch.
		const settingsRows = await db
			.select()
			.from(chatProviderSettings)
			.where(eq(chatProviderSettings.organizationId, ids.orgA));
		expect(settingsRows).toHaveLength(4);
		expect(settingsRows.every((r) => r.isAuthoritative === false)).toBe(true);

		// Mixed-version compatibility: legacy resolvers continue reading untouched legacy tables.
		const legacySlack = await getLegacySlackBot(ids.orgA);
		expect(legacySlack?.slackTeamId).toBe(ids.slackTeamA);
		expect(legacySlack?.botAccessToken).toBe("xoxb-orgA-legacy");

		const legacyTelegram = await getLegacyTelegramBot(ids.orgA);
		expect(legacyTelegram?.botToken).toBe(ids.telegramTokenA);

		const legacyDiscord = await getLegacyDiscordBot(ids.orgA);
		expect(legacyDiscord?.applicationId).toBe(ids.discordAppA);

		const legacyTeams = await resolveLegacyTeamsTenant(ids.teamsTenantA1);
		expect(legacyTeams.status).toBe("configured");

		// Org B sees zero installations from Org A (tenant isolation).
		const orgBInventory = await getOrganizationChatInstallationsInventory(ids.orgB, {
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		expect(orgBInventory.providers.slack.connectionState).toBe("disconnected");
		expect(orgBInventory.providers.teams.teamsTenants).toEqual([]);
		expect(orgBInventory.providers.telegram.currentInstallations).toEqual([]);
		expect(orgBInventory.providers.discord.currentInstallations).toEqual([]);
	});

	it("surfaces duplicate and unknown bot identities as remediation blockers while preserving legacy routes", async () => {
		// Duplicate Discord app across Org A and Org B
		await db.insert(discordBotConfig).values([
			{
				organizationId: ids.orgA,
				botToken: "vault:managed",
				applicationId: ids.discordAppDuplicate,
				publicKey: "a".repeat(64),
				webhookSecret: "dc-dup-org-a",
				setupStatus: "active",
			},
			{
				organizationId: ids.orgB,
				botToken: "vault:managed",
				applicationId: ids.discordAppDuplicate,
				publicKey: "a".repeat(64),
				webhookSecret: "dc-dup-org-b",
				setupStatus: "active",
			},
		]);

		// Duplicate Telegram bot token across Org A and Org B
		harness.secrets.set(`${ids.orgA}:telegram/bot_token`, ids.telegramTokenDuplicate);
		harness.secrets.set(`${ids.orgB}:telegram/bot_token`, ids.telegramTokenDuplicate);
		await db.insert(telegramBotConfig).values([
			{
				organizationId: ids.orgA,
				botToken: "vault:managed",
				botUsername: "shared_dup_bot",
				webhookSecret: "tg-dup-org-a",
				setupStatus: "active",
			},
			{
				organizationId: ids.orgB,
				botToken: "vault:managed",
				botUsername: "shared_dup_bot",
				webhookSecret: "tg-dup-org-b",
				setupStatus: "active",
			},
		]);

		// Unknown Slack bot identity (missing botUserId) on Org A
		harness.secrets.set(`${ids.orgA}:slack/bot_access_token`, "xoxb-missing-bot-user");
		await db.insert(slackWorkspaceConfig).values({
			organizationId: ids.orgA,
			slackTeamId: ids.slackTeamA,
			slackTeamName: "Slack Missing Bot ID",
			botAccessToken: "vault:managed",
			botUserId: null,
			setupStatus: "active",
		});

		// Resumable paginated batch backfill (limit 1 -> page 1 = orgA, page 2 = orgB)
		const page1 = await backfillAllLegacyChatInstallations({
			limit: 1,
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		expect(page1.processedOrganizationIds).toEqual([ids.orgA]);
		expect(page1.hasMore).toBe(true);
		expect(page1.nextCursor).toBe(ids.orgA);

		const page2 = await backfillAllLegacyChatInstallations({
			cursor: page1.nextCursor,
			limit: 1,
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		expect(page2.processedOrganizationIds).toEqual([ids.orgB]);
		expect(page2.hasMore).toBe(false);

		// Verify Org A & Org B duplicate Discord and Telegram bots are both blocked and hold no bot claim.
		const invA = await getOrganizationChatInstallationsInventory(ids.orgA, {
			syncLegacy: false,
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		const invB = await getOrganizationChatInstallationsInventory(ids.orgB, {
			syncLegacy: false,
			deploymentConfig: DEPLOYMENT_CONFIG,
		});

		expect(invA.providers.discord.connectionState).toBe("remediation_required");
		expect(invA.providers.discord.canSwitchOrMutateEndpoint).toBe(false);
		expect(invA.providers.discord.blockers[0]?.code).toBe("duplicate_external_identity");

		expect(invB.providers.discord.connectionState).toBe("remediation_required");
		expect(invB.providers.discord.canSwitchOrMutateEndpoint).toBe(false);
		expect(invB.providers.discord.blockers[0]?.code).toBe("duplicate_external_identity");

		expect(invA.providers.telegram.connectionState).toBe("remediation_required");
		expect(invA.providers.telegram.canSwitchOrMutateEndpoint).toBe(false);
		expect(invA.providers.telegram.blockers[0]?.code).toBe("duplicate_external_identity");

		expect(invB.providers.telegram.connectionState).toBe("remediation_required");
		expect(invB.providers.telegram.canSwitchOrMutateEndpoint).toBe(false);

		// Unknown Slack bot identity blocks replacement/endpoint mutation.
		expect(invA.providers.slack.connectionState).toBe("remediation_required");
		expect(invA.providers.slack.canSwitchOrMutateEndpoint).toBe(false);
		expect(invA.providers.slack.blockers[0]).toMatchObject({
			code: "unknown_bot_identity",
			missingField: "botUserId",
		});

		const slackEligibility = await checkSwitchEligibility(ids.orgA, "slack", {
			syncLegacy: false,
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		expect(slackEligibility.allowed).toBe(false);

		// Legacy rows and traffic remain untouched during remediation.
		expect(await getLegacySlackBot(ids.orgA)).not.toBeNull();
		expect(await getLegacyTelegramBot(ids.orgA)).not.toBeNull();

		// Secret store outage is distinguishable on Telegram backfill.
		harness.secretStoreOutageOrgs.add(ids.orgB);
		await backfillOrganizationChatInstallations(ids.orgB, {
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		const invBOutage = await getOrganizationChatInstallationsInventory(ids.orgB, {
			syncLegacy: false,
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		expect(invBOutage.providers.telegram.blockers[0]?.code).toBe("secret_store_unavailable");
		expect(invBOutage.providers.telegram.canSwitchOrMutateEndpoint).toBe(false);
	});

	it("discovers every legacy Teams tenant with unexpected historical statuses and setting disagreements", async () => {
		await db.insert(teamsTenantConfig).values([
			{
				organizationId: ids.orgA,
				tenantId: ids.teamsTenantA1,
				tenantName: "Contoso Europe",
				setupStatus: "active",
				enableApprovals: true,
				enableCommands: true,
				enableDailyDigest: true,
				enableEscalations: true,
				digestTime: "08:00",
				digestTimezone: "Europe/Berlin",
				escalationTimeoutHours: 24,
				serviceUrl: "https://smba.trafficmanager.net/emea/",
			},
			{
				organizationId: ids.orgA,
				tenantId: ids.teamsTenantA2,
				tenantName: "Contoso US",
				setupStatus: "active",
				enableApprovals: false,
				enableCommands: true,
				enableDailyDigest: true,
				enableEscalations: true,
				digestTime: "09:30",
				digestTimezone: "America/New_York",
				escalationTimeoutHours: 12,
				serviceUrl: "https://smba.trafficmanager.net/amer/",
			},
			{
				organizationId: ids.orgA,
				tenantId: ids.teamsTenantA3,
				tenantName: "Contoso Legacy Disabled",
				setupStatus: "disabled",
				enableApprovals: true,
				enableCommands: false,
				enableDailyDigest: false,
				enableEscalations: false,
				digestTime: "08:00",
				digestTimezone: "Europe/Berlin",
				escalationTimeoutHours: 24,
			},
		]);

		const { tenants, disagreements } = await listLegacyTeamsTenantsForOrganization(ids.orgA, {
			deploymentConfig: DEPLOYMENT_CONFIG,
		});

		expect(tenants).toHaveLength(3);
		expect(tenants.map((t) => t.tenantId)).toEqual([
			ids.teamsTenantA1,
			ids.teamsTenantA2,
			ids.teamsTenantA3,
		]);

		const disabledTenant = tenants.find((t) => t.tenantId === ids.teamsTenantA3);
		expect(disabledTenant).toMatchObject({
			setupStatus: "disabled",
			isUnexpectedStatus: true,
			installationStatus: "remediation_required",
		});
		expect(disabledTenant?.blockers[0]?.code).toBe("unexpected_legacy_status");

		// Both active tenants stay legacy_active simultaneously (multi-tenant Teams allowed before switch!).
		const resolved = await resolveActiveChatInstallation(ids.orgA, "teams", {
			syncLegacy: false,
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		expect(resolved.kind).toBe("legacy");
		if (resolved.kind === "legacy") {
			expect(resolved.installations).toHaveLength(2);
		}

		// Settings disagreements across tenants are surfaced clearly.
		expect(disagreements.map((d) => d.field)).toContain("enableApprovals");
		expect(disagreements.map((d) => d.field)).toContain("digestTime");
		expect(disagreements.map((d) => d.field)).toContain("digestTimezone");
		expect(disagreements.map((d) => d.field)).toContain("escalationTimeoutHours");

		// Legacy Teams active tenant list remains untouched.
		const activeLegacy = await getLegacyActiveTeamsTenants();
		const orgAActiveIds = activeLegacy
			.filter((t) => t.organizationId === ids.orgA)
			.map((t) => t.tenantId)
			.toSorted();
		expect(orgAActiveIds).toEqual([ids.teamsTenantA1, ids.teamsTenantA2].toSorted());

		// Full inventory flags remediation_required because of the unexpected "disabled" status.
		const inventory = await getOrganizationChatInstallationsInventory(ids.orgA, {
			syncLegacy: false,
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		expect(inventory.providers.teams.connectionState).toBe("remediation_required");
		expect(inventory.providers.teams.canSwitchOrMutateEndpoint).toBe(false);
		expect(inventory.providers.teams.teamsTenants).toHaveLength(3);
		expect(inventory.providers.teams.teamsSettingsDisagreements.length).toBeGreaterThan(0);

		// Confirm Org B can also use the shared deployment-managed Teams bot without colliding on bot_claim!
		await db.insert(teamsTenantConfig).values({
			organizationId: ids.orgB,
			tenantId: ids.teamsTenantB1,
			tenantName: "Fabrikam Tenant",
			setupStatus: "active",
		});
		const invB = await getOrganizationChatInstallationsInventory(ids.orgB, {
			deploymentConfig: DEPLOYMENT_CONFIG,
		});
		expect(invB.providers.teams.connectionState).toBe("connected");
		expect(invB.providers.teams.canSwitchOrMutateEndpoint).toBe(true);
		expect(invB.providers.teams.currentInstallations).toHaveLength(1);
	});

	it("enforces organization settings access and org scoping on inventory server actions against PostgreSQL", async () => {
		harness.secrets.set(`${ids.orgA}:slack/bot_access_token`, "xoxb-orgA-action");
		await db.insert(slackWorkspaceConfig).values({
			organizationId: ids.orgA,
			slackTeamId: ids.slackTeamA,
			slackTeamName: "Org A Private Slack",
			botAccessToken: "vault:managed",
			botUserId: "U2040ACTION",
			setupStatus: "active",
		});

		// Signed-out caller is refused.
		expect(await getChatInstallationsInventory()).toMatchObject({
			success: false,
			code: "AuthenticationError",
		});

		// Non-admin member of Org A is refused.
		harness.userId = ids.memberUserA;
		harness.organizationId = ids.orgA;
		expect(await getChatInstallationsInventory()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await getProviderChatInstallationInventory({ provider: "slack" })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});

		// Org A admin reads Org A's inventory.
		harness.userId = ids.userA;
		harness.organizationId = ids.orgA;
		const orgAResult = await getChatInstallationsInventory();
		expect(orgAResult.success).toBe(true);
		if (orgAResult.success) {
			expect(orgAResult.data.organizationId).toBe(ids.orgA);
			expect(orgAResult.data.providers.slack.currentInstallations[0]?.externalSpaceId).toBe(
				ids.slackTeamA,
			);
		}

		// Org B admin reads only Org B (never sees Org A's Slack workspace).
		harness.userId = ids.userB;
		harness.organizationId = ids.orgB;
		const orgBSlack = await getProviderChatInstallationInventory({ provider: "slack" });
		expect(orgBSlack.success).toBe(true);
		if (orgBSlack.success) {
			expect(orgBSlack.data.connectionState).toBe("disconnected");
			expect(orgBSlack.data.currentInstallations).toEqual([]);
		}
	});
});
