import { describe, expect, it, vi } from "vitest";
import type { BotCommandContext, BotPlatform } from "@/lib/bot-platform/types";

vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: async () => (_key: string, fallback: string, params?: Record<string, string>) =>
		Object.entries(params ?? {}).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, v), fallback),
}));

const { helpCommand } = await import("./help");

function makeContext(platform: BotPlatform): BotCommandContext {
	return {
		platform,
		organizationId: "org-1",
		employeeId: "emp-1",
		userId: "user-1",
		platformUserId: "ext-1",
		config: {
			organizationId: "org-1",
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: true,
			digestTime: "08:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		},
		args: [],
		locale: "en",
		temporal: {} as never,
		listCommands: () => [helpCommand],
	};
}

describe("helpCommand", () => {
	it.each([
		["teams", "Teams"],
		["telegram", "Telegram"],
		["slack", "Slack"],
		["discord", "Discord"],
	] as const)(
		"renders the correct platform name for %s and directs members to Settings -> Notifications",
		async (platform, expectedName) => {
			const response = await helpCommand.handler(makeContext(platform));

			expect(response.type).toBe("text");
			expect(response.text).toContain(expectedName);
			expect(response.text).toContain("Settings → Notifications");
		},
	);
});
