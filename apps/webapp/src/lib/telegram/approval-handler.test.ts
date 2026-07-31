import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	approvalFindFirstMock,
	employeeFindFirstMock,
	getChatIdForUserMock,
	sendMessageMock,
	decideBotApprovalMock,
	loadBotApprovalDecisionTargetMock,
	resolveTelegramUserMock,
	getBotTranslateMock,
	getUserLocaleMock,
} = vi.hoisted(() => ({
	approvalFindFirstMock: vi.fn(),
	employeeFindFirstMock: vi.fn(),
	getChatIdForUserMock: vi.fn(),
	sendMessageMock: vi.fn(),
	decideBotApprovalMock: vi.fn(),
	loadBotApprovalDecisionTargetMock: vi.fn(),
	resolveTelegramUserMock: vi.fn(),
	getBotTranslateMock: vi.fn(),
	getUserLocaleMock: vi.fn(),
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
	approvalRequest: {
		id: "approvalRequest.id",
		organizationId: "approvalRequest.organizationId",
	},
	employee: {
		id: "employee.id",
		organizationId: "employee.organizationId",
		userId: "employee.userId",
	},
	telegramApprovalMessage: {},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	}),
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: getBotTranslateMock,
	getUserLocale: getUserLocaleMock,
}));
vi.mock("@/lib/bot-platform/approval-decision", () => ({
	decideBotApproval: decideBotApprovalMock,
	canAttemptBotApprovalDecision: ({
		status,
		workflowKind,
	}: {
		status: string;
		workflowKind: string;
	}) =>
		status === "pending" ||
		workflowKind === "manual_time_submission" ||
		workflowKind === "policy_clock_out",
	loadBotApprovalDecisionTarget: loadBotApprovalDecisionTargetMock,
}));
vi.mock("@/lib/notifications/recipient-display-context", () => ({
	resolveRecipientDisplayContext: vi.fn(),
}));
vi.mock("./api", () => ({
	editMessageText: vi.fn(),
	sendMessage: sendMessageMock,
}));
vi.mock("./conversation-manager", () => ({
	getChatIdForUser: getChatIdForUserMock,
}));
vi.mock("./formatters", () => ({
	buildApprovalMessage: vi.fn(),
	buildResolvedApprovalMessage: vi.fn(),
	escapeMarkdownV2: vi.fn(),
}));
vi.mock("./user-resolver", () => ({
	resolveTelegramUser: resolveTelegramUserMock,
}));

describe("sendApprovalMessageToManager", () => {
	beforeEach(() => vi.clearAllMocks());

	it("does not send when the approver is outside the approval organization", async () => {
		employeeFindFirstMock.mockResolvedValue(undefined);
		const { sendApprovalMessageToManager } = await import("./approval-handler");

		await sendApprovalMessageToManager(
			"approval-in-org-b",
			"approver-in-org-b",
			"org-a",
			"token",
		);

		expect(approvalFindFirstMock).not.toHaveBeenCalled();
		expect(getChatIdForUserMock).not.toHaveBeenCalled();
		expect(sendMessageMock).not.toHaveBeenCalled();
	});

	it("does not send an approval from another organization", async () => {
		employeeFindFirstMock.mockResolvedValue({ userId: "manager-in-org-a" });
		approvalFindFirstMock.mockResolvedValue(undefined);
		const { sendApprovalMessageToManager } = await import("./approval-handler");

		await sendApprovalMessageToManager(
			"approval-in-org-b",
			"approver-in-org-a",
			"org-a",
			"token",
		);

		expect(approvalFindFirstMock).toHaveBeenCalledOnce();
		expect(getChatIdForUserMock).not.toHaveBeenCalled();
		expect(sendMessageMock).not.toHaveBeenCalled();
	});
});

describe("handleApprovalCallback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getUserLocaleMock.mockResolvedValue("en");
		getBotTranslateMock.mockResolvedValue(
			(_key: string, fallback: string) => fallback,
		);
		loadBotApprovalDecisionTargetMock.mockResolvedValue({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			approverId: "manager-1",
			requesterEmployeeId: "employee-1",
			status: "approved",
			workflowKind: "manual_time_submission",
		});
	});

	it("delegates an exact terminal time-entry target so the owner can replay", async () => {
		resolveTelegramUserMock.mockResolvedValue({
			status: "found",
			user: { employeeId: "manager-1", userId: "user-1" },
		});
		approvalFindFirstMock.mockResolvedValue({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "employee-1",
			approverId: "manager-1",
			status: "approved",
			createdAt: new Date("2026-07-20T10:00:00Z"),
		});
		decideBotApprovalMock.mockResolvedValue({
			id: "approval-1",
			type: "time_entry",
			status: "approved",
		});
		employeeFindFirstMock
			.mockResolvedValueOnce({ user: { name: "Manager" } })
			.mockResolvedValueOnce({
				user: { name: "Employee", email: "employee@example.com" },
			});

		const { handleApprovalCallback } = await import("./approval-handler");
		await handleApprovalCallback(
			{ id: "query-1", from: { id: 1 }, message: undefined },
			{ a: "ap", id: "approval-1" },
			"telegram-1",
			{ organizationId: "org-1", botToken: "token" } as never,
		);

		expect(decideBotApprovalMock).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
			action: "approve",
			platform: "telegram",
		});
	});

	it("keeps terminal time corrections already processed", async () => {
		resolveTelegramUserMock.mockResolvedValue({
			status: "found",
			user: { employeeId: "manager-1", userId: "user-1" },
		});
		approvalFindFirstMock.mockResolvedValue({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "employee-1",
			approverId: "manager-1",
			status: "approved",
		});
		loadBotApprovalDecisionTargetMock.mockResolvedValue({
			status: "approved",
			workflowKind: "time_correction",
		});
		const editMessageText = vi.mocked((await import("./api")).editMessageText);

		const { handleApprovalCallback } = await import("./approval-handler");
		await handleApprovalCallback(
			{
				id: "query-1",
				from: { id: 1 },
				message: { chat: { id: 1 }, message_id: 2 },
			},
			{ a: "ap", id: "approval-1" },
			"telegram-1",
			{ organizationId: "org-1", botToken: "token" } as never,
		);

		expect(editMessageText).toHaveBeenCalled();
		expect(decideBotApprovalMock).not.toHaveBeenCalled();
	});
});
