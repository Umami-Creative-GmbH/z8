import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentSession: vi.fn(),
	getCurrentEmployee: vi.fn(),
	findMember: vi.fn(),
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

	it("approves pending work periods for organization admins", async () => {
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
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				approvalStatus: "approved",
				pendingChanges: null,
			}),
		);
		expect(mockState.updateWhere).toHaveBeenCalledWith({
			type: "and",
			conditions: expect.arrayContaining([
				expect.objectContaining({ left: "workPeriod.id", right: "period-1" }),
				expect.objectContaining({ left: "workPeriod.organizationId", right: "org-1" }),
				expect.objectContaining({ left: "workPeriod.approvalStatus", right: "pending" }),
			]),
		});
	});
});
