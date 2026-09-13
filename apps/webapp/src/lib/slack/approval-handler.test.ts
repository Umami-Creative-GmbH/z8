import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/lib/effect/errors";
import type { ResolvedSlackBot, SlackInteractionPayload } from "./types";

const effects = vi.hoisted(() => ({
	approvalFindFirst: vi.fn(),
	periodFindFirst: vi.fn(),
	assignmentFindFirst: vi.fn(),
	execute: vi.fn(),
	employeeFindFirst: vi.fn(),
	messageFindFirst: vi.fn(),
	trackResponse: vi.fn(),
	persistDecision: vi.fn(),
	resolveUser: vi.fn(),
	updateMessage: vi.fn(),
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
			slackApprovalMessage: { findFirst: effects.messageFindFirst },
		},
		execute: effects.execute,
		update: () => ({
			set: (values: unknown) => ({
				where: () => effects.trackResponse(values),
			}),
		}),
	},
}));

// Keep bot orchestration, inbox loading/eligibility/authorization, registry lookup,
// and Effect dispatch real. The registered domain effect is controlled here;
// exact replay/conflict rules remain covered by the ordinary owner tests.
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
vi.mock("./user-resolver", () => ({ resolveSlackUser: effects.resolveUser }));
vi.mock("./api", () => ({
	openConversation: vi.fn(),
	postMessage: vi.fn(),
	updateMessage: effects.updateMessage,
}));
vi.mock("./conversation-manager", () => ({ getChannelIdForUser: vi.fn() }));

import { handleApprovalAction } from "./approval-handler";

const bot: ResolvedSlackBot = {
	organizationId: "org-1",
	botAccessToken: "token",
	slackTeamId: "team-1",
	slackTeamName: "Team",
	botUserId: "bot-1",
	setupStatus: "completed",
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: false,
	enableEscalations: false,
	digestTime: "09:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
};
const payload: SlackInteractionPayload = {
	type: "block_actions",
	user: { id: "slack-user-1" },
	team: { id: "team-1" },
	channel: { id: "channel-1" },
	message: { ts: "message-1" },
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

function act(action: "approve" | "reject" = "approve", interaction = payload) {
	return handleApprovalAction(
		interaction,
		{
			action_id: `approval_${action}`,
			value: "approval-1",
		},
		"slack-user-1",
		bot,
	);
}

// Interpret the two equality filters used for compatibility requests, so a
// missing organization predicate would expose the foreign row and fail the test.
function storedRequest(row: ReturnType<typeof request>) {
	return async ({ where }: { where: SQL }) => {
		const query = new PgDialect().sqlToQuery(where);
		for (const [column, value] of [
			["id", row.id],
			["organization_id", row.organizationId],
		]) {
			const parameter = query.sql.match(
				new RegExp(`"approval_request"\\."${column}" = \\$(\\d+)`),
			);
			if (parameter && query.params[Number(parameter[1]) - 1] !== value)
				return undefined;
		}
		return row;
	};
}

describe("Slack approval attempts through the inbox", () => {
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
		effects.approvalFindFirst.mockImplementation(storedRequest(request()));
		effects.periodFindFirst.mockResolvedValue({
			pendingChanges: null,
			clockInId: null,
			clockOutId: null,
		});
		effects.execute.mockResolvedValue({ rows: [] });
		effects.employeeFindFirst.mockResolvedValue({
			user: { name: "Morgan Manager", email: "morgan@example.com" },
		});
		effects.messageFindFirst.mockResolvedValue({ id: "message-record-1" });
		effects.persistDecision.mockResolvedValue(undefined);
	});

	it("approves a pending request and presents and tracks the committed decision", async () => {
		await act();

		expect(effects.persistDecision).toHaveBeenCalledWith({
			entityId: "period-1",
			actorEmployeeId: "manager-1",
			action: "approve",
			options: { approvalRequestId: "approval-1" },
		});
		expect(effects.updateMessage).toHaveBeenCalledWith(
			"token",
			expect.objectContaining({
				channel: "channel-1",
				ts: "message-1",
				text: expect.stringContaining("Approved"),
			}),
		);
		expect(effects.trackResponse).toHaveBeenCalledWith({
			status: "approved",
			respondedAt: expect.any(Date),
		});
		expect(effects.logger.error).not.toHaveBeenCalled();
	});

	it("rejects a pending request with exact Slack attribution", async () => {
		await act("reject");
		expect(effects.persistDecision).toHaveBeenCalledWith({
			entityId: "period-1",
			actorEmployeeId: "manager-1",
			action: "reject",
			reason: "Rejected via Slack",
			options: { approvalRequestId: "approval-1" },
		});
		expect(effects.updateMessage).toHaveBeenCalledWith(
			"token",
			expect.objectContaining({ text: "Rejected by Morgan Manager" }),
		);
		expect(effects.trackResponse).toHaveBeenCalledWith({
			status: "rejected",
			respondedAt: expect.any(Date),
		});
	});

	it("silently exits before identity or approval reads when the payload has no target", async () => {
		await handleApprovalAction(
			payload,
			{ action_id: "approval_approve" },
			"slack-user-1",
			bot,
		);
		expect(effects.resolveUser).not.toHaveBeenCalled();
		expect(effects.approvalFindFirst).not.toHaveBeenCalled();
		expect(effects.persistDecision).not.toHaveBeenCalled();
		expect(effects.updateMessage).not.toHaveBeenCalled();
	});

	it("resolves identity before any approval reads and silently exits for an unlinked actor", async () => {
		effects.resolveUser.mockImplementation(async () => {
			expect(effects.approvalFindFirst).not.toHaveBeenCalled();
			return { status: "not_found" };
		});
		await act();
		expect(effects.resolveUser).toHaveBeenCalledWith("slack-user-1", "team-1");
		expect(effects.approvalFindFirst).not.toHaveBeenCalled();
		expect(effects.persistDecision).not.toHaveBeenCalled();
		expect(effects.updateMessage).not.toHaveBeenCalled();
		expect(effects.logger.warn).toHaveBeenCalledWith(
			{ slackUserId: "slack-user-1" },
			"Unlinked user tried to act on approval",
		);
	});

	it.each(["missing", "foreign organization", "foreign id"])(
		"silently exits for a %s compatibility request",
		async (scenario) => {
			if (scenario === "missing")
				effects.approvalFindFirst.mockResolvedValue(undefined);
			else
				effects.approvalFindFirst.mockImplementation(
					storedRequest(
						request(
							scenario === "foreign organization"
								? { organizationId: "org-2" }
								: { id: "approval-2" },
						),
					),
				);
			await act();
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.updateMessage).not.toHaveBeenCalled();
			expect(effects.periodFindFirst).not.toHaveBeenCalled();
			expect(effects.logger.warn).toHaveBeenCalledWith(
				{ approvalId: "approval-1" },
				"Approval not found",
			);
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

	it("requires a compatibility request even when a terminal canonical assignment exists", async () => {
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
		expect(effects.updateMessage).not.toHaveBeenCalled();
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
		expect(effects.updateMessage).not.toHaveBeenCalled();
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
					...(action === "reject" ? { reason: "Rejected via Slack" } : {}),
				}),
			);
			expect(effects.updateMessage).toHaveBeenCalledWith(
				"token",
				expect.objectContaining({ text: `${label} by Morgan Manager` }),
			);
			expect(effects.trackResponse).toHaveBeenCalledWith({
				status,
				respondedAt: expect.any(Date),
			});
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
		"keeps %s ineligible targets already processed before comparing the approver",
		async (status, metadata) => {
			effects.approvalFindFirst.mockResolvedValue(
				request({ status, metadata, approverId: "other-manager" }),
			);
			await act();
			expect(effects.updateMessage).toHaveBeenCalledWith("token", {
				channel: "channel-1",
				ts: "message-1",
				text: "This approval has already been processed.",
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
		expect(effects.updateMessage).toHaveBeenCalledWith(
			"token",
			expect.objectContaining({
				text: "This approval has already been processed.",
			}),
		);
	});

	it.each(["channel", "message"] as const)(
		"silently exits an already processed request without a %s",
		async (field) => {
			effects.approvalFindFirst.mockResolvedValue(
				request({ status: "cancelled" }),
			);
			await act("approve", { ...payload, [field]: undefined });
			expect(effects.updateMessage).not.toHaveBeenCalled();
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

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
			expect(effects.updateMessage).not.toHaveBeenCalled();
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
				.mockImplementation(storedRequest(request({ organizationId: "org-2" })))
				.mockResolvedValueOnce(request());
			if (stage === "authoritative reload")
				effects.approvalFindFirst.mockResolvedValueOnce(request());
			await act();
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.updateMessage).not.toHaveBeenCalled();
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
			expect(effects.updateMessage).not.toHaveBeenCalled();
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
		"logs domain decision failure without success presentation: %s",
		async (error) => {
			effects.approvalFindFirst.mockResolvedValue(
				request({ status: "approved" }),
			);
			effects.persistDecision.mockRejectedValue(error);
			await act();
			expect(effects.persistDecision).toHaveBeenCalledOnce();
			expect(effects.updateMessage).not.toHaveBeenCalled();
			expect(effects.trackResponse).not.toHaveBeenCalled();
			expect(effects.logger.error).toHaveBeenCalledWith(
				{ error, approvalId: "approval-1", action: "approve" },
				"Failed to process approval action",
			);
		},
	);

	it("hands presentation the original request while dispatch uses the authoritative target", async () => {
		effects.approvalFindFirst
			.mockResolvedValue(
				request({ requestedBy: "employee-2", entityId: "period-2" }),
			)
			.mockResolvedValueOnce(request());
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
		await act();
		expect(effects.persistDecision).toHaveBeenCalledWith(
			expect.objectContaining({ entityId: "period-2" }),
		);
		expect(effects.updateMessage).toHaveBeenCalledWith(
			"token",
			expect.objectContaining({
				blocks: expect.arrayContaining([
					expect.objectContaining({
						type: "section",
						fields: expect.arrayContaining([
							{ type: "mrkdwn", text: "*From:*\nOriginal Requester" },
						]),
					}),
				]),
			}),
		);
		expect(effects.logger.error).not.toHaveBeenCalled();
	});

	it("keeps a committed decision when Slack delivery fails and skips response tracking", async () => {
		const committed: string[] = [];
		effects.persistDecision.mockImplementation(
			async ({ action }: { action: string }) => {
				committed.push(action);
			},
		);
		const error = new Error("Slack unavailable");
		effects.updateMessage.mockImplementation(async () => {
			expect(committed).toEqual(["approve"]);
			throw error;
		});
		await expect(act()).resolves.toBeUndefined();
		expect(committed).toEqual(["approve"]);
		expect(effects.logger.info).toHaveBeenCalledWith(
			expect.objectContaining({ action: "approve" }),
			"Approval action processed via Slack",
		);
		expect(effects.logger.error).toHaveBeenCalledWith(
			{ error, approvalId: "approval-1", action: "approve" },
			"Failed to process approval action",
		);
		expect(effects.messageFindFirst).not.toHaveBeenCalled();
		expect(effects.trackResponse).not.toHaveBeenCalled();
	});

	it.each(["channel", "message", "requester"] as const)(
		"still tracks success when presentation has no %s",
		async (missing) => {
			if (missing === "requester")
				effects.employeeFindFirst.mockResolvedValue(undefined);
			await act(
				"approve",
				missing === "requester"
					? payload
					: { ...payload, [missing]: undefined },
			);
			expect(effects.persistDecision).toHaveBeenCalledOnce();
			expect(effects.updateMessage).not.toHaveBeenCalled();
			expect(effects.trackResponse).toHaveBeenCalledWith({
				status: "approved",
				respondedAt: expect.any(Date),
			});
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

	it("uses the unknown-approver fallback and succeeds without a tracking record", async () => {
		effects.employeeFindFirst.mockResolvedValueOnce(undefined);
		effects.messageFindFirst.mockResolvedValue(undefined);
		await act();
		expect(effects.updateMessage).toHaveBeenCalledWith(
			"token",
			expect.objectContaining({ text: "Approved by Unknown" }),
		);
		expect(effects.trackResponse).not.toHaveBeenCalled();
		expect(effects.logger.error).not.toHaveBeenCalled();
	});
});
