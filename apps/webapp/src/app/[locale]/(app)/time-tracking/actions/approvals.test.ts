import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findEmployee: vi.fn(),
	findPolicies: vi.fn(),
	findGroupMembers: vi.fn(),
	findEmployees: vi.fn(),
	findManagerLinks: vi.fn(),
	insertValues: vi.fn(),
	insertReturning: vi.fn(),
	finalizeAutoCompleted: vi.fn(),
	notifyAutoCompleted: vi.fn(),
	onClockOutPendingApproval: vi.fn(),
	onClockOutPendingApprovalToManager: vi.fn(),
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
			teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
			team: { findMany: vi.fn().mockResolvedValue([]) },
		},
		insert: vi.fn(() => ({
			values: (values: unknown) => {
				mockState.insertValues(values);
				return { returning: mockState.insertReturning };
			},
		})),
	},
}));

vi.mock("@/lib/notifications/triggers", () => ({
	onClockOutPendingApproval: mockState.onClockOutPendingApproval,
	onClockOutPendingApprovalToManager:
		mockState.onClockOutPendingApprovalToManager,
}));

vi.mock("@/lib/approvals/server/work-period-approvals", async () => {
	const { Effect } = await import("effect");
	return {
		finalizeAutoCompletedWorkPeriodApprovalEffect: (...args: unknown[]) =>
			mockState.finalizeAutoCompleted(...args),
		notifyWorkPeriodApprovalAfterCommit: (...args: unknown[]) =>
			mockState.notifyAutoCompleted(...args),
		approveWorkPeriodWithCurrentApproverEffect: vi.fn(() => Effect.void),
		rejectWorkPeriodWithCurrentApproverEffect: vi.fn(() => Effect.void),
	};
});

vi.mock("./shared", () => ({ logger: mockState.logger }));

const {
	createClockOutApprovalRequest,
	createManualEntryApprovalRequest,
	createTimeEntryApprovalRequest,
} = await import("./approvals");

describe("time tracking approval requests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.findEmployee.mockResolvedValue({
			teamId: null,
			organizationId: "org-1",
			userId: "user-1",
			user: { name: "Avery Employee", email: "avery@example.com", image: null },
		});
		mockState.findGroupMembers.mockResolvedValue([]);
		mockState.findManagerLinks.mockResolvedValue([]);
		mockState.findEmployees.mockResolvedValue([
			{
				id: "emp-1",
				userId: "user-1",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
			},
			{
				id: "manager-1",
				userId: "manager-user-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
		]);
		mockState.insertValues.mockResolvedValue(undefined);
		mockState.insertReturning.mockResolvedValue([{ id: "approval-1" }]);
		mockState.finalizeAutoCompleted.mockReturnValue(
			Effect.succeed({
				kind: "manual_time_submission",
				action: "approve",
				reason: null,
				period: {
					id: "work-period-1",
					organizationId: "org-1",
					employeeId: "emp-1",
					canonicalRecordId: "record-1",
					startTime: new Date("2026-07-14T08:00:00.000Z"),
					endTime: new Date("2026-07-14T16:00:00.000Z"),
				},
			}),
		);
		mockState.notifyAutoCompleted.mockReturnValue(Effect.void);
		mockState.onClockOutPendingApproval.mockResolvedValue(undefined);
		mockState.onClockOutPendingApprovalToManager.mockResolvedValue(undefined);
	});

	it("fails with typed validation when neither a policy nor fallback approver resolves", async () => {
		mockState.findPolicies.mockResolvedValue([]);

		await expect(
			createTimeEntryApprovalRequest({
				workPeriodId: "work-period-1",
				employeeId: "emp-1",
				managerId: null,
				organizationId: "org-1",
				reason: "Manual time entry: Missed punch",
				overtimeRisk: "none",
				kind: "manual_time_submission",
			}),
		).rejects.toMatchObject({
			_tag: "ValidationError",
			message: "No manager assigned to approve time changes",
			field: "managerId",
		});
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("uses an explicit policy reviewer without a fallback manager", async () => {
		mockState.findEmployees.mockResolvedValue([
			{
				id: "emp-1",
				userId: "user-1",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
			},
			{
				id: "reviewer-1",
				userId: "reviewer-user-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
		]);
		mockState.findPolicies.mockResolvedValue([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Explicit reviewer",
				isActive: true,
				priority: 1,
				conditions: [
					{
						conditionType: "approval_type",
						operator: "equals",
						valueJson: "time_entry",
					},
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Reviewer",
						approverType: "specific_employee",
						approverEmployeeId: "reviewer-1",
						fallbackBehavior: "fail",
					},
				],
			},
		]);

		const result = await createManualEntryApprovalRequest(
			{
				workPeriodId: "work-period-1",
				employeeId: "emp-1",
				managerId: null,
				organizationId: "org-1",
				startTime: new Date("2026-07-14T08:00:00.000Z"),
				endTime: new Date("2026-07-14T16:00:00.000Z"),
				durationMinutes: 480,
				reason: "Missed punch",
			},
			{ notify: false },
		);

		expect(result.kind).toBe("chain_created");
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				entityType: "time_entry",
				entityId: "work-period-1",
				approverId: "reviewer-1",
				status: "pending",
			}),
		);
	});

	it("auto-completes only when a matched policy stage resolves to the requester", async () => {
		mockState.findPolicies.mockResolvedValue([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Requester review",
				isActive: true,
				priority: 1,
				conditions: [
					{
						conditionType: "approval_type",
						operator: "equals",
						valueJson: "time_entry",
					},
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Requester",
						approverType: "specific_employee",
						approverEmployeeId: "emp-1",
						fallbackBehavior: "fail",
					},
				],
			},
		]);

		const result = await createManualEntryApprovalRequest(
			{
				workPeriodId: "work-period-1",
				employeeId: "emp-1",
				managerId: null,
				organizationId: "org-1",
				startTime: new Date("2026-07-14T08:00:00.000Z"),
				endTime: new Date("2026-07-14T16:00:00.000Z"),
				durationMinutes: 480,
				reason: "Missed punch",
			},
			{ notify: false },
		);

		expect(result).toMatchObject({
			kind: "auto_completed",
			reason: "requester_is_approver",
		});
		expect(mockState.finalizeAutoCompleted).toHaveBeenCalledOnce();
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
					{
						conditionType: "approval_type",
						operator: "equals",
						valueJson: "time_entry",
					},
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Missing approver",
						approverType: "specific_employee",
						approverEmployeeId: "missing-employee",
						fallbackBehavior: "fail",
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
			kind: "policy_clock_out",
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

	it("persists manual request metadata without replacing caller metadata", async () => {
		mockState.findPolicies.mockResolvedValue([]);

		const result = await createManualEntryApprovalRequest({
			workPeriodId: "work-period-1",
			employeeId: "emp-1",
			managerId: "manager-1",
			organizationId: "org-1",
			startTime: new Date("2026-07-14T08:00:00.000Z"),
			endTime: new Date("2026-07-14T16:00:00.000Z"),
			durationMinutes: 480,
			reason: "Missed punch",
			metadata: { source: "calendar", timeRequest: { imported: true } },
		});

		expect(result.kind).toBe("default_created");
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "pending",
				metadata: {
					source: "calendar",
					timeRequest: { imported: true, kind: "manual_time_submission" },
				},
			}),
		);
		expect(mockState.onClockOutPendingApprovalToManager).toHaveBeenCalledOnce();
	});

	it("persists policy clock-out metadata", async () => {
		mockState.findPolicies.mockResolvedValue([]);

		await createClockOutApprovalRequest({
			workPeriodId: "work-period-1",
			employeeId: "emp-1",
			managerId: "manager-1",
			organizationId: "org-1",
			startTime: new Date("2026-07-14T08:00:00.000Z"),
			endTime: new Date("2026-07-14T16:00:00.000Z"),
			durationMinutes: 480,
		});

		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: { timeRequest: { kind: "policy_clock_out" } },
			}),
		);
	});

	it("finalizes requester auto-completion and skips pending notifications", async () => {
		mockState.findPolicies.mockResolvedValue([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Requester review",
				isActive: true,
				priority: 1,
				conditions: [
					{
						conditionType: "approval_type",
						operator: "equals",
						valueJson: "time_entry",
					},
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Requester",
						approverType: "specific_employee",
						approverEmployeeId: "emp-1",
						fallbackBehavior: "fail",
					},
				],
			},
		]);
		mockState.findEmployees.mockResolvedValue([
			{
				id: "emp-1",
				userId: "user-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
		]);

		const result = await createManualEntryApprovalRequest({
			workPeriodId: "work-period-1",
			employeeId: "emp-1",
			managerId: "emp-1",
			organizationId: "org-1",
			startTime: new Date("2026-07-14T08:00:00.000Z"),
			endTime: new Date("2026-07-14T16:00:00.000Z"),
			durationMinutes: 480,
			reason: "Missed punch",
		});

		expect(result.kind).toBe("auto_completed");
		expect(mockState.finalizeAutoCompleted).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				approvalRequestId: "approval-1",
				organizationId: "org-1",
				requesterEmployeeId: "emp-1",
				kind: "manual_time_submission",
			}),
		);
		expect(mockState.notifyAutoCompleted).toHaveBeenCalledOnce();
		expect(mockState.onClockOutPendingApproval).not.toHaveBeenCalled();
		expect(mockState.onClockOutPendingApprovalToManager).not.toHaveBeenCalled();
	});

	it("auto-completes policy clock-out without sending a pending notification", async () => {
		mockState.findPolicies.mockResolvedValue([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Requester review",
				isActive: true,
				priority: 1,
				conditions: [
					{
						conditionType: "approval_type",
						operator: "equals",
						valueJson: "time_entry",
					},
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Requester",
						approverType: "specific_employee",
						approverEmployeeId: "emp-1",
						fallbackBehavior: "fail",
					},
				],
			},
		]);
		mockState.findEmployees.mockResolvedValue([
			{
				id: "emp-1",
				userId: "user-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
		]);

		const result = await createClockOutApprovalRequest({
			workPeriodId: "work-period-1",
			employeeId: "emp-1",
			managerId: "emp-1",
			organizationId: "org-1",
			startTime: new Date("2026-07-14T08:00:00.000Z"),
			endTime: new Date("2026-07-14T16:00:00.000Z"),
			durationMinutes: 480,
		});

		expect(result.kind).toBe("auto_completed");
		expect(mockState.finalizeAutoCompleted).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ kind: "policy_clock_out" }),
		);
		expect(mockState.notifyAutoCompleted).toHaveBeenCalledOnce();
		expect(mockState.onClockOutPendingApproval).not.toHaveBeenCalled();
		expect(mockState.onClockOutPendingApprovalToManager).not.toHaveBeenCalled();
	});

	it("propagates auto-completion finalizer failures", async () => {
		mockState.findPolicies.mockResolvedValue([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Requester review",
				isActive: true,
				priority: 1,
				conditions: [
					{
						conditionType: "approval_type",
						operator: "equals",
						valueJson: "time_entry",
					},
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Requester",
						approverType: "specific_employee",
						approverEmployeeId: "emp-1",
						fallbackBehavior: "fail",
					},
				],
			},
		]);
		mockState.findEmployees.mockResolvedValue([
			{
				id: "emp-1",
				userId: "user-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
		]);
		mockState.finalizeAutoCompleted.mockReturnValue(
			Effect.fail(new Error("finalizer failed")),
		);

		await expect(
			createClockOutApprovalRequest({
				workPeriodId: "work-period-1",
				employeeId: "emp-1",
				managerId: "emp-1",
				organizationId: "org-1",
				startTime: new Date("2026-07-14T08:00:00.000Z"),
				endTime: new Date("2026-07-14T16:00:00.000Z"),
				durationMinutes: 480,
			}),
		).rejects.toThrow("finalizer failed");
		expect(mockState.insertValues).toHaveBeenCalledTimes(3);
	});
});
