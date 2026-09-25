import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// These tests exercise actual preparation, inbox discovery and provider rendering.
// Storage/transport are controlled; real PostgreSQL receipt/race evidence remains
// an activation obligation. The ordinary owner/transition suites test its guard.
const state = vi.hoisted(() => ({
	rows: {} as Record<string, Record<string, unknown>[]>,
	sends: {
		slack: vi.fn(),
		telegram: vi.fn(),
		discord: vi.fn(),
		teams: vi.fn(),
	},
	replies: {
		slack: vi.fn(),
		telegram: vi.fn(),
		discord: vi.fn(),
		teams: vi.fn(),
	},
	resolve: vi.fn(),
	track: vi.fn(),
	history: vi.fn(),
	workflowRuntime: vi.fn(),
	legacyEvidence: vi.fn(),
	freshDecision: vi.fn(),
	mutation: vi.fn(),
	acknowledge: vi.fn(),
	read: vi.fn(),
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/db", () => {
	const findRows =
		(table: string) =>
		async ({ where }: { where: SQL }) => {
			state.read(table);
			const query = new PgDialect().sqlToQuery(where);
			return (state.rows[table] ?? []).filter((row) =>
				[...query.sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g)].every(
					(match) =>
						row[
							match[1].replace(/_([a-z])/g, (_match, letter: string) =>
								letter.toUpperCase(),
							)
						] === query.params[Number(match[2]) - 1],
				),
			);
		};
	return {
		db: {
			query: Object.fromEntries(
				[
					"approvalRequest",
					"employee",
					"member",
					"workPeriod",
					"timeEntry",
					"approvalWorkflowStage",
					"approvalWorkflow",
					"approvalStageAssignment",
					"slackApprovalMessage",
					"telegramApprovalMessage",
				].map((table) => [
					table,
					{
						findFirst: async (input: { where: SQL }) =>
							(await findRows(table)(input))[0],
						findMany: findRows(table),
					},
				]),
			),
			insert: () => ({ values: state.track }),
			update: () => ({
				set: (values: unknown) => ({
					where: (where: SQL) => state.mutation(values, where),
				}),
			}),
		},
	};
});
vi.mock("@/lib/approvals/server/work-period-approvals", () => ({
	decideOrdinaryWorkPeriodWithStableTargetEffect: state.history,
}));
vi.mock("@/lib/approvals/workflow/runtime", () => ({
	createProductionApprovalWorkflowRuntime: state.workflowRuntime,
}));
vi.mock("@/lib/approvals/domain-adapters/work-period-legacy-state", () => ({
	loadOrdinaryWorkPeriodLegacyDecisionEvidence: state.legacyEvidence,
}));
vi.mock(
	"@/lib/approvals/domain-adapters/legacy-write-coordinator",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("@/lib/approvals/domain-adapters/legacy-write-coordinator")
			>();
		return {
			...actual,
			createLegacyApprovalWriteCoordinator: (
				...args: Parameters<typeof actual.createLegacyApprovalWriteCoordinator>
			) => {
				const coordinator = actual.createLegacyApprovalWriteCoordinator(
					...args,
				);
				return {
					...coordinator,
					execute: (...inputs: Parameters<typeof coordinator.execute>) => {
						state.freshDecision();
						return coordinator.execute(...inputs);
					},
				};
			},
		};
	},
);
vi.mock("@/lib/bot-platform/command-registry", () => ({
	executeCommand: vi.fn(),
	getAllCommands: vi.fn(),
	parseCommand: vi.fn(),
}));
vi.mock("@/lib/bot-platform/temporal-context", () => ({
	resolveBotTemporalContext: vi.fn(),
}));
vi.mock("@/lib/notifications/recipient-display-context", () => ({
	resolveRecipientDisplayContext: async () => ({
		locale: "en",
		timezone: "UTC",
		timeFormat: "24h",
	}),
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => state.logger }));
// Bound-card admission (#290) reads evidence and controls; it is exercised
// against PostgreSQL in telegram/bound-approval.integration.test.ts. Here no
// card is admitted, so every adapter must behave review-only.
vi.mock("@/lib/approvals/presentation/bound-card", () => ({
	prepareBoundAbsenceCard: async () => null,
}));
// Expense card admission (#296) likewise: expense-review-decision.integration.test.ts.
vi.mock("@/lib/approvals/presentation/travel-expense-card", () => ({
	prepareBoundTravelExpenseCard: async () => null,
}));
vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: async (organizationId: string) =>
		`https://${organizationId}.z8.test`,
}));
vi.mock("@/lib/slack/user-resolver", () => ({
	resolveSlackUser: state.resolve,
}));
vi.mock("@/lib/telegram/user-resolver", () => ({
	resolveTelegramUser: state.resolve,
}));
vi.mock("@/lib/discord/user-resolver", () => ({
	resolveDiscordUser: state.resolve,
}));
vi.mock("@/lib/slack/api", () => ({
	postMessage: state.sends.slack,
	updateMessage: state.replies.slack,
	openConversation: vi.fn(),
}));
vi.mock("@/lib/telegram/api", () => ({
	sendMessage: state.sends.telegram,
	editMessageText: state.replies.telegram,
	answerCallbackQuery: state.acknowledge,
}));
vi.mock("@/lib/discord/api", () => ({
	sendMessage: state.sends.discord,
	createInteractionResponse: state.replies.discord,
}));
// No approval delivery owner is active in these adapter tests.
vi.mock("@/lib/approvals/delivery/store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/approvals/delivery/store")>()),
	isApprovalNotificationDeliveredByOwner: async () => false,
}));
vi.mock("@/lib/teams/bot-adapter", () => ({
	sendAdaptiveCard: state.sends.teams,
	sendProactiveMessage: state.sends.teams,
}));
vi.mock("@/lib/slack/conversation-manager", () => ({
	getChannelIdForUser: async () => "channel",
}));
vi.mock("@/lib/telegram/conversation-manager", () => ({
	getChatIdForUser: async () => "10",
}));
vi.mock("@/lib/discord/conversation-manager", () => ({
	getChannelIdForUser: async () => "channel",
}));
vi.mock("@/lib/teams/conversation-manager", () => ({
	getConversationReferenceForUser: async () => ({
		conversation: { id: "conversation" },
	}),
}));

import { Effect } from "effect";
import { db } from "@/db";
import { handleTelegramUpdate } from "@/lib/telegram/bot-handler";
import { sendSlackNotification } from "@/lib/notifications/slack-channel";
import { sendTelegramNotification } from "@/lib/notifications/telegram-channel";
import { sendDiscordNotification } from "@/lib/notifications/discord-channel";
import { sendTeamsNotification } from "@/lib/notifications/teams-channel";
import {
	handleApprovalAction as slackAction,
	sendApprovalMessageToManager as sendSlack,
} from "@/lib/slack/approval-handler";
import {
	handleApprovalCallback as telegramAction,
	sendApprovalMessageToManager as sendTelegram,
} from "@/lib/telegram/approval-handler";
import {
	handleApprovalButtonClick as discordAction,
	sendApprovalMessageToManager as sendDiscord,
} from "@/lib/discord/approval-handler";
import {
	handleApprovalAction as teamsAction,
	sendApprovalCardToManager as sendTeams,
} from "@/lib/teams/approval-handler";

vi.mock("@/lib/slack", async () => ({
	...(await import("@/lib/slack/approval-handler")),
	getBotConfigByOrganization: async () => ({ botAccessToken: "token" }),
	getChannelIdForUser: async () => "channel",
	postMessage: state.sends.slack,
}));
vi.mock("@/lib/telegram", async () => ({
	...(await import("@/lib/telegram/approval-handler")),
	getBotConfigByOrganization: async () => ({ botToken: "token" }),
	getChatIdForUser: async () => "10",
	sendMessage: state.sends.telegram,
}));
vi.mock("@/lib/discord", async () => ({
	...(await import("@/lib/discord/approval-handler")),
	getBotConfigByOrganization: async () => ({ botToken: "token" }),
	getChannelIdForUser: async () => "channel",
	sendMessage: state.sends.discord,
}));
vi.mock("@/lib/teams", async () => ({
	...(await import("@/lib/teams/approval-handler")),
	getConversationReferenceForUser: async () => ({
		conversation: { id: "conversation" },
	}),
	sendProactiveMessage: state.sends.teams,
}));

describe.each([
	{ platform: "slack", send: sendSlackNotification },
	{ platform: "telegram", send: sendTelegramNotification },
	{ platform: "discord", send: sendDiscordNotification },
	{ platform: "teams", send: sendTeamsNotification },
] as const)(
	"$platform existing approval-reference notification route",
	({ platform, send }) => {
		it.each([true, false])(
			"keeps foreign=%s approval details out of fallback output",
			async (foreign) => {
				if (foreign) state.rows.approvalRequest[0].organizationId = "foreign";
				await send({
					userId: "user",
					organizationId: "org",
					type: "approval_request_submitted",
					entityType: "approval_request",
					entityId: "approval",
					title: "SECRET TITLE",
					message: "SECRET MESSAGE",
				});
				expect(state.sends[platform]).toHaveBeenCalledTimes(foreign ? 0 : 1);
				expect(JSON.stringify(state.sends[platform].mock.calls)).not.toContain(
					"SECRET",
				);
			},
		);
	},
);

const managerId = "10000000-0000-4000-8000-000000000001";
// Production defers Next.js-only decision imports so escalation workers can
// import senders. Warm those imports outside individual callback test deadlines;
// transformation competes with the full repository suite on cold runs.
beforeAll(async () => {
	await import("@/lib/bot-platform/approval-decision");
	await vi.importActual("@/lib/approvals/server/work-period-approvals");
}, 60_000);
const platformCases = [
	{
		platform: "slack",
		send: () => sendSlack("approval", managerId, "org", "token"),
		act: (action: "approve" | "reject" = "approve") =>
			slackAction(
				{
					channel: { id: "channel" },
					message: { ts: "timestamp" },
				} as Parameters<typeof slackAction>[0],
				{ action_id: `approval_${action}`, value: "approval" },
				"provider-user",
				{
					organizationId: "org",
					slackTeamId: "team",
					botAccessToken: "token",
				} as Parameters<typeof slackAction>[3],
			),
	},
	{
		platform: "telegram",
		send: () => sendTelegram("approval", managerId, "org", "token"),
		act: (action: "approve" | "reject" = "approve") =>
			telegramAction(
				{
					id: "query",
					message: { chat: { id: 10, type: "private" }, message_id: 20 },
				} as Parameters<typeof telegramAction>[0],
				{ a: action === "approve" ? "ap" : "rj", id: "approval" },
				"provider-user",
				{ organizationId: "org", botToken: "token" } as Parameters<
					typeof telegramAction
				>[3],
			),
	},
	{
		platform: "discord",
		send: () => sendDiscord("approval", managerId, "org", "token"),
		act: (action: "approve" | "reject" = "approve") =>
			discordAction(
				{ id: "interaction", token: "interaction-token" } as Parameters<
					typeof discordAction
				>[0],
				{ a: action === "approve" ? "ap" : "rj", id: "approval" },
				"provider-user",
				{ organizationId: "org", botToken: "token" } as Parameters<
					typeof discordAction
				>[3],
			),
	},
	{
		platform: "teams",
		send: () => sendTeams("approval", managerId, "org"),
		act: (action: "approve" | "reject" = "approve") =>
			teamsAction(
				{ sendActivity: state.replies.teams } as unknown as Parameters<
					typeof teamsAction
				>[0],
				"approval",
				action,
				{ employeeId: managerId, userId: "user" } as Parameters<
					typeof teamsAction
				>[3],
				{ organizationId: "org" } as Parameters<typeof teamsAction>[4],
			),
	},
] as const;

beforeEach(() => {
	vi.resetAllMocks();
	state.rows = {
		approvalRequest: [
			{
				id: "approval",
				organizationId: "org",
				approverId: managerId,
				requestedBy: "requester",
				entityType: "time_entry",
				entityId: "period",
				status: "pending",
				metadata: { timeRequest: { kind: "manual_time_submission" } },
				notes: "SECRET NOTES",
				createdAt: new Date("2026-07-01T12:00:00Z"),
			},
		],
		employee: [
			{
				id: managerId,
				organizationId: "org",
				isActive: true,
				userId: "user",
				user: { id: "user", name: "SECRET NAME", email: "private@example.com" },
			},
		],
		member: [{ id: "membership", organizationId: "org", userId: "user" }],
		workPeriod: [
			{
				id: "period",
				organizationId: "org",
				employeeId: "requester",
				pendingChanges: null,
				clockInId: null,
				clockOutId: null,
			},
		],
		slackApprovalMessage: [
			{
				id: "slack-record",
				organizationId: "org",
				approvalRequestId: "approval",
				recipientUserId: "user",
				channelId: "channel",
				messageTs: "timestamp",
			},
		],
		telegramApprovalMessage: [
			{
				id: "telegram-record",
				organizationId: "org",
				approvalRequestId: "approval",
				recipientUserId: "user",
				chatId: "10",
				messageId: "20",
			},
		],
	};
	state.resolve.mockResolvedValue({
		status: "found",
		user: { employeeId: managerId, userId: "user", organizationId: "org" },
	});
	state.history.mockImplementation(() =>
		Effect.fail(new Error("No exact historical receipt")),
	);
	state.sends.slack.mockResolvedValue({ ts: "timestamp" });
	state.sends.telegram.mockResolvedValue({ message_id: 20 });
	state.sends.discord.mockResolvedValue({ id: "message" });
	state.sends.teams.mockResolvedValue("activity");
});

describe.each(platformCases)(
	"$platform approval preparation to transport",
	({ platform, send, act }) => {
		it.each([
			"absence_entry",
			"time_entry",
			"travel_expense_claim",
			"unknown_kind",
		])("sends only a review notice for unbound %s", async (kind) => {
			state.rows.approvalRequest[0].entityType = kind;
			await send();
			expect(state.sends[platform]).toHaveBeenCalledOnce();
			const output = JSON.stringify(state.sends[platform].mock.calls);
			expect(output).toContain("Review required");
			// Exact item on the organization's origin, never the generic inbox.
			expect(output).toContain("https://org.z8.test/approvals/review/org/compatibility/approval");
			expect(output).not.toContain("/approvals/inbox");
			expect(output).not.toMatch(
				/SECRET|private@example|correctedTime|Time Correction|callback_data|approval_approve|Action.Submit|Action.Http/,
			);
			expect(state.track).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org",
					recipientUserId: "user",
					approvalRequestId: "approval",
				}),
			);
			expect(state.read.mock.calls.flat()).not.toContain("timeEntry");
		});
		it.each([
			"foreign request",
			"wrong assignee",
			"foreign employee",
			"inactive employee",
			"missing membership",
			"terminal request",
		])("suppresses disclosure for %s", async (condition) => {
			if (condition === "foreign request")
				state.rows.approvalRequest[0].organizationId = "foreign";
			if (condition === "wrong assignee")
				state.rows.approvalRequest[0].approverId = "someone-else";
			if (condition === "foreign employee")
				state.rows.employee[0].organizationId = "foreign";
			if (condition === "inactive employee")
				state.rows.employee[0].isActive = false;
			if (condition === "missing membership") state.rows.member = [];
			if (condition === "terminal request")
				state.rows.approvalRequest[0].status = "approved";
			await send();
			expect(state.sends[platform]).not.toHaveBeenCalled();
			expect(state.track).not.toHaveBeenCalled();
		});
		it.each(["approve", "reject"] as const)(
			"requires review for a fresh %s callback",
			async (action) => {
				await act(action);
				expect(state.replies[platform]).toHaveBeenCalledOnce();
				const output = JSON.stringify(state.replies[platform].mock.calls);
				expect(output).toContain("No decision was made");
				expect(output).toContain("https://org.z8.test/approvals/review/org/compatibility/approval");
				expect(output).not.toMatch(/SECRET|successfully|resolvedAt/);
				expect(state.history).toHaveBeenCalledWith(
					expect.anything(),
					expect.anything(),
					expect.objectContaining({ historicalOnly: true }),
				);
				expect(state.track).not.toHaveBeenCalled();
			},
		);
		it("does not disclose to a former canonical assignee even if the compatibility representative is stale", async () => {
			state.rows.approvalWorkflowStage = [
				{
					id: "stage",
					organizationId: "org",
					legacyApprovalRequestId: "approval",
					workflowId: "workflow",
					status: "pending",
					sequence: 1,
				},
			];
			state.rows.approvalWorkflow = [
				{
					id: "workflow",
					organizationId: "org",
					status: "pending",
					currentStageOrder: 1,
				},
			];
			state.rows.approvalStageAssignment = [
				{
					id: "assignment",
					organizationId: "org",
					workflowId: "workflow",
					stageId: "stage",
					approverEmployeeId: "replacement",
					status: "pending",
				},
			];
			await send();
			expect(state.sends[platform]).not.toHaveBeenCalled();
		});
		it("ignores foreign and unrelated stages while verifying the recipient's current assignment", async () => {
			state.rows.approvalWorkflowStage = [
				{
					id: "foreign-stage",
					organizationId: "foreign",
					legacyApprovalRequestId: "approval",
					status: "approved",
				},
				{
					id: "unrelated-stage",
					organizationId: "org",
					legacyApprovalRequestId: "another-request",
					status: "approved",
				},
				{
					id: "stage",
					organizationId: "org",
					legacyApprovalRequestId: "approval",
					workflowId: "workflow",
					status: "pending",
					sequence: 1,
				},
			];
			state.rows.approvalWorkflow = [
				{
					id: "workflow",
					organizationId: "org",
					status: "pending",
					currentStageOrder: 1,
				},
			];
			state.rows.approvalStageAssignment = [
				{
					id: "assignment",
					organizationId: "org",
					workflowId: "workflow",
					stageId: "stage",
					approverEmployeeId: managerId,
					status: "pending",
				},
			];
			await send();
			expect(state.sends[platform]).toHaveBeenCalledOnce();
		});
		it.each(["approve", "reject"] as const)(
			"preserves a verified historical %s without claiming final request status or new actor/time",
			async (action) => {
				state.rows.approvalRequest[0].status =
					action === "approve" ? "approved" : "rejected";
				state.history.mockReturnValue(Effect.void);
				await act(action);
				const output = JSON.stringify(state.replies[platform].mock.calls);
				expect(output).toContain("previously recorded");
				expect(output).toContain("no new decision was made");
				expect(output).toContain("https://org.z8.test/approvals/review/org/compatibility/approval");
				expect(output).not.toMatch(/SECRET|2026|Request approved|successfully/);
				expect(state.track).not.toHaveBeenCalled();
			},
		);
		it.each([
			"missing request",
			"foreign request",
			"foreign actor",
			"inactive actor",
			"wrong assignee",
			"removed membership",
		])("rejects callback access for %s", async (condition) => {
			if (condition === "missing request") state.rows.approvalRequest = [];
			if (condition === "foreign request")
				state.rows.approvalRequest[0].organizationId = "foreign";
			if (condition === "foreign actor")
				state.rows.employee[0].organizationId = "foreign";
			if (condition === "inactive actor")
				state.rows.employee[0].isActive = false;
			if (condition === "wrong assignee")
				state.rows.approvalRequest[0].approverId = "someone-else";
			if (condition === "removed membership") state.rows.member = [];
			await act();
			expect(state.history).not.toHaveBeenCalled();
			expect(JSON.stringify(state.replies[platform].mock.calls)).not.toMatch(
				/SECRET|previously recorded/,
			);
		});
		it("requires fresh review for unclassified time requests rather than guessing a correction", async () => {
			state.rows.approvalRequest[0].metadata = null;
			await act();
			expect(state.history).not.toHaveBeenCalled();
			expect(JSON.stringify(state.replies[platform].mock.calls)).toContain(
				"No decision was made",
			);
		});
		it("never reuses an event ID when the requester-owned period is missing", async () => {
			state.rows.workPeriod[0].employeeId = "someone-else";
			await act();
			expect(state.history).not.toHaveBeenCalled();
			expect(JSON.stringify(state.replies[platform].mock.calls)).not.toContain(
				"SECRET",
			);
		});
		it("does not turn provider rejection into a decision or tracking success", async () => {
			state.sends[platform].mockRejectedValueOnce(
				new Error("Provider unavailable"),
			);
			await send();
			expect(state.track).not.toHaveBeenCalled();
			expect(state.history).not.toHaveBeenCalled();
		});
		it.each(["reject", "false"])(
			"preserves verified history when the historical reply transport returns %s",
			async (failure) => {
				state.history.mockReturnValue(Effect.void);
				if (failure === "reject")
					state.replies[platform].mockRejectedValueOnce(
						new Error("Provider unavailable"),
					);
				else state.replies[platform].mockResolvedValueOnce(false);
				await act().catch(() => undefined);
				expect(state.history).toHaveBeenCalledOnce();
				expect(state.track).not.toHaveBeenCalled();
				expect(state.rows.approvalRequest[0].status).toBe("pending");
			},
		);
		it.each([
			"pending",
			"matching approval",
			"matching rejection",
			"different rejection reason",
		])(
			"connects a callback to the real ordinary owner for %s",
			async (scenario) => {
				const owner = await vi.importActual<
					typeof import("@/lib/approvals/server/work-period-approvals")
				>("@/lib/approvals/server/work-period-approvals");
				state.history.mockImplementation(
					owner.decideOrdinaryWorkPeriodWithStableTargetEffect,
				);
				const action = scenario.includes("rejection") ? "reject" : "approve";
				const status =
					scenario === "pending"
						? "pending"
						: action === "approve"
							? "approved"
							: "rejected";
				Object.assign(state.rows.approvalRequest[0], {
					status,
					approvedAt:
						status === "approved" ? new Date("2026-07-02T10:00:00Z") : null,
					rejectionReason:
						scenario === "different rejection reason"
							? "A different decision"
							: `Rejected via ${platform[0].toUpperCase()}${platform.slice(1)}`,
				});
				Object.assign(state.rows.workPeriod[0], {
					canonicalRecordId: "canonical",
					approvalWorkflowId: null,
					approvalStatus: status,
					isActive: false,
					deletedAt: null,
					startTime: new Date("2026-07-01T08:00:00Z"),
					endTime: new Date("2026-07-01T09:00:00Z"),
					durationMinutes: 60,
				});
				state.legacyEvidence.mockImplementation(async () => ({
					approvalRequest: state.rows.approvalRequest[0],
					source: { workflowType: "manual_time_submission" },
				}));
				state.workflowRuntime.mockReturnValue({
					repository: {
						withTransaction: async (
							run: (context: unknown) => Promise<unknown>,
						) =>
							run({
								dbService: { db },
								writeGate: { acquire: async () => ({ mode: "legacy" }) },
								compatibilityWriter: { withWriteGate: () => ({}) },
							}),
					},
				});
				await act(action);
				expect(state.workflowRuntime).toHaveBeenCalled();
				expect(state.legacyEvidence).toHaveBeenCalled();
				expect(state.freshDecision).not.toHaveBeenCalled();
				expect(state.mutation).not.toHaveBeenCalled();
				const reply = JSON.stringify(state.replies[platform].mock.calls);
				expect(reply).toContain(
					scenario.startsWith("matching")
						? "previously recorded"
						: "No decision was made",
				);
				expect(state.rows.approvalRequest[0].status).toBe(status);
				expect(state.track).not.toHaveBeenCalled();
			},
		);
	},
);

describe("Telegram webhook dispatcher after review-only cutover", () => {
	it.each([
		"normal",
		"unlinked",
		"resolver failure",
		"read failure",
		"delivery failure",
		"malformed",
		"acknowledgment failure",
	])("acknowledges exactly once for %s", async (scenario) => {
		if (scenario === "unlinked")
			state.resolve.mockResolvedValueOnce({ status: "not_found" });
		if (scenario === "resolver failure")
			state.resolve.mockRejectedValueOnce(new Error("Resolver unavailable"));
		if (scenario === "read failure")
			state.read.mockImplementationOnce(() => {
				throw new Error("Database unavailable");
			});
		if (scenario === "delivery failure")
			state.replies.telegram.mockRejectedValueOnce(
				new Error("Provider unavailable"),
			);
		if (scenario === "acknowledgment failure")
			state.acknowledge.mockRejectedValueOnce(
				new Error("Acknowledgment unavailable"),
			);
		await handleTelegramUpdate(
			{
				update_id: 1,
				callback_query: {
					id: "query",
					from: { id: 1, is_bot: false, first_name: "Manager" },
					data:
						scenario === "malformed"
							? "{"
							: JSON.stringify({ a: "ap", id: "approval" }),
					message: {
						message_id: 20,
						date: 0,
						chat: { id: 10, type: "private" },
					},
				},
			},
			{ organizationId: "org", botToken: "token" } as Parameters<
				typeof handleTelegramUpdate
			>[1],
		);
		// No committed or verified outcome, so the acknowledgment carries no text.
		expect(state.acknowledge).toHaveBeenCalledExactlyOnceWith(
			"token",
			"query",
			undefined,
		);
		expect(state.track).not.toHaveBeenCalled();
	});
});

it("loads the new notice translations through the actual bot translator", async () => {
	const { getBotTranslate } = await vi.importActual<
		typeof import("@/lib/bot-platform/i18n")
	>("@/lib/bot-platform/i18n");
	const translate = await getBotTranslate("de");
	expect(translate("bot.approval.reviewRequiredTitle", "fallback")).toBe(
		"Prüfung erforderlich",
	);
	expect(translate("bot.approval.historicalTitle", "fallback")).toBe(
		"Frühere Entscheidung",
	);
});

describe.each(platformCases.slice(0, 2))(
	"$platform exact-message retirement",
	({ platform, act }) => {
		it.each(["organizationId", "recipientUserId", "approvalRequestId"])(
			"does not edit a tracking row with mismatched %s",
			async (field) => {
				const table =
					platform === "slack"
						? "slackApprovalMessage"
						: "telegramApprovalMessage";
				state.rows[table][0][field] = "foreign";
				await act();
				expect(state.replies[platform]).not.toHaveBeenCalled();
			},
		);
	},
);
