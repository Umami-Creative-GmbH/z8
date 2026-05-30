import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findEmployee: vi.fn(),
	findPolicies: vi.fn(),
	findGroupMembers: vi.fn(),
	findEmployees: vi.fn(),
	findManagerLinks: vi.fn(),
	insertValues: vi.fn(),
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: mockState.findEmployee,
				findMany: mockState.findEmployees,
			},
			approvalPolicy: { findMany: mockState.findPolicies },
			employeeGroupMember: { findMany: mockState.findGroupMembers },
			employeeGroup: { findMany: vi.fn().mockResolvedValue([]) },
			employeeManagers: { findMany: mockState.findManagerLinks },
		},
		insert: vi.fn(() => ({ values: mockState.insertValues })),
	},
}));

vi.mock("@/lib/notifications/triggers", () => ({
	onClockOutPendingApproval: vi.fn().mockResolvedValue(undefined),
	onClockOutPendingApprovalToManager: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./shared", () => ({ logger: mockState.logger }));

const { createTimeEntryApprovalRequest } = await import("./approvals");

describe("time tracking approval requests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.findEmployee.mockResolvedValue({ teamId: null, organizationId: "org-1" });
		mockState.findGroupMembers.mockResolvedValue([]);
		mockState.findManagerLinks.mockResolvedValue([]);
		mockState.findEmployees.mockResolvedValue([
			{ id: "emp-1", userId: "user-1", organizationId: "org-1", isActive: true, role: "employee" },
			{
				id: "manager-1",
				userId: "manager-user-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
		]);
		mockState.insertValues.mockResolvedValue(undefined);
	});

	it("falls back to manager approval when a matched policy cannot resolve", async () => {
		mockState.findPolicies.mockResolvedValue([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Broken time policy",
				isActive: true,
				priority: 1,
				conditions: [
					{ conditionType: "approval_type", operator: "equals", valueJson: "time_entry" },
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Missing approver",
						approverType: "specific_employee",
						approverEmployeeId: "missing-employee",
					},
				],
			},
		]);

		await createTimeEntryApprovalRequest({
			workPeriodId: "work-period-1",
			employeeId: "emp-1",
			managerId: "manager-1",
			organizationId: "org-1",
			reason: "Clock-out requires approval",
			overtimeRisk: "warning",
		});

		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				entityType: "time_entry",
				entityId: "work-period-1",
				requestedBy: "emp-1",
				approverId: "manager-1",
				status: "pending",
				reason: "Clock-out requires approval",
			}),
		);
	});
});
