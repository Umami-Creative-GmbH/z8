import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentSession: vi.fn(),
	getCurrentEmployee: vi.fn(),
	findMember: vi.fn(),
	findApprovalRequests: vi.fn(),
	decideStableTarget: vi.fn(),
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

vi.mock("@/lib/approvals/server/work-period-approvals", async () => {
	const { Effect } = await import("effect");
	return {
		decideOrdinaryWorkPeriodWithStableTargetEffect: (...args: unknown[]) => {
			return mockState.decideStableTarget(...args) ?? Effect.void;
		},
	};
});

vi.mock("@/lib/approvals/server/time-correction-approvals", async () => {
	const { Effect } = await import("effect");
	return { decideTimeCorrectionWithStableTargetEffect: () => Effect.void };
});

vi.mock("./auth", () => ({
	getCurrentSession: mockState.getCurrentSession,
	getCurrentEmployee: mockState.getCurrentEmployee,
}));

vi.mock("./entry-helpers", () => ({
	createTimeEntry: vi.fn(),
	validateProjectAssignment: vi.fn(),
}));

vi.mock("./shared", () => ({
	logger: mockState.logger,
}));

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
		mockState.decideStableTarget.mockReturnValue(Effect.void);
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

	it("returns a generic failure when the exact target mismatches", async () => {
		mockState.findMember.mockResolvedValue({ role: "admin" });
		mockState.decideStableTarget.mockReturnValue(
			Effect.fail(new Error("private target mismatch")),
		);

		const result = await approveWorkPeriod({
			workPeriodId: "period-1",
			approvalRequestId: "approval-mismatch",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to approve work period. Please try again.",
		});
		expect(mockState.decideStableTarget).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ approvalRequestId: "approval-mismatch" }),
			expect.anything(),
		);
		expect(mockState.updateSet).not.toHaveBeenCalled();
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
