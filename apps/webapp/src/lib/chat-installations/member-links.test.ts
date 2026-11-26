import { describe, expect, it } from "vitest";
import {
	buildAvailableNotificationChannels,
	buildVerifiedExternalScope,
	deriveMemberChannelLinkStatus,
	generateChatLinkCode,
	getOrganizationChatChannelAvailability,
	hashChatLinkCode,
	normalizeChatLinkCode,
} from "./member-links";

describe("chat link code normalization, entropy, and digest binding", () => {
	it("normalizes whitespace, hyphens, and letter case before hashing", () => {
		const ctx = {
			organizationId: "org-a",
			installationId: "inst-1",
			purpose: "member_link" as const,
		};

		expect(normalizeChatLinkCode(" abcd-efgh-2345 ")).toBe("ABCDEFGH2345");
		expect(hashChatLinkCode("abcd-efgh-2345", ctx)).toBe(hashChatLinkCode("  ABCDEFGH2345 ", ctx));
		expect(hashChatLinkCode("abcd-efgh-2345", ctx)).toMatch(/^[0-9a-f]{64}$/);
	});

	it("binds digests to organization, installation, and purpose", () => {
		const code = "ABCD-EFGH-2345";
		const base = hashChatLinkCode(code, {
			organizationId: "org-a",
			installationId: "inst-1",
			purpose: "member_link",
		});
		const wrongOrg = hashChatLinkCode(code, {
			organizationId: "org-b",
			installationId: "inst-1",
			purpose: "member_link",
		});
		const wrongInstallation = hashChatLinkCode(code, {
			organizationId: "org-a",
			installationId: "inst-2",
			purpose: "member_link",
		});
		const wrongPurpose = hashChatLinkCode(code, {
			organizationId: "org-a",
			installationId: "inst-1",
			purpose: "candidate_enrollment",
		});

		expect(new Set([base, wrongOrg, wrongInstallation, wrongPurpose]).size).toBe(4);
	});

	it("generates formatted high-entropy unambiguous codes", () => {
		const codes = new Set(Array.from({ length: 20 }, () => generateChatLinkCode()));
		expect(codes.size).toBe(20);
		for (const code of codes) {
			expect(code).toMatch(
				/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/,
			);
		}
	});
});

describe("buildVerifiedExternalScope", () => {
	it("scopes Slack to workspace, Teams to tenant, Telegram to bot ID, and Discord to application ID", () => {
		expect(
			buildVerifiedExternalScope({
				provider: "slack",
				externalSpaceId: "T12345",
				externalBotId: "U999",
				externalAppId: "A111",
			}),
		).toBe("slack:workspace:T12345");

		expect(
			buildVerifiedExternalScope({
				provider: "teams",
				externalSpaceId: "11111111-2222-4333-8444-555555555555",
				externalBotId: null,
				externalAppId: "app-1",
			}),
		).toBe("teams:tenant:11111111-2222-4333-8444-555555555555");

		expect(
			buildVerifiedExternalScope({
				provider: "telegram",
				externalSpaceId: null,
				externalBotId: "123456789",
				externalAppId: null,
			}),
		).toBe("telegram:bot:123456789");

		expect(
			buildVerifiedExternalScope({
				provider: "discord",
				externalSpaceId: null,
				externalBotId: null,
				externalAppId: "987654321012345678",
			}),
		).toBe("discord:app:987654321012345678");
	});

	it("returns null when the required verified identity is missing", () => {
		expect(
			buildVerifiedExternalScope({
				provider: "telegram",
				externalSpaceId: null,
				externalBotId: "   ",
				externalAppId: null,
			}),
		).toBeNull();
	});
});

describe("getOrganizationChatChannelAvailability & buildAvailableNotificationChannels", () => {
	it("returns all chat channels unavailable when organization context is absent", async () => {
		const chatAvailability = await getOrganizationChatChannelAvailability(null);
		expect(chatAvailability).toEqual({
			teams: false,
			telegram: false,
			discord: false,
			slack: false,
		});

		expect(buildAvailableNotificationChannels(chatAvailability)).toEqual({
			in_app: true,
			push: true,
			email: true,
			teams: false,
			telegram: false,
			discord: false,
			slack: false,
		});
	});
});

describe("deriveMemberChannelLinkStatus", () => {
	it("reports unavailable when no installation exists for the organization", () => {
		expect(
			deriveMemberChannelLinkStatus({
				hasActiveInstallation: false,
				hasRemediationInstallation: false,
				verificationFailed: false,
				hasLiveLink: false,
				conversationReachability: null,
			}),
		).toEqual({ status: "unavailable", recoveryHint: null });
	});

	it("reports could_not_verify when verification fails or installation needs remediation", () => {
		expect(
			deriveMemberChannelLinkStatus({
				hasActiveInstallation: true,
				hasRemediationInstallation: false,
				verificationFailed: true,
				hasLiveLink: false,
				conversationReachability: null,
			}),
		).toEqual({ status: "could_not_verify", recoveryHint: "verification_error" });

		expect(
			deriveMemberChannelLinkStatus({
				hasActiveInstallation: false,
				hasRemediationInstallation: true,
				verificationFailed: false,
				hasLiveLink: false,
				conversationReachability: null,
			}),
		).toEqual({ status: "could_not_verify", recoveryHint: "installation_remediation" });
	});

	it("reports action_needed when channel is available but employee is not linked or DM is unreachable", () => {
		expect(
			deriveMemberChannelLinkStatus({
				hasActiveInstallation: true,
				hasRemediationInstallation: false,
				verificationFailed: false,
				hasLiveLink: false,
				conversationReachability: null,
			}),
		).toEqual({ status: "action_needed", recoveryHint: "link_required" });

		expect(
			deriveMemberChannelLinkStatus({
				hasActiveInstallation: true,
				hasRemediationInstallation: false,
				verificationFailed: false,
				hasLiveLink: true,
				conversationReachability: "unreachable",
			}),
		).toEqual({ status: "action_needed", recoveryHint: "start_bot_private_chat" });
	});

	it("reports connected when a live member link is active and reachable", () => {
		expect(
			deriveMemberChannelLinkStatus({
				hasActiveInstallation: true,
				hasRemediationInstallation: false,
				verificationFailed: false,
				hasLiveLink: true,
				conversationReachability: "reachable",
			}),
		).toEqual({ status: "connected", recoveryHint: null });
	});
});
