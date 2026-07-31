import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	approvalFindFirst: vi.fn(),
	employeeFindFirst: vi.fn(),
	slackMessageFindFirst: vi.fn(),
	discordMessageFindFirst: vi.fn(),
	teamsCardFindFirst: vi.fn(),
	decide: vi.fn(),
	loadTarget: vi.fn(),
	resolveSlackUser: vi.fn(),
	resolveDiscordUser: vi.fn(),
	sendActivity: vi.fn(),
	interactionResponse: vi.fn(),
	slackUpdateMessage: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: { findFirst: mocks.approvalFindFirst },
			employee: { findFirst: mocks.employeeFindFirst },
			slackApprovalMessage: { findFirst: mocks.slackMessageFindFirst },
			discordApprovalMessage: { findFirst: mocks.discordMessageFindFirst },
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
	discordApprovalMessage: { approvalRequestId: "discord.approvalRequestId" },
	employee: { id: "employee.id", organizationId: "employee.organizationId" },
	slackApprovalMessage: { approvalRequestId: "slack.approvalRequestId" },
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
vi.mock("@/lib/slack/api", () => ({
	openConversation: vi.fn(),
	postMessage: vi.fn(),
	updateMessage: mocks.slackUpdateMessage,
}));
vi.mock("@/lib/slack/conversation-manager", () => ({
	getChannelIdForUser: vi.fn(),
}));
vi.mock("@/lib/slack/formatters", () => ({
	buildApprovalBlocks: vi.fn(),
	buildResolvedApprovalBlocks: vi.fn(),
}));
vi.mock("@/lib/slack/user-resolver", () => ({
	resolveSlackUser: mocks.resolveSlackUser,
}));
vi.mock("@/lib/discord/api", () => ({
	createInteractionResponse: mocks.interactionResponse,
	sendMessage: vi.fn(),
}));
vi.mock("@/lib/discord/conversation-manager", () => ({
	getChannelIdForUser: vi.fn(),
}));
vi.mock("@/lib/discord/formatters", () => ({
	buildApprovalEmbed: vi.fn(),
	buildResolvedApprovalEmbed: vi.fn(),
}));
vi.mock("@/lib/discord/user-resolver", () => ({
	resolveDiscordUser: mocks.resolveDiscordUser,
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
		mocks.slackMessageFindFirst.mockResolvedValue(undefined);
		mocks.discordMessageFindFirst.mockResolvedValue(undefined);
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

	it("keeps Slack terminal time corrections already processed", async () => {
		mocks.resolveSlackUser.mockResolvedValue({
			status: "found",
			user: { employeeId: "manager-1", userId: "user-1" },
		});
		mocks.loadTarget.mockResolvedValue({
			status: "approved",
			workflowKind: "time_correction",
		});
		const { handleApprovalAction } = await import(
			"@/lib/slack/approval-handler"
		);

		await handleApprovalAction(
			{ channel: { id: "channel-1" }, message: { ts: "message-1" } } as never,
			{ action_id: "approval_approve", value: "approval-1" },
			"slack-user-1",
			{
				organizationId: "org-1",
				slackTeamId: "team-1",
				botAccessToken: "token",
			} as never,
		);

		expect(mocks.slackUpdateMessage).toHaveBeenCalledWith(
			"token",
			expect.objectContaining({
				text: "This approval has already been processed.",
			}),
		);
		expect(mocks.decide).not.toHaveBeenCalled();
	});

	it("delegates Slack terminal time-entry targets to the stable owner", async () => {
		mocks.resolveSlackUser.mockResolvedValue({
			status: "found",
			user: { employeeId: "manager-1", userId: "user-1" },
		});
		const { handleApprovalAction } = await import(
			"@/lib/slack/approval-handler"
		);

		await handleApprovalAction(
			{} as never,
			{ action_id: "approval_approve", value: "approval-1" },
			"slack-user-1",
			{
				organizationId: "org-1",
				slackTeamId: "team-1",
				botAccessToken: "token",
			} as never,
		);

		expect(mocks.decide).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
			action: "approve",
			platform: "slack",
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

	it("delegates Discord terminal time-entry targets to the stable owner", async () => {
		mocks.resolveDiscordUser.mockResolvedValue({
			status: "found",
			user: { employeeId: "manager-1", userId: "user-1" },
		});
		const { handleApprovalButtonClick } = await import(
			"@/lib/discord/approval-handler"
		);

		await handleApprovalButtonClick(
			{ id: "interaction-1", token: "token" } as never,
			{ a: "ap", id: "approval-1" },
			"discord-user-1",
			{ organizationId: "org-1" } as never,
		);

		expect(mocks.decide).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
			action: "approve",
			platform: "discord",
		});
	});

	it("keeps Discord terminal time corrections already processed", async () => {
		mocks.resolveDiscordUser.mockResolvedValue({
			status: "found",
			user: { employeeId: "manager-1", userId: "user-1" },
		});
		mocks.loadTarget.mockResolvedValue({
			status: "approved",
			workflowKind: "time_correction",
		});
		const { handleApprovalButtonClick } = await import(
			"@/lib/discord/approval-handler"
		);

		await handleApprovalButtonClick(
			{ id: "interaction-1", token: "token" } as never,
			{ a: "ap", id: "approval-1" },
			"discord-user-1",
			{ organizationId: "org-1" } as never,
		);

		expect(mocks.interactionResponse).toHaveBeenCalledWith(
			"interaction-1",
			"token",
			expect.anything(),
			{ content: "This approval has already been processed.", flags: 64 },
		);
		expect(mocks.decide).not.toHaveBeenCalled();
	});
});
