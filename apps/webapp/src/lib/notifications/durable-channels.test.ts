import { describe, expect, it, vi } from "vitest";
import { isDiscordAvailable, sendDiscordNotification } from "./discord-channel";
import { loadNotificationChannelAvailability } from "./notification-service";
import { isSlackAvailable, sendSlackNotification } from "./slack-channel";
import { isTeamsAvailable, sendTeamsNotification } from "./teams-channel";
import { isTelegramAvailable } from "./telegram-channel";

const mocks = vi.hoisted(() => ({
	recipient: vi.fn(async () => null),
	send: vi.fn(async () => null),
	enabled: vi.fn(async () => true),
}));
vi.mock("@/lib/teams", () => ({
	isTeamsEnabledForOrganization: mocks.enabled,
	isBotConfigured: () => true,
	sendApprovalCardToManager: vi.fn(),
	getConversationReferenceForUser: mocks.recipient,
	sendProactiveMessage: mocks.send,
}));
vi.mock("@/lib/slack", () => ({
	isSlackEnabledForOrganization: mocks.enabled,
	getBotConfigByOrganization: async () => ({ botAccessToken: "test" }),
	sendApprovalMessageToManager: vi.fn(),
	getChannelIdForUser: mocks.recipient,
	postMessage: mocks.send,
}));
vi.mock("@/lib/discord", () => ({
	isDiscordEnabledForOrganization: mocks.enabled,
	getBotConfigByOrganization: async () => ({ botToken: "test" }),
	sendApprovalMessageToManager: vi.fn(),
	getChannelIdForUser: mocks.recipient,
	sendMessage: mocks.send,
}));
vi.mock("@/lib/telegram", () => ({ isTelegramEnabledForOrganization: mocks.enabled }));
vi.mock("@/lib/discord/formatters", () => ({ buildNotificationEmbed: () => [] }));
vi.mock("@/lib/email/email-service", () => ({
	getTransportName: async () => "Console (Development)",
	sendEmail: vi.fn(),
}));
const params = {
	userId: "user",
	organizationId: "org",
	type: "automatic_clock_out" as const,
	title: "Automatic",
	message: "Ended",
};
describe("durable notification channel outcomes", () => {
	for (const [name, available] of Object.entries({
		teams: isTeamsAvailable,
		slack: isSlackAvailable,
		discord: isDiscordAvailable,
		telegram: isTelegramAvailable,
	})) {
		it(`${name} retries strict lookup failures and recovers while preserving best-effort defaults`, async () => {
			mocks.enabled.mockRejectedValue(new Error("lookup offline"));
			await expect(available("org", { throwOnError: true })).rejects.toThrow("lookup offline");
			await expect(available("org")).resolves.toBe(false);
			mocks.enabled.mockResolvedValue(true);
			await expect(available("org", { throwOnError: true })).resolves.toBe(true);
		});
	}
	it("propagates planning lookup errors only for durable availability", async () => {
		mocks.enabled.mockRejectedValue(new Error("lookup offline"));
		await expect(loadNotificationChannelAvailability("org", { durable: true })).rejects.toThrow(
			"lookup offline",
		);
		await expect(loadNotificationChannelAvailability("org")).resolves.toMatchObject({
			teams: false,
		});
		mocks.enabled.mockResolvedValue(true);
	});
	for (const [name, send] of Object.entries({
		teams: sendTeamsNotification,
		slack: sendSlackNotification,
		discord: sendDiscordNotification,
	})) {
		it(`${name} propagates an unacknowledged transport result to durable retry`, async () => {
			mocks.recipient.mockResolvedValue("recipient");
			mocks.send.mockResolvedValue(null);
			await expect(send(params, { durable: true })).rejects.toThrow();
			await expect(send(params)).resolves.toBeUndefined();
		});
		it(`${name} identifies missing recipient transport without marking it sent`, async () => {
			mocks.recipient.mockResolvedValue(null);
			await expect(send(params, { durable: true })).resolves.toBe("unavailable");
			await expect(send(params)).resolves.toBeUndefined();
		});
	}
	it("does not schedule email for the development console transport", async () => {
		expect((await loadNotificationChannelAvailability("org")).email).toBe(false);
	});
});
