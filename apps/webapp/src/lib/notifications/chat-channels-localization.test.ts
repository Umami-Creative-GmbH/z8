import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	localize: vi.fn(),
	slackPost: vi.fn(),
	teamsSend: vi.fn(),
	discordSend: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: { query: { approvalRequest: { findFirst: vi.fn() }, employee: { findFirst: vi.fn() } } },
}));
vi.mock("@/lib/approvals/delivery/store", () => ({
	isApprovalNotificationDeliveredByOwner: vi.fn(async () => false),
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));
vi.mock("./outbound-localization", () => ({ localizeOutboundNotification: mocks.localize }));
vi.mock("@/lib/slack", () => ({
	getBotConfigByOrganization: async () => ({ botAccessToken: "slack-token" }),
	getChannelIdForUser: async () => "slack-channel",
	postMessage: mocks.slackPost,
	sendApprovalMessageToManager: vi.fn(),
}));
vi.mock("@/lib/teams", () => ({
	getConversationReferenceForUser: async () => ({ conversation: { id: "teams-conversation" } }),
	sendProactiveMessage: mocks.teamsSend,
	sendApprovalCardToManager: vi.fn(),
}));
vi.mock("@/lib/discord", () => ({
	getBotConfigByOrganization: async () => ({ botToken: "discord-token" }),
	getChannelIdForUser: async () => "discord-channel",
	sendMessage: mocks.discordSend,
	sendApprovalMessageToManager: vi.fn(),
}));

const metadata = {
	i18n: {
		titleKey: "common:notifications.content.teamMemberAdded.title",
		messageKey: "common:notifications.content.teamMemberAdded.message",
		params: { teamName: "Ops" },
	},
};

const notification = {
	userId: "user-1",
	organizationId: "org-1",
	type: "team_member_added" as const,
	title: "Added to team",
	message: "You were added to the Ops team.",
	actionUrl: "https://z8.test/teams/ops",
	metadata,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.localize.mockResolvedValue({
		locale: "de",
		title: "Zum Team hinzugefügt",
		message: "Sie wurden zum Team Ops hinzugefügt.",
		actionLabel: "In Z8 ansehen",
	});
	mocks.slackPost.mockResolvedValue({ ok: true });
	mocks.teamsSend.mockResolvedValue({ id: "activity" });
	mocks.discordSend.mockResolvedValue({ id: "message" });
});

function expectLocalizedFor(userId: string, organizationId: string) {
	expect(mocks.localize).toHaveBeenCalledWith({
		userId,
		organizationId,
		title: "Added to team",
		message: "You were added to the Ops team.",
		metadata,
		withActionLabel: true,
	});
}

// The first import of the channel module graph is slow when many suites run in parallel.
describe("Slack notification messages", { timeout: 30_000 }, () => {
	it("sends the title, message and link text in the recipient language", async () => {
		const { sendSlackNotification } = await import("./slack-channel");

		await sendSlackNotification(notification);

		expectLocalizedFor("user-1", "org-1");
		expect(mocks.slackPost).toHaveBeenCalledWith("slack-token", {
			channel: "slack-channel",
			text: "*Zum Team hinzugefügt*\n\nSie wurden zum Team Ops hinzugefügt.\n\n<https://z8.test/teams/ops|In Z8 ansehen>",
		});
	});
});

describe("Teams notification messages", { timeout: 30_000 }, () => {
	it("sends the title, message and link text in the recipient language", async () => {
		const { sendTeamsNotification } = await import("./teams-channel");

		await sendTeamsNotification(notification);

		expectLocalizedFor("user-1", "org-1");
		expect(mocks.teamsSend).toHaveBeenCalledWith(
			{ conversation: { id: "teams-conversation" } },
			{
				type: "message",
				text: "**Zum Team hinzugefügt**\n\nSie wurden zum Team Ops hinzugefügt.\n\n[In Z8 ansehen](https://z8.test/teams/ops)",
			},
		);
	});
});

describe("Discord notification messages", { timeout: 30_000 }, () => {
	it("sends the title, message and link text in the recipient language", async () => {
		const { sendDiscordNotification } = await import("./discord-channel");

		await sendDiscordNotification(notification);

		expectLocalizedFor("user-1", "org-1");
		expect(mocks.discordSend).toHaveBeenCalledWith("discord-token", "discord-channel", {
			embeds: [
				expect.objectContaining({
					title: "Zum Team hinzugefügt",
					description:
						"Sie wurden zum Team Ops hinzugefügt.\n\n[In Z8 ansehen](https://z8.test/teams/ops)",
				}),
			],
		});
	});

	it("sends no link when the notification has no action URL", async () => {
		const { sendDiscordNotification } = await import("./discord-channel");

		await sendDiscordNotification({ ...notification, actionUrl: undefined });

		expect(mocks.discordSend).toHaveBeenCalledWith("discord-token", "discord-channel", {
			embeds: [expect.objectContaining({ description: "Sie wurden zum Team Ops hinzugefügt." })],
		});
	});
});
