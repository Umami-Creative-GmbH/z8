import { beforeEach, describe, expect, it, vi } from "vitest";
import { processTelegramBotDigest } from "./daily-digest";

const {
	buildDigestDataForManagerMock,
	getBotTranslateMock,
	getOrganizationPrivateConversationsMock,
	claimTelegramDigestDeliveryMock,
	currentRosterDigestManagerMock,
	markTelegramDigestDeliveryFailedMock,
	markTelegramDigestDeliverySentMock,
	resolveRecipientDisplayContextMock,
	sendMessageMock,
	shouldSkipDigestForManagerMock,
} = vi.hoisted(() => ({
	buildDigestDataForManagerMock: vi.fn(),
	getBotTranslateMock: vi.fn(),
	getOrganizationPrivateConversationsMock: vi.fn(),
	claimTelegramDigestDeliveryMock: vi.fn(),
	currentRosterDigestManagerMock: vi.fn(),
	markTelegramDigestDeliveryFailedMock: vi.fn(),
	markTelegramDigestDeliverySentMock: vi.fn(),
	resolveRecipientDisplayContextMock: vi.fn(),
	sendMessageMock: vi.fn(),
	shouldSkipDigestForManagerMock: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/bot-platform/current-roster-team", () => ({
	currentRosterDigestManager: currentRosterDigestManagerMock,
}));
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/bot-platform/i18n", () => ({ getBotTranslate: getBotTranslateMock }));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));
vi.mock("@/lib/notifications/recipient-display-context", () => ({
	resolveRecipientDisplayContext: resolveRecipientDisplayContextMock,
}));
vi.mock("@/lib/teams/jobs/daily-digest", () => ({
	buildDigestDataForManager: buildDigestDataForManagerMock,
	shouldSkipDigestForManager: shouldSkipDigestForManagerMock,
}));
vi.mock("../api", () => ({ sendMessage: sendMessageMock }));
vi.mock("../bot-config", () => ({ getAllActiveBotConfigs: vi.fn() }));
vi.mock("../conversation-manager", () => ({
	getOrganizationPrivateConversations: getOrganizationPrivateConversationsMock,
}));
vi.mock("../formatters", () => ({ buildDailyDigestMessage: vi.fn(() => "digest") }));
vi.mock("./digest-delivery-ledger", () => ({
	claimTelegramDigestDelivery: claimTelegramDigestDeliveryMock,
	markTelegramDigestDeliveryFailed: markTelegramDigestDeliveryFailedMock,
	markTelegramDigestDeliverySent: markTelegramDigestDeliverySentMock,
}));

describe("processTelegramBotDigest", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		getOrganizationPrivateConversationsMock.mockResolvedValue([
			{ chatId: "chat-berlin", userId: "manager-berlin" },
			{ chatId: "chat-new-york", userId: "manager-new-york" },
		]);
		resolveRecipientDisplayContextMock
			.mockResolvedValueOnce({ locale: "de", timeFormat: "24h", timezone: "Europe/Berlin" })
			.mockResolvedValueOnce({
				locale: "en-US",
				timeFormat: "12h",
				timezone: "America/New_York",
			});
		buildDigestDataForManagerMock.mockResolvedValue({});
		getBotTranslateMock.mockResolvedValue(() => "digest");
		sendMessageMock.mockResolvedValue({});
		claimTelegramDigestDeliveryMock.mockResolvedValue(true);
		markTelegramDigestDeliverySentMock.mockResolvedValue(undefined);
		markTelegramDigestDeliveryFailedMock.mockResolvedValue(undefined);
		shouldSkipDigestForManagerMock.mockResolvedValue(false);
	});

	it("sends once when concurrent runs compete for the same recipient digest", async () => {
		currentRosterDigestManagerMock.mockResolvedValue({ id: "employee-berlin" });
		getOrganizationPrivateConversationsMock.mockResolvedValue([
			{ chatId: "chat-berlin", userId: "manager-berlin" },
		]);
		resolveRecipientDisplayContextMock.mockResolvedValue({
			locale: "de",
			timeFormat: "24h",
			timezone: "Europe/Berlin",
		});
		claimTelegramDigestDeliveryMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
		const bot = {
			botToken: "token",
			digestTime: "02:00",
			digestTimezone: "Europe/Berlin",
			organizationId: "org-a",
		};

		const [first, second] = await Promise.all([
			processTelegramBotDigest(bot, new Date("2026-07-10T00:05:00.000Z")),
			processTelegramBotDigest(bot, new Date("2026-07-10T00:05:00.000Z")),
		]);

		expect(first + second).toBe(1);
		expect(sendMessageMock).toHaveBeenCalledTimes(1);
	});

	it("retries a failed delivery claim", async () => {
		currentRosterDigestManagerMock.mockResolvedValue({ id: "employee-berlin" });
		getOrganizationPrivateConversationsMock.mockResolvedValue([
			{ chatId: "chat-berlin", userId: "manager-berlin" },
		]);
		resolveRecipientDisplayContextMock.mockResolvedValue({
			locale: "de",
			timeFormat: "24h",
			timezone: "Europe/Berlin",
		});
		const bot = {
			botToken: "token",
			digestTime: "02:00",
			digestTimezone: "Europe/Berlin",
			organizationId: "org-a",
		};

		sendMessageMock.mockRejectedValueOnce(new Error("network"));
		expect(await processTelegramBotDigest(bot, new Date("2026-07-10T00:05:00.000Z"))).toBe(0);
		expect(markTelegramDigestDeliveryFailedMock).toHaveBeenCalledTimes(1);

		sendMessageMock.mockResolvedValueOnce({});
		expect(await processTelegramBotDigest(bot, new Date("2026-07-10T00:05:00.000Z"))).toBe(1);
		expect(sendMessageMock).toHaveBeenCalledTimes(2);
	});

	it("uses separate delivery keys for recipient-local UTC and Honolulu dates", async () => {
		currentRosterDigestManagerMock
			.mockResolvedValueOnce({ id: "employee-utc" })
			.mockResolvedValueOnce({ id: "employee-honolulu" });
		getOrganizationPrivateConversationsMock.mockResolvedValue([
			{ chatId: "chat-utc", userId: "manager-utc" },
			{ chatId: "chat-honolulu", userId: "manager-honolulu" },
		]);
		resolveRecipientDisplayContextMock
			.mockResolvedValueOnce({ locale: "en", timeFormat: "24h", timezone: "UTC" })
			.mockResolvedValueOnce({ locale: "en", timeFormat: "24h", timezone: "Pacific/Honolulu" });

		await processTelegramBotDigest(
			{
				botToken: "token",
				digestTime: "02:00",
				digestTimezone: "Europe/Berlin",
				organizationId: "org-a",
			},
			new Date("2026-07-10T00:05:00.000Z"),
		);

		expect(claimTelegramDigestDeliveryMock).toHaveBeenCalledWith(
			expect.objectContaining({ logicalDate: "2026-07-10", organizationId: "org-a" }),
		);
		expect(claimTelegramDigestDeliveryMock).toHaveBeenCalledWith(
			expect.objectContaining({ logicalDate: "2026-07-09", organizationId: "org-a" }),
		);
	});

	it("keeps otherwise matching delivery keys scoped to their organization", async () => {
		currentRosterDigestManagerMock.mockResolvedValue({ id: "employee-manager" });
		getOrganizationPrivateConversationsMock.mockResolvedValue([
			{ chatId: "chat-manager", userId: "manager-user" },
		]);
		resolveRecipientDisplayContextMock.mockResolvedValue({
			locale: "en",
			timeFormat: "24h",
			timezone: "UTC",
		});

		await processTelegramBotDigest(
			{
				botToken: "token",
				digestTime: "02:00",
				digestTimezone: "Europe/Berlin",
				organizationId: "org-a",
			},
			new Date("2026-07-10T00:05:00.000Z"),
		);
		await processTelegramBotDigest(
			{
				botToken: "token",
				digestTime: "02:00",
				digestTimezone: "Europe/Berlin",
				organizationId: "org-b",
			},
			new Date("2026-07-10T00:05:00.000Z"),
		);

		expect(claimTelegramDigestDeliveryMock).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-a" }),
		);
		expect(claimTelegramDigestDeliveryMock).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-b" }),
		);
	});

	it("sends nothing to a user who is not a current manager of a current report (#1438)", async () => {
		currentRosterDigestManagerMock.mockResolvedValue(null);

		const sent = await processTelegramBotDigest(
			{
				botToken: "token",
				digestTime: "02:00",
				digestTimezone: "Europe/Berlin",
				organizationId: "org-a",
			},
			new Date("2026-07-10T00:05:00.000Z"),
		);

		expect(sent).toBe(0);
		expect(currentRosterDigestManagerMock).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-a",
			userId: "manager-berlin",
		});
		expect(buildDigestDataForManagerMock).not.toHaveBeenCalled();
		expect(sendMessageMock).not.toHaveBeenCalled();
	});

	it("uses one schedule occurrence while building recipient-specific content", async () => {
		currentRosterDigestManagerMock
			.mockResolvedValueOnce({ id: "employee-berlin" })
			.mockResolvedValueOnce({ id: "employee-new-york" });

		const sent = await processTelegramBotDigest(
			{
				botToken: "token",
				digestTime: "02:00",
				digestTimezone: "Europe/Berlin",
				organizationId: "org-a",
			},
			new Date("2026-07-10T00:05:00.000Z"),
		);

		expect(sent).toBe(2);
		expect(buildDigestDataForManagerMock).toHaveBeenCalledWith(
			"employee-berlin",
			"org-a",
			"Europe/Berlin",
			"de",
		);
		expect(buildDigestDataForManagerMock).toHaveBeenCalledWith(
			"employee-new-york",
			"org-a",
			"America/New_York",
			"en-US",
		);
	});
});
