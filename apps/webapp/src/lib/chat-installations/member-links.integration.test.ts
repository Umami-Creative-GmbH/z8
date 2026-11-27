/**
 * #2042 / #2037 PostgreSQL 16 integration coverage:
 * - Digest-only storage & atomic single-use proof consumption under concurrent redemption
 * - Wrong organization & wrong bot redemption rejection
 * - Expired proof rejection & rate limiting (issuance + failed guesses)
 * - Former member refusal at issuance AND at redemption (after becoming former)
 * - Strict candidate enrollment segregation from live links & legacy mappings
 * - Verified same-scope identity reuse (same org + workspace/tenant allowed; cross-org/bot refused)
 * - Unlink & independent link status for a member of multiple organizations
 * - End-to-end Telegram /link redemption & shared org channel availability parity
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

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getOrgSecret: async (organizationId: string, key: string) =>
		harness.secrets.get(`${organizationId}:${key}`) ?? null,
}));

const { db } = await import("@/db");
const {
	chatInstallation,
	chatInstallationLinkProof,
	chatInstallationMemberLink,
	employee,
	slackWorkspaceConfig,
	telegramBotConfig,
	telegramUserMapping,
} = await import("@/db/schema");
const {
	backfillOrganizationChatInstallations,
	getMemberChatLinks,
	getOrganizationChatChannelAvailability,
	issueChatLinkProof,
	issueMemberTelegramLinkCode,
	redeemChatLinkProof,
	reuseVerifiedExternalIdentity,
	unlinkMemberChatLink,
} = await import("@/lib/chat-installations");
const { claimLinkCode } = await import("@/lib/telegram/user-resolver");

const ids = {
	orgA: "t2042-org-a",
	orgB: "t2042-org-b",
	userMulti: "t2042-user-multi",
	userOther: "t2042-user-other",
	userFormer: "t2042-user-former",
	empMultiA: "e2042000-0000-4000-8000-000000000001",
	empMultiB: "e2042000-0000-4000-8000-000000000002",
	empOtherA: "e2042000-0000-4000-8000-000000000003",
	empFormerA: "e2042000-0000-4000-8000-000000000004",
	botTokenA: "204200001:AAH_mock_orgA_bot_token",
	botTokenB: "204200002:AAH_mock_orgB_bot_token",
	slackTeamA: "T2042ORGA",
	slackTeamB: "T2042ORGB",
} as const;

describe("chat installation member links & digest proofs (PostgreSQL)", () => {
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.orgA, ids.orgB],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.userMulti, ids.userOther, ids.userFormer],
		]);
		harness.secrets.clear();
	}

	async function seedBaseFixtures() {
		await admin.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'Org A', 't2042-org-a', now()),
			        ($2, 'Org B', 't2042-org-b', now())`,
			[ids.orgA, ids.orgB],
		);

		await admin.query(
			`insert into "user" (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'Multi Member', 'multi-2042@example.test', true, now(), now()),
			        ($2, 'Other Member', 'other-2042@example.test', true, now(), now()),
			        ($3, 'Former Member', 'former-2042@example.test', true, now(), now())`,
			[ids.userMulti, ids.userOther, ids.userFormer],
		);

		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('m2042-multi-a', $1, $3, 'member', 'approved', now()),
			        ('m2042-multi-b', $2, $3, 'member', 'approved', now()),
			        ('m2042-other-a', $1, $4, 'member', 'approved', now()),
			        ('m2042-former-a', $1, $5, 'member', 'approved', now())`,
			[ids.orgA, ids.orgB, ids.userMulti, ids.userOther, ids.userFormer],
		);

		await admin.query(
			`insert into employee (id, user_id, organization_id, role, is_active, created_at, updated_at)
			 values ($1, $5, $7, 'employee', true, now(), now()),
			        ($2, $5, $8, 'employee', true, now(), now()),
			        ($3, $6, $7, 'employee', true, now(), now()),
			        ($4, $9, $7, 'employee', false, now(), now())`,
			[
				ids.empMultiA,
				ids.empMultiB,
				ids.empOtherA,
				ids.empFormerA,
				ids.userMulti,
				ids.userOther,
				ids.orgA,
				ids.orgB,
				ids.userFormer,
			],
		);

		// Seed legacy active Telegram bots in both orgs (different numeric bot IDs)
		harness.secrets.set(`${ids.orgA}:telegram/bot_token`, ids.botTokenA);
		harness.secrets.set(`${ids.orgB}:telegram/bot_token`, ids.botTokenB);
		harness.secrets.set(`${ids.orgA}:slack/bot_access_token`, "xoxb-2042-org-a");

		await db.insert(telegramBotConfig).values([
			{
				organizationId: ids.orgA,
				botToken: "vault:managed",
				botUsername: "z8_orga_bot",
				botDisplayName: "Z8 Org A",
				webhookSecret: "wh-2042-orga",
				webhookRegistered: true,
				setupStatus: "active",
			},
			{
				organizationId: ids.orgB,
				botToken: "vault:managed",
				botUsername: "z8_orgb_bot",
				botDisplayName: "Z8 Org B",
				webhookSecret: "wh-2042-orgb",
				webhookRegistered: true,
				setupStatus: "active",
			},
		]);

		await db.insert(slackWorkspaceConfig).values({
			organizationId: ids.orgA,
			slackTeamId: ids.slackTeamA,
			slackTeamName: "Org A Slack",
			botAccessToken: "vault:managed",
			botUserId: "U2042BOTA",
			setupStatus: "active",
		});

		await backfillOrganizationChatInstallations(ids.orgA);
		await backfillOrganizationChatInstallations(ids.orgB);
	}

	async function getTelegramInstallation(organizationId: string) {
		const [inst] = await db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, organizationId),
					eq(chatInstallation.provider, "telegram"),
					eq(chatInstallation.status, "legacy_active"),
				),
			)
			.limit(1);
		if (!inst) throw new Error(`Missing telegram installation for ${organizationId}`);
		return inst;
	}

	async function getSlackInstallation(organizationId: string) {
		const [inst] = await db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, organizationId),
					eq(chatInstallation.provider, "slack"),
					eq(chatInstallation.status, "legacy_active"),
				),
			)
			.limit(1);
		if (!inst) throw new Error(`Missing slack installation for ${organizationId}`);
		return inst;
	}

	beforeEach(async () => {
		await cleanup();
		await seedBaseFixtures();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("stores only the digest and consumes a proof atomically once under concurrent redemptions", async () => {
		const instA = await getTelegramInstallation(ids.orgA);

		const issued = await issueChatLinkProof({
			organizationId: ids.orgA,
			installationId: instA.id,
			userId: ids.userMulti,
			purpose: "member_link",
		});
		expect(issued.status).toBe("issued");
		if (issued.status !== "issued") return;

		// Verify raw code is never stored in Postgres (only 64-char SHA-256 digest).
		const [storedProof] = await db
			.select()
			.from(chatInstallationLinkProof)
			.where(eq(chatInstallationLinkProof.id, issued.proofId));
		expect(storedProof.codeDigest).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(storedProof)).not.toContain(issued.code);
		expect(JSON.stringify(storedProof)).not.toContain(issued.code.replaceAll("-", ""));

		// Race 5 concurrent redemptions with the same valid code.
		const attempts = await Promise.all(
			Array.from({ length: 5 }, (_, idx) =>
				redeemChatLinkProof({
					organizationId: ids.orgA,
					installationId: instA.id,
					purpose: "member_link",
					code: issued.code,
					externalUserId: `tg-racer-${idx}`,
					externalUsername: `racer_${idx}`,
					externalDisplayName: `Racer ${idx}`,
				}),
			),
		);

		const successes = attempts.filter((r) => r.status === "success");
		const alreadyUsed = attempts.filter((r) => r.status === "already_used");
		expect(successes).toHaveLength(1);
		expect(alreadyUsed).toHaveLength(4);

		// Subsequent replay also fails.
		const replay = await redeemChatLinkProof({
			organizationId: ids.orgA,
			installationId: instA.id,
			purpose: "member_link",
			code: issued.code,
			externalUserId: "tg-replay",
		});
		expect(replay.status).toBe("already_used");
	});

	it("rejects wrong organization, wrong bot installation, expired proof, and enforces rate limiting", async () => {
		const instA = await getTelegramInstallation(ids.orgA);
		const instB = await getTelegramInstallation(ids.orgB);
		const t0 = new Date("2026-11-26T12:00:00.000Z");

		const issued = await issueChatLinkProof(
			{
				organizationId: ids.orgA,
				installationId: instA.id,
				userId: ids.userMulti,
				purpose: "member_link",
				ttlMinutes: 10,
			},
			{ now: () => t0 },
		);
		expect(issued.status).toBe("issued");
		if (issued.status !== "issued") return;

		// Wrong organization & wrong bot installation
		const wrongOrg = await redeemChatLinkProof(
			{
				organizationId: ids.orgB,
				installationId: instB.id,
				purpose: "member_link",
				code: issued.code,
				externalUserId: "tg-wrong-org",
			},
			{ now: () => t0 },
		);
		expect(wrongOrg.status).toBe("invalid_code");

		// Wrong bot token via Telegram claimLinkCode
		const wrongBotViaWebhook = await claimLinkCode(
			issued.code,
			"tg-wrong-bot",
			ids.orgA,
			"wrongbot",
			"Wrong Bot",
			{ botToken: ids.botTokenB },
		);
		expect(wrongBotViaWebhook.status).toBe("invalid_code");

		// Expired proof (11 minutes later)
		const expired = await redeemChatLinkProof(
			{
				organizationId: ids.orgA,
				installationId: instA.id,
				purpose: "member_link",
				code: issued.code,
				externalUserId: "tg-late",
			},
			{ now: () => new Date("2026-11-26T12:11:00.000Z") },
		);
		expect(expired.status).toBe("expired");

		// Rate limiting failed guesses for an external user
		for (let i = 0; i < 3; i++) {
			const guess = await redeemChatLinkProof(
				{
					organizationId: ids.orgA,
					installationId: instA.id,
					purpose: "member_link",
					code: `ZZZZ-ZZZZ-ZZZ${i}`,
					externalUserId: "tg-bruteforce",
				},
				{ now: () => t0, redeemRateLimitMax: 3 },
			);
			expect(guess.status).toBe("invalid_code");
		}
		const rateLimited = await redeemChatLinkProof(
			{
				organizationId: ids.orgA,
				installationId: instA.id,
				purpose: "member_link",
				code: issued.code,
				externalUserId: "tg-bruteforce",
			},
			{ now: () => t0, redeemRateLimitMax: 3 },
		);
		expect(rateLimited.status).toBe("rate_limited");

		// Rate limiting issuance
		const issueT = new Date("2026-11-26T13:00:00.000Z");
		for (let i = 0; i < 2; i++) {
			const res = await issueChatLinkProof(
				{
					organizationId: ids.orgA,
					installationId: instA.id,
					userId: ids.userOther,
					purpose: "member_link",
				},
				{ now: () => issueT, issueRateLimitMax: 2 },
			);
			expect(res.status).toBe("issued");
		}
		const issueLimited = await issueChatLinkProof(
			{
				organizationId: ids.orgA,
				installationId: instA.id,
				userId: ids.userOther,
				purpose: "member_link",
			},
			{ now: () => issueT, issueRateLimitMax: 2 },
		);
		expect(issueLimited.status).toBe("rate_limited");
	});

	it("refuses former members at both issuance and redemption", async () => {
		const instA = await getTelegramInstallation(ids.orgA);

		// Former member cannot issue a proof
		const formerIssue = await issueChatLinkProof({
			organizationId: ids.orgA,
			installationId: instA.id,
			userId: ids.userFormer,
			purpose: "member_link",
		});
		expect(formerIssue).toEqual({ status: "ineligible", reason: "former_employee" });

		// Active member issues proof, then becomes former before redemption
		const activeIssue = await issueChatLinkProof({
			organizationId: ids.orgA,
			installationId: instA.id,
			userId: ids.userOther,
			purpose: "member_link",
		});
		expect(activeIssue.status).toBe("issued");
		if (activeIssue.status !== "issued") return;

		await db.update(employee).set({ isActive: false }).where(eq(employee.id, ids.empOtherA));

		const redeemAfterDeparture = await redeemChatLinkProof({
			organizationId: ids.orgA,
			installationId: instA.id,
			purpose: "member_link",
			code: activeIssue.code,
			externalUserId: "tg-former-late",
		});
		expect(redeemAfterDeparture).toEqual({ status: "ineligible", reason: "former_employee" });

		// No live link or legacy mapping was created
		const links = await db
			.select()
			.from(chatInstallationMemberLink)
			.where(
				and(
					eq(chatInstallationMemberLink.organizationId, ids.orgA),
					eq(chatInstallationMemberLink.userId, ids.userOther),
				),
			);
		expect(links).toHaveLength(0);
	});

	it("segregates candidate enrollment from live employee links and legacy mappings", async () => {
		const [candidateInst] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.orgA,
				provider: "telegram",
				credentialSource: "organization_owned",
				status: "candidate",
				routeId: "route-2042-cand-tg",
				externalBotId: "204299999",
				externalBotUsername: "z8_orga_candidate_bot",
				verificationState: "verified",
			})
			.returning();

		// Cannot issue member_link proof on a candidate installation
		const wrongPurposeIssue = await issueChatLinkProof({
			organizationId: ids.orgA,
			installationId: candidateInst.id,
			userId: ids.userMulti,
			purpose: "member_link",
		});
		expect(wrongPurposeIssue.status).toBe("installation_unavailable");

		// Issue & redeem candidate_enrollment proof
		const candProof = await issueChatLinkProof({
			organizationId: ids.orgA,
			installationId: candidateInst.id,
			userId: ids.userMulti,
			purpose: "candidate_enrollment",
		});
		expect(candProof.status).toBe("issued");
		if (candProof.status !== "issued") return;

		const candRedeem = await redeemChatLinkProof({
			organizationId: ids.orgA,
			installationId: candidateInst.id,
			purpose: "candidate_enrollment",
			code: candProof.code,
			externalUserId: "tg-cand-777",
			externalUsername: "multi_cand",
		});
		expect(candRedeem).toMatchObject({
			status: "success",
			userId: ids.userMulti,
			isCandidateEnrollment: true,
		});

		// Legacy live telegram_user_mapping must NOT be modified
		const legacyRows = await db
			.select()
			.from(telegramUserMapping)
			.where(
				and(
					eq(telegramUserMapping.organizationId, ids.orgA),
					eq(telegramUserMapping.userId, ids.userMulti),
				),
			);
		expect(legacyRows).toHaveLength(0);

		// Live member chat link status MUST still be action_needed (not connected!)
		const snapshot = await getMemberChatLinks({
			userId: ids.userMulti,
			organizationId: ids.orgA,
		});
		const telegramView = snapshot.channels.find((c) => c.provider === "telegram");
		expect(telegramView?.status).toBe("action_needed");
	});

	it("reuses verified external identity only within its exact verified external scope", async () => {
		const slackA = await getSlackInstallation(ids.orgA);
		const tgA = await getTelegramInstallation(ids.orgA);

		// Stage a candidate Slack app in the SAME workspace for Org A
		const [slackCandidateSameWorkspace] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.orgA,
				provider: "slack",
				credentialSource: "organization_owned",
				status: "candidate",
				routeId: "route-2042-slack-cand-same",
				externalSpaceId: ids.slackTeamA,
				externalSpaceName: "Org A Slack",
				externalAppId: "A2042NEW",
				verificationState: "verified",
			})
			.returning();

		// Stage a candidate Telegram bot (different numeric bot ID -> different external scope!)
		const [tgCandidateDiffBot] = await db
			.insert(chatInstallation)
			.values({
				organizationId: ids.orgA,
				provider: "telegram",
				credentialSource: "organization_owned",
				status: "candidate",
				routeId: "route-2042-tg-cand-diff",
				externalBotId: "204288888",
				externalBotUsername: "z8_orga_new_bot",
				verificationState: "verified",
			})
			.returning();

		// Link user on live Slack A and live Telegram A via proof
		const slackProof = await issueChatLinkProof({
			organizationId: ids.orgA,
			installationId: slackA.id,
			userId: ids.userMulti,
			purpose: "member_link",
		});
		if (slackProof.status !== "issued") throw new Error("expected slack proof");
		const slackRedeem = await redeemChatLinkProof({
			organizationId: ids.orgA,
			installationId: slackA.id,
			purpose: "member_link",
			code: slackProof.code,
			externalUserId: "U_SLACK_MULTI",
			externalUsername: "multi_slack",
		});
		expect(slackRedeem.status).toBe("success");

		const tgProof = await issueChatLinkProof({
			organizationId: ids.orgA,
			installationId: tgA.id,
			userId: ids.userMulti,
			purpose: "member_link",
		});
		if (tgProof.status !== "issued") throw new Error("expected tg proof");
		const tgRedeem = await redeemChatLinkProof({
			organizationId: ids.orgA,
			installationId: tgA.id,
			purpose: "member_link",
			code: tgProof.code,
			externalUserId: "777001",
			externalUsername: "multi_tg",
		});
		expect(tgRedeem.status).toBe("success");

		// Same org + same Slack workspace -> reuse succeeds (into candidate lane)
		const slackReuse = await reuseVerifiedExternalIdentity({
			organizationId: ids.orgA,
			sourceInstallationId: slackA.id,
			targetInstallationId: slackCandidateSameWorkspace.id,
			userId: ids.userMulti,
		});
		expect(slackReuse).toMatchObject({
			status: "reused",
			externalUserId: "U_SLACK_MULTI",
			externalScope: `slack:workspace:${ids.slackTeamA}`,
			isCandidateEnrollment: true,
		});

		// Different Telegram bot -> scope_mismatch!
		const tgReuse = await reuseVerifiedExternalIdentity({
			organizationId: ids.orgA,
			sourceInstallationId: tgA.id,
			targetInstallationId: tgCandidateDiffBot.id,
			userId: ids.userMulti,
		});
		expect(tgReuse.status).toBe("scope_mismatch");

		// Cross-organization installation -> installation_not_found!
		const tgB = await getTelegramInstallation(ids.orgB);
		const crossOrgReuse = await reuseVerifiedExternalIdentity({
			organizationId: ids.orgA,
			sourceInstallationId: tgA.id,
			targetInstallationId: tgB.id,
			userId: ids.userMulti,
		});
		expect(crossOrgReuse.status).toBe("installation_not_found");
	});

	it("keeps link status, linking, and unlinking independent across organizations and shares channel availability", async () => {
		// Verify shared availability per org vs absent org
		expect(await getOrganizationChatChannelAvailability(ids.orgA)).toEqual({
			slack: true,
			teams: false,
			telegram: true,
			discord: false,
		});
		expect(await getOrganizationChatChannelAvailability(ids.orgB)).toEqual({
			slack: false,
			teams: false,
			telegram: true,
			discord: false,
		});
		expect(await getOrganizationChatChannelAvailability(null)).toEqual({
			slack: false,
			teams: false,
			telegram: false,
			discord: false,
		});

		// Link User Multi in Org A via end-to-end Telegram flow
		const codeA = await issueMemberTelegramLinkCode({
			userId: ids.userMulti,
			organizationId: ids.orgA,
		});
		expect(codeA.status).toBe("issued");
		if (codeA.status !== "issued") return;

		const claimA = await claimLinkCode(
			codeA.code,
			"tg-multi-user",
			ids.orgA,
			"multi_handle",
			"Multi Member",
			{ botToken: ids.botTokenA, chatId: "chat-a-1" },
		);
		expect(claimA).toEqual({
			status: "success",
			userId: ids.userMulti,
			employeeId: ids.empMultiA,
		});

		// Org A is Connected, Org B is still Action needed
		const linksA1 = await getMemberChatLinks({
			userId: ids.userMulti,
			organizationId: ids.orgA,
		});
		const linksB1 = await getMemberChatLinks({
			userId: ids.userMulti,
			organizationId: ids.orgB,
		});
		expect(linksA1.channels.find((c) => c.provider === "telegram")?.status).toBe("connected");
		expect(linksB1.channels.find((c) => c.provider === "telegram")?.status).toBe("action_needed");

		// Link User Multi in Org B too
		const codeB = await issueMemberTelegramLinkCode({
			userId: ids.userMulti,
			organizationId: ids.orgB,
		});
		if (codeB.status !== "issued") throw new Error("expected orgB code");
		const claimB = await claimLinkCode(
			codeB.code,
			"tg-multi-user",
			ids.orgB,
			"multi_handle",
			"Multi Member",
			{ botToken: ids.botTokenB, chatId: "chat-b-1" },
		);
		expect(claimB.status).toBe("success");

		// Unlink in Org A -> Org A becomes action_needed, Org B stays connected!
		const unlinkedA = await unlinkMemberChatLink({
			userId: ids.userMulti,
			organizationId: ids.orgA,
			provider: "telegram",
		});
		expect(unlinkedA).toEqual({ unlinked: true });

		const linksA2 = await getMemberChatLinks({
			userId: ids.userMulti,
			organizationId: ids.orgA,
		});
		const linksB2 = await getMemberChatLinks({
			userId: ids.userMulti,
			organizationId: ids.orgB,
		});
		expect(linksA2.channels.find((c) => c.provider === "telegram")?.status).toBe("action_needed");
		expect(linksB2.channels.find((c) => c.provider === "telegram")?.status).toBe("connected");
	});
});
