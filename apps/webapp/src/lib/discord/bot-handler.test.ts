import { beforeEach, describe, expect, it, vi } from "vitest";

// Every Discord reply is in the recipient language: a linked user's own
// language (here "de"), else the organization's default (here "fr").
const state = vi.hoisted(() => ({
	executeCommand: vi.fn(),
	followup: vi.fn(),
	interactionResponse: vi.fn(),
	resolveDiscordUser: vi.fn(),
	claimLinkCode: vi.fn(),
	getUserLocale: vi.fn(),
}));

vi.mock("@/lib/bot-platform/command-registry", () => ({ executeCommand: state.executeCommand }));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getUserLocale: state.getUserLocale,
	getBotTranslate: async (locale: string) => (key: string) => `${locale}:${key}`,
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("./api", () => ({
	createFollowupMessage: state.followup,
	createInteractionResponse: state.interactionResponse,
}));
vi.mock("./approval-handler", () => ({
	handleApprovalButtonClick: vi.fn(),
	handleBoundApprovalInteraction: vi.fn(),
}));
vi.mock("./bound-approval", () => ({ parseBoundApprovalCustomId: () => null }));
vi.mock("./conversation-manager", () => ({ saveConversation: vi.fn() }));
vi.mock("./user-resolver", () => ({
	resolveDiscordUser: state.resolveDiscordUser,
	claimLinkCode: state.claimLinkCode,
}));

const { handleDiscordInteraction } = await import("./bot-handler");
const { InteractionType } = await import("./types");

const bot = {
	organizationId: "org-1",
	botToken: "bot-token",
	applicationId: "app-1",
	enableApprovals: true,
	enableCommands: true,
} as never;

function command(name: string, options?: { name: string; value: string }[]) {
	return {
		id: "interaction-1",
		token: "token-1",
		type: InteractionType.APPLICATION_COMMAND,
		data: { name, options },
		user: { id: "discord-user", username: "requester" },
		channel_id: "channel-1",
	} as never;
}

function lastFollowupContent() {
	return state.followup.mock.lastCall?.[3]?.content;
}

beforeEach(() => {
	vi.clearAllMocks();
	state.getUserLocale.mockImplementation(async ({ userId }: { userId: string | null }) =>
		userId ? "de" : "fr",
	);
	state.resolveDiscordUser.mockResolvedValue({
		status: "found",
		user: { userId: "user-1", employeeId: "employee-1" },
	});
	state.executeCommand.mockResolvedValue({ type: "text", text: "reply" });
});

describe("Discord bot replies", () => {
	it("runs commands in the linked user's recipient language", async () => {
		await handleDiscordInteraction(command("clockin"), bot);

		expect(state.getUserLocale).toHaveBeenCalledWith({ userId: "user-1", organizationId: "org-1" });
		expect(state.executeCommand).toHaveBeenCalledWith(
			"clockin",
			expect.objectContaining({ locale: "de" }),
		);
	});

	it("tells an unlinked user in the organization's default language", async () => {
		state.resolveDiscordUser.mockResolvedValue({ status: "not_linked" });

		await handleDiscordInteraction(command("clockin"), bot);

		expect(lastFollowupContent()).toBe("fr:bot.static.notLinkedDiscord");
		expect(state.executeCommand).not.toHaveBeenCalled();
	});

	it("reports a failed command in the user's language", async () => {
		state.executeCommand.mockRejectedValue(new Error("boom"));

		await handleDiscordInteraction(command("clockin"), bot);

		expect(lastFollowupContent()).toBe("de:bot.static.commandError");
	});

	it("answers a link code in the organization's default, and a success in the user's language", async () => {
		await handleDiscordInteraction(command("link"), bot);
		expect(lastFollowupContent()).toBe("fr:bot.static.linkUsageDiscord");

		state.claimLinkCode.mockResolvedValueOnce({ status: "expired" });
		await handleDiscordInteraction(command("link", [{ name: "code", value: "ABC" }]), bot);
		expect(lastFollowupContent()).toBe("fr:bot.static.linkExpired");

		state.claimLinkCode.mockResolvedValueOnce({
			status: "success",
			userId: "user-1",
			employeeId: "employee-1",
		});
		await handleDiscordInteraction(command("link", [{ name: "code", value: "ABC" }]), bot);
		expect(lastFollowupContent()).toBe("de:bot.static.linkSuccessDiscord");
	});
});
