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

vi.mock("@/lib/approvals/server/time-correction-approvals", async () => {
	const { Effect } = await import("effect");
	return {
		decideTimeCorrectionWithStableTargetEffect: (...args: unknown[]) => {
			mockState.decideStableTarget(...args);
			return Effect.void;
		},
	};
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
		mockState.getCurrentEmployee.mockResolvedValue({ id: "employee-1", organizationId: "org-1" });
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

		const result = await approveWorkPeriod("period-1");

		expect(result).toEqual({
			success: false,
			error: "Only admins and owners can approve time entries",
		});
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("routes one exact pending ordinary request for organization admins", async () => {
		mockState.findMember.mockResolvedValue({ role: "admin" });

		const result = await approveWorkPeriod("period-1");

		expect(result).toEqual({ success: true, data: { workPeriodId: "period-1" } });
		expect(mockState.selectWhere).toHaveBeenCalledWith({
			type: "and",
			conditions: expect.arrayContaining([
				expect.objectContaining({ left: "workPeriod.id", right: "period-1" }),
				expect.objectContaining({ left: "workPeriod.organizationId", right: "org-1" }),
			]),
		});
		expect(mockState.decideStableTarget).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id: "employee-1", organizationId: "org-1" }),
			"approval-1",
			"approve",
			undefined,
			{ approvalRequestId: "approval-1", allowOrganizationWideApprover: true },
		);
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("rejects a pending period without exactly one ordinary request", async () => {
		mockState.findMember.mockResolvedValue({ role: "admin" });
		mockState.findApprovalRequests.mockResolvedValue([]);

		const result = await approveWorkPeriod("period-1");

		expect(result).toEqual({
			success: false,
			error: "Only pending work periods can be approved",
		});
		expect(mockState.decideStableTarget).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});
});
