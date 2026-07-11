import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	buildDigestDataForManagerMock,
	getBotTranslateMock,
	getOrganizationPrivateConversationsMock,
	claimTelegramDigestDeliveryMock,
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
	markTelegramDigestDeliveryFailedMock: vi.fn(),
	markTelegramDigestDeliverySentMock: vi.fn(),
	resolveRecipientDisplayContextMock: vi.fn(),
	sendMessageMock: vi.fn(),
	shouldSkipDigestForManagerMock: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: vi.fn() },
			employeeManagers: { findFirst: vi.fn() },
		},
	},
}));
vi.mock("@/db/schema", () => ({ employee: {}, employeeManagers: {} }));
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
		const { db } = await import("@/db");
		vi.mocked(db.query.employee.findFirst).mockResolvedValue({ id: "employee-berlin" });
		vi.mocked(db.query.employeeManagers.findFirst).mockResolvedValue({ id: "managed-employee" });
		getOrganizationPrivateConversationsMock.mockResolvedValue([
			{ chatId: "chat-berlin", userId: "manager-berlin" },
		]);
		resolveRecipientDisplayContextMock.mockResolvedValue({
			locale: "de",
			timeFormat: "24h",
			timezone: "Europe/Berlin",
		});
		claimTelegramDigestDeliveryMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
		const { processTelegramBotDigest } = await import("./daily-digest");
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
		const { db } = await import("@/db");
		vi.mocked(db.query.employee.findFirst).mockResolvedValue({ id: "employee-berlin" });
		vi.mocked(db.query.employeeManagers.findFirst).mockResolvedValue({ id: "managed-employee" });
		getOrganizationPrivateConversationsMock.mockResolvedValue([
			{ chatId: "chat-berlin", userId: "manager-berlin" },
		]);
		resolveRecipientDisplayContextMock.mockResolvedValue({
			locale: "de",
			timeFormat: "24h",
			timezone: "Europe/Berlin",
		});
		const { processTelegramBotDigest } = await import("./daily-digest");
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
		const { db } = await import("@/db");
		vi.mocked(db.query.employee.findFirst)
			.mockResolvedValueOnce({ id: "employee-utc" })
			.mockResolvedValueOnce({ id: "employee-honolulu" });
		vi.mocked(db.query.employeeManagers.findFirst).mockResolvedValue({ id: "managed-employee" });
		getOrganizationPrivateConversationsMock.mockResolvedValue([
			{ chatId: "chat-utc", userId: "manager-utc" },
			{ chatId: "chat-honolulu", userId: "manager-honolulu" },
		]);
		resolveRecipientDisplayContextMock
			.mockResolvedValueOnce({ locale: "en", timeFormat: "24h", timezone: "UTC" })
			.mockResolvedValueOnce({ locale: "en", timeFormat: "24h", timezone: "Pacific/Honolulu" });
		const { processTelegramBotDigest } = await import("./daily-digest");

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
		const { db } = await import("@/db");
		vi.mocked(db.query.employee.findFirst).mockResolvedValue({ id: "employee-manager" });
		vi.mocked(db.query.employeeManagers.findFirst).mockResolvedValue({ id: "managed-employee" });
		getOrganizationPrivateConversationsMock.mockResolvedValue([
			{ chatId: "chat-manager", userId: "manager-user" },
		]);
		resolveRecipientDisplayContextMock.mockResolvedValue({
			locale: "en",
			timeFormat: "24h",
			timezone: "UTC",
		});
		const { processTelegramBotDigest } = await import("./daily-digest");

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

	it("uses one schedule occurrence while building recipient-specific content", async () => {
		const { db } = await import("@/db");
		vi.mocked(db.query.employee.findFirst)
			.mockResolvedValueOnce({ id: "employee-berlin" })
			.mockResolvedValueOnce({ id: "employee-new-york" });
		vi.mocked(db.query.employeeManagers.findFirst).mockResolvedValue({ id: "managed-employee" });
		const { processTelegramBotDigest } = await import("./daily-digest");

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
		expect(buildDigestDataForManagerMock).toHaveBeenCalledWith({
			display: { locale: "de", timeFormat: "24h", timezone: "Europe/Berlin" },
			logicalDate: "2026-07-10",
			managerId: "employee-berlin",
			now: "2026-07-10T00:05:00.000Z",
			organizationId: "org-a",
		});
		expect(buildDigestDataForManagerMock).toHaveBeenCalledWith({
			display: { locale: "en-US", timeFormat: "12h", timezone: "America/New_York" },
			logicalDate: "2026-07-09",
			managerId: "employee-new-york",
			now: "2026-07-10T00:05:00.000Z",
			organizationId: "org-a",
		});
	});
});
