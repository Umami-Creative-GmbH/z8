import { beforeEach, describe, expect, it, vi } from "vitest";

// Every Slack reply is in the recipient language: a linked user's own
// language (here "de"), else the organization's default (here "fr").
const state = vi.hoisted(() => ({
	executeCommand: vi.fn(),
	postMessage: vi.fn(),
	resolveSlackUser: vi.fn(),
	claimLinkCode: vi.fn(),
	getUserLocale: vi.fn(),
}));

vi.mock("@/lib/bot-platform/command-registry", () => ({
	executeCommand: state.executeCommand,
	parseCommand: (text: string) => ({ command: text.replace(/^\//, ""), args: [] }),
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getUserLocale: state.getUserLocale,
	getBotTranslate: async (locale: string) => (key: string) => `${locale}:${key}`,
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("./api", () => ({ postMessage: state.postMessage }));
vi.mock("./approval-handler", () => ({ handleApprovalAction: vi.fn() }));
vi.mock("./conversation-manager", () => ({ saveConversation: vi.fn() }));
vi.mock("./user-resolver", () => ({
	resolveSlackUser: state.resolveSlackUser,
	claimLinkCode: state.claimLinkCode,
}));

const { handleSlashCommand, handleEvent } = await import("./bot-handler");

const bot = {
	organizationId: "org-1",
	slackTeamId: "team-1",
	botAccessToken: "xoxb",
	botUserId: "bot-user",
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: false,
	enableEscalations: false,
	digestTime: "08:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
} as never;

function slash(text: string) {
	return {
		text,
		user_id: "slack-user",
		user_name: "requester",
		channel_id: "channel-1",
	} as never;
}

const linked = { status: "found", user: { userId: "user-1", employeeId: "employee-1" } };

beforeEach(() => {
	vi.clearAllMocks();
	state.getUserLocale.mockImplementation(async ({ userId }: { userId: string | null }) =>
		userId ? "de" : "fr",
	);
	state.resolveSlackUser.mockResolvedValue(linked);
	state.executeCommand.mockResolvedValue({ type: "text", text: "reply" });
});

describe("Slack bot replies", () => {
	it("runs commands in the linked user's recipient language", async () => {
		await handleSlashCommand(slash("clockin"), bot);

		expect(state.getUserLocale).toHaveBeenCalledWith({ userId: "user-1", organizationId: "org-1" });
		expect(state.executeCommand).toHaveBeenCalledWith(
			"clockin",
			expect.objectContaining({ locale: "de" }),
		);
	});

	it("welcomes in the organization's default language", async () => {
		await expect(handleSlashCommand(slash(""), bot)).resolves.toEqual({
			text: "fr:bot.static.welcomeSlack",
		});
		expect(state.getUserLocale).toHaveBeenCalledWith({ userId: null, organizationId: "org-1" });
	});

	it("tells an unlinked user in the organization's default language", async () => {
		state.resolveSlackUser.mockResolvedValue({ status: "not_linked" });

		await expect(handleSlashCommand(slash("clockin"), bot)).resolves.toEqual({
			text: "fr:bot.static.notLinkedSlack",
		});
		expect(state.executeCommand).not.toHaveBeenCalled();
	});

	it("answers a link code in the organization's default, and a success in the user's language", async () => {
		state.claimLinkCode.mockResolvedValueOnce({ status: "invalid_code" });
		await expect(handleSlashCommand(slash("link ABC"), bot)).resolves.toEqual({
			text: "fr:bot.static.linkInvalid",
		});

		state.claimLinkCode.mockResolvedValueOnce({
			status: "success",
			userId: "user-1",
			employeeId: "employee-1",
		});
		await expect(handleSlashCommand(slash("link ABC"), bot)).resolves.toEqual({
			text: "de:bot.static.linkSuccessSlack",
		});

		await expect(handleSlashCommand(slash("link"), bot)).resolves.toEqual({
			text: "fr:bot.static.linkUsageSlack",
		});
	});

	it("answers direct messages in the recipient language", async () => {
		const dm = (text: string) =>
			({
				event: { type: "message", channel_type: "im", text, user: "slack-user", channel: "dm" },
			}) as never;

		await handleEvent(dm("hello"), bot);
		expect(state.postMessage).toHaveBeenLastCalledWith("xoxb", {
			channel: "dm",
			text: "de:bot.static.helpHintSlack",
		});

		state.resolveSlackUser.mockResolvedValue({ status: "not_linked" });
		await handleEvent(dm("hello"), bot);
		expect(state.postMessage).toHaveBeenLastCalledWith("xoxb", {
			channel: "dm",
			text: "fr:bot.static.notLinkedSlackDm",
		});
	});
});
