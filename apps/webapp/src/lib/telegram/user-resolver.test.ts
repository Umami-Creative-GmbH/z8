import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	resolveTelegramInstallationForBot: vi.fn(),
	redeemChatLinkProof: vi.fn(),
	unlinkMemberChatLink: vi.fn(),
	resolveCommandActorEmployee: vi.fn(),
	findLinkCode: vi.fn(),
	findMapping: vi.fn(),
	insertValues: vi.fn(),
	updateWhere: vi.fn(),
}));

vi.mock("@/lib/chat-installations/member-links", () => ({
	resolveTelegramInstallationForBot: mocks.resolveTelegramInstallationForBot,
	redeemChatLinkProof: mocks.redeemChatLinkProof,
	unlinkMemberChatLink: mocks.unlinkMemberChatLink,
}));

vi.mock("@/lib/integrations/resolve-command-actor", () => ({
	resolveCommandActorEmployee: mocks.resolveCommandActorEmployee,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			telegramLinkCode: { findFirst: mocks.findLinkCode },
			telegramUserMapping: { findFirst: mocks.findMapping },
		},
		insert: () => ({ values: mocks.insertValues }),
		update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
	},
}));

const { claimLinkCode, unlinkTelegramUser } = await import("./user-resolver");

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolveTelegramInstallationForBot.mockResolvedValue({
		id: "inst-tg-1",
		organizationId: "org-1",
		provider: "telegram",
		status: "legacy_active",
	});
	mocks.redeemChatLinkProof.mockResolvedValue({ status: "invalid_code" });
	mocks.unlinkMemberChatLink.mockResolvedValue({ unlinked: true });
	mocks.resolveCommandActorEmployee.mockResolvedValue({ id: "emp-1", isActive: true });
	mocks.findLinkCode.mockResolvedValue(null);
	mocks.findMapping.mockResolvedValue(null);
	mocks.insertValues.mockResolvedValue(undefined);
	mocks.updateWhere.mockResolvedValue(undefined);
});

describe("Telegram claimLinkCode with installation-bound digest proofs", () => {
	it("redeems installation-bound digest proof using the inbound bot identity", async () => {
		mocks.redeemChatLinkProof.mockResolvedValueOnce({
			status: "success",
			userId: "user-1",
			employeeId: "emp-1",
			linkId: "link-1",
			installationId: "inst-tg-1",
			isCandidateEnrollment: false,
		});

		const result = await claimLinkCode("ABCD-EFGH-2345", "tg-42", "org-1", "alice", "Alice", {
			botToken: "123456:token",
			chatId: "chat-42",
		});

		expect(result).toEqual({ status: "success", userId: "user-1", employeeId: "emp-1" });
		expect(mocks.resolveTelegramInstallationForBot).toHaveBeenCalledWith({
			organizationId: "org-1",
			botToken: "123456:token",
			installationId: undefined,
		});
		expect(mocks.redeemChatLinkProof).toHaveBeenCalledWith({
			organizationId: "org-1",
			installationId: "inst-tg-1",
			purpose: "member_link",
			code: "ABCD-EFGH-2345",
			externalUserId: "tg-42",
			externalUsername: "alice",
			externalDisplayName: "Alice",
			externalConversationId: "chat-42",
			conversationType: "private",
		});
		expect(mocks.findLinkCode).not.toHaveBeenCalled();
	});

	it("returns rate_limited and ineligible directly without falling back to legacy codes", async () => {
		mocks.redeemChatLinkProof.mockResolvedValueOnce({
			status: "rate_limited",
			retryAfterSeconds: 60,
		});
		expect(
			await claimLinkCode("BADCODE", "tg-42", "org-1", undefined, undefined, {
				botToken: "123456:token",
			}),
		).toEqual({ status: "rate_limited" });
		expect(mocks.findLinkCode).not.toHaveBeenCalled();

		mocks.redeemChatLinkProof.mockResolvedValueOnce({
			status: "ineligible",
			reason: "former_employee",
		});
		expect(
			await claimLinkCode("ABCD-EFGH-2345", "tg-42", "org-1", undefined, undefined, {
				botToken: "123456:token",
			}),
		).toEqual({ status: "ineligible" });
		expect(mocks.findLinkCode).not.toHaveBeenCalled();
	});

	it("falls back to unexpired legacy 6-char codes and refuses former employees", async () => {
		mocks.findLinkCode.mockResolvedValueOnce({
			id: "legacy-1",
			userId: "user-former",
			organizationId: "org-1",
			code: "ABC234",
			status: "pending",
			expiresAt: new Date(Date.now() + 60_000),
		});
		mocks.resolveCommandActorEmployee.mockResolvedValueOnce(null);

		const result = await claimLinkCode("ABC234", "tg-42", "org-1", "former", "Former User", {
			botToken: "123456:token",
		});

		expect(result).toEqual({ status: "ineligible" });
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});

	it("unlinks via shared member-link unlinker for the organization", async () => {
		const ok = await unlinkTelegramUser("user-1", "org-1");
		expect(ok).toBe(true);
		expect(mocks.unlinkMemberChatLink).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
			provider: "telegram",
		});
	});
});
