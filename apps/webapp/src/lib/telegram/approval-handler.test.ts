import { beforeEach, describe, expect, it, vi } from "vitest";

const { approvalFindFirstMock, employeeFindFirstMock, getChatIdForUserMock, sendMessageMock } =
	vi.hoisted(() => ({
		approvalFindFirstMock: vi.fn(),
		employeeFindFirstMock: vi.fn(),
		getChatIdForUserMock: vi.fn(),
		sendMessageMock: vi.fn(),
	}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: { findFirst: approvalFindFirstMock },
			employee: { findFirst: employeeFindFirstMock },
		},
		insert: vi.fn(),
	},
}));

vi.mock("@/db/schema", () => ({
	approvalRequest: { id: "approvalRequest.id", organizationId: "approvalRequest.organizationId" },
	employee: {
		id: "employee.id",
		organizationId: "employee.organizationId",
		userId: "employee.userId",
	},
	telegramApprovalMessage: {},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: vi.fn(),
	getUserLocale: vi.fn(),
}));
vi.mock("@/lib/bot-platform/approval-decision", () => ({ decideBotApproval: vi.fn() }));
vi.mock("@/lib/notifications/recipient-display-context", () => ({
	resolveRecipientDisplayContext: vi.fn(),
}));
vi.mock("./api", () => ({ editMessageText: vi.fn(), sendMessage: sendMessageMock }));
vi.mock("./conversation-manager", () => ({ getChatIdForUser: getChatIdForUserMock }));
vi.mock("./formatters", () => ({
	buildApprovalMessage: vi.fn(),
	buildResolvedApprovalMessage: vi.fn(),
	escapeMarkdownV2: vi.fn(),
}));
vi.mock("./user-resolver", () => ({ resolveTelegramUser: vi.fn() }));

describe("sendApprovalMessageToManager", () => {
	beforeEach(() => vi.clearAllMocks());

	it("does not send when the approver is outside the approval organization", async () => {
		employeeFindFirstMock.mockResolvedValue(undefined);
		const { sendApprovalMessageToManager } = await import("./approval-handler");

		await sendApprovalMessageToManager("approval-in-org-b", "approver-in-org-b", "org-a", "token");

		expect(approvalFindFirstMock).not.toHaveBeenCalled();
		expect(getChatIdForUserMock).not.toHaveBeenCalled();
		expect(sendMessageMock).not.toHaveBeenCalled();
	});

	it("does not send an approval from another organization", async () => {
		employeeFindFirstMock.mockResolvedValue({ userId: "manager-in-org-a" });
		approvalFindFirstMock.mockResolvedValue(undefined);
		const { sendApprovalMessageToManager } = await import("./approval-handler");

		await sendApprovalMessageToManager("approval-in-org-b", "approver-in-org-a", "org-a", "token");

		expect(approvalFindFirstMock).toHaveBeenCalledOnce();
		expect(getChatIdForUserMock).not.toHaveBeenCalled();
		expect(sendMessageMock).not.toHaveBeenCalled();
	});
});
