import { beforeEach, describe, expect, it, vi } from "vitest";

// Every Telegram reply is in the recipient language: a linked user's own
// language (here "de"), else the organization's default (here "fr").
const state = vi.hoisted(() => ({
	executeCommand: vi.fn(),
	sendMessage: vi.fn(),
	resolveTelegramUser: vi.fn(),
	claimLinkCode: vi.fn(),
	getUserLocale: vi.fn(),
	getUserLocaleRaw: vi.fn(),
}));

vi.mock("@/lib/bot-platform/command-registry", () => ({
	executeCommand: state.executeCommand,
	getAllCommands: () => [],
	parseCommand: (text: string) =>
		text.startsWith("/") ? { command: text.slice(1), args: [] } : null,
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getUserLocale: state.getUserLocale,
	getUserLocaleRaw: state.getUserLocaleRaw,
	getBotTranslate: async (locale: string) => (key: string) => `${locale}:${key}`,
	setUserLocale: vi.fn(),
}));
vi.mock("@/lib/bot-platform/temporal-context", () => ({
	resolveBotTemporalContext: async () => ({ locale: "de" }),
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("./api", () => ({
	answerCallbackQuery: vi.fn(),
	editMessageText: vi.fn(),
	sendMessage: state.sendMessage,
}));
vi.mock("./approval-handler", () => ({
	handleApprovalCallback: vi.fn(),
	handleBoundApprovalCallback: vi.fn(),
}));
vi.mock("./bound-approval", () => ({ parseBoundApprovalCallback: () => null }));
vi.mock("./conversation-manager", () => ({ saveConversation: vi.fn() }));
vi.mock("./formatters", () => ({
	escapeMarkdownV2: (text: string) => text,
	markdownToHtml: (text: string) => text,
}));
vi.mock("./user-resolver", () => ({
	resolveTelegramUser: state.resolveTelegramUser,
	claimLinkCode: state.claimLinkCode,
}));

const { handleTelegramUpdate } = await import("./bot-handler");

const bot = {
	organizationId: "org-1",
	botToken: "123:secret",
	enableCommands: true,
} as never;

function message(text: string) {
	return {
		update_id: 1,
		message: { text, chat: { id: 42, type: "private" }, from: { id: 7, first_name: "Ann" } },
	} as never;
}

function lastSent() {
	return state.sendMessage.mock.lastCall?.[1];
}

beforeEach(() => {
	vi.clearAllMocks();
	state.getUserLocale.mockImplementation(async ({ userId }: { userId: string | null }) =>
		userId ? "de" : "fr",
	);
	state.getUserLocaleRaw.mockResolvedValue(null);
	state.resolveTelegramUser.mockResolvedValue({
		status: "found",
		user: { userId: "user-1", employeeId: "employee-1" },
	});
	state.executeCommand.mockResolvedValue({ type: "text", text: "reply" });
});

describe("Telegram bot replies", () => {
	it("welcomes in the organization's default language", async () => {
		await handleTelegramUpdate(message("/start"), bot);

		expect(lastSent().text).toBe("fr:bot.static.welcome");
		expect(state.getUserLocale).toHaveBeenCalledWith({ userId: null, organizationId: "org-1" });
	});

	it("tells an unlinked user in the organization's default language", async () => {
		state.resolveTelegramUser.mockResolvedValue({ status: "not_linked" });

		await handleTelegramUpdate(message("/clockin"), bot);

		expect(lastSent().text).toBe("fr:bot.static.notLinked");
	});

	it("answers a linked user in their recipient language", async () => {
		await handleTelegramUpdate(message("hello"), bot);

		expect(state.getUserLocale).toHaveBeenCalledWith({ userId: "user-1", organizationId: "org-1" });
		expect(lastSent().text).toBe("de:bot.static.typeHelp");
	});

	it("answers a link code in the organization's default, and a success in the user's language", async () => {
		state.claimLinkCode.mockResolvedValueOnce({ status: "invalid_code" });
		await handleTelegramUpdate(message("/link ABC"), bot);
		expect(lastSent().text).toBe("fr:bot.static.linkInvalid");

		state.claimLinkCode.mockResolvedValueOnce({
			status: "success",
			userId: "user-1",
			employeeId: "employee-1",
		});
		await handleTelegramUpdate(message("/link ABC"), bot);
		expect(lastSent().text).toBe("de:bot.static.linkSuccess");
	});

	it("marks only the user's saved language as chosen in /language", async () => {
		state.getUserLocale.mockResolvedValue("fr");

		await handleTelegramUpdate(message("/language"), bot);
		const unsaved = lastSent();
		expect(unsaved.text).toBe("fr:bot.language.prompt");
		const unsavedLabels = unsaved.reply_markup.inline_keyboard
			.flat()
			.map((b: { text: string }) => b.text);
		expect(unsavedLabels.some((label: string) => label.endsWith("✓"))).toBe(false);

		state.getUserLocaleRaw.mockResolvedValue("de");
		await handleTelegramUpdate(message("/language"), bot);
		const chosen = lastSent()
			.reply_markup.inline_keyboard.flat()
			.filter((b: { text: string }) => b.text.endsWith("✓"))
			.map((b: { callback_data: string }) => JSON.parse(b.callback_data).l);
		expect(chosen).toEqual(["de"]);
	});
});
