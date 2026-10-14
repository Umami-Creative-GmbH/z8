import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	attemptBotApproval: vi.fn(),
	resolveRecipientDisplayContext: vi.fn(),
	resolveRecipientNotificationLocale: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { query: { teamsApprovalCard: { findFirst: vi.fn() } } } }));
vi.mock("@/env", () => ({ env: { MICROSOFT_APP_ID: "app-id" } }));
vi.mock("@/lib/approvals/delivery/kick", () => ({ kickApprovalDelivery: vi.fn() }));
vi.mock("@/lib/approvals/delivery/store", () => ({
	approvalDeliveryMessageReviewReference: vi.fn(),
	findApprovalDeliveryMessageByRemoteIdentity: vi.fn(async () => null),
	isApprovalNotificationDeliveredByOwner: vi.fn(),
	isApprovalDeliveryMessagePending: vi.fn(),
	markApprovalDeliveryMessageWithoutControls: vi.fn(),
}));
vi.mock("@/lib/approvals/presentation", () => ({ prepareApprovalPresentation: vi.fn() }));
vi.mock("@/lib/bot-platform/approval-decision", () => ({
	attemptBotApproval: mocks.attemptBotApproval,
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: async (locale: string) => (key: string, fallback: string) =>
		locale === "en" ? fallback : `${locale}:${key}`,
}));
vi.mock("@/lib/notifications/recipient-display-context", () => ({
	resolveRecipientDisplayContext: mocks.resolveRecipientDisplayContext,
}));
vi.mock("@/lib/notifications/recipient-locale", () => ({
	resolveRecipientNotificationLocale: mocks.resolveRecipientNotificationLocale,
}));

const { handleApprovalAction } = await import("./approval-handler");

type Context = Parameters<typeof handleApprovalAction>[0];
type User = Parameters<typeof handleApprovalAction>[3];
type Tenant = Parameters<typeof handleApprovalAction>[4];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolveRecipientDisplayContext.mockResolvedValue({
		locale: "de",
		timezone: "Europe/Berlin",
		timeFormat: "24h",
	});
	mocks.resolveRecipientNotificationLocale.mockResolvedValue("fr");
});

describe("Teams approval replies", () => {
	it("reports an unavailable approval in the presser's language", async () => {
		mocks.attemptBotApproval.mockResolvedValue({ status: "unavailable" });
		const sendActivity = vi.fn(async () => undefined);

		await handleApprovalAction(
			{ sendActivity } as unknown as Context,
			"r-1",
			"approve",
			{ userId: "u-1", employeeId: "e-1", organizationId: "org-1" } as User,
			{ organizationId: "org-1", tenantId: "t-1" } as Tenant,
		);

		expect(sendActivity).toHaveBeenCalledWith("de:bot.approval.unavailable");
	});
});
