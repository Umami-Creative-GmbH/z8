import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAutoClockOutNotification } from "@/lib/time-tracking/automatic-clock-out/notifications";
import { decision } from "@/lib/time-tracking/automatic-clock-out/testing.test.fixture";
import { deliverNotificationToChannel } from "./notification-service";

const mocks = vi.hoisted(() => ({
	domain: vi.fn(),
	slack: vi.fn(),
	teams: vi.fn(),
	telegram: vi.fn(),
	discord: vi.fn(),
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			organization: { findFirst: async () => ({ slug: "acme" }) },
			employee: { findFirst: async () => ({ id: "employee", userId: "recipient" }) },
		},
	},
}));
vi.mock("@/env", () => ({
	env: { PLATFORM_DOMAIN: "platform.example", BETTER_AUTH_URL: "https://app.example" },
}));
vi.mock("@/lib/social-oauth", () => ({ getConfiguredProviders: vi.fn() }));
vi.mock("@/lib/domain/domain-service", () => ({ getDomainConfigByOrganization: mocks.domain }));
vi.mock("@/lib/events", () => ({ publishEventAsync: vi.fn() }));
vi.mock("./email-notifications", () => ({ sendEmailNotification: vi.fn() }));
vi.mock("./push-service", () => ({ isPushAvailable: () => false, sendPushToUser: vi.fn() }));
vi.mock("@/lib/approvals/delivery/store", () => ({
	isApprovalNotificationDeliveredByOwner: vi.fn(),
}));
vi.mock("@/lib/slack", () => ({
	isSlackEnabledForOrganization: async () => true,
	getChannelIdForUser: async () => "recipient",
	getBotConfigByOrganization: async () => ({ botAccessToken: "test" }),
	postMessage: mocks.slack,
	sendApprovalMessageToManager: vi.fn(),
}));
vi.mock("@/lib/teams", () => ({
	isBotConfigured: () => true,
	isTeamsEnabledForOrganization: async () => true,
	getConversationReferenceForUser: async () => "recipient",
	sendProactiveMessage: mocks.teams,
	sendApprovalCardToManager: vi.fn(),
}));
vi.mock("@/lib/telegram", () => ({
	isTelegramEnabledForOrganization: async () => true,
	getChatIdForUser: async () => "recipient",
	getBotConfigByOrganization: async () => ({ botToken: "test" }),
	sendMessage: mocks.telegram,
	sendApprovalMessageToManager: vi.fn(),
}));
vi.mock("@/lib/discord", () => ({
	isDiscordEnabledForOrganization: async () => true,
	getChannelIdForUser: async () => "recipient",
	getBotConfigByOrganization: async () => ({ botToken: "test" }),
	sendMessage: mocks.discord,
	sendApprovalMessageToManager: vi.fn(),
}));
vi.mock("./recipient-display-context", () => ({
	resolveRecipientDisplayContext: async () => ({
		locale: "en",
		timezone: "Europe/Berlin",
		timeFormat: "24h",
	}),
}));
vi.mock("@/lib/bot-platform/temporal-context", () => ({
	resolveBotTemporalContext: async () => ({ locale: "en", effectiveTimezone: "Europe/Berlin" }),
}));
vi.mock("./outbound-localization", () => ({
	localizeOutboundNotification: async (input: { title: string; message: string }) => input,
}));

describe("automatic clock-out external work links", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const send of [mocks.slack, mocks.teams, mocks.telegram, mocks.discord])
			send.mockResolvedValue({ id: "ack" });
	});
	it.each([
		[{ domain: "work.acme.example", domainVerified: true }, "https://work.acme.example"],
		[{ domain: "unverified.example", domainVerified: false }, "https://acme.platform.example"],
		[null, "https://acme.platform.example"],
	])("resolves organization domain %j in actual bot payloads", async (domain, origin) => {
		mocks.domain.mockResolvedValue(domain);
		const facts = decision();
		const params = buildAutoClockOutNotification({
			decision: facts,
			recipientUserId: "recipient",
			locale: "en",
		});
		const relative = `/calendar/${facts.employeeId}?date=2026-10-24`;
		for (const channel of ["slack", "teams", "telegram", "discord"] as const) {
			await expect(
				deliverNotificationToChannel(channel, params, null, { durable: true }),
			).resolves.toBe("sent");
			// These are the actual channel formatters' provider-bound payloads; unescape Telegram Markdown.
			const payload = JSON.stringify(mocks[channel].mock.calls).replace(/\\/g, "");
			expect(payload).toContain(`${origin}${relative}`);
		}
		expect(params.actionUrl).toBe(relative);
		expect(mocks.domain).toHaveBeenCalledWith(facts.organizationId);
	});
});
