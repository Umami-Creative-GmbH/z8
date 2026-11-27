import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	getMemberChatLinks: vi.fn(),
	issueMemberChatLinkCode: vi.fn(),
	issueMemberTelegramLinkCode: vi.fn(),
	issueMemberTelegramCandidateLinkCode: vi.fn(),
	unlinkMemberChatLink: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller));
});

vi.mock("@/lib/chat-installations/member-links", () => ({
	getMemberChatLinks: mocks.getMemberChatLinks,
	issueMemberChatLinkCode: mocks.issueMemberChatLinkCode,
	issueMemberTelegramLinkCode: mocks.issueMemberTelegramLinkCode,
	issueMemberTelegramCandidateLinkCode: mocks.issueMemberTelegramCandidateLinkCode,
	unlinkMemberChatLink: mocks.unlinkMemberChatLink,
}));

const {
	generateMemberChatLinkCode,
	generateMemberTelegramLinkCode,
	getMemberChatLinksAction,
	unlinkMemberChatAccount,
} = await import("./chat-link-actions");

const orgMember: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};
const formerEmployee: StubCaller = {
	...orgMember,
	employee: { id: "employee-1", role: "employee", former: true },
};
const pendingMember: StubCaller = { ...orgMember, membershipRole: null };
const noOrgUser: StubCaller = {
	userId: "user-1",
	activeOrganizationId: null,
	membershipRole: null,
	employee: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgMember;
	mocks.getMemberChatLinks.mockResolvedValue({
		organizationId: "org-1",
		hasOrganizationContext: true,
		channels: [],
	});
	mocks.issueMemberChatLinkCode.mockResolvedValue({
		status: "issued",
		proofId: "proof-chat-1",
		code: "TEAM-1234-5678",
		expiresAt: new Date("2026-11-26T12:25:00.000Z"),
		installationId: "inst-teams-1",
		purpose: "member_link",
		botUsername: null,
	});
	mocks.issueMemberTelegramLinkCode.mockResolvedValue({
		status: "issued",
		proofId: "proof-1",
		code: "ABCD-EFGH-2345",
		expiresAt: new Date("2026-11-26T12:25:00.000Z"),
		installationId: "inst-tg-1",
		purpose: "member_link",
		botUsername: "z8_acme_bot",
	});
	mocks.unlinkMemberChatLink.mockResolvedValue({ unlinked: true });
});

describe("member chat link settings actions", () => {
	it("loads the active organization's member chat links using DatabaseService", async () => {
		const result = await getMemberChatLinksAction();

		expect(result).toEqual({
			success: true,
			data: {
				organizationId: "org-1",
				hasOrganizationContext: true,
				channels: [],
			},
		});
		expect(mocks.getMemberChatLinks).toHaveBeenCalledWith(
			{
				userId: "user-1",
				organizationId: "org-1",
			},
			{ db: expect.anything() },
		);
	});

	it.each(["telegram", "slack", "teams", "discord"] as const)(
		"issues a short-lived %s link code scoped to the active organization",
		async (provider) => {
			const result = await generateMemberChatLinkCode({ provider });

			expect(result).toEqual({
				success: true,
				data: {
					code: "TEAM-1234-5678",
					expiresAt: "2026-11-26T12:25:00.000Z",
					installationId: "inst-teams-1",
					botUsername: null,
					provider,
					purpose: "member_link",
				},
			});
			expect(mocks.issueMemberChatLinkCode).toHaveBeenCalledWith(
				{
					userId: "user-1",
					organizationId: "org-1",
					provider,
					purpose: "member_link",
					installationId: undefined,
				},
				{ db: expect.anything() },
			);
		},
	);

	it("issues a short-lived Telegram link code scoped to the active organization", async () => {
		const result = await generateMemberTelegramLinkCode();

		expect(result).toEqual({
			success: true,
			data: {
				code: "ABCD-EFGH-2345",
				expiresAt: "2026-11-26T12:25:00.000Z",
				installationId: "inst-tg-1",
				botUsername: "z8_acme_bot",
			},
		});
		expect(mocks.issueMemberTelegramLinkCode).toHaveBeenCalledWith(
			{
				userId: "user-1",
				organizationId: "org-1",
			},
			{ db: expect.anything() },
		);
	});

	it("surfaces stable refusal code when too many link codes are issued", async () => {
		mocks.issueMemberTelegramLinkCode.mockResolvedValueOnce({
			status: "rate_limited",
			retryAfterSeconds: 180,
		});

		const result = await generateMemberTelegramLinkCode();

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "chat_link_rate_limited",
		});
	});

	it("unlinks the member's own link in the active organization using DatabaseService", async () => {
		const result = await unlinkMemberChatAccount({ provider: "telegram" });

		expect(result).toEqual({ success: true, data: { unlinked: true } });
		expect(mocks.unlinkMemberChatLink).toHaveBeenCalledWith(
			{
				userId: "user-1",
				organizationId: "org-1",
				provider: "telegram",
				installationId: undefined,
			},
			{ db: expect.anything() },
		);
	});

	it.each([
		["a former employee", formerEmployee],
		["a pending member", pendingMember],
		["a user without active organization", noOrgUser],
	])("refuses chat link operations for %s", async (_label, caller) => {
		mocks.caller = caller;

		expect(await getMemberChatLinksAction()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await generateMemberChatLinkCode({ provider: "teams" })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await generateMemberTelegramLinkCode()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await unlinkMemberChatAccount({ provider: "telegram" })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});

		expect(mocks.getMemberChatLinks).not.toHaveBeenCalled();
		expect(mocks.issueMemberChatLinkCode).not.toHaveBeenCalled();
		expect(mocks.issueMemberTelegramLinkCode).not.toHaveBeenCalled();
		expect(mocks.unlinkMemberChatLink).not.toHaveBeenCalled();
	});
});
