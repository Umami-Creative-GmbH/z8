import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { ConflictError } from "@/lib/effect/errors";

const mockState = vi.hoisted(() => ({
	getCurrentSession: vi.fn(),
	getCurrentEmployee: vi.fn(),
	findMember: vi.fn(),
	findApprovalRequests: vi.fn(),
	decideStableTarget: vi.fn(),
	decideStableTargetDefect: undefined as unknown,
	decideStableTargetQueryFailure: undefined as unknown,
	selectWhere: vi.fn(),
	selectLimit: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
	logger: {
		error: vi.fn(),
	},
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
	eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: {
				findFirst: mockState.findMember,
			},
			approvalRequest: {
				findMany: mockState.findApprovalRequests,
			},
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: mockState.selectWhere,
			})),
		})),
		update: vi.fn(() => ({
			set: mockState.updateSet,
		})),
	},
}));

vi.mock("@/db/auth-schema", () => ({
	member: {
		userId: "member.userId",
		organizationId: "member.organizationId",
	},
}));

vi.mock("@/db/schema", () => ({
	approvalRequest: {
		organizationId: "approvalRequest.organizationId",
		entityType: "approvalRequest.entityType",
		entityId: "approvalRequest.entityId",
		status: "approvalRequest.status",
	},
	timeEntry: {
		id: "timeEntry.id",
		employeeId: "timeEntry.employeeId",
	},
	workPeriod: {
		id: "workPeriod.id",
		organizationId: "workPeriod.organizationId",
		approvalStatus: "workPeriod.approvalStatus",
	},
}));

vi.mock("@/lib/time-tracking/validation", () => ({
	validateTimeEntryRange: vi.fn(),
}));

// A rejected stub becomes the Effect's typed failure, as the owner's decision fails.
// A set decideStableTargetDefect makes the decision die with it instead, and a set
// decideStableTargetQueryFailure rejects a query run through the action's db service.
// Like the owner, that query runs at a Promise boundary and the owner's catch keeps a
// ConflictError it receives, turning anything else into its generic conflict.
vi.mock("@/lib/approvals/server/work-period-approvals", async () => {
	const { Effect } = await import("effect");
	const { ConflictError } = await import("@/lib/effect/errors");
	return {
		decideOrdinaryWorkPeriodWithStableTargetEffect: (...args: unknown[]) => {
			if (mockState.decideStableTargetQueryFailure !== undefined) {
				const dbService = args[0] as ApprovalDbService;
				return Effect.tryPromise({
					try: () =>
						Effect.runPromise(
							dbService.query("workPeriodApproval.decide", () =>
								Promise.reject(mockState.decideStableTargetQueryFailure),
							),
						),
					catch: (error) =>
						error instanceof ConflictError
							? error
							: new ConflictError({
									message: "Ordinary work-period decision failed",
									conflictType: "approval_decision",
								}),
				});
			}
			return mockState.decideStableTargetDefect === undefined
				? Effect.tryPromise({
						try: () => mockState.decideStableTarget(...args),
						catch: (error) => error,
					})
				: Effect.die(mockState.decideStableTargetDefect);
		},
	};
});

vi.mock("./auth", () => ({
	getCurrentSession: mockState.getCurrentSession,
	getCurrentEmployee: mockState.getCurrentEmployee,
}));

vi.mock("./entry-helpers", () => ({
	validateProjectAssignment: vi.fn(),
}));

vi.mock("@/lib/time-tracking/time-entry-writer", () => ({
	createTimeEntry: vi.fn(),
}));

vi.mock("./shared", () => ({
	logger: mockState.logger,
}));

vi.mock("../actions", () => ({ updateWorkPeriodProject: vi.fn() }));
vi.mock("./work-period-split", () => ({ splitOwnWorkPeriod: vi.fn() }));

const { approveWorkPeriod } = await import("./mutations");

describe("approveWorkPeriod", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
		});
		mockState.selectWhere.mockReturnValue({ limit: mockState.selectLimit });
		mockState.selectLimit.mockResolvedValue([
			{
				id: "period-1",
				organizationId: "org-1",
				approvalStatus: "pending",
			},
		]);
		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.updateWhere.mockResolvedValue(undefined);
		mockState.decideStableTarget.mockResolvedValue(undefined);
		mockState.decideStableTargetDefect = undefined;
		mockState.decideStableTargetQueryFailure = undefined;
		mockState.findApprovalRequests.mockResolvedValue([
			{
				id: "approval-1",
				entityId: "period-1",
				organizationId: "org-1",
				status: "pending",
				metadata: { timeRequest: { kind: "manual_time_submission" } },
			},
		]);
	});

	it("rejects normal organization members", async () => {
		mockState.findMember.mockResolvedValue({ role: "member" });

		const result = await approveWorkPeriod({
			workPeriodId: "period-1",
			approvalRequestId: "approval-1",
		});

		expect(result).toEqual({
			success: false,
			error: "Only admins and owners can approve time entries",
		});
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("routes one exact pending ordinary request for organization admins", async () => {
		mockState.findMember.mockResolvedValue({ role: "admin" });

		const result = await approveWorkPeriod({
			workPeriodId: "period-1",
			approvalRequestId: "approval-1",
		});

		expect(result).toEqual({
			success: true,
			data: { workPeriodId: "period-1" },
		});
		expect(mockState.selectWhere).toHaveBeenCalledWith({
			type: "and",
			conditions: expect.arrayContaining([
				expect.objectContaining({ left: "workPeriod.id", right: "period-1" }),
				expect.objectContaining({
					left: "workPeriod.organizationId",
					right: "org-1",
				}),
			]),
		});
		expect(mockState.decideStableTarget).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id: "employee-1", organizationId: "org-1" }),
			{
				approvalRequestId: "approval-1",
				workPeriodId: "period-1",
				decision: { kind: "approve", reason: null },
			},
			{ approvalRequestId: "approval-1", allowOrganizationWideApprover: true },
		);
		expect(mockState.findApprovalRequests).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("preserves the typed conflict when no pending ordinary target is valid", async () => {
		mockState.findMember.mockResolvedValue({ role: "admin" });
		mockState.decideStableTarget.mockRejectedValue(
			new ConflictError({
				message: "Ordinary work-period decision failed",
				conflictType: "approval_decision",
			}),
		);

		const result = await approveWorkPeriod({
			workPeriodId: "period-1",
			approvalRequestId: "approval-mismatch",
		});

		expect(result).toEqual({
			success: false,
			error: "Ordinary work-period decision failed",
			code: "ConflictError",
		});
		expect(mockState.decideStableTarget).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ approvalRequestId: "approval-mismatch" }),
			expect.anything(),
		);
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("redacts a conflict the decision dies with instead of failing with", async () => {
		mockState.findMember.mockResolvedValue({ role: "admin" });
		mockState.decideStableTargetDefect = new ConflictError({
			message: "private conflict defect",
			conflictType: "approval_decision",
		});

		const result = await approveWorkPeriod({
			workPeriodId: "period-1",
			approvalRequestId: "approval-1",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to approve work period. Please try again.",
		});
	});

	it("keeps a conflict thrown inside a decision query typed", async () => {
		mockState.findMember.mockResolvedValue({ role: "admin" });
		mockState.decideStableTargetQueryFailure = new ConflictError({
			message: "Resolve the pending break review first",
			conflictType: "work_period_pending_approval",
		});

		const result = await approveWorkPeriod({
			workPeriodId: "period-1",
			approvalRequestId: "approval-1",
		});

		expect(result).toEqual({
			success: false,
			error: "Resolve the pending break review first",
			code: "ConflictError",
		});
	});

	it("keeps a failed decision query generic", async () => {
		mockState.findMember.mockResolvedValue({ role: "admin" });
		mockState.decideStableTargetQueryFailure = new Error("connection reset by peer");

		const result = await approveWorkPeriod({
			workPeriodId: "period-1",
			approvalRequestId: "approval-1",
		});

		expect(result).toEqual({
			success: false,
			error: "Ordinary work-period decision failed",
			code: "ConflictError",
		});
	});

	it("redacts non-domain failures", async () => {
		mockState.findMember.mockResolvedValue({ role: "admin" });
		mockState.decideStableTarget.mockRejectedValue(new Error("private target mismatch"));

		const result = await approveWorkPeriod({
			workPeriodId: "period-1",
			approvalRequestId: "approval-mismatch",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to approve work period. Please try again.",
		});
	});

	it("delegates an exact terminal target so the owner can determine replay", async () => {
		mockState.findMember.mockResolvedValue({ role: "admin" });
		mockState.selectLimit.mockResolvedValue([
			{
				id: "period-1",
				organizationId: "org-1",
				approvalStatus: "approved",
			},
		]);

		const result = await approveWorkPeriod({
			workPeriodId: "period-1",
			approvalRequestId: "approval-1",
		});

		expect(result).toEqual({
			success: true,
			data: { workPeriodId: "period-1" },
		});
		expect(mockState.decideStableTarget).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ approvalRequestId: "approval-1" }),
			expect.anything(),
		);
	});
});
