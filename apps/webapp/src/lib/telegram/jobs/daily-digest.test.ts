import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	buildDigestDataMock,
	claimDailyDigestDeliveryMock,
	findEmployeeManagersMock,
	findEmployeeMock,
	getAllActiveBotConfigsMock,
	getBotTranslateMock,
	getOrganizationPrivateConversationsMock,
	markDailyDigestDeliveryFailedMock,
	markDailyDigestDeliverySentMock,
	resolveBotTemporalContextMock,
	sendMessageMock,
} = vi.hoisted(() => ({
	buildDigestDataMock: vi.fn(),
	claimDailyDigestDeliveryMock: vi.fn(),
	findEmployeeManagersMock: vi.fn(),
	findEmployeeMock: vi.fn(),
	getAllActiveBotConfigsMock: vi.fn(),
	getBotTranslateMock: vi.fn(),
	getOrganizationPrivateConversationsMock: vi.fn(),
	markDailyDigestDeliveryFailedMock: vi.fn(),
	markDailyDigestDeliverySentMock: vi.fn(),
	resolveBotTemporalContextMock: vi.fn(),
	sendMessageMock: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: findEmployeeMock },
			employeeManagers: { findFirst: findEmployeeManagersMock },
		},
	},
}));
vi.mock("@/db/schema", () => ({
	employee: { organizationId: "employee.organizationId", userId: "employee.userId" },
	employeeManagers: { managerId: "employeeManagers.managerId" },
}));
vi.mock("@/env", () => ({ env: { APP_URL: "https://z8.test" } }));
vi.mock("@/lib/bot-platform/i18n", () => ({ getBotTranslate: getBotTranslateMock }));
vi.mock("@/lib/bot-platform/temporal-context", () => ({
	resolveBotTemporalContext: resolveBotTemporalContextMock,
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/notifications/daily-digest-delivery", () => ({
	claimDailyDigestDelivery: claimDailyDigestDeliveryMock,
	markDailyDigestDeliveryFailed: markDailyDigestDeliveryFailedMock,
	markDailyDigestDeliverySent: markDailyDigestDeliverySentMock,
}));
vi.mock("@/lib/teams/jobs/daily-digest", () => ({ buildDigestDataForManager: buildDigestDataMock }));
vi.mock("../api", () => ({ sendMessage: sendMessageMock }));
vi.mock("../bot-config", () => ({ getAllActiveBotConfigs: getAllActiveBotConfigsMock }));
vi.mock("../conversation-manager", () => ({
	getOrganizationPrivateConversations: getOrganizationPrivateConversationsMock,
}));
vi.mock("../formatters", () => ({ buildDailyDigestMessage: vi.fn(() => "digest") }));

describe("runTelegramDailyDigestJob", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-10T09:05:00Z"));
		vi.clearAllMocks();
		getAllActiveBotConfigsMock.mockResolvedValue([
			{ organizationId: "org-1", botToken: "token", enableDailyDigest: true, digestTime: "09:00", digestTimezone: "UTC" },
		]);
		getOrganizationPrivateConversationsMock.mockResolvedValue([{ userId: "user-1", chatId: "chat-1" }]);
		findEmployeeMock.mockResolvedValue({ id: "employee-1" });
		findEmployeeManagersMock.mockResolvedValue({ id: "manager-link-1" });
		resolveBotTemporalContextMock.mockResolvedValue({ effectiveTimezone: "America/New_York", locale: "en" });
		claimDailyDigestDeliveryMock.mockResolvedValue("delivery-1");
		buildDigestDataMock.mockResolvedValue({});
		getBotTranslateMock.mockResolvedValue(vi.fn());
		sendMessageMock.mockResolvedValue({ ok: true });
		markDailyDigestDeliverySentMock.mockResolvedValue(undefined);
	});

	afterEach(() => vi.useRealTimers());

	it("claims, sends, and records a digest using the recipient local date", async () => {
		const { runTelegramDailyDigestJob } = await import("./daily-digest");

		await expect(runTelegramDailyDigestJob()).resolves.toMatchObject({ digestsSent: 1 });

		expect(claimDailyDigestDeliveryMock).toHaveBeenCalledWith({
			organizationId: "org-1",
			recipientUserId: "user-1",
			platform: "telegram",
			type: "daily_digest",
			recipientLocalDate: "2026-07-10",
		});
		expect(markDailyDigestDeliverySentMock).toHaveBeenCalledWith({
			id: "delivery-1",
			organizationId: "org-1",
		});
	});

	it("does not send when the recipient's daily delivery was already claimed", async () => {
		claimDailyDigestDeliveryMock.mockResolvedValue(null);
		const { runTelegramDailyDigestJob } = await import("./daily-digest");

		await expect(runTelegramDailyDigestJob()).resolves.toMatchObject({ digestsSent: 0 });

		expect(sendMessageMock).not.toHaveBeenCalled();
	});

	it("marks a claimed delivery failed when Telegram rejects it", async () => {
		const failure = new Error("Telegram unavailable");
		sendMessageMock.mockRejectedValue(failure);
		const { runTelegramDailyDigestJob } = await import("./daily-digest");

		await expect(runTelegramDailyDigestJob()).resolves.toMatchObject({ digestsSent: 0 });

		expect(markDailyDigestDeliveryFailedMock).toHaveBeenCalledWith(
			{ id: "delivery-1", organizationId: "org-1" },
			failure,
		);
	});
});
