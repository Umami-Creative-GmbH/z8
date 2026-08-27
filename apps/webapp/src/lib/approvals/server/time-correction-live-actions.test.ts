import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	db: null as unknown,
	session: null as unknown,
	workflowRuntime: null as unknown,
	requestRow: null as Record<string, unknown> | null,
	processApprovalWithCurrentEmployee: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret-value-with-at-least-32-characters",
		SCIM_CREDENTIAL_HASH_SECRET: "test-scim-credential-hash-secret-value",
		NODE_ENV: "test",
		NEXT_PHASE: undefined,
		CI: "false",
	},
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	const { DatabaseService } = await import(
		"@/lib/effect/services/database.service"
	);
	const AppLayer = Layer.merge(
		Layer.succeed(
			AuthService,
			AuthService.of({
				getSession: () => Effect.succeed(state.session as never),
			}),
		),
		Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				get db() {
					return state.db as never;
				},
				query: (_name, operation) =>
					Effect.tryPromise({
						try: operation,
						catch: (cause) => cause as never,
					}),
			}),
		),
	);
	return {
		AppLayer,
		runtime: { runPromiseExit: Effect.runPromiseExit },
	};
});

vi.mock("@/lib/approvals/workflow/runtime", () => ({
	createProductionApprovalWorkflowRuntime: () => state.workflowRuntime,
}));

vi.mock("@/lib/approvals/server/shared", () => ({
	processApprovalWithCurrentEmployee: state.processApprovalWithCurrentEmployee,
}));

vi.mock("@/lib/notifications/triggers", () => ({
	onTimeCorrectionApproved: vi.fn(),
	onTimeCorrectionRejected: vi.fn(),
}));

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: vi.fn(),
}));

const { approveTimeCorrectionEffect, rejectTimeCorrectionEffect } =
	await import("./time-correction-approvals");

const actor = {
	id: "31000000-0000-4000-8000-000000000902",
	userId: "user-manager",
	organizationId: "org-1",
	isActive: true,
	user: {
		id: "user-manager",
		name: "Manager",
		email: "manager@example.com",
		image: null,
	},
};

function createHarness() {
	const approvalRequestFindFirst = vi.fn(async () => state.requestRow);
	const workPeriodFindFirst = vi.fn().mockResolvedValue({
		id: "work-period-1",
		organizationId: "org-1",
		employeeId: "31000000-0000-4000-8000-000000000901",
		pendingChanges: null,
		clockInId: "entry-1",
		clockOutId: null,
		approvalWorkflowId: "workflow-1",
	});
	const transition = vi.fn().mockResolvedValue({});
	const transactionDb = {
		query: {
			employee: {
				findFirst: vi.fn().mockResolvedValue(actor),
				findMany: vi.fn().mockResolvedValue([actor]),
			},
			member: {
				findMany: vi.fn().mockResolvedValue([
					{
						organizationId: "org-1",
						userId: "user-manager",
						status: "approved",
					},
				]),
			},
			approvalRequest: { findFirst: approvalRequestFindFirst },
			approvalStageAssignment: { findFirst: vi.fn().mockResolvedValue(null) },
			approvalWorkflowStage: { findFirst: vi.fn().mockResolvedValue(null) },
			approvalWorkflow: { findFirst: vi.fn().mockResolvedValue(null) },
			workPeriod: { findFirst: workPeriodFindFirst },
			timeEntry: {
				findFirst: vi.fn().mockResolvedValue(null),
				findMany: vi.fn().mockResolvedValue([
					{
						id: "51000000-0000-4000-8000-000000000901",
						replacesEntryId: "entry-1",
					},
				]),
			},
		},
	};
	const compatibilityWriter = {
		withWriteGate() {
			return this;
		},
		mirrorCanonicalToLegacy: vi.fn(),
		mirrorLegacyToCanonical: vi.fn(),
	};
	const context = {
		dbService: { db: transactionDb },
		writeGate: {
			acquire: vi.fn().mockResolvedValue({
				mode: "complete",
				behavior: {
					serveFrom: "canonical",
					writeLegacy: false,
					writeCanonical: true,
					decideCanonical: true,
					mirror: "none",
				},
			}),
		},
		repository: {
			loadSnapshot: vi.fn().mockResolvedValue({
				id: "workflow-1",
				organizationId: "org-1",
				workflowType: "time_correction",
				sourceType: "time_entry",
				sourceId: "work-period-1",
				requesterEmployeeId: "31000000-0000-4000-8000-000000000901",
				status: "pending",
				currentStageOrder: 1,
				version: 4,
				stages: [
					{
						id: "stage-1",
						organizationId: "org-1",
						workflowId: "workflow-1",
						sequence: 1,
						status: "pending",
						legacyApprovalRequestId: "approval-stable-1",
						assignments: [
							{
								id: "assignment-1",
								organizationId: "org-1",
								workflowId: "workflow-1",
								stageId: "stage-1",
								approverEmployeeId: actor.id,
								status: "pending",
							},
						],
					},
				],
			}),
		},
		compatibilityWriter,
	};
	state.db = transactionDb;
	state.workflowRuntime = {
		repository: {
			withTransaction: async (
				operation: (value: unknown) => Promise<unknown>,
			) => await operation(context),
		},
		transitionEngine: { executeInTransaction: transition },
	};
	return {
		approvalRequestFindFirst,
		workPeriodFindFirst,
		transition,
		transactionDb,
	};
}

function compiledWhere(call: unknown[]): { sql: string; params: unknown[] } {
	const options = call[0] as { where: SQL };
	return new PgDialect().sqlToQuery(options.where);
}

describe("authenticated time correction live actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.session = {
			user: {
				id: "user-manager",
				name: "Manager",
				email: "manager@example.com",
			},
			session: {
				id: "session-1",
				userId: "user-manager",
				expiresAt: new Date("2027-01-01T00:00:00.000Z"),
				token: "token",
				activeOrganizationId: "org-1",
			},
		};
		state.requestRow = {
			id: "approval-stable-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "work-period-1",
			requestedBy: "31000000-0000-4000-8000-000000000901",
			approverId: actor.id,
			status: "pending",
			metadata: {
				workflow: { id: "workflow-1", organizationId: "org-1" },
				stage: {
					id: "stage-1",
					sequence: 1,
					assignmentId: "assignment-1",
				},
				timeCorrection: {
					action: "edit",
					clockInCorrectionId: "51000000-0000-4000-8000-000000000901",
				},
			},
			reason: "Missed punch",
		};
	});

	it.each([
		["approve", undefined],
		["reject", "Incorrect shift"],
	] as const)("executes the real authenticated %s wrapper by stable approval ID", async (action, reason) => {
		const harness = createHarness();

		const result =
			action === "approve"
				? await approveTimeCorrectionEffect("approval-stable-1")
				: await rejectTimeCorrectionEffect("approval-stable-1", reason);

		expect(result).toEqual({ success: true, data: undefined });
		expect(harness.approvalRequestFindFirst).toHaveBeenCalledOnce();
		const approvalQuery = compiledWhere(
			harness.approvalRequestFindFirst.mock.calls[0] as unknown[],
		);
		expect(approvalQuery.params).toContain("approval-stable-1");
		expect(approvalQuery.params).not.toContain("work-period-1");
		expect(harness.transition).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				organizationId: "org-1",
				workflowId: "workflow-1",
				command:
					action === "approve"
						? expect.objectContaining({ type: "approve" })
						: expect.objectContaining({
								type: "reject",
								reason: "Incorrect shift",
							}),
			}),
		);
		expect(state.processApprovalWithCurrentEmployee).not.toHaveBeenCalled();
	});

	it("returns a typed not-found result for a stale or foreign stable ID without legacy mutation", async () => {
		state.requestRow = null;
		const harness = createHarness();

		const result = await approveTimeCorrectionEffect("foreign-approval-id");

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(harness.workPeriodFindFirst).not.toHaveBeenCalled();
		expect(harness.transition).not.toHaveBeenCalled();
		expect(state.processApprovalWithCurrentEmployee).not.toHaveBeenCalled();
	});
});
