import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentSession: vi.fn(),
	getCurrentEmployee: vi.fn(),
	getUserTimezone: vi.fn(),
	getActiveWorkPeriod: vi.fn(),
	validateTimeEntry: vi.fn(),
	validateTimeEntryRange: vi.fn(),
	validateProjectAssignment: vi.fn(),
	createTimeEntry: vi.fn(),
	checkClockOutNeedsApproval: vi.fn(),
	createClockOutApprovalRequest: vi.fn(),
	createManualEntryApprovalRequest: vi.fn(),
	sendClockOutApprovalNotifications: vi.fn(),
	sendManualEntryApprovalNotifications: vi.fn(),
	getEditCapabilityForPeriod: vi.fn(),
	calculateAndPersistSurcharges: vi.fn(),
	checkComplianceAfterClockOut: vi.fn(),
	enforceBreaksAfterClockOut: vi.fn(),
	checkProjectBudgetAfterClockOut: vi.fn(),
	markEmployeeWorkBalanceDirty: vi.fn(),
	isBillingMutationAllowed: vi.fn(),
	requireBillingForMutation: vi.fn(),
	insertValues: vi.fn(),
	insertReturning: vi.fn(),
	findManyWorkPeriods: vi.fn(),
	transaction: vi.fn(),
	updateReturning: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			workPeriod: {
				findMany: mockState.findManyWorkPeriods,
			},
		},
		insert: vi.fn(() => ({
			values: (...args: unknown[]) => mockState.insertValues(...args),
		})),
		transaction: mockState.transaction,
		update: vi.fn(() => ({
			set: mockState.updateSet,
		})),
	},
}));

vi.mock("@/db/schema", () => ({
	workPeriod: {
		endTime: "workPeriod.endTime",
		employeeId: "workPeriod.employeeId",
		id: "workPeriod.id",
		isActive: "workPeriod.isActive",
		organizationId: "workPeriod.organizationId",
		startTime: "workPeriod.startTime",
	},
}));

vi.mock("@/lib/time-tracking/validation", () => ({
	validateTimeEntry: mockState.validateTimeEntry,
	validateTimeEntryRange: mockState.validateTimeEntryRange,
}));

vi.mock("@/lib/billing/guard", () => ({
	isBillingMutationAllowed: mockState.isBillingMutationAllowed,
	requireBillingForMutation: mockState.requireBillingForMutation,
}));

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: mockState.markEmployeeWorkBalanceDirty,
}));

vi.mock("./approvals", () => ({
	createClockOutApprovalRequest: mockState.createClockOutApprovalRequest,
	createManualEntryApprovalRequest: mockState.createManualEntryApprovalRequest,
	sendClockOutApprovalNotifications: mockState.sendClockOutApprovalNotifications,
	sendManualEntryApprovalNotifications: mockState.sendManualEntryApprovalNotifications,
}));

vi.mock("./auth", () => ({
	getCurrentSession: mockState.getCurrentSession,
	getCurrentEmployee: mockState.getCurrentEmployee,
	getUserTimezone: mockState.getUserTimezone,
}));

vi.mock("./compliance", () => ({
	calculateAndPersistSurcharges: mockState.calculateAndPersistSurcharges,
	calculateBreaksTakenToday: vi.fn(),
	checkComplianceAfterClockOut: mockState.checkComplianceAfterClockOut,
	enforceBreaksAfterClockOut: mockState.enforceBreaksAfterClockOut,
}));

vi.mock("./entry-helpers", () => ({
	checkProjectBudgetAfterClockOut: mockState.checkProjectBudgetAfterClockOut,
	createTimeEntry: mockState.createTimeEntry,
	validateProjectAssignment: mockState.validateProjectAssignment,
}));

vi.mock("./policy-helpers", () => ({
	checkClockOutNeedsApproval: mockState.checkClockOutNeedsApproval,
	getEditCapabilityForPeriod: mockState.getEditCapabilityForPeriod,
}));

vi.mock("./queries", () => ({
	getActiveWorkPeriod: mockState.getActiveWorkPeriod,
	getTimeSummary: vi.fn(),
}));

vi.mock("./shared", () => ({
	BREAK_WARNING_THRESHOLD_MINUTES: 30,
	EMPTY_BREAK_REMINDER_STATUS: {
		needsBreakSoon: false,
		uninterruptedMinutes: 0,
		maxUninterrupted: null,
		minutesUntilBreakRequired: null,
		breakRequirement: null,
	},
	logger: mockState.logger,
	ONE_MINUTE_MS: 60_000,
}));

const { addBreakToActiveSession, clockIn, clockOut, createManualTimeEntry } = await import("./clocking");

describe("clockIn", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T09:00:00.000Z"));

		mockState.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			teamId: null,
			managerId: null,
		});
		mockState.getUserTimezone.mockResolvedValue("UTC");
		mockState.getActiveWorkPeriod.mockResolvedValue(null);
		mockState.validateTimeEntry.mockResolvedValue({ isValid: true });
		mockState.createTimeEntry.mockResolvedValue({
			id: "clock-in-1",
			type: "clock_in",
			timestamp: new Date("2026-05-04T09:00:00.000Z"),
		});
		mockState.requireBillingForMutation.mockResolvedValue({ canAccess: true });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
		mockState.insertValues.mockResolvedValue(undefined);
	});

	it("rejects suspended organizations before creating a clock-in entry", async () => {
		mockState.requireBillingForMutation.mockResolvedValue({
			canAccess: false,
			reason: "trial_expired",
		});
		mockState.isBillingMutationAllowed.mockReturnValue(false);

		const result = await clockIn("remote");

		expect(mockState.requireBillingForMutation).toHaveBeenCalledWith("org-1");
		expect(result).toEqual({ success: false, error: "billing_required", code: "trial_expired" });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("persists remote work location when clocking in", async () => {
		const result = await clockIn("remote");

		expect(result.success).toBe(true);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workLocationType: "remote",
			}),
		);
	});

	it("defaults to office work location when clocking in without a location", async () => {
		const result = await clockIn();

		expect(result.success).toBe(true);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workLocationType: "office",
			}),
		);
	});

	it("rejects invalid work location before creating a time entry", async () => {
		const result = await clockIn("field" as never);

		expect(result).toEqual({ success: false, error: "Invalid work location type" });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});
});

describe("clockOut", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.updateReturning.mockReset();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T10:00:00.000Z"));

		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.updateWhere.mockReturnValue({ returning: mockState.updateReturning });
		mockState.updateReturning.mockResolvedValue([{ id: "period-1" }]);
		mockState.transaction.mockImplementation(async (callback) =>
			callback({
				update: vi.fn(() => ({
					set: mockState.updateSet,
				})),
			}),
		);
		mockState.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			teamId: null,
			managerId: null,
		});
		mockState.getUserTimezone.mockResolvedValue("UTC");
		mockState.getActiveWorkPeriod.mockResolvedValue({
			id: "period-1",
			startTime: new Date("2026-05-04T09:00:00.000Z"),
		});
		mockState.validateTimeEntry.mockResolvedValue({ isValid: true });
		mockState.createTimeEntry.mockResolvedValue({
			id: "clock-out-1",
			type: "clock_out",
			timestamp: new Date("2026-05-04T10:00:00.000Z"),
		});
		mockState.checkClockOutNeedsApproval.mockResolvedValue(false);
		mockState.sendClockOutApprovalNotifications.mockResolvedValue(undefined);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);
		mockState.checkComplianceAfterClockOut.mockResolvedValue([]);
		mockState.enforceBreaksAfterClockOut.mockResolvedValue({ wasAdjusted: false });
		mockState.markEmployeeWorkBalanceDirty.mockResolvedValue(undefined);
		mockState.sendManualEntryApprovalNotifications.mockResolvedValue(undefined);
		mockState.requireBillingForMutation.mockResolvedValue({ canAccess: true });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
	});

	it("rejects suspended organizations before creating a clock-out entry", async () => {
		mockState.requireBillingForMutation.mockResolvedValue({
			canAccess: false,
			reason: "payment_failed",
		});
		mockState.isBillingMutationAllowed.mockReturnValue(false);

		const result = await clockOut();

		expect(mockState.requireBillingForMutation).toHaveBeenCalledWith("org-1");
		expect(result).toEqual({ success: false, error: "billing_required", code: "payment_failed" });
		expect(mockState.transaction).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("approves live clock-out instead of creating a pending approval", async () => {
		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.checkClockOutNeedsApproval).toHaveBeenCalledWith("employee-1");
		expect(result.success && result.data.pendingApproval).toBeUndefined();
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				approvalStatus: "approved",
				pendingChanges: null,
			}),
		);
		expect(mockState.createClockOutApprovalRequest).not.toHaveBeenCalled();
	});

	it("rejects approval-required clock-out before mutating", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			teamId: null,
			managerId: "manager-1",
		});

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "Time changes requiring approval are not supported for this action yet",
		});
		expect(mockState.transaction).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
		expect(mockState.createClockOutApprovalRequest).not.toHaveBeenCalled();
	});

	it("rejects approval-required clock-out when no manager is assigned", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "No manager assigned to approve time changes",
		});
		expect(mockState.transaction).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
		expect(mockState.createClockOutApprovalRequest).not.toHaveBeenCalled();
	});

	it("fails closed when the clock-out approval check fails before mutating", async () => {
		mockState.checkClockOutNeedsApproval.mockRejectedValueOnce(new Error("policy unavailable"));

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "Could not verify time approval policy. Please try again.",
		});
		expect(mockState.transaction).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("marks the work balance dirty from the active period start date after closing the period", async () => {
		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-04",
		});
		expect(mockState.updateReturning.mock.invocationCallOrder[0]).toBeLessThan(
			mockState.markEmployeeWorkBalanceDirty.mock.invocationCallOrder[0],
		);
	});

	it("keeps clock-out successful when dirty marking fails", async () => {
		mockState.markEmployeeWorkBalanceDirty.mockRejectedValueOnce(new Error("dirty marker failed"));

		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.logger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				workPeriodId: "period-1",
			}),
			"Failed to mark work balance dirty after clock-out",
		);
	});

	it("closes the active period in the same transaction as the clock-out entry", async () => {
		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.transaction).toHaveBeenCalledTimes(1);
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(
			{
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_out",
				timestamp: new Date("2026-05-04T10:00:00.000Z"),
				createdBy: "user-1",
			},
			expect.anything(),
		);
	});

	it("returns a failure when the active period update affects no rows", async () => {
		mockState.updateReturning.mockResolvedValueOnce([]);

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.checkComplianceAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.enforceBreaksAfterClockOut).not.toHaveBeenCalled();
	});

	it("does not mark work balance dirty when rejecting approval-required clock-out", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			teamId: null,
			managerId: "manager-1",
		});

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "Time changes requiring approval are not supported for this action yet",
		});
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.checkComplianceAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.enforceBreaksAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
	});
});

describe("createManualTimeEntry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.transaction.mockReset();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T10:00:00.000Z"));

		mockState.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			teamId: null,
			managerId: null,
		});
		mockState.getUserTimezone.mockResolvedValue("UTC");
		mockState.validateTimeEntryRange.mockResolvedValue({ isValid: true });
		mockState.validateProjectAssignment.mockResolvedValue({ isValid: true });
		mockState.getEditCapabilityForPeriod.mockResolvedValue({
			type: "approval_required",
			reason: "outside_direct_edit_window",
		});
		mockState.markEmployeeWorkBalanceDirty.mockResolvedValue(undefined);
		mockState.findManyWorkPeriods.mockResolvedValue([]);
		mockState.transaction.mockImplementation(async (callback) =>
			callback({
				insert: vi.fn(() => ({
					values: (...args: unknown[]) => mockState.insertValues(...args),
				})),
			}),
		);
	});

	it("rejects approval-required manual entries when no manager is assigned", async () => {
		const result = await createManualTimeEntry({
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "No manager assigned to approve time changes",
		});
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(mockState.createManualEntryApprovalRequest).not.toHaveBeenCalled();
	});

	it("rejects approval-required manual entries before mutating", async () => {
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			teamId: null,
			managerId: "manager-1",
		});

		const result = await createManualTimeEntry({
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "Time changes requiring approval are not supported for this action yet",
		});
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(mockState.createManualEntryApprovalRequest).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(mockState.transaction).not.toHaveBeenCalled();
	});

	it("fails closed when the manual-entry edit capability check fails before mutating", async () => {
		mockState.getEditCapabilityForPeriod.mockRejectedValueOnce(new Error("policy unavailable"));

		const result = await createManualTimeEntry({
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "Could not verify time approval policy. Please try again.",
		});
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(mockState.transaction).not.toHaveBeenCalled();
	});

	it("marks the work balance dirty from the manual clock-in date after creating an approved entry", async () => {
		mockState.getEditCapabilityForPeriod.mockResolvedValue({ type: "direct", reason: "within_window" });
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1" })
			.mockResolvedValueOnce({ id: "clock-out-1" });
		mockState.insertValues.mockReturnValueOnce({ returning: mockState.insertReturning });
		mockState.insertReturning.mockResolvedValueOnce([{ id: "period-1" }]);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);

		const result = await createManualTimeEntry({
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-04",
		});
		expect(mockState.insertReturning.mock.invocationCallOrder[0]).toBeLessThan(
			mockState.markEmployeeWorkBalanceDirty.mock.invocationCallOrder[0],
		);
	});

	it("keeps manual entry creation successful when dirty marking fails", async () => {
		mockState.getEditCapabilityForPeriod.mockResolvedValue({ type: "direct", reason: "within_window" });
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1" })
			.mockResolvedValueOnce({ id: "clock-out-1" });
		mockState.insertValues.mockReturnValueOnce({ returning: mockState.insertReturning });
		mockState.insertReturning.mockResolvedValueOnce([{ id: "period-1" }]);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);
		mockState.markEmployeeWorkBalanceDirty.mockRejectedValueOnce(new Error("dirty marker failed"));

		const result = await createManualTimeEntry({
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.logger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				workPeriodId: "period-1",
			}),
			"Failed to mark work balance dirty after manual time entry",
		);
	});
});

describe("addBreakToActiveSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.insertReturning.mockReset();
		mockState.updateReturning.mockReset();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T10:00:00.000Z"));

		mockState.insertValues.mockResolvedValue(undefined);
		mockState.insertReturning.mockResolvedValue([
			{
				id: "period-2",
				startTime: new Date("2026-05-04T10:00:00.000Z"),
			},
		]);
		mockState.transaction.mockImplementation(async (callback) =>
			callback({
				insert: vi.fn(() => ({
					values: (...args: unknown[]) => mockState.insertValues(...args),
				})),
				update: vi.fn(() => ({
					set: mockState.updateSet,
				})),
			}),
		);
		mockState.updateReturning.mockResolvedValue([{ id: "period-1" }]);
		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.updateWhere.mockReturnValue({ returning: mockState.updateReturning });
		mockState.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			teamId: null,
			managerId: null,
		});
		mockState.getActiveWorkPeriod.mockResolvedValue({
			id: "period-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			startTime: new Date("2026-05-04T09:00:00.000Z"),
			workLocationType: "remote",
		});
		mockState.createTimeEntry
			.mockResolvedValueOnce({
				id: "clock-out-1",
				type: "clock_out",
				timestamp: new Date("2026-05-04T09:45:00.000Z"),
			})
			.mockResolvedValueOnce({
				id: "clock-in-2",
				type: "clock_in",
				timestamp: new Date("2026-05-04T10:00:00.000Z"),
			});
	});

	it("splits the active session into a closed period and a new active period", async () => {
		mockState.insertValues.mockReturnValueOnce({ returning: mockState.insertReturning });

		const result = await addBreakToActiveSession(15);

		expect(result).toEqual({
			success: true,
			data: {
				id: "period-2",
				startTime: new Date("2026-05-04T10:00:00.000Z"),
			},
		});
		expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(
			1,
			{
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_out",
				timestamp: new Date("2026-05-04T09:45:00.000Z"),
				createdBy: "user-1",
			},
			expect.anything(),
		);
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				clockOutId: "clock-out-1",
				endTime: new Date("2026-05-04T09:45:00.000Z"),
				durationMinutes: 45,
				isActive: false,
				approvalStatus: "approved",
				pendingChanges: null,
			}),
		);
		expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(
			2,
			{
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_in",
				timestamp: new Date("2026-05-04T10:00:00.000Z"),
				createdBy: "user-1",
			},
			expect.anything(),
		);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				clockInId: "clock-in-2",
				startTime: new Date("2026-05-04T10:00:00.000Z"),
				workLocationType: "remote",
			}),
		);
	});

	it("marks the work balance dirty from the closed period start date after adding a break", async () => {
		mockState.insertValues.mockReturnValueOnce({ returning: mockState.insertReturning });

		const result = await addBreakToActiveSession(15);

		expect(result.success).toBe(true);
		expect(mockState.markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-04",
		});
		expect(mockState.updateReturning.mock.invocationCallOrder[0]).toBeLessThan(
			mockState.markEmployeeWorkBalanceDirty.mock.invocationCallOrder[0],
		);
	});

	it("allows a break shorter than the active session when the session has partial minutes", async () => {
		mockState.getActiveWorkPeriod.mockResolvedValue({
			id: "period-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			startTime: new Date("2026-05-04T09:45:30.000Z"),
			workLocationType: "office",
		});
		mockState.insertValues.mockReturnValueOnce({ returning: mockState.insertReturning });

		const result = await addBreakToActiveSession(14);

		expect(result.success).toBe(true);
		expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				type: "clock_out",
				timestamp: new Date("2026-05-04T09:46:00.000Z"),
			}),
			expect.anything(),
		);
	});

	it("returns a failure when the active period update affects no rows", async () => {
		mockState.updateReturning.mockResolvedValueOnce([]);
		mockState.insertValues.mockReturnValueOnce({ returning: mockState.insertReturning });

		const result = await addBreakToActiveSession(15);

		expect(result).toEqual({
			success: false,
			error: "Failed to add break. Please try again.",
		});
		expect(mockState.createTimeEntry).toHaveBeenCalledTimes(1);
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("rejects zero minutes before writing entries", async () => {
		const result = await addBreakToActiveSession(0);

		expect(result).toEqual({
			success: false,
			error: "Enter a break duration of at least 1 minute.",
		});
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("rejects when employee is not clocked in", async () => {
		mockState.getActiveWorkPeriod.mockResolvedValue(null);

		const result = await addBreakToActiveSession(15);

		expect(result).toEqual({
			success: false,
			error: "You are not currently clocked in.",
		});
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("rejects a break duration equal to or longer than the active session", async () => {
		mockState.getActiveWorkPeriod.mockResolvedValue({
			id: "period-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			startTime: new Date("2026-05-04T09:45:00.000Z"),
			workLocationType: "office",
		});

		const result = await addBreakToActiveSession(15);

		expect(result).toEqual({
			success: false,
			error: "Break duration must be shorter than your current session.",
		});
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});
});
