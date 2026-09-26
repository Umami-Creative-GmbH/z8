import type { TurnContext } from "botbuilder";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A command reply that cannot be delivered is a transport failure, not a
// command failure: a clock command may already have committed. The adapters
// must not answer it with "something went wrong, please try again".
const state = vi.hoisted(() => ({
	executeCommand: vi.fn(),
	discordFollowup: vi.fn(),
}));

vi.mock("@/lib/bot-platform/command-registry", () => ({
	executeCommand: state.executeCommand,
	parseCommand: (text: string) => ({ command: text.replace(/^\//, ""), args: [] }),
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: async () => (_key: string, fallback: string) => fallback,
	getUserLocale: async () => "en",
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/discord/api", () => ({
	createFollowupMessage: state.discordFollowup,
	createInteractionResponse: vi.fn(),
}));
vi.mock("@/lib/discord/user-resolver", () => ({
	resolveDiscordUser: async () => ({
		status: "found",
		user: { userId: "user-1", employeeId: "employee-1" },
	}),
	claimLinkCode: vi.fn(),
}));
vi.mock("@/lib/discord/conversation-manager", () => ({ saveConversation: vi.fn() }));
vi.mock("@/lib/discord/approval-handler", () => ({ handleApprovalButtonClick: vi.fn() }));
vi.mock("@/lib/teams/tenant-resolver", () => ({
	resolveTenant: async () => ({
		status: "configured",
		tenant: {
			organizationId: "org-1",
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: false,
			enableEscalations: false,
			digestTime: "08:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		},
	}),
	updateTenantServiceUrl: vi.fn(),
}));
vi.mock("@/lib/teams/user-resolver", () => ({
	resolveTeamsUser: async () => ({
		status: "found",
		user: { userId: "user-1", employeeId: "employee-1" },
	}),
}));
vi.mock("@/lib/teams/conversation-manager", () => ({
	saveConversationReference: vi.fn(),
	deactivateConversation: vi.fn(),
}));
vi.mock("@/lib/teams/approval-handler", () => ({ handleApprovalAction: vi.fn() }));
vi.mock("@/lib/teams/shift-pickup-handler", () => ({ handleShiftPickupAction: vi.fn() }));

const { handleDiscordInteraction } = await import("@/lib/discord/bot-handler");
const { handleBotActivity } = await import("@/lib/teams/bot-handler");
const { InteractionType } = await import("@/lib/discord/types");

const committedReply = { type: "text", text: "Clocked out at 09:00. Duration: 1h 1m." };

beforeEach(() => {
	vi.clearAllMocks();
	state.executeCommand.mockResolvedValue(committedReply);
});

describe("command reply delivery", () => {
	it("Discord does not report a processed command as failed when its reply fails", async () => {
		state.discordFollowup.mockRejectedValueOnce(new Error("Discord 503"));

		await handleDiscordInteraction(
			{
				id: "interaction-1",
				token: "token-1",
				type: InteractionType.APPLICATION_COMMAND,
				data: { name: "clockout" },
				user: { id: "discord-user", username: "requester" },
				channel_id: "channel-1",
			} as never,
			{
				organizationId: "org-1",
				botToken: "bot-token",
				applicationId: "application-1",
				enableCommands: true,
			} as never,
		);

		expect(state.executeCommand).toHaveBeenCalledTimes(1);
		expect(state.discordFollowup).toHaveBeenLastCalledWith(
			"bot-token",
			"application-1",
			"token-1",
			{
				content:
					"Your command was processed, but its reply could not be shown. Check your status before repeating it.",
			},
		);
	});

	it("Teams does not answer an undelivered reply with the generic retry error", async () => {
		const sendActivity = vi
			.fn()
			.mockRejectedValueOnce(new Error("Teams 503"))
			.mockResolvedValue(undefined);

		await handleBotActivity({
			activity: {
				type: "message",
				text: "clockout",
				conversation: { tenantId: "tenant-1" },
				from: { aadObjectId: "aad-user", name: "Requester" },
			},
			sendActivity,
		} as unknown as TurnContext);

		expect(state.executeCommand).toHaveBeenCalledTimes(1);
		expect(sendActivity.mock.calls.map(([message]) => message)).toEqual([
			committedReply.text,
			"Your command was processed, but its reply could not be shown. Check your status before repeating it.",
		]);
	});
});
