import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	approvalFindFirst: vi.fn(),
	employeeFindFirst: vi.fn(),
	teamsCardFindFirst: vi.fn(),
	decide: vi.fn(),
	loadTarget: vi.fn(),
	sendActivity: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: { findFirst: mocks.approvalFindFirst },
			employee: { findFirst: mocks.employeeFindFirst },
			teamsApprovalCard: { findFirst: mocks.teamsCardFindFirst },
		},
		update: vi.fn(),
	},
}));

vi.mock("@/db/schema", () => ({
	absenceEntry: {},
	approvalRequest: {
		id: "approval.id",
		organizationId: "approval.organizationId",
	},
	employee: { id: "employee.id", organizationId: "employee.organizationId" },
	teamsApprovalCard: { approvalRequestId: "teams.approvalRequestId" },
	timeEntry: {},
}));

vi.mock("@/lib/bot-platform/approval-decision", () => ({
	canAttemptBotApprovalDecision: ({
		status,
		workflowKind,
	}: Record<string, string>) =>
		status === "pending" ||
		workflowKind === "manual_time_submission" ||
		workflowKind === "policy_clock_out",
	decideBotApproval: mocks.decide,
	loadBotApprovalDecisionTarget: mocks.loadTarget,
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: vi.fn(),
	getUserLocale: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	}),
}));
vi.mock("@/lib/teams/bot-adapter", () => ({ updateMessage: vi.fn() }));
vi.mock("@/lib/teams/cards/approval-card", () => ({
	buildResolvedApprovalCard: vi.fn(),
}));
vi.mock("@/lib/teams/conversation-manager", () => ({
	getStoredConversation: vi.fn(),
}));

const terminalApproval = {
	id: "approval-1",
	organizationId: "org-1",
	entityType: "time_entry",
	entityId: "period-1",
	requestedBy: "employee-1",
	approverId: "manager-1",
	status: "approved",
	createdAt: new Date("2026-07-20T10:00:00Z"),
};

describe("bot terminal ordinary replay", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.approvalFindFirst.mockResolvedValue(terminalApproval);
		mocks.employeeFindFirst.mockResolvedValue(undefined);
		mocks.teamsCardFindFirst.mockResolvedValue(undefined);
		mocks.decide.mockResolvedValue({
			id: "approval-1",
			type: "time_entry",
			status: "approved",
		});
		mocks.loadTarget.mockResolvedValue({
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

	it("keeps Teams terminal time corrections already processed", async () => {
		mocks.loadTarget.mockResolvedValue({
			status: "approved",
			workflowKind: "time_correction",
		});
		const { handleApprovalAction } = await import(
			"@/lib/teams/approval-handler"
		);

		await expect(
			handleApprovalAction(
				{ sendActivity: mocks.sendActivity } as never,
				"approval-1",
				"approve",
				{ employeeId: "manager-1", userId: "user-1" } as never,
				{ organizationId: "org-1" } as never,
			),
		).rejects.toMatchObject({
			code: "APPROVAL_ALREADY_RESOLVED",
			message: "Approval already resolved",
		});
		expect(mocks.decide).not.toHaveBeenCalled();
	});

	it("delegates Teams terminal time-entry targets to the stable owner", async () => {
		const { handleApprovalAction } = await import(
			"@/lib/teams/approval-handler"
		);

		await handleApprovalAction(
			{ sendActivity: mocks.sendActivity } as never,
			"approval-1",
			"approve",
			{ employeeId: "manager-1", userId: "user-1" } as never,
			{ organizationId: "org-1" } as never,
		);

		expect(mocks.decide).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
			action: "approve",
			platform: "teams",
		});
	});
});
