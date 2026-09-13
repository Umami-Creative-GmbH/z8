import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/lib/effect/errors";
import type { DiscordInteraction, ResolvedDiscordBot } from "./types";
import { InteractionResponseType, InteractionType } from "./types";

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
	interactionResponse: vi.fn(),
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
			discordApprovalMessage: { findFirst: effects.messageFindFirst },
		},
		execute: effects.execute,
		update: () => ({
			set: (values: unknown) => ({
				where: () => effects.trackResponse(values),
			}),
		}),
	},
}));

// Exercise real bot orchestration, inbox loading/eligibility/authorization,
// registry lookup, Effect dispatch, and Discord formatting. Control the domain
// persistence effect; ordinary-owner tests cover exact replay/conflict rules.
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
vi.mock("./user-resolver", () => ({ resolveDiscordUser: effects.resolveUser }));
vi.mock("./api", () => ({
	createInteractionResponse: effects.interactionResponse,
	sendMessage: vi.fn(),
}));
vi.mock("./conversation-manager", () => ({ getChannelIdForUser: vi.fn() }));

import { handleApprovalButtonClick } from "./approval-handler";

const bot: ResolvedDiscordBot = {
	organizationId: "org-1",
	botToken: "bot-token",
	applicationId: "app-1",
	publicKey: "public-key",
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
const interaction: DiscordInteraction = {
	id: "interaction-1",
	application_id: "app-1",
	type: InteractionType.MESSAGE_COMPONENT,
	token: "interaction-token",
	message: { id: "message-1", channel_id: "channel-1" },
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

function act(action: "approve" | "reject" = "approve", payload = interaction) {
	return handleApprovalButtonClick(
		payload,
		{ a: action === "approve" ? "ap" : "rj", id: "approval-1" },
		"discord-user-1",
		bot,
	);
}

// Interpret request equality predicates so removing a scope filter exposes the
// foreign row, rather than having a mock hide a tenancy regression.
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

function expectEphemeral(content: string) {
	expect(effects.interactionResponse).toHaveBeenCalledExactlyOnceWith(
		"interaction-1",
		"interaction-token",
		InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		{ content, flags: 64 },
	);
}

function expectResolved(
	label: "Approved" | "Rejected",
	name = "Morgan Manager",
) {
	expect(effects.interactionResponse).toHaveBeenCalledExactlyOnceWith(
		"interaction-1",
		"interaction-token",
		InteractionResponseType.UPDATE_MESSAGE,
		{
			embeds: [
				expect.objectContaining({
					title:
						label === "Approved"
							? "✅ Approval Approved"
							: "❌ Approval Rejected",
					fields: expect.arrayContaining([
						{ name: `${label} by`, value: name, inline: true },
					]),
				}),
			],
			components: [
				{
					type: 1,
					components: [
						expect.objectContaining({ label: "Approve", disabled: true }),
						expect.objectContaining({ label: "Reject", disabled: true }),
					],
				},
			],
		},
	);
}

describe("Discord approval attempts through the inbox", () => {
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

	it("approves a pending request before acknowledging and tracks the resolved message", async () => {
		effects.persistDecision.mockImplementation(async () => {
			expect(effects.interactionResponse).not.toHaveBeenCalled();
		});
		await act();
		expect(effects.persistDecision).toHaveBeenCalledExactlyOnceWith({
			entityId: "period-1",
			actorEmployeeId: "manager-1",
			action: "approve",
			options: { approvalRequestId: "approval-1" },
		});
		expectResolved("Approved");
		expect(effects.trackResponse).toHaveBeenCalledWith({
			status: "approved",
			respondedAt: expect.any(Date),
		});
		expect(effects.logger.error).not.toHaveBeenCalled();
	});

	it("rejects a pending request with exact Discord attribution", async () => {
		await act("reject");
		expect(effects.persistDecision).toHaveBeenCalledExactlyOnceWith({
			entityId: "period-1",
			actorEmployeeId: "manager-1",
			action: "reject",
			reason: "Rejected via Discord",
			options: { approvalRequestId: "approval-1" },
		});
		expectResolved("Rejected");
		expect(effects.trackResponse).toHaveBeenCalledWith({
			status: "rejected",
			respondedAt: expect.any(Date),
		});
	});

	it("resolves identity before approval reads and responds ephemerally to an unlinked actor", async () => {
		effects.resolveUser.mockImplementation(async () => {
			expect(effects.approvalFindFirst).not.toHaveBeenCalled();
			return { status: "not_found" };
		});
		await act();
		expect(effects.resolveUser).toHaveBeenCalledWith("discord-user-1", "org-1");
		expectEphemeral("Your Discord account is not linked to Z8.");
		expect(effects.approvalFindFirst).not.toHaveBeenCalled();
		expect(effects.persistDecision).not.toHaveBeenCalled();
		expect(effects.logger.warn).toHaveBeenCalledWith(
			{ discordUserId: "discord-user-1" },
			"Unlinked user tried to act on approval",
		);
	});

	it.each(["identity resolution", "unlinked response"])(
		"leaves %s failure outside the attempt catch for the caller to handle",
		async (stage) => {
			const error = new Error(stage);
			if (stage === "identity resolution")
				effects.resolveUser.mockRejectedValue(error);
			else {
				effects.resolveUser.mockResolvedValue({ status: "not_found" });
				effects.interactionResponse.mockRejectedValue(error);
			}
			await expect(act()).rejects.toBe(error);
			expect(effects.approvalFindFirst).not.toHaveBeenCalled();
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

	it.each(["missing", "foreign organization", "foreign id"])(
		"responds not-found for a %s compatibility request",
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
			expectEphemeral("This approval request was not found.");
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.periodFindFirst).not.toHaveBeenCalled();
			expect(effects.trackResponse).not.toHaveBeenCalled();
			expect(effects.logger.warn).toHaveBeenCalledWith(
				{ approvalId: "approval-1" },
				"Approval not found",
			);
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

	it("requires the compatibility request even when a terminal canonical assignment exists", async () => {
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
		expectEphemeral("This approval request was not found.");
		expect(effects.assignmentFindFirst).not.toHaveBeenCalled();
		expect(effects.execute).not.toHaveBeenCalled();
		expect(effects.persistDecision).not.toHaveBeenCalled();
	});

	it("responds unauthorized to a linked employee who is not the assigned approver", async () => {
		effects.approvalFindFirst.mockResolvedValue(
			request({ approverId: "other-manager" }),
		);
		await act();
		expectEphemeral("You are not authorized to act on this approval.");
		expect(effects.persistDecision).not.toHaveBeenCalled();
		expect(effects.trackResponse).not.toHaveBeenCalled();
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
			expect(effects.persistDecision).toHaveBeenCalledExactlyOnceWith({
				entityId: "period-1",
				actorEmployeeId: "manager-1",
				action,
				...(action === "reject" ? { reason: "Rejected via Discord" } : {}),
				options: { approvalRequestId: "approval-1" },
			});
			expectResolved(label);
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
		"keeps %s ineligible targets already processed, including for a linked non-approver",
		async (status, metadata) => {
			for (const approverId of ["manager-1", "other-manager"]) {
				effects.interactionResponse.mockClear();
				effects.approvalFindFirst.mockResolvedValue(
					request({ status, metadata, approverId }),
				);
				await act();
				expectEphemeral("This approval has already been processed.");
			}
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
		expectEphemeral("This approval has already been processed.");
		expect(effects.persistDecision).not.toHaveBeenCalled();
	});

	it.each(["target load", "authoritative reload"])(
		"logs later %s absence without a new not-found response",
		async (stage) => {
			effects.approvalFindFirst
				.mockResolvedValue(undefined)
				.mockResolvedValueOnce(request());
			if (stage === "authoritative reload")
				effects.approvalFindFirst.mockResolvedValueOnce(request());
			await expect(act()).resolves.toBeUndefined();
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.interactionResponse).not.toHaveBeenCalled();
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
			expect(effects.interactionResponse).not.toHaveBeenCalled();
			expect(effects.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.objectContaining({ _tag: "NotFoundError" }),
				}),
				"Failed to process approval action",
			);
		},
	);

	it.each(["initial lookup", "target load", "authoritative reload"])(
		"logs and swallows a %s exception without sending a generic response",
		async (stage) => {
			const error = new Error("Database unavailable");
			effects.approvalFindFirst.mockRejectedValue(error);
			if (stage !== "initial lookup")
				effects.approvalFindFirst.mockResolvedValueOnce(request());
			if (stage === "authoritative reload")
				effects.approvalFindFirst.mockResolvedValueOnce(request());
			await expect(act()).resolves.toBeUndefined();
			expect(effects.persistDecision).not.toHaveBeenCalled();
			expect(effects.interactionResponse).not.toHaveBeenCalled();
			expect(effects.logger.warn).not.toHaveBeenCalled();
			expect(effects.logger.error).toHaveBeenCalledWith(
				{ error, approvalId: "approval-1", action: "approve" },
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
			expect(effects.interactionResponse).not.toHaveBeenCalled();
			expect(effects.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ approvalId: "approval-1" }),
				"Failed to process approval action",
			);
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
		"logs domain failure for %s %s without success presentation",
		async (status, action, error) => {
			effects.approvalFindFirst.mockResolvedValue(request({ status }));
			effects.persistDecision.mockRejectedValue(error);
			await expect(act(action)).resolves.toBeUndefined();
			expect(effects.persistDecision).toHaveBeenCalledOnce();
			expect(effects.interactionResponse).not.toHaveBeenCalled();
			expect(effects.trackResponse).not.toHaveBeenCalled();
			expect(effects.logger.error).toHaveBeenCalledWith(
				{ error, approvalId: "approval-1", action },
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
		expect(effects.interactionResponse).toHaveBeenCalledWith(
			"interaction-1",
			"interaction-token",
			InteractionResponseType.UPDATE_MESSAGE,
			expect.objectContaining({
				embeds: [
					expect.objectContaining({
						fields: expect.arrayContaining([
							{ name: "From", value: "Original Requester", inline: true },
						]),
					}),
				],
			}),
		);
		expect(effects.logger.error).not.toHaveBeenCalled();
	});

	it.each(["message update", "ephemeral fallback"])(
		"keeps the committed decision after %s delivery fails and skips tracking",
		async (delivery) => {
			const committed: string[] = [];
			effects.persistDecision.mockImplementation(
				async ({ action }: { action: string }) => {
					committed.push(action);
				},
			);
			const error = new Error("Discord unavailable");
			effects.interactionResponse.mockImplementation(async () => {
				expect(committed).toEqual(["approve"]);
				throw error;
			});
			await expect(
				act(
					"approve",
					delivery === "message update"
						? interaction
						: { ...interaction, message: undefined },
				),
			).resolves.toBeUndefined();
			expect(committed).toEqual(["approve"]);
			expect(effects.interactionResponse).toHaveBeenCalledOnce();
			expect(effects.logger.info).toHaveBeenCalledWith(
				expect.objectContaining({ action: "approve" }),
				"Approval action processed via Discord",
			);
			expect(effects.logger.error).toHaveBeenCalledWith(
				{ error, approvalId: "approval-1", action: "approve" },
				"Failed to process approval action",
			);
			expect(effects.messageFindFirst).not.toHaveBeenCalled();
			expect(effects.trackResponse).not.toHaveBeenCalled();
		},
	);

	it.each([
		["message", "approve", "Approval approved successfully.", "approved"],
		["requester", "reject", "Approval rejected successfully.", "rejected"],
	] as const)(
		"uses ephemeral success and tracks the decision when presentation has no %s",
		async (missing, action, content, status) => {
			if (missing === "requester")
				effects.employeeFindFirst.mockResolvedValue(undefined);
			effects.trackResponse.mockImplementation(async () => {
				expectEphemeral(content);
			});
			await act(
				action,
				missing === "message"
					? { ...interaction, message: undefined }
					: interaction,
			);
			expect(effects.persistDecision).toHaveBeenCalledOnce();
			expectEphemeral(content);
			expect(effects.trackResponse).toHaveBeenCalledWith({
				status,
				respondedAt: expect.any(Date),
			});
			expect(effects.logger.error).not.toHaveBeenCalled();
		},
	);

	it("uses the unknown-approver fallback and succeeds without a tracking record", async () => {
		effects.employeeFindFirst.mockResolvedValueOnce(undefined);
		effects.messageFindFirst.mockResolvedValue(undefined);
		await act();
		expectResolved("Approved", "Unknown");
		expect(effects.trackResponse).not.toHaveBeenCalled();
		expect(effects.logger.error).not.toHaveBeenCalled();
	});

	it("logs a tracking failure after the success response without sending another acknowledgement", async () => {
		const error = new Error("Tracking unavailable");
		effects.trackResponse.mockRejectedValue(error);
		await expect(act()).resolves.toBeUndefined();
		expectResolved("Approved");
		expect(effects.persistDecision).toHaveBeenCalledOnce();
		expect(effects.logger.error).toHaveBeenCalledWith(
			{ error, approvalId: "approval-1", action: "approve" },
			"Failed to process approval action",
		);
	});
});
