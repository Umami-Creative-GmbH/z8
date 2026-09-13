import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/lib/effect/errors";
import type { ResolvedTelegramBot, TelegramCallbackQuery } from "./types";

const effects = vi.hoisted(() => ({
	approvalFindFirst: vi.fn(),
	periodFindFirst: vi.fn(),
	assignmentFindFirst: vi.fn(),
	execute: vi.fn(),
	employeeFindFirst: vi.fn(),
	absenceFindFirst: vi.fn(),
	messageFindFirst: vi.fn(),
	trackResponse: vi.fn(),
	persistDecision: vi.fn(),
	resolveUser: vi.fn(),
	resolveDisplay: vi.fn(),
	getLocale: vi.fn(),
	getTranslate: vi.fn(),
	editMessage: vi.fn(),
	sendMessage: vi.fn(),
	getChat: vi.fn(),
	acknowledge: vi.fn(),
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: { findFirst: effects.approvalFindFirst },
			workPeriod: { findFirst: effects.periodFindFirst },
			timeEntry: { findMany: vi.fn(async () => []) },
			approvalStageAssignment: { findFirst: effects.assignmentFindFirst },
			employee: { findFirst: effects.employeeFindFirst },
			absenceEntry: { findFirst: effects.absenceFindFirst },
			telegramApprovalMessage: { findFirst: effects.messageFindFirst },
		},
		execute: effects.execute,
		update: () => ({
			set: (values: unknown) => ({
				where: (where: SQL) => effects.trackResponse(values, where),
			}),
		}),
	},
}));

// Same seam as Slack: real bot attempt, inbox discovery/eligibility/authorization,
// registry lookup and Effect dispatch. Only the registered domain effect is
// controlled; the ordinary owner tests verify exact replay/conflict persistence.
vi.mock("@/lib/approvals/init", async () => {
	const { registerApprovalHandler } = await import(
		"@/lib/approvals/domain/registry"
	);
	const { TimeCorrectionHandler } = await import(
		"@/lib/approvals/handlers/time-correction.handler"
	);
	const { Effect } = await import("effect");
	registerApprovalHandler({
		...TimeCorrectionHandler,
		approve: (entityId, actorEmployeeId, options) =>
			Effect.promise(() =>
				effects.persistDecision({
					entityId,
					actorEmployeeId,
					action: "approve",
					options,
				}),
			),
		reject: (entityId, actorEmployeeId, reason, options) =>
			Effect.promise(() =>
				effects.persistDecision({
					entityId,
					actorEmployeeId,
					action: "reject",
					reason,
					options,
				}),
			),
	});
	return {};
});
vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	return { runtime: { runPromiseExit: Effect.runPromiseExit } };
});
vi.mock("@/lib/logger", () => ({ createLogger: () => effects.logger }));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: effects.getTranslate,
	getUserLocale: effects.getLocale,
	setUserLocale: vi.fn(),
}));
vi.mock("@/lib/notifications/recipient-display-context", () => ({
	resolveRecipientDisplayContext: effects.resolveDisplay,
}));
vi.mock("./user-resolver", () => ({
	resolveTelegramUser: effects.resolveUser,
	claimLinkCode: vi.fn(),
}));
vi.mock("./api", () => ({
	editMessageText: effects.editMessage,
	sendMessage: effects.sendMessage,
	answerCallbackQuery: effects.acknowledge,
}));
vi.mock("./conversation-manager", () => ({
	getChatIdForUser: effects.getChat,
	saveConversation: vi.fn(),
}));
vi.mock("@/lib/bot-platform/command-registry", () => ({
	executeCommand: vi.fn(),
	getAllCommands: vi.fn(),
	parseCommand: vi.fn(),
}));
vi.mock("@/lib/bot-platform/temporal-context", () => ({
	resolveBotTemporalContext: vi.fn(),
}));

import {
	handleApprovalCallback,
	sendApprovalMessageToManager,
} from "./approval-handler";
import { handleTelegramUpdate } from "./bot-handler";

const bot: ResolvedTelegramBot = {
	organizationId: "org-1",
	botToken: "token",
	botUsername: "z8bot",
	webhookSecret: "webhook-secret",
	setupStatus: "completed",
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: false,
	enableEscalations: false,
	digestTime: "09:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
};
const query: TelegramCallbackQuery = {
	id: "query-1",
	from: { id: 1, is_bot: false, first_name: "Morgan" },
	message: {
		chat: { id: 10, type: "private" },
		message_id: 20,
		date: 1784541600,
	},
	data: JSON.stringify({ a: "ap", id: "approval-1" }),
};

function request(overrides: Record<string, unknown> = {}) {
	return {
		id: "approval-1",
		organizationId: "org-1",
		entityType: "time_entry",
		entityId: "period-1",
		requestedBy: "employee-1",
		approverId: "manager-1",
		status: "pending",
		metadata: { timeRequest: { kind: "manual_time_submission" } },
		createdAt: new Date("2026-07-20T10:00:00Z"),
		...overrides,
	};
}

function act(action: "approve" | "reject" = "approve", callback = query) {
	return handleApprovalCallback(
		callback,
		{ a: action === "approve" ? "ap" : "rj", id: "approval-1" },
		"1",
		bot,
	);
}

// Interpret equality predicates so omitting organization or id exposes foreign
// rows, causing observable decision/presentation assertions to fail.
function storedRow<T extends { id: string; organizationId: string }>(
	table: string,
	row: T,
) {
	return async ({ where }: { where: SQL }) => {
		const query = new PgDialect().sqlToQuery(where);
		for (const [column, value] of [
			["id", row.id],
			["organization_id", row.organizationId],
		]) {
			const parameter = query.sql.match(
				new RegExp(`"${table}"\\."${column}" = \\$(\\d+)`),
			);
			if (parameter && query.params[Number(parameter[1]) - 1] !== value)
				return undefined;
		}
		return row;
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	effects.resolveUser.mockResolvedValue({
		status: "found",
		user: {
			employeeId: "manager-1",
			userId: "user-1",
			organizationId: "org-1",
		},
	});
	effects.approvalFindFirst.mockImplementation(
		storedRow("approval_request", request()),
	);
	effects.periodFindFirst.mockResolvedValue({
		pendingChanges: null,
		clockInId: null,
		clockOutId: null,
	});
	effects.execute.mockResolvedValue({ rows: [] });
	effects.employeeFindFirst.mockResolvedValue({
		userId: "user-1",
		user: { name: "Morgan Manager", email: "morgan@example.com" },
	});
	effects.messageFindFirst.mockResolvedValue({ id: "message-record-1" });
	effects.persistDecision.mockResolvedValue(undefined);
	effects.resolveDisplay.mockResolvedValue({
		locale: "en",
		timezone: "Europe/Berlin",
		timeFormat: "24h",
	});
	effects.getLocale.mockResolvedValue("en");
	effects.getTranslate.mockResolvedValue(
		(_key: string, fallback: string) => fallback,
	);
});

afterEach(() => vi.useRealTimers());

describe("Telegram approval attempts through the inbox", () => {
	it("approves a pending request and presents and tracks the committed decision", async () => {
		await act();
		expect(effects.persistDecision).toHaveBeenCalledWith({
			entityId: "period-1",
			actorEmployeeId: "manager-1",
			action: "approve",
			options: { approvalRequestId: "approval-1" },
		});
		expect(effects.editMessage).toHaveBeenCalledWith("token", {
			chat_id: 10,
			message_id: 20,
			text: expect.stringContaining("*Approved* by Morgan Manager"),
			parse_mode: "MarkdownV2",
		});
		expect(effects.trackResponse).toHaveBeenCalledWith(
			{ status: "approved", respondedAt: expect.any(Date) },
			expect.anything(),
		);
		expect(effects.acknowledge).not.toHaveBeenCalled();
		expect(effects.logger.error).not.toHaveBeenCalled();
	});
});

describe("Telegram approval eligibility and authority", () => {
	it("rejects a pending request with exact Telegram attribution", async () => {
		await act("reject");
		expect(effects.persistDecision).toHaveBeenCalledWith({
			entityId: "period-1",
			actorEmployeeId: "manager-1",
			action: "reject",
			reason: "Rejected via Telegram",
			options: { approvalRequestId: "approval-1" },
		});
		expect(effects.editMessage).toHaveBeenCalledWith(
			"token",
			expect.objectContaining({
				text: expect.stringContaining("*Rejected* by Morgan Manager"),
			}),
		);
		expect(effects.trackResponse).toHaveBeenCalledWith(
			{ status: "rejected", respondedAt: expect.any(Date) },
			expect.anything(),
		);
	});

	it("resolves identity before approval reads and silently exits for an unlinked actor", async () => {
		effects.resolveUser.mockImplementation(async () => {
			expect(effects.approvalFindFirst).not.toHaveBeenCalled();
			return { status: "not_found" };
		});
		await act();
		expect(effects.resolveUser).toHaveBeenCalledWith("1", "org-1");
		expect(effects.approvalFindFirst).not.toHaveBeenCalled();
		expect(effects.persistDecision).not.toHaveBeenCalled();
		expect(effects.editMessage).not.toHaveBeenCalled();
		expect(effects.logger.warn).toHaveBeenCalledWith(
			{ telegramUserId: "1" },
			"Unlinked user tried to act on approval",
		);
	});

	it("leaves identity resolution exceptions outside the attempt catch", async () => {
		const error = new Error("Identity unavailable");
		effects.resolveUser.mockRejectedValue(error);
		await expect(act()).rejects.toBe(error);
		expect(effects.approvalFindFirst).not.toHaveBeenCalled();
		expect(effects.logger.error).not.toHaveBeenCalled();
	});

	it.each(["missing", "foreign organization", "foreign id"])(
		"silently exits for a %s compatibility request",
		async (scenario) => {
			if (scenario === "missing")
				effects.approvalFindFirst.mockResolvedValue(undefined);
			else
				effects.approvalFindFirst.mockImplementation(
					storedRow(
						"approval_request",
						request(
							scenario === "foreign organization"
								? { organizationId: "org-2" }
								: { id: "approval-2" },
						),
					),
				);
			await act();
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.editMessage).not.toHaveBeenCalled();
			expect(effects.periodFindFirst).not.toHaveBeenCalled();
			expect(effects.logger.warn).toHaveBeenCalledWith(
				{ approvalId: "approval-1" },
				"Approval not found",
			);
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

	it("requires a compatibility request even when a canonical assignment exists", async () => {
		effects.approvalFindFirst.mockResolvedValue(undefined);
		effects.assignmentFindFirst.mockResolvedValue({
			id: "approval-1",
			organizationId: "org-1",
			workflowId: "workflow-1",
			stageId: "stage-1",
			approverEmployeeId: "manager-1",
			status: "approved",
			workflow: {
				id: "workflow-1",
				organizationId: "org-1",
				workflowType: "manual_time_submission",
				sourceType: "time_entry",
				sourceId: "period-1",
				requesterEmployeeId: "employee-1",
				status: "approved",
				currentStageOrder: null,
			},
			stage: {
				id: "stage-1",
				organizationId: "org-1",
				workflowId: "workflow-1",
				sequence: 1,
				status: "approved",
			},
		});
		await act();
		expect(effects.assignmentFindFirst).not.toHaveBeenCalled();
		expect(effects.persistDecision).not.toHaveBeenCalled();
		expect(effects.editMessage).not.toHaveBeenCalled();
		expect(effects.logger.warn).toHaveBeenCalledWith(
			{ approvalId: "approval-1" },
			"Approval not found",
		);
	});

	it("silently rejects a linked employee who is not the assigned approver", async () => {
		effects.approvalFindFirst.mockResolvedValue(
			request({ approverId: "other-manager" }),
		);
		await act();
		expect(effects.persistDecision).not.toHaveBeenCalled();
		expect(effects.editMessage).not.toHaveBeenCalled();
		expect(effects.logger.warn).toHaveBeenCalledWith(
			{ approvalId: "approval-1", employeeId: "manager-1" },
			"Unauthorized approval attempt",
		);
	});

	it.each([
		["approved", "manual_time_submission", "approve", "Approved"],
		["rejected", "manual_time_submission", "reject", "Rejected"],
		["approved", "policy_clock_out", "approve", "Approved"],
		["rejected", "policy_clock_out", "reject", "Rejected"],
	] as const)(
		"presents successful %s %s replay as success",
		async (status, kind, action, label) => {
			effects.approvalFindFirst.mockResolvedValue(
				request({ status, metadata: { timeRequest: { kind } } }),
			);
			await act(action);
			expect(effects.persistDecision).toHaveBeenCalledOnce();
			expect(effects.persistDecision).toHaveBeenCalledWith(
				expect.objectContaining({
					action,
					...(action === "reject" ? { reason: "Rejected via Telegram" } : {}),
				}),
			);
			expect(effects.editMessage).toHaveBeenCalledWith(
				"token",
				expect.objectContaining({
					text: expect.stringContaining(`*${label}* by Morgan Manager`),
				}),
			);
			expect(effects.trackResponse).toHaveBeenCalledWith(
				{ status, respondedAt: expect.any(Date) },
				expect.anything(),
			);
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

	it.each([
		[
			"approved",
			{
				timeCorrection: {
					action: "edit",
					workLocationType: "office",
					workCategoryId: null,
				},
			},
		],
		[
			"rejected",
			{
				timeCorrection: {
					action: "edit",
					workLocationType: "office",
					workCategoryId: null,
				},
			},
		],
		["cancelled", { timeRequest: { kind: "manual_time_submission" } }],
		["unknown", { timeRequest: { kind: "policy_clock_out" } }],
		["approved", null],
	])(
		"keeps %s ineligible targets already processed before comparing approvers",
		async (status, metadata) => {
			effects.approvalFindFirst.mockResolvedValue(
				request({ status, metadata, approverId: "other-manager" }),
			);
			effects.getLocale.mockResolvedValue("de");
			effects.getTranslate.mockResolvedValue(() => "Bereits [bearbeitet]!");
			await act();
			expect(effects.getLocale).toHaveBeenCalledWith("user-1");
			expect(effects.getTranslate).toHaveBeenCalledWith("de");
			expect(effects.editMessage).toHaveBeenCalledWith("token", {
				chat_id: 10,
				message_id: 20,
				text: "Bereits \\[bearbeitet\\]\\!",
				parse_mode: "MarkdownV2",
			});
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.trackResponse).not.toHaveBeenCalled();
			expect(effects.logger.warn).not.toHaveBeenCalled();
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

	it("fails closed for terminal ordinary metadata when its scoped period is missing", async () => {
		effects.approvalFindFirst.mockResolvedValue(
			request({ status: "approved" }),
		);
		effects.periodFindFirst.mockResolvedValue(undefined);
		await act();
		expect(effects.persistDecision).not.toHaveBeenCalled();
		expect(effects.editMessage).toHaveBeenCalledWith(
			"token",
			expect.objectContaining({
				text: "This approval has already been processed\\.",
			}),
		);
	});

	it("silently exits an already processed request without a message", async () => {
		effects.approvalFindFirst.mockResolvedValue(
			request({ status: "cancelled" }),
		);
		await act("approve", { ...query, message: undefined });
		expect(effects.editMessage).not.toHaveBeenCalled();
		expect(effects.getLocale).not.toHaveBeenCalled();
		expect(effects.persistDecision).not.toHaveBeenCalled();
		expect(effects.logger.error).not.toHaveBeenCalled();
	});

	it.each(["target load", "authoritative reload"])(
		"logs later %s absence as an error rather than initial not-found",
		async (stage) => {
			effects.approvalFindFirst
				.mockResolvedValue(undefined)
				.mockResolvedValueOnce(request());
			if (stage === "authoritative reload")
				effects.approvalFindFirst.mockResolvedValueOnce(request());
			await act();
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.editMessage).not.toHaveBeenCalled();
			expect(effects.logger.warn).not.toHaveBeenCalled();
			expect(effects.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.objectContaining({ _tag: "NotFoundError" }),
					approvalId: "approval-1",
					action: "approve",
				}),
				"Failed to process approval action",
			);
		},
	);

	it.each(["target load", "authoritative reload"])(
		"preserves organization scope during %s",
		async (stage) => {
			effects.approvalFindFirst
				.mockImplementation(
					storedRow("approval_request", request({ organizationId: "org-2" })),
				)
				.mockResolvedValueOnce(request());
			if (stage === "authoritative reload")
				effects.approvalFindFirst.mockResolvedValueOnce(request());
			await act();
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.editMessage).not.toHaveBeenCalled();
			expect(effects.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.objectContaining({ _tag: "NotFoundError" }),
				}),
				"Failed to process approval action",
			);
		},
	);

	it.each([{ approverId: "new-manager" }, { status: "cancelled" }])(
		"uses authoritative reload to prevent a stale decision after %j",
		async (change) => {
			effects.approvalFindFirst
				.mockResolvedValue(request(change))
				.mockResolvedValueOnce(request())
				.mockResolvedValueOnce(request());
			await act();
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.editMessage).not.toHaveBeenCalled();
			expect(effects.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ approvalId: "approval-1" }),
				"Failed to process approval action",
			);
		},
	);

	it.each([
		new Error("Decision persistence failed"),
		new ConflictError({
			message: "Conflicting ordinary replay",
			conflictType: "approval_transition",
		}),
	])(
		"logs and swallows domain decision failure without success presentation: %s",
		async (error) => {
			effects.approvalFindFirst.mockResolvedValue(
				request({ status: "approved" }),
			);
			effects.persistDecision.mockRejectedValue(error);
			await expect(act()).resolves.toBeUndefined();
			expect(effects.persistDecision).toHaveBeenCalledOnce();
			expect(effects.editMessage).not.toHaveBeenCalled();
			expect(effects.trackResponse).not.toHaveBeenCalled();
			expect(effects.logger.error).toHaveBeenCalledWith(
				{ error, approvalId: "approval-1", action: "approve" },
				"Failed to process approval action",
			);
		},
	);
});

describe("Telegram post-decision presentation", () => {
	it("uses the original request for presentation and the authoritative target for dispatch", async () => {
		effects.approvalFindFirst
			.mockResolvedValue(
				request({ requestedBy: "employee-2", entityId: "period-2" }),
			)
			.mockResolvedValueOnce(
				request({ entityType: "absence_entry", entityId: "absence-1" }),
			);
		let committed = false;
		effects.persistDecision.mockImplementation(async () => {
			committed = true;
		});
		effects.employeeFindFirst.mockImplementation(
			async ({ where }: { where: SQL }) => {
				expect(committed).toBe(true);
				const { params } = new PgDialect().sqlToQuery(where);
				return {
					user: {
						name: params.includes("employee-1")
							? "Original Requester"
							: "Refreshed Person",
					},
				};
			},
		);
		effects.absenceFindFirst.mockImplementation(
			storedRow("absence_entry", {
				id: "absence-1",
				organizationId: "org-1",
				category: { name: "Original Leave" },
				startDate: "2026-07-20",
				endDate: "2026-07-21",
			}),
		);
		await act();
		expect(effects.persistDecision).toHaveBeenCalledWith(
			expect.objectContaining({ entityId: "period-2" }),
		);
		expect(effects.editMessage).toHaveBeenCalledWith(
			"token",
			expect.objectContaining({
				text: expect.stringContaining(
					"From: *Original Requester*\nType: Original Leave\nPeriod: Jul 20, 2026 \\- Jul 21, 2026",
				),
			}),
		);
		expect(effects.logger.error).not.toHaveBeenCalled();
	});

	it("formats success with the recipient locale, timezone, and time preference", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-07-20T10:00:00Z"));
		effects.resolveDisplay.mockResolvedValue({
			locale: "de",
			timezone: "Europe/Berlin",
			timeFormat: "24h",
		});
		effects.getTranslate.mockResolvedValue((key: string, fallback: string) =>
			key === "bot.approval.approved" ? "Genehmigt" : fallback,
		);
		await act();
		expect(effects.resolveDisplay).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
		});
		expect(effects.getTranslate).toHaveBeenCalledWith("de");
		expect(effects.editMessage).toHaveBeenCalledWith(
			"token",
			expect.objectContaining({
				text: expect.stringContaining(
					"*Genehmigt* by Morgan Manager\nat 20\\. Juli 2026, 12:00",
				),
			}),
		);
	});

	it.each(["missing", "foreign"])(
		"skips presentation and tracking for a %s approver employee",
		async (scenario) => {
			if (scenario === "missing")
				effects.employeeFindFirst.mockResolvedValue(undefined);
			else
				effects.employeeFindFirst.mockImplementation(
					storedRow("employee", {
						id: "manager-1",
						organizationId: "org-2",
						user: { name: "Foreign Manager" },
					}),
				);
			await act();
			expect(effects.persistDecision).toHaveBeenCalledOnce();
			expect(effects.editMessage).not.toHaveBeenCalled();
			expect(effects.resolveDisplay).not.toHaveBeenCalled();
			expect(effects.messageFindFirst).not.toHaveBeenCalled();
			expect(effects.trackResponse).not.toHaveBeenCalled();
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

	it.each(["message", "requester", "display context", "foreign requester"])(
		"still tracks success when presentation has no %s",
		async (missing) => {
			if (missing === "requester")
				effects.employeeFindFirst
					.mockResolvedValue(undefined)
					.mockResolvedValueOnce({ user: { name: "Manager" } });
			if (missing === "foreign requester")
				effects.employeeFindFirst
					.mockImplementation(
						storedRow("employee", {
							id: "employee-1",
							organizationId: "org-2",
							user: { name: "Foreign" },
						}),
					)
					.mockResolvedValueOnce({ user: { name: "Manager" } });
			if (missing === "display context")
				effects.resolveDisplay.mockResolvedValue(null);
			await act(
				"approve",
				missing === "message" ? { ...query, message: undefined } : query,
			);
			expect(effects.persistDecision).toHaveBeenCalledOnce();
			expect(effects.editMessage).not.toHaveBeenCalled();
			expect(effects.trackResponse).toHaveBeenCalledWith(
				{ status: "approved", respondedAt: expect.any(Date) },
				expect.anything(),
			);
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

	it("omits foreign absence details from original-request presentation", async () => {
		effects.approvalFindFirst
			.mockResolvedValue(request())
			.mockResolvedValueOnce(
				request({ entityType: "absence_entry", entityId: "absence-1" }),
			);
		effects.absenceFindFirst.mockImplementation(
			storedRow("absence_entry", {
				id: "absence-1",
				organizationId: "org-2",
				category: { name: "Foreign Leave" },
				startDate: "2026-07-20",
				endDate: "2026-07-21",
			}),
		);
		await act();
		expect(effects.editMessage).toHaveBeenCalledWith(
			"token",
			expect.objectContaining({
				text: expect.stringContaining("Type: Leave"),
			}),
		);
		expect(effects.editMessage.mock.calls[0][1].text).not.toContain(
			"Foreign Leave",
		);
		expect(effects.trackResponse).toHaveBeenCalledOnce();
	});

	it.each(["missing", "foreign"])(
		"still presents success with a %s tracking record",
		async (scenario) => {
			if (scenario === "missing")
				effects.messageFindFirst.mockResolvedValue(undefined);
			else
				effects.messageFindFirst.mockImplementation(
					storedRow("telegram_approval_message", {
						id: "message-record-1",
						organizationId: "org-2",
					}),
				);
			effects.employeeFindFirst.mockResolvedValueOnce({ user: null });
			await act();
			expect(effects.editMessage).toHaveBeenCalledWith(
				"token",
				expect.objectContaining({
					text: expect.stringContaining("*Approved* by Unknown"),
				}),
			);
			expect(effects.trackResponse).not.toHaveBeenCalled();
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

	it("scopes the response tracking write to the message and organization", async () => {
		await act();
		const { sql, params } = new PgDialect().sqlToQuery(
			effects.trackResponse.mock.calls[0][1],
		);
		expect(sql).toContain('"telegram_approval_message"."id" = $1');
		expect(sql).toContain('"telegram_approval_message"."organization_id" = $2');
		expect(params).toEqual(["message-record-1", "org-1"]);
	});

	it("keeps a committed decision when delivery throws and skips tracking", async () => {
		const committed: string[] = [];
		effects.persistDecision.mockImplementation(
			async ({ action }: { action: string }) => {
				committed.push(action);
			},
		);
		const error = new Error("Telegram unavailable");
		effects.editMessage.mockImplementation(async () => {
			expect(committed).toEqual(["approve"]);
			throw error;
		});
		await expect(act()).resolves.toBeUndefined();
		expect(committed).toEqual(["approve"]);
		expect(effects.logger.error).toHaveBeenCalledWith(
			{ error, approvalId: "approval-1", action: "approve" },
			"Failed to process approval action",
		);
		expect(effects.messageFindFirst).not.toHaveBeenCalled();
		expect(effects.trackResponse).not.toHaveBeenCalled();
	});

	it("still tracks the committed decision when Telegram returns an unsuccessful edit", async () => {
		effects.editMessage.mockResolvedValue(false);
		await act();
		expect(effects.persistDecision).toHaveBeenCalledOnce();
		expect(effects.trackResponse).toHaveBeenCalledOnce();
		expect(effects.logger.error).not.toHaveBeenCalled();
	});
});

describe("Telegram dispatcher acknowledgement", () => {
	it("acknowledges only after the real approval handler finishes presentation and tracking", async () => {
		let release: () => void = () => {};
		const delivery = new Promise<void>((resolve) => {
			release = resolve;
		});
		effects.editMessage.mockReturnValue(delivery);
		const update = handleTelegramUpdate(
			{ update_id: 1, callback_query: query },
			bot,
		);
		await vi.waitFor(() => expect(effects.editMessage).toHaveBeenCalledOnce());
		expect(effects.persistDecision).toHaveBeenCalledOnce();
		expect(effects.acknowledge).not.toHaveBeenCalled();
		effects.acknowledge.mockImplementation(async () => {
			expect(effects.trackResponse).toHaveBeenCalledOnce();
		});
		release();
		await update;
		expect(effects.acknowledge).toHaveBeenCalledExactlyOnceWith(
			"token",
			"query-1",
		);
	});

	it.each([
		"unlinked",
		"missing request",
		"wrong approver",
		"already processed",
		"decision failure",
		"delivery failure",
		"resolver failure",
		"malformed callback",
	])(
		"acknowledges after the existing success/catch flow for %s",
		async (scenario) => {
			const error = new Error(scenario);
			if (scenario === "unlinked")
				effects.resolveUser.mockResolvedValue({ status: "not_found" });
			if (scenario === "missing request")
				effects.approvalFindFirst.mockResolvedValue(undefined);
			if (scenario === "wrong approver")
				effects.approvalFindFirst.mockResolvedValue(
					request({ approverId: "other-manager" }),
				);
			if (scenario === "already processed")
				effects.approvalFindFirst.mockResolvedValue(
					request({ status: "cancelled" }),
				);
			if (scenario === "decision failure")
				effects.persistDecision.mockRejectedValue(error);
			if (scenario === "delivery failure")
				effects.editMessage.mockRejectedValue(error);
			if (scenario === "resolver failure")
				effects.resolveUser.mockRejectedValue(error);
			await handleTelegramUpdate(
				{
					update_id: 1,
					callback_query:
						scenario === "malformed callback" ? { ...query, data: "{" } : query,
				},
				bot,
			);
			expect(effects.acknowledge).toHaveBeenCalledExactlyOnceWith(
				"token",
				"query-1",
			);
			if (scenario === "resolver failure")
				expect(effects.logger.error).toHaveBeenCalledWith(
					{ error, data: query.data },
					"Failed to parse callback data",
				);
		},
	);

	it("leaves acknowledgement failures with the outer dispatcher catch", async () => {
		const error = new Error("Acknowledgement unavailable");
		effects.acknowledge.mockRejectedValue(error);
		await expect(
			handleTelegramUpdate({ update_id: 1, callback_query: query }, bot),
		).resolves.toBeUndefined();
		expect(effects.trackResponse).toHaveBeenCalledOnce();
		expect(effects.logger.error).toHaveBeenCalledWith(
			{ error, updateId: 1, organizationId: "org-1" },
			"Error handling Telegram update",
		);
	});
});

describe("sendApprovalMessageToManager", () => {
	it("does not send when the approver is outside the approval organization", async () => {
		effects.employeeFindFirst.mockImplementation(
			storedRow("employee", {
				id: "manager-1",
				organizationId: "org-2",
				userId: "user-2",
			}),
		);
		await sendApprovalMessageToManager(
			"approval-1",
			"manager-1",
			"org-1",
			"token",
		);
		expect(effects.approvalFindFirst).not.toHaveBeenCalled();
		expect(effects.getChat).not.toHaveBeenCalled();
		expect(effects.sendMessage).not.toHaveBeenCalled();
	});

	it("does not send an approval from another organization", async () => {
		effects.approvalFindFirst.mockImplementation(
			storedRow("approval_request", request({ organizationId: "org-2" })),
		);
		await sendApprovalMessageToManager(
			"approval-1",
			"manager-1",
			"org-1",
			"token",
		);
		expect(effects.approvalFindFirst).toHaveBeenCalledOnce();
		expect(effects.getChat).not.toHaveBeenCalled();
		expect(effects.sendMessage).not.toHaveBeenCalled();
	});
});
