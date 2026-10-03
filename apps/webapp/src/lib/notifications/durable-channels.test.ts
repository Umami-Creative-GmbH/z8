import { describe, expect, it, vi } from "vitest";
import { sendDiscordNotification } from "./discord-channel";
import { loadNotificationChannelAvailability } from "./notification-service";
import { sendSlackNotification } from "./slack-channel";
import { sendTeamsNotification } from "./teams-channel";

const mocks = vi.hoisted(() => ({
	recipient: vi.fn(async () => null),
	send: vi.fn(async () => null),
}));
vi.mock("@/lib/teams", () => ({
	isTeamsEnabledForOrganization: async () => true,
	isBotConfigured: () => true,
	sendApprovalCardToManager: vi.fn(),
	getConversationReferenceForUser: mocks.recipient,
	sendProactiveMessage: mocks.send,
}));
vi.mock("@/lib/slack", () => ({
	isSlackEnabledForOrganization: async () => true,
	getBotConfigByOrganization: async () => ({ botAccessToken: "test" }),
	sendApprovalMessageToManager: vi.fn(),
	getChannelIdForUser: mocks.recipient,
	postMessage: mocks.send,
}));
vi.mock("@/lib/discord", () => ({
	isDiscordEnabledForOrganization: async () => true,
	getBotConfigByOrganization: async () => ({ botToken: "test" }),
	sendApprovalMessageToManager: vi.fn(),
	getChannelIdForUser: mocks.recipient,
	sendMessage: mocks.send,
}));
vi.mock("@/lib/telegram", () => ({ isTelegramEnabledForOrganization: async () => false }));
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
