import { TestAdapter, TurnContext } from "botbuilder";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/lib/effect/errors";
import type { ResolvedTeamsUser, ResolvedTenant } from "./types";
import { TeamsError } from "./types";

const effects = vi.hoisted(() => ({
	approvalFindFirst: vi.fn(),
	periodFindFirst: vi.fn(),
	assignmentFindFirst: vi.fn(),
	execute: vi.fn(),
	employeeFindFirst: vi.fn(),
	timeEntryFindFirst: vi.fn(),
	cardFindFirst: vi.fn(),
	trackResponse: vi.fn(),
	persistDecision: vi.fn(),
	getStoredConversation: vi.fn(),
	getUserLocale: vi.fn(),
	getBotTranslate: vi.fn(),
	updateMessage: vi.fn(),
	sendActivity: vi.fn(),
	resolveTenant: vi.fn(),
	resolveTeamsUser: vi.fn(),
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: { findFirst: effects.approvalFindFirst },
			workPeriod: { findFirst: effects.periodFindFirst },
			timeEntry: {
				findFirst: effects.timeEntryFindFirst,
				findMany: vi.fn(async () => []),
			},
			approvalStageAssignment: { findFirst: effects.assignmentFindFirst },
			employee: { findFirst: effects.employeeFindFirst },
			teamsApprovalCard: { findFirst: effects.cardFindFirst },
		},
		execute: effects.execute,
		update: () => ({
			set: (values: unknown) => ({
				where: (where: SQL) => effects.trackResponse(values, where),
			}),
		}),
	},
}));

// Keep bot orchestration, inbox loading/eligibility/authorization, registry
// lookup, Effect dispatch, and card formatting real. Control domain persistence;
// ordinary-owner tests separately verify exact replay/conflict rules.
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
vi.mock("@/lib/bot-platform/i18n", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/bot-platform/i18n")>()),
	getUserLocale: effects.getUserLocale,
	getBotTranslate: effects.getBotTranslate,
}));
vi.mock("./bot-adapter", () => ({ updateMessage: effects.updateMessage }));
vi.mock("./conversation-manager", () => ({
	getStoredConversation: effects.getStoredConversation,
	deactivateConversation: vi.fn(),
	saveConversationReference: vi.fn(),
}));
vi.mock("./tenant-resolver", () => ({
	resolveTenant: effects.resolveTenant,
	updateTenantServiceUrl: vi.fn(),
}));
vi.mock("./user-resolver", () => ({
	resolveTeamsUser: effects.resolveTeamsUser,
}));
vi.mock("./shift-pickup-handler", () => ({ handleShiftPickupAction: vi.fn() }));
vi.mock("@/lib/bot-platform/command-registry", () => ({
	executeCommand: vi.fn(),
	parseCommand: vi.fn(),
}));

import { handleApprovalAction } from "./approval-handler";
import { handleBotActivity } from "./bot-handler";

const tenant: ResolvedTenant = {
	tenantId: "tenant-1",
	tenantName: "Team",
	organizationId: "org-1",
	setupStatus: "completed",
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: false,
	enableEscalations: false,
	digestTime: "09:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
	serviceUrl: "https://teams.example.com",
};
const user: ResolvedTeamsUser = {
	userId: "user-1",
	employeeId: "manager-1",
	organizationId: "org-1",
	teamsUserId: "teams-user-1",
	teamsEmail: "morgan@example.com",
	teamsTenantId: "tenant-1",
	isNewMapping: false,
};
const context = new TurnContext(new TestAdapter(), { type: "invoke" });
const conversationReference = { conversation: { id: "conversation-1" } };

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

function act(action: "approve" | "reject" = "approve") {
	return handleApprovalAction(context, "approval-1", action, user, tenant);
}

// Honor actual equality predicates so removing a scope filter exposes the
// foreign row, rather than letting the persistence double hide the regression.
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

function expectResolved(
	status: "approved" | "rejected",
	name = "Morgan Manager",
) {
	expect(effects.updateMessage).toHaveBeenCalledWith(
		conversationReference,
		"activity-1",
		{
			type: "message",
			text: status === "approved" ? "Approval approved" : "Approval rejectd",
			attachments: [
				{
					contentType: "application/vnd.microsoft.card.adaptive",
					content: expect.objectContaining({
						type: "AdaptiveCard",
						body: expect.arrayContaining([
							expect.objectContaining({
								type: "FactSet",
								facts: expect.arrayContaining([
									{
										title: "Status",
										value: status === "approved" ? "APPROVED" : "REJECTED",
									},
									{
										title:
											status === "approved" ? "Approved by" : "Rejected by",
										value: name,
									},
								]),
							}),
						]),
					}),
				},
			],
		},
	);
}

function expectNoDecisionOrPresentation() {
	expect(effects.persistDecision).not.toHaveBeenCalled();
	expect(effects.updateMessage).not.toHaveBeenCalled();
	expect(effects.trackResponse).not.toHaveBeenCalled();
	expect(effects.sendActivity).not.toHaveBeenCalled();
}

describe("Teams approval attempts through the inbox", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.spyOn(context, "sendActivity").mockImplementation(effects.sendActivity);
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
		effects.cardFindFirst.mockResolvedValue({
			id: "card-1",
			teamsActivityId: "activity-1",
		});
		effects.getStoredConversation.mockResolvedValue({ conversationReference });
		effects.getUserLocale.mockResolvedValue("en");
		effects.getBotTranslate.mockResolvedValue(
			(_key: string, fallback: string) => fallback,
		);
		effects.persistDecision.mockResolvedValue(undefined);
	});

	it("approves a pending request before updating its stored card, tracking, and confirming", async () => {
		effects.persistDecision.mockImplementation(async () => {
			expect(effects.updateMessage).not.toHaveBeenCalled();
			expect(effects.sendActivity).not.toHaveBeenCalled();
		});
		await act();
		expect(effects.persistDecision).toHaveBeenCalledExactlyOnceWith({
			entityId: "period-1",
			actorEmployeeId: "manager-1",
			action: "approve",
			options: { approvalRequestId: "approval-1" },
		});
		expectResolved("approved");
		expect(effects.getStoredConversation).toHaveBeenCalledExactlyOnceWith(
			"user-1",
			"org-1",
		);
		expect(effects.getUserLocale).toHaveBeenCalledExactlyOnceWith("user-1");
		expect(effects.getBotTranslate).toHaveBeenCalledExactlyOnceWith("en");
		expect(effects.trackResponse).toHaveBeenCalledWith(
			{
				status: "approved",
				respondedAt: expect.any(Date),
			},
			expect.anything(),
		);
		expect(effects.sendActivity).toHaveBeenCalledExactlyOnceWith(
			"Request approved successfully.",
		);
		expect(effects.logger.error).not.toHaveBeenCalled();
	});

	it("rejects a pending request with exact Teams attribution", async () => {
		await act("reject");
		expect(effects.persistDecision).toHaveBeenCalledExactlyOnceWith({
			entityId: "period-1",
			actorEmployeeId: "manager-1",
			action: "reject",
			reason: "Rejected via Teams",
			options: { approvalRequestId: "approval-1" },
		});
		expectResolved("rejected");
		expect(effects.trackResponse).toHaveBeenCalledWith(
			{
				status: "rejected",
				respondedAt: expect.any(Date),
			},
			expect.anything(),
		);
		expect(effects.sendActivity).toHaveBeenCalledExactlyOnceWith(
			"Request rejected successfully.",
		);
	});

	it.each(["missing", "foreign organization", "foreign id"])(
		"throws Teams not-found for a %s compatibility request",
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
			await expect(act()).rejects.toMatchObject({
				name: "TeamsError",
				code: "APPROVAL_NOT_FOUND",
				message: "Approval not found",
			});
			expectNoDecisionOrPresentation();
			expect(effects.periodFindFirst).not.toHaveBeenCalled();
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
		await expect(act()).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" });
		expect(effects.assignmentFindFirst).not.toHaveBeenCalled();
		expect(effects.execute).not.toHaveBeenCalled();
		expectNoDecisionOrPresentation();
	});

	it("throws Teams unauthorized for a linked employee who is not the assigned approver", async () => {
		effects.approvalFindFirst.mockResolvedValue(
			request({ approverId: "other-manager" }),
		);
		await expect(act()).rejects.toMatchObject({
			name: "TeamsError",
			code: "NOT_AUTHORIZED",
			message: "Not authorized to approve",
		});
		expectNoDecisionOrPresentation();
	});

	it.each([
		["approved", "manual_time_submission", "approve"],
		["rejected", "manual_time_submission", "reject"],
		["approved", "policy_clock_out", "approve"],
		["rejected", "policy_clock_out", "reject"],
	] as const)(
		"repeats success presentation for a successful %s %s replay",
		async (status, kind, action) => {
			effects.approvalFindFirst.mockResolvedValue(
				request({ status, metadata: { timeRequest: { kind } } }),
			);
			await act(action);
			await act(action);
			expect(effects.persistDecision).toHaveBeenCalledTimes(2);
			expect(effects.persistDecision).toHaveBeenCalledWith({
				entityId: "period-1",
				actorEmployeeId: "manager-1",
				action,
				...(action === "reject" ? { reason: "Rejected via Teams" } : {}),
				options: { approvalRequestId: "approval-1" },
			});
			expectResolved(status);
			expect(effects.updateMessage).toHaveBeenCalledTimes(2);
			expect(effects.trackResponse).toHaveBeenCalledTimes(2);
			expect(effects.sendActivity.mock.calls).toEqual([
				[`Request ${status} successfully.`],
				[`Request ${status} successfully.`],
			]);
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
		"keeps %s ineligible targets already resolved before comparing the approver",
		async (status, metadata) => {
			for (const approverId of ["manager-1", "other-manager"]) {
				effects.approvalFindFirst.mockResolvedValue(
					request({ status, metadata, approverId }),
				);
				await expect(act()).rejects.toMatchObject({
					name: "TeamsError",
					code: "APPROVAL_ALREADY_RESOLVED",
					message: "Approval already resolved",
				});
			}
			expectNoDecisionOrPresentation();
		},
	);

	it("fails closed for terminal ordinary metadata when its scoped period is missing", async () => {
		effects.approvalFindFirst.mockResolvedValue(
			request({ status: "approved" }),
		);
		effects.periodFindFirst.mockResolvedValue(undefined);
		await expect(act()).rejects.toMatchObject({
			code: "APPROVAL_ALREADY_RESOLVED",
		});
		expectNoDecisionOrPresentation();
	});

	it.each(["target load", "authoritative reload"])(
		"translates later %s absence into a generic bot error rather than initial not-found",
		async (stage) => {
			effects.approvalFindFirst
				.mockResolvedValue(undefined)
				.mockResolvedValueOnce(request());
			if (stage === "authoritative reload")
				effects.approvalFindFirst.mockResolvedValueOnce(request());
			await expect(act()).rejects.toMatchObject({
				name: "TeamsError",
				code: "BOT_ERROR",
				message: "Failed to process approval",
				details: { originalError: "Approval not found" },
			});
			expectNoDecisionOrPresentation();
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
			await expect(act()).rejects.toMatchObject({
				code: "BOT_ERROR",
				details: { originalError: "Approval not found" },
			});
			expectNoDecisionOrPresentation();
		},
	);

	it.each(["initial lookup", "target load", "authoritative reload"])(
		"translates a %s exception into the existing generic bot error",
		async (stage) => {
			effects.approvalFindFirst.mockRejectedValue(
				new Error("Database unavailable"),
			);
			if (stage !== "initial lookup")
				effects.approvalFindFirst.mockResolvedValueOnce(request());
			if (stage === "authoritative reload")
				effects.approvalFindFirst.mockResolvedValueOnce(request());
			await expect(act()).rejects.toMatchObject({
				name: "TeamsError",
				code: "BOT_ERROR",
				message: "Failed to process approval",
				details: { originalError: "Database unavailable" },
			});
			expectNoDecisionOrPresentation();
		},
	);

	it.each([{ approverId: "new-manager" }, { status: "cancelled" }])(
		"uses authoritative reload to prevent a stale decision after %j",
		async (change) => {
			effects.approvalFindFirst
				.mockResolvedValue(request(change))
				.mockResolvedValueOnce(request())
				.mockResolvedValueOnce(request());
			await expect(act()).rejects.toMatchObject({ code: "BOT_ERROR" });
			expectNoDecisionOrPresentation();
		},
	);

	it.each([
		["pending", "approve", new Error("Decision persistence failed")],
		[
			"approved",
			"reject",
			new ConflictError({
				message: "Conflicting ordinary replay",
				conflictType: "approval_transition",
			}),
		],
	] as const)(
		"translates domain failure for %s %s without success presentation",
		async (status, action, error) => {
			effects.approvalFindFirst.mockResolvedValue(request({ status }));
			effects.persistDecision.mockRejectedValue(error);
			await expect(act(action)).rejects.toMatchObject({
				code: "BOT_ERROR",
				details: { originalError: error.message },
			});
			expect(effects.persistDecision).toHaveBeenCalledOnce();
			expect(effects.updateMessage).not.toHaveBeenCalled();
			expect(effects.trackResponse).not.toHaveBeenCalled();
			expect(effects.sendActivity).not.toHaveBeenCalled();
		},
	);

	it("preserves an existing Teams error instance and details from the decision", async () => {
		const error = new TeamsError("Existing Teams failure", "NOT_AUTHORIZED", {
			source: "domain",
		});
		effects.persistDecision.mockRejectedValue(error);
		await expect(act()).rejects.toBe(error);
		expect(effects.updateMessage).not.toHaveBeenCalled();
		expect(effects.sendActivity).not.toHaveBeenCalled();
	});

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
			conversationReference,
			"activity-1",
			expect.objectContaining({
				attachments: [
					expect.objectContaining({
						content: expect.objectContaining({
							body: expect.arrayContaining([
								expect.objectContaining({
									type: "FactSet",
									facts: expect.arrayContaining([
										{ title: "From", value: "Original Requester" },
									]),
								}),
							]),
						}),
					}),
				],
			}),
		);
		const [entryQuery] = effects.timeEntryFindFirst.mock.calls[0];
		expect(new PgDialect().sqlToQuery(entryQuery.where).params).toEqual([
			"period-1",
		]);
	});

	it("still tracks and confirms a committed decision when the remote card update fails", async () => {
		const committed: string[] = [];
		effects.persistDecision.mockImplementation(
			async ({ action }: { action: string }) => {
				committed.push(action);
			},
		);
		const error = new Error("Teams unavailable");
		effects.updateMessage.mockImplementation(async () => {
			expect(committed).toEqual(["approve"]);
			throw error;
		});
		effects.trackResponse.mockImplementation(
			async (_values: unknown, where: SQL) => {
				expect(effects.updateMessage).toHaveBeenCalledOnce();
				expect(effects.sendActivity).not.toHaveBeenCalled();
				expect(new PgDialect().sqlToQuery(where).params).toEqual(["card-1"]);
			},
		);
		await expect(act()).resolves.toBeUndefined();
		expect(committed).toEqual(["approve"]);
		expect(effects.logger.warn).toHaveBeenCalledWith(
			{ error, approvalId: "approval-1" },
			"Failed to update Teams card",
		);
		expect(effects.trackResponse).toHaveBeenCalledWith(
			{ status: "approved", respondedAt: expect.any(Date) },
			expect.anything(),
		);
		expect(effects.sendActivity).toHaveBeenCalledExactlyOnceWith(
			"Request approved successfully.",
		);
		expect(effects.logger.error).not.toHaveBeenCalled();
	});

	it.each(["conversation lookup", "tracking", "confirmation"])(
		"keeps the committed decision but propagates a generic bot error for a post-decision %s failure",
		async (stage) => {
			const committed: string[] = [];
			effects.persistDecision.mockImplementation(
				async ({ action }: { action: string }) => {
					committed.push(action);
				},
			);
			const error = new Error(`${stage} unavailable`);
			if (stage === "conversation lookup")
				effects.getStoredConversation.mockRejectedValue(error);
			if (stage === "tracking") effects.trackResponse.mockRejectedValue(error);
			if (stage === "confirmation")
				effects.sendActivity.mockRejectedValue(error);
			await expect(act()).rejects.toMatchObject({
				code: "BOT_ERROR",
				details: { originalError: error.message },
			});
			expect(committed).toEqual(["approve"]);
			if (stage !== "confirmation")
				expect(effects.sendActivity).not.toHaveBeenCalled();
			if (stage === "conversation lookup") {
				expect(effects.updateMessage).not.toHaveBeenCalled();
				expect(effects.trackResponse).not.toHaveBeenCalled();
			}
		},
	);

	it.each(["card", "activity id", "conversation", "requester"])(
		"still confirms success when presentation has no %s",
		async (missing) => {
			if (missing === "card")
				effects.cardFindFirst.mockResolvedValue(undefined);
			if (missing === "activity id")
				effects.cardFindFirst.mockResolvedValue({
					id: "card-1",
					teamsActivityId: null,
				});
			if (missing === "conversation")
				effects.getStoredConversation.mockResolvedValue(undefined);
			if (missing === "requester")
				effects.employeeFindFirst
					.mockResolvedValueOnce({ user: { name: "Morgan Manager" } })
					.mockResolvedValue(undefined);
			await act();
			expect(effects.persistDecision).toHaveBeenCalledOnce();
			expect(effects.updateMessage).not.toHaveBeenCalled();
			if (missing === "card" || missing === "activity id")
				expect(effects.trackResponse).not.toHaveBeenCalled();
			else expect(effects.trackResponse).toHaveBeenCalledOnce();
			expect(effects.sendActivity).toHaveBeenCalledExactlyOnceWith(
				"Request approved successfully.",
			);
		},
	);

	it("uses the unknown-approver fallback", async () => {
		effects.employeeFindFirst.mockResolvedValueOnce(undefined);
		await act();
		expectResolved("approved", "Unknown");
		expect(effects.sendActivity).toHaveBeenCalledExactlyOnceWith(
			"Request approved successfully.",
		);
	});

	describe("Teams caller ownership of identity and invoke responses", () => {
		function invoke() {
			const invokeContext = new TurnContext(new TestAdapter(), {
				type: "invoke",
				conversation: {
					id: "conversation-1",
					tenantId: "tenant-1",
					isGroup: false,
					name: "Manager",
					conversationType: "personal",
				},
				from: {
					id: "channel-user-1",
					name: "Morgan Manager",
					aadObjectId: "teams-user-1",
				},
				value: { action: "approve", approvalId: "approval-1" },
			});
			vi.spyOn(invokeContext, "sendActivity").mockImplementation(
				effects.sendActivity,
			);
			return handleBotActivity(invokeContext);
		}

		beforeEach(() => {
			effects.resolveTenant.mockResolvedValue({ status: "configured", tenant });
			effects.resolveTeamsUser.mockResolvedValue({ status: "found", user });
		});

		it.each(["not_linked", "no_employee"])(
			"owns the 401 invoke response for a %s actor before approval reads",
			async (status) => {
				effects.resolveTenant.mockImplementation(async () => {
					expect(effects.resolveTeamsUser).not.toHaveBeenCalled();
					expect(effects.approvalFindFirst).not.toHaveBeenCalled();
					return { status: "configured", tenant };
				});
				effects.resolveTeamsUser.mockImplementation(async () => {
					expect(effects.resolveTenant).toHaveBeenCalledExactlyOnceWith(
						"tenant-1",
					);
					expect(effects.approvalFindFirst).not.toHaveBeenCalled();
					return { status };
				});
				await invoke();
				expect(effects.resolveTeamsUser).toHaveBeenCalledExactlyOnceWith(
					"teams-user-1",
					null,
					"tenant-1",
				);
				expect(effects.approvalFindFirst).not.toHaveBeenCalled();
				expect(effects.persistDecision).not.toHaveBeenCalled();
				expect(effects.sendActivity).toHaveBeenCalledExactlyOnceWith({
					type: "invokeResponse",
					value: { status: 401 },
				});
			},
		);

		it("rejects an unconfigured tenant before actor or approval resolution", async () => {
			effects.resolveTenant.mockResolvedValue({
				status: "unconfigured",
				tenantId: "tenant-1",
			});
			await invoke();
			expect(effects.resolveTeamsUser).not.toHaveBeenCalled();
			expect(effects.approvalFindFirst).not.toHaveBeenCalled();
			expect(effects.sendActivity).toHaveBeenCalledExactlyOnceWith({
				type: "invokeResponse",
				value: { status: 403 },
			});
		});

		it.each(["success", "card update failure"])(
			"sends its 200 invoke response after handler confirmation on %s",
			async (scenario) => {
				if (scenario === "card update failure")
					effects.updateMessage.mockRejectedValue(
						new Error("Teams unavailable"),
					);
				effects.approvalFindFirst.mockImplementation(async (query) => {
					expect(effects.resolveTeamsUser).toHaveBeenCalledExactlyOnceWith(
						"teams-user-1",
						null,
						"tenant-1",
					);
					return storedRequest(request())(query);
				});
				await invoke();
				expect(effects.persistDecision).toHaveBeenCalledOnce();
				expect(effects.trackResponse).toHaveBeenCalledOnce();
				expect(effects.sendActivity.mock.calls).toEqual([
					["Request approved successfully."],
					[{ type: "invokeResponse", value: { status: 200 } }],
				]);
			},
		);

		it.each([
			[
				"missing",
				"This approval request no longer exists or has already been processed.",
			],
			["ineligible", "This approval has already been approved or rejected."],
			["unauthorized", "You're not authorized to perform this action."],
			["decision exception", "Something went wrong. Please try again."],
			["tracking exception", "Something went wrong. Please try again."],
		])(
			"owns user-facing %s error translation and does not emit a success invoke response",
			async (scenario, message) => {
				if (scenario === "missing")
					effects.approvalFindFirst.mockResolvedValue(undefined);
				if (scenario === "ineligible")
					effects.approvalFindFirst.mockResolvedValue(
						request({ status: "cancelled" }),
					);
				if (scenario === "unauthorized")
					effects.approvalFindFirst.mockResolvedValue(
						request({ approverId: "other-manager" }),
					);
				if (scenario === "decision exception")
					effects.persistDecision.mockRejectedValue(
						new Error("Decision failed"),
					);
				if (scenario === "tracking exception")
					effects.trackResponse.mockRejectedValue(new Error("Tracking failed"));
				await invoke();
				expect(effects.sendActivity).toHaveBeenCalledExactlyOnceWith(message);
				if (scenario === "tracking exception")
					expect(effects.persistDecision).toHaveBeenCalledOnce();
			},
		);
	});
});
