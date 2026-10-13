import type { TurnContext } from "botbuilder";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Every Teams reply is in the recipient language: a linked user's own
// language (here "de"), else the organization's default (here "fr").
const state = vi.hoisted(() => ({
	executeCommand: vi.fn(),
	resolveTeamsUser: vi.fn(),
	getUserLocale: vi.fn(),
}));

vi.mock("@/env", () => ({ env: { APP_URL: "https://z8.test" } }));
vi.mock("@/lib/bot-platform/command-registry", () => ({
	executeCommand: state.executeCommand,
	parseCommand: (text: string) => (text ? { command: text, args: [] } : null),
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getUserLocale: state.getUserLocale,
	getBotTranslate: async (locale: string) => (key: string) => `${locale}:${key}`,
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("./tenant-resolver", () => ({
	resolveTenant: async () => ({
		status: "configured",
		tenant: { organizationId: "org-1", enableCommands: true },
	}),
	updateTenantServiceUrl: vi.fn(),
}));
vi.mock("./user-resolver", () => ({ resolveTeamsUser: state.resolveTeamsUser }));
vi.mock("./conversation-manager", () => ({
	saveConversationReference: vi.fn(),
	deactivateConversation: vi.fn(),
}));
vi.mock("./approval-handler", () => ({
	handleApprovalAction: vi.fn(),
	handleBoundApprovalInvoke: vi.fn(),
}));
vi.mock("./bound-approval", () => ({ parseTeamsBoundApprovalInvoke: () => ({ kind: "none" }) }));
vi.mock("./shift-pickup-handler", () => ({ handleShiftPickupAction: vi.fn() }));

const { handleBotActivity } = await import("./bot-handler");

function turn(activity: Record<string, unknown>) {
	const sendActivity = vi.fn().mockResolvedValue(undefined);
	return {
		context: { activity, sendActivity } as unknown as TurnContext,
		sent: () => sendActivity.mock.calls.map(([message]) => message),
	};
}

function messageActivity(text: string) {
	return {
		type: "message",
		text,
		conversation: { tenantId: "tenant-1" },
		from: { aadObjectId: "aad-user", name: "Requester" },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	state.getUserLocale.mockImplementation(async ({ userId }: { userId: string | null }) =>
		userId ? "de" : "fr",
	);
	state.resolveTeamsUser.mockResolvedValue({
		status: "found",
		user: { userId: "user-1", employeeId: "employee-1" },
	});
	state.executeCommand.mockResolvedValue({ type: "text", text: "reply" });
});

describe("Teams bot replies", () => {
	it("runs commands in the linked user's recipient language", async () => {
		const { context } = turn(messageActivity("clockin"));

		await handleBotActivity(context);

		expect(state.getUserLocale).toHaveBeenCalledWith({ userId: "user-1", organizationId: "org-1" });
		expect(state.executeCommand).toHaveBeenCalledWith(
			"clockin",
			expect.objectContaining({ locale: "de" }),
		);
	});

	it("tells an unlinked user in the organization's default language", async () => {
		state.resolveTeamsUser.mockResolvedValue({ status: "not_linked" });
		const { context, sent } = turn(messageActivity("clockin"));

		await handleBotActivity(context);

		expect(state.getUserLocale).toHaveBeenCalledWith({ userId: null, organizationId: "org-1" });
		expect(sent()).toEqual(["fr:bot.static.notLinkedTeams"]);
	});

	it("welcomes a configured organization in its default language", async () => {
		const { context, sent } = turn({
			type: "conversationUpdate",
			conversation: { tenantId: "tenant-1" },
			recipient: { id: "bot" },
			membersAdded: [{ id: "bot" }],
		});

		await handleBotActivity(context);

		expect(sent()).toEqual(["fr:bot.static.welcomeTeams"]);
	});

	it("reports an unexpected failure in the linked user's language once the organization is known", async () => {
		state.executeCommand.mockRejectedValue(new Error("boom"));
		const { context, sent } = turn(messageActivity("clockin"));

		await handleBotActivity(context);

		expect(sent()).toEqual(["de:bot.static.genericError"]);
	});

	it("reports a Teams error in the organization's default language for an unlinked presser", async () => {
		state.resolveTeamsUser.mockResolvedValue({ status: "not_linked" });
		const { TeamsError } = await import("./types");
		state.getUserLocale.mockImplementationOnce(async () => {
			throw new TeamsError("lookup failed", "USER_NOT_LINKED");
		});
		const { context, sent } = turn(messageActivity("clockin"));

		await handleBotActivity(context);

		expect(sent()).toEqual(["fr:bot.static.errorUserNotLinked"]);
	});
});
