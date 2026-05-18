import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentSession: vi.fn(),
	getCurrentEmployee: vi.fn(),
	getUserTimezone: vi.fn(),
	getActiveWorkPeriod: vi.fn(),
	validateTimeEntry: vi.fn(),
	validateProjectAssignment: vi.fn(),
	createTimeEntry: vi.fn(),
	checkClockOutNeedsApproval: vi.fn(),
	createClockOutApprovalRequest: vi.fn(),
	calculateAndPersistSurcharges: vi.fn(),
	checkComplianceAfterClockOut: vi.fn(),
	enforceBreaksAfterClockOut: vi.fn(),
	checkProjectBudgetAfterClockOut: vi.fn(),
	insertValues: vi.fn(),
	insertReturning: vi.fn(),
	transaction: vi.fn(),
	updateReturning: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/db", () => ({
	db: {
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
	validateTimeEntryRange: vi.fn(),
}));

vi.mock("./approvals", () => ({
	createClockOutApprovalRequest: mockState.createClockOutApprovalRequest,
	createManualEntryApprovalRequest: vi.fn(),
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
	getEditCapabilityForPeriod: vi.fn(),
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

const { addBreakToActiveSession, clockIn, clockOut } = await import("./clocking");

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
		mockState.insertValues.mockResolvedValue(undefined);
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
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);
		mockState.checkComplianceAfterClockOut.mockResolvedValue([]);
		mockState.enforceBreaksAfterClockOut.mockResolvedValue({ wasAdjusted: false });
	});

	it("approves live clock-out instead of creating a pending approval", async () => {
		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(result.success && result.data.pendingApproval).toBeUndefined();
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				approvalStatus: "approved",
				pendingChanges: null,
			}),
		);
		expect(mockState.createClockOutApprovalRequest).not.toHaveBeenCalled();
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
});

describe("addBreakToActiveSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
