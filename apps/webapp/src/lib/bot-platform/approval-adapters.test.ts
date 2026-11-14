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
	decide: vi.fn(),
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
// The unbound card is an adapter over the time approval decision (#1679); the
// decision's replay-only behaviour is proven against PostgreSQL in
// time-approval-decision.integration.test.ts. Here only the translation is.
vi.mock("@/lib/approvals/server/time-approval-decision", () => ({
	decideTimeApproval: state.decide,
}));
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
	prepareBoundLegacyAbsenceCard: async () => null,
}));
// Legacy absence cards (#384): legacy-bound-approval.integration.test.ts. The
// fixtures here model canonical absence authority.
vi.mock("@/lib/approvals/authority", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/approvals/authority")>();
	return {
		...actual,
		readApprovalAuthoritySnapshot: async () =>
			actual.resolveApprovalAuthority("canonical"),
	};
});
// Legacy time cards (#432): legacy-time-bound-approval.integration.test.ts. The
// time fixtures here have no legacy revision, so they keep the existing path.
vi.mock("@/lib/approvals/evidence/legacy-time", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/lib/approvals/evidence/legacy-time")
	>()),
	readTimeRequestAuthority: async () => "undetermined",
}));
// Historical replays here were never card decisions: no evidence names a binding.
vi.mock("@/lib/approvals/evidence/store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/approvals/evidence/store")>()),
	findLegacyDecisionEvidenceByRequest: async () => null,
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
	resolveApprovalDMChannel: async () => ({ kind: "ok", result: "channel" }),
}));
vi.mock("@/lib/teams/conversation-manager", () => ({
	getConversationReferenceForUser: async () => ({
		conversation: { id: "conversation" },
	}),
}));

import {
	handleApprovalButtonClick as discordAction,
	sendApprovalMessageToManager as sendDiscord,
} from "@/lib/discord/approval-handler";
import { sendDiscordNotification } from "@/lib/notifications/discord-channel";
import { sendSlackNotification } from "@/lib/notifications/slack-channel";
import { sendTeamsNotification } from "@/lib/notifications/teams-channel";
import { sendTelegramNotification } from "@/lib/notifications/telegram-channel";
import {
	sendApprovalMessageToManager as sendSlack,
	handleApprovalAction as slackAction,
} from "@/lib/slack/approval-handler";
import {
	sendApprovalCardToManager as sendTeams,
	handleApprovalAction as teamsAction,
} from "@/lib/teams/approval-handler";
import {
	sendApprovalMessageToManager as sendTelegram,
	handleApprovalCallback as telegramAction,
} from "@/lib/telegram/approval-handler";
import { handleTelegramUpdate } from "@/lib/telegram/bot-handler";

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
}, 60_000);
const platformNames = {
	slack: "Slack",
	telegram: "Telegram",
	discord: "Discord",
	teams: "Teams",
} as const;
const decided = {
	status: "decided",
	kind: "manual_time_submission",
	workPeriodId: "period",
	outcome: "approved",
	replayed: true,
} as const;
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
	state.decide.mockResolvedValue({ status: "refused", reason: "changed" });
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
			expect(output).toContain(
				"https://org.z8.test/approvals/review/org/compatibility/approval",
			);
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
				expect(output).toContain(
					"https://org.z8.test/approvals/review/org/compatibility/approval",
				);
				expect(output).not.toMatch(/SECRET|successfully|resolvedAt/);
				// Only a committed decision by the same approver can be confirmed.
				expect(state.decide).toHaveBeenCalledExactlyOnceWith({
					organizationId: "org",
					approvalId: "approval",
					actor: { employeeId: managerId, userId: "user" },
					right: { as: "approver" },
					decision:
						action === "approve"
							? { kind: "approve" }
							: {
									kind: "reject",
									reason: `Rejected via ${platformNames[platform]}`,
								},
					replayOnly: true,
				});
				expect(state.track).not.toHaveBeenCalled();
			},
		);
		it.each([
			"right_not_held",
			"reassigned",
			"already_decided",
			"unclassified",
			"not_found",
		] as const)(
			"answers review required when the decision refuses as %s",
			async (reason) => {
				state.decide.mockResolvedValueOnce({ status: "refused", reason });
				await act();
				const output = JSON.stringify(state.replies[platform].mock.calls);
				expect(output).toContain("No decision was made");
				expect(output).not.toContain("previously recorded");
			},
		);
		it("requires review without deciding when the approval is not a time approval", async () => {
			state.rows.approvalRequest[0].entityType = "absence_entry";
			await act();
			expect(state.decide).not.toHaveBeenCalled();
			expect(JSON.stringify(state.replies[platform].mock.calls)).toContain(
				"No decision was made",
			);
		});
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
				state.decide.mockResolvedValue({
					...decided,
					outcome: action === "approve" ? "approved" : "rejected",
				});
				await act(action);
				const output = JSON.stringify(state.replies[platform].mock.calls);
				expect(output).toContain("previously recorded");
				expect(output).toContain("no new decision was made");
				expect(output).toContain(
					"https://org.z8.test/approvals/review/org/compatibility/approval",
				);
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
			expect(state.decide).not.toHaveBeenCalled();
			expect(JSON.stringify(state.replies[platform].mock.calls)).not.toMatch(
				/SECRET|previously recorded/,
			);
		});
		it("does not turn provider rejection into a decision or tracking success", async () => {
			state.sends[platform].mockRejectedValueOnce(
				new Error("Provider unavailable"),
			);
			await send();
			expect(state.track).not.toHaveBeenCalled();
			expect(state.decide).not.toHaveBeenCalled();
		});
		it.each(["reject", "false"])(
			"preserves verified history when the historical reply transport returns %s",
			async (failure) => {
				state.decide.mockResolvedValue(decided);
				if (failure === "reject")
					state.replies[platform].mockRejectedValueOnce(
						new Error("Provider unavailable"),
					);
				else state.replies[platform].mockResolvedValueOnce(false);
				await act().catch(() => undefined);
				expect(state.decide).toHaveBeenCalledOnce();
				expect(state.track).not.toHaveBeenCalled();
				expect(state.rows.approvalRequest[0].status).toBe("pending");
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

it("loads the unbound card's approval once before confirming a decision", async () => {
	state.decide.mockResolvedValue(decided);
	const { attemptBotApproval } = await import(
		"@/lib/bot-platform/approval-decision"
	);
	await expect(
		attemptBotApproval({
			approvalId: "approval",
			actorEmployeeId: managerId,
			organizationId: "org",
			action: "approve",
			platform: "telegram",
		}),
	).resolves.toEqual({ status: "historical", action: "approve" });
	expect(
		state.read.mock.calls.flat().filter((table) => table === "approvalRequest"),
	).toHaveLength(1);
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
		"Historische Entscheidung",
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
