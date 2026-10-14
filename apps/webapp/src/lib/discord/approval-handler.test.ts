import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createInteractionResponse: vi.fn(async () => true),
	createFollowupMessage: vi.fn(async () => undefined),
	resolveDiscordUser: vi.fn(),
	attemptBotApproval: vi.fn(),
	attemptBoundBotApproval: vi.fn(),
	resolveRecipientDisplayContext: vi.fn(),
	resolveRecipientNotificationLocale: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { query: { discordApprovalMessage: { findFirst: vi.fn() } } } }));
vi.mock("./api", () => ({
	createInteractionResponse: mocks.createInteractionResponse,
	createFollowupMessage: mocks.createFollowupMessage,
	editMessage: vi.fn(),
	sendMessage: vi.fn(),
}));
vi.mock("./user-resolver", () => ({ resolveDiscordUser: mocks.resolveDiscordUser }));
vi.mock("./conversation-manager", () => ({ resolveApprovalDMChannel: vi.fn() }));
vi.mock("@/lib/approvals/delivery/kick", () => ({ kickApprovalDelivery: vi.fn() }));
vi.mock("@/lib/approvals/delivery/store", () => ({
	approvalDeliveryMessageReviewReference: vi.fn(),
	findApprovalDeliveryMessageByRemoteIdentity: vi.fn(async () => null),
	isApprovalDeliveryMessagePending: vi.fn(),
	markApprovalDeliveryMessageWithoutControls: vi.fn(),
}));
vi.mock("@/lib/approvals/presentation", () => ({ prepareApprovalPresentation: vi.fn() }));
vi.mock("@/lib/bot-platform/approval-decision", () => ({
	attemptBotApproval: mocks.attemptBotApproval,
	attemptBoundBotApproval: mocks.attemptBoundBotApproval,
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: async (locale: string) => (key: string, fallback: string) =>
		locale === "en" ? fallback : `${locale}:${key}`,
}));
vi.mock("@/lib/notifications/recipient-display-context", () => ({
	resolveRecipientDisplayContext: mocks.resolveRecipientDisplayContext,
}));
vi.mock("@/lib/notifications/recipient-locale", () => ({
	resolveRecipientNotificationLocale: mocks.resolveRecipientNotificationLocale,
}));

const { handleApprovalButtonClick, handleBoundApprovalInteraction } = await import(
	"./approval-handler"
);

const bot = {
	organizationId: "org-1",
	botToken: "token",
	applicationId: "1122334455667788990",
} as Parameters<typeof handleApprovalButtonClick>[3];

const interaction = {
	id: "1300000000000000001",
	token: "interaction-token",
	application_id: "1122334455667788990",
	user: { id: "4400000000000000001" },
} as Parameters<typeof handleApprovalButtonClick>[0];

function sentContent(): unknown {
	const calls = mocks.createInteractionResponse.mock.calls as unknown as Array<
		[string, string, number, { content?: string }]
	>;
	return calls.at(-1)?.[3]?.content;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolveRecipientNotificationLocale.mockImplementation(
		async (input: { userId?: string | null }) => (input.userId ? "de" : "fr"),
	);
	mocks.resolveRecipientDisplayContext.mockResolvedValue({
		locale: "de",
		timezone: "Europe/Berlin",
		timeFormat: "24h",
	});
});

describe("Discord approval replies", () => {
	it("tells an unlinked presser in the organization's default language", async () => {
		mocks.resolveDiscordUser.mockResolvedValue({ status: "not_found" });

		await handleApprovalButtonClick(interaction, { a: "ap", id: "r-1" }, "44", bot);

		expect(sentContent()).toBe("fr:bot.static.notLinkedDiscord");
	});

	it("reports an unavailable approval in the presser's language", async () => {
		mocks.resolveDiscordUser.mockResolvedValue({
			status: "found",
			user: { userId: "u-1", employeeId: "e-1" },
		});
		mocks.attemptBotApproval.mockResolvedValue({ status: "unavailable" });

		await handleApprovalButtonClick(interaction, { a: "ap", id: "r-1" }, "44", bot);

		expect(sentContent()).toBe("de:bot.approval.unavailable");
	});

	it("tells an unlinked presser of a bound card in the organization's default language", async () => {
		mocks.resolveDiscordUser.mockResolvedValue({ status: "not_found" });

		await handleBoundApprovalInteraction(
			interaction,
			{ action: "approve", bindingId: "b2920000-0000-4000-8000-000000000001" },
			bot,
		);

		expect(mocks.createFollowupMessage).toHaveBeenCalledWith(
			"token",
			bot.applicationId,
			"interaction-token",
			expect.objectContaining({ content: "fr:bot.static.notLinkedDiscord" }),
		);
	});
});
