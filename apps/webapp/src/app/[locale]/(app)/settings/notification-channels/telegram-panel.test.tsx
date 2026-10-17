import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	access: vi.fn(),
	bot: vi.fn(),
	link: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.access,
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			telegramBotConfig: { findFirst: mocks.bot },
			telegramUserMapping: { findFirst: mocks.link },
		},
	},
}));
vi.mock("@/components/settings/telegram-settings", () => ({
	TelegramSettings: () => null,
}));

import { TelegramPanel } from "./telegram-panel";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.access.mockResolvedValue({
		organizationId: "org-1",
		authContext: { user: { id: "user-1" } },
	});
	mocks.bot.mockResolvedValue({
		botToken: "private-token",
		setupStatus: "connected",
		botUsername: "example_bot",
	});
	mocks.link.mockResolvedValue({
		telegramUsername: "example",
		telegramDisplayName: "Employee",
		isActive: true,
		privateField: "private",
	});
});
describe("merged chat Telegram panel", () => {
	it("preserves organization and current-user query scopes and excludes server secrets", async () => {
		const panel = await TelegramPanel();
		const dialect = new PgDialect();
		expect(dialect.sqlToQuery(mocks.bot.mock.calls[0][0].where).params).toEqual(
			["org-1"],
		);
		expect(
			dialect.sqlToQuery(mocks.link.mock.calls[0][0].where).params,
		).toEqual(["user-1", "org-1", true]);
		expect(panel.props).toMatchObject({
			organizationId: "org-1",
			userId: "user-1",
			isAdmin: true,
			initialConfig: { botUsername: "example_bot" },
			initialUserLink: { telegramUsername: "example" },
		});
		expect(JSON.stringify(panel.props)).not.toContain("private-token");
		expect(panel.props.initialConfig).not.toHaveProperty("botToken");
		expect(panel.props.initialUserLink).not.toHaveProperty("privateField");
	});
	it("does not query organization data before the org-admin guard", async () => {
		mocks.access.mockRejectedValue(new Error("denied"));
		await expect(TelegramPanel()).rejects.toThrow("denied");
		expect(mocks.bot).not.toHaveBeenCalled();
		expect(mocks.link).not.toHaveBeenCalled();
	});
});
