import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/effect/errors";

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
	getEditCapabilityForPeriod: vi.fn(),
	createClockOutApprovalRequest: vi.fn(),
	sendClockOutApprovalNotifications: vi.fn(),
	sendClockOutApprovedNotification: vi.fn(),
	createManualEntryApprovalRequest: vi.fn(),
	sendManualEntryApprovalNotifications: vi.fn(),
	sendManualEntryApprovedNotification: vi.fn(),
	transactionOpen: false,
	calculateAndPersistSurcharges: vi.fn(),
	checkComplianceAfterClockOut: vi.fn(),
	enforceBreaksAfterClockOut: vi.fn(),
	checkProjectBudgetAfterClockOut: vi.fn(),
	markEmployeeWorkBalanceDirty: vi.fn(),
	isBillingMutationAllowed: vi.fn(),
	requireBillingForMutation: vi.fn(),
	insertValues: vi.fn(),
	insertReturning: vi.fn(),
	findWorkPeriods: vi.fn(),
	findEmployees: vi.fn(),
	findManagerLinks: vi.fn(),
	findTeamMemberships: vi.fn(),
	findTeams: vi.fn(),
	transaction: vi.fn(),
	updateReturning: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
	clockingClockIn: vi.fn(),
	clockingClockOut: vi.fn(),
	createCanonicalWorkRecord: vi.fn(),
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findMany: mockState.findEmployees },
			employeeManagers: { findMany: mockState.findManagerLinks },
			teamMembership: { findMany: mockState.findTeamMemberships },
			team: { findMany: mockState.findTeams },
			workPeriod: { findMany: mockState.findWorkPeriods },
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
	employee: {
		id: "employee.id",
		organizationId: "employee.organizationId",
		isActive: "employee.isActive",
	},
	employeeManagers: {
		employeeId: "employeeManagers.employeeId",
		managerId: "employeeManagers.managerId",
	},
	teamMembership: {
		employeeId: "teamMembership.employeeId",
		organizationId: "teamMembership.organizationId",
	},
	team: {
		organizationId: "team.organizationId",
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

vi.mock("@/lib/time-tracking/clocking-service", () => ({
	ClockingConflictError: class ClockingConflictError extends Error {},
	clockingService: {
		clockIn: (...args: unknown[]) => mockState.clockingClockIn(...args),
		clockOut: (...args: unknown[]) => mockState.clockingClockOut(...args),
	},
}));

vi.mock("../actions.canonical", () => ({
	canonicalWorkRecordClient: {
		createForCompletedPeriod: mockState.createCanonicalWorkRecord,
	},
}));

vi.mock("./approvals", () => ({
	createClockOutApprovalRequest: mockState.createClockOutApprovalRequest,
	createManualEntryApprovalRequest: mockState.createManualEntryApprovalRequest,
	sendClockOutApprovalNotifications:
		mockState.sendClockOutApprovalNotifications,
	sendClockOutApprovedNotification: mockState.sendClockOutApprovedNotification,
	sendManualEntryApprovalNotifications:
		mockState.sendManualEntryApprovalNotifications,
	sendManualEntryApprovedNotification:
		mockState.sendManualEntryApprovedNotification,
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

const { addBreakToActiveSession, clockIn, clockOut, createManualTimeEntry } =
	await import("./clocking");

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
		mockState.createCanonicalWorkRecord.mockResolvedValue({
			id: "canonical-1",
		});
		mockState.clockingClockIn.mockImplementation(async (input) => {
			const entry = await mockState.createTimeEntry({
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				type: "clock_in",
				timestamp: new Date("2026-05-04T09:00:00.000Z"),
				createdBy: input.createdBy,
				...input.action,
			});
			await mockState.insertValues({
				workLocationType: input.workLocationType,
			});
			return { entry };
		});
	});

	it("rejects suspended organizations before creating a clock-in entry", async () => {
		mockState.requireBillingForMutation.mockResolvedValue({
			canAccess: false,
			reason: "trial_expired",
		});
		mockState.isBillingMutationAllowed.mockReturnValue(false);

		const result = await clockIn("remote");

		expect(mockState.requireBillingForMutation).toHaveBeenCalledWith("org-1");
		expect(result).toEqual({
			success: false,
			error: "billing_required",
			code: "trial_expired",
		});
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

	it("stores browser-derived timezone capture when clocking in with a valid browser timezone", async () => {
		const result = await clockIn("office", {
			browserTimezone: "America/New_York",
		});

		expect(result.success).toBe(true);
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				timezone: "America/New_York",
				timezoneSource: "browser",
				utcOffsetMinutes: -240,
			}),
		);
	});

	it("falls back to saved timezone capture when clocking in with an invalid browser timezone", async () => {
		mockState.getUserTimezone.mockResolvedValue("Europe/Berlin");

		const result = await clockIn("office", { browserTimezone: "Not/AZone" });

		expect(result.success).toBe(true);
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
				utcOffsetMinutes: 120,
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

		expect(result).toEqual({
			success: false,
			error: "Invalid work location type",
		});
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
		mockState.updateWhere.mockReturnValue({
			returning: mockState.updateReturning,
		});
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
		});
		mockState.findEmployees.mockResolvedValue([
			{
				id: "employee-1",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
			},
			{
				id: "manager-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
		]);
		mockState.findManagerLinks.mockResolvedValue([
			{ employeeId: "employee-1", managerId: "manager-1", isPrimary: true },
		]);
		mockState.findTeamMemberships.mockResolvedValue([]);
		mockState.findTeams.mockResolvedValue([]);
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
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);
		mockState.checkComplianceAfterClockOut.mockResolvedValue([]);
		mockState.enforceBreaksAfterClockOut.mockResolvedValue({
			wasAdjusted: false,
		});
		mockState.createCanonicalWorkRecord.mockResolvedValue({
			id: "canonical-1",
		});
		mockState.markEmployeeWorkBalanceDirty.mockResolvedValue(undefined);
		mockState.requireBillingForMutation.mockResolvedValue({ canAccess: true });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
		mockState.createClockOutApprovalRequest.mockResolvedValue({
			kind: "default_created",
			approvalRequestId: "approval-1",
		});
		mockState.sendClockOutApprovalNotifications.mockResolvedValue(undefined);
		mockState.sendClockOutApprovedNotification.mockResolvedValue(undefined);
		mockState.clockingClockOut.mockImplementation(async (input) => {
			const activePeriod = {
				id: "period-1",
				startTime: new Date("2026-05-04T09:00:00.000Z"),
			};
			const durationMinutes = 60;
			const transaction = {};
			const periodPatch = await input.beforePeriodClose?.({
				transaction,
				activePeriod,
				durationMinutes,
			});
			const entry = await mockState.createTimeEntry({
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				type: "clock_out",
				timestamp: new Date("2026-05-04T10:00:00.000Z"),
				createdBy: input.createdBy,
				...input.action,
			});
			mockState.updateSet({
				approvalStatus: input.approvalStatus,
				pendingChanges: input.pendingChanges,
				...periodPatch,
			});
			const period = { id: "period-1" };
			const transactionResult = await input.afterPeriodClose?.({
				transaction,
				activePeriod,
				durationMinutes,
				entry,
				period,
			});
			return {
				entry,
				durationMinutes,
				period,
				activePeriod,
				transactionResult,
			};
		});
	});

	it("rejects suspended organizations before creating a clock-out entry", async () => {
		mockState.requireBillingForMutation.mockResolvedValue({
			canAccess: false,
			reason: "payment_failed",
		});
		mockState.isBillingMutationAllowed.mockReturnValue(false);

		const result = await clockOut();

		expect(mockState.requireBillingForMutation).toHaveBeenCalledWith("org-1");
		expect(result).toEqual({
			success: false,
			error: "billing_required",
			code: "payment_failed",
		});
		expect(mockState.transaction).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("routes approval-required live clock-out through the primary manager link", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);

		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.checkClockOutNeedsApproval).toHaveBeenCalledWith(
			"employee-1",
		);
		expect(result.success && result.data.pendingApproval).toBe(true);
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				approvalStatus: "pending",
				pendingChanges: expect.objectContaining({
					originalStartTime: "2026-05-04T09:00:00.000Z",
					originalEndTime: "2026-05-04T10:00:00.000Z",
					originalDurationMinutes: 60,
					requestedBy: "user-1",
					isNewClockOut: true,
				}),
			}),
		);
		expect(mockState.createClockOutApprovalRequest).toHaveBeenCalledWith(
			{
				workPeriodId: "period-1",
				employeeId: "employee-1",
				managerId: "manager-1",
				organizationId: "org-1",
				startTime: new Date("2026-05-04T09:00:00.000Z"),
				endTime: new Date("2026-05-04T10:00:00.000Z"),
				durationMinutes: 60,
			},
			expect.objectContaining({ notify: false, dbService: expect.anything() }),
		);
	});

	it("does not report a pending clock-out when its approval auto-completes", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.createClockOutApprovalRequest.mockResolvedValue({
			kind: "auto_completed",
			approvalRequestId: "approval-1",
			chainInstanceId: null,
			reason: "requester_is_approver",
		});

		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(result.success && result.data.pendingApproval).toBe(false);
		expect(mockState.createClockOutApprovalRequest).toHaveBeenCalledOnce();
	});

	it("rejects approval-required live clock-out when no manager link resolves", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.findManagerLinks.mockResolvedValue([]);

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

	it("rejects approval-required clock-out when no manager is assigned", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.findManagerLinks.mockResolvedValue([]);

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
		mockState.checkClockOutNeedsApproval.mockRejectedValueOnce(
			new Error("policy unavailable"),
		);

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
		expect(mockState.clockingClockOut.mock.invocationCallOrder[0]).toBeLessThan(
			mockState.markEmployeeWorkBalanceDirty.mock.invocationCallOrder[0],
		);
	});

	it("marks the work balance dirty after break enforcement can adjust the closed period", async () => {
		mockState.enforceBreaksAfterClockOut.mockResolvedValueOnce({
			wasAdjusted: true,
			adjustment: { breakMinutes: 30 },
		});

		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.enforceBreaksAfterClockOut).toHaveBeenCalled();
		expect(
			mockState.enforceBreaksAfterClockOut.mock.invocationCallOrder[0],
		).toBeLessThan(
			mockState.markEmployeeWorkBalanceDirty.mock.invocationCallOrder[0],
		);
	});

	it("keeps clock-out successful when dirty marking fails", async () => {
		mockState.markEmployeeWorkBalanceDirty.mockRejectedValueOnce(
			new Error("dirty marker failed"),
		);

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

	it("routes the clock-out entry and period close through the transactional service", async () => {
		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.clockingClockOut).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				createdBy: "user-1",
				action: expect.objectContaining({ timezone: "UTC" }),
			}),
		);
	});

	it("rolls back the live clock-out source rows when approval creation fails", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		const durableState = {
			entries: [] as string[],
			periods: [] as string[],
			canonicalRecords: [] as string[],
			approvals: [] as string[],
		};
		mockState.createCanonicalWorkRecord.mockImplementation(async () => {
			durableState.canonicalRecords.push("canonical-1");
			return { id: "canonical-1" };
		});
		mockState.createClockOutApprovalRequest.mockImplementation(async () => {
			durableState.approvals.push("approval-1");
			throw new Error("approval creation failed");
		});
		mockState.clockingClockOut.mockImplementation(async (input) => {
			const snapshot = Object.fromEntries(
				Object.entries(durableState).map(([key, rows]) => [key, rows.length]),
			) as Record<keyof typeof durableState, number>;
			try {
				const activePeriod = {
					id: "period-1",
					startTime: new Date("2026-05-04T09:00:00.000Z"),
				};
				const durationMinutes = 60;
				const transaction = {};
				const periodPatch = await input.beforePeriodClose?.({
					transaction,
					activePeriod,
					durationMinutes,
				});
				durableState.entries.push("clock-out-1");
				durableState.periods.push("period-1");
				const entry = { id: "clock-out-1", type: "clock_out" };
				const period = { id: "period-1", ...periodPatch };
				const transactionResult = await input.afterPeriodClose?.({
					transaction,
					activePeriod,
					durationMinutes,
					entry,
					period,
				});
				return {
					entry,
					period,
					activePeriod,
					durationMinutes,
					transactionResult,
				};
			} catch (error) {
				for (const key of Object.keys(durableState) as Array<
					keyof typeof durableState
				>) {
					durableState[key].length = snapshot[key];
				}
				throw error;
			}
		});

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(durableState).toEqual({
			entries: [],
			periods: [],
			canonicalRecords: [],
			approvals: [],
		});
	});

	it("stores browser-derived timezone capture when clocking out with a valid browser timezone", async () => {
		const result = await clockOut(undefined, undefined, {
			browserTimezone: "America/New_York",
		});

		expect(result.success).toBe(true);
		expect(mockState.clockingClockOut).toHaveBeenCalledWith(
			expect.objectContaining({
				action: expect.objectContaining({
					timezone: "America/New_York",
					timezoneSource: "browser",
					utcOffsetMinutes: -240,
				}),
			}),
		);
	});

	it("returns a failure when the active period update affects no rows", async () => {
		mockState.clockingClockOut.mockRejectedValueOnce(
			new Error("Active work period changed"),
		);

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.checkComplianceAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.enforceBreaksAfterClockOut).not.toHaveBeenCalled();
	});

	it("does not mark work balance dirty when rejecting approval-required clock-out without a manager", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.findManagerLinks.mockResolvedValue([]);

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "No manager assigned to approve time changes",
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
		mockState.findWorkPeriods.mockResolvedValue([]);
		mockState.findEmployees.mockResolvedValue([
			{
				id: "employee-1",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
			},
			{
				id: "manager-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
		]);
		mockState.findManagerLinks.mockResolvedValue([]);
		mockState.findTeamMemberships.mockResolvedValue([]);
		mockState.findTeams.mockResolvedValue([]);
		mockState.transaction.mockImplementation(async (callback) =>
			callback({
				insert: vi.fn(() => ({
					values: (...args: unknown[]) => mockState.insertValues(...args),
				})),
			}),
		);
	});

	it("fails closed for approval-required manual entries when no approver resolves", async () => {
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1", type: "clock_in" })
			.mockResolvedValueOnce({ id: "clock-out-1", type: "clock_out" });
		mockState.createCanonicalWorkRecord.mockResolvedValue({
			id: "canonical-1",
		});
		mockState.insertValues.mockReturnValueOnce({
			returning: mockState.insertReturning,
		});
		mockState.insertReturning.mockResolvedValueOnce([{ id: "period-1" }]);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);
		mockState.createManualEntryApprovalRequest.mockRejectedValue(
			new ValidationError({
				message: "No manager assigned to approve time changes",
				field: "managerId",
			}),
		);

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
		expect(mockState.createManualEntryApprovalRequest).toHaveBeenCalledWith(
			expect.objectContaining({ managerId: null }),
			expect.objectContaining({ notify: false, dbService: expect.anything() }),
		);
	});

	it("fails closed when the manual-entry edit capability check fails before mutating", async () => {
		mockState.getEditCapabilityForPeriod.mockRejectedValueOnce(
			new Error("policy unavailable"),
		);

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
		mockState.getEditCapabilityForPeriod.mockResolvedValue({
			type: "direct",
			reason: "within_window",
		});
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1" })
			.mockResolvedValueOnce({ id: "clock-out-1" });
		mockState.insertValues.mockReturnValueOnce({
			returning: mockState.insertReturning,
		});
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

	it("uses submitted timezone for self manual entries when browser timezone differs", async () => {
		mockState.getEditCapabilityForPeriod.mockResolvedValue({
			type: "direct",
			reason: "within_window",
		});
		mockState.getUserTimezone.mockResolvedValue("Europe/Berlin");
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1" })
			.mockResolvedValueOnce({ id: "clock-out-1" });
		mockState.insertValues.mockReturnValueOnce({
			returning: mockState.insertReturning,
		});
		mockState.insertReturning.mockResolvedValueOnce([{ id: "period-1" }]);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);

		const result = await createManualTimeEntry({
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			timezone: "Europe/Berlin",
			browserTimezone: "America/New_York",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				type: "clock_in",
				timestamp: new Date("2026-05-04T06:00:00.000Z"),
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
				utcOffsetMinutes: 120,
			}),
			expect.anything(),
		);
		expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				type: "clock_out",
				timestamp: new Date("2026-05-04T07:00:00.000Z"),
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
				utcOffsetMinutes: 120,
			}),
			expect.anything(),
		);
		expect(mockState.getEditCapabilityForPeriod).toHaveBeenCalledWith(
			expect.objectContaining({
				workPeriodEndTime: new Date("2026-05-04T07:00:00.000Z"),
				timezone: "Europe/Berlin",
			}),
		);
	});

	it("uses browser capture for self manual entries when it matches the effective timezone", async () => {
		vi.setSystemTime(new Date("2026-05-04T14:00:00.000Z"));
		mockState.getEditCapabilityForPeriod.mockResolvedValue({
			type: "direct",
			reason: "within_window",
		});
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1" })
			.mockResolvedValueOnce({ id: "clock-out-1" });
		mockState.insertValues.mockReturnValueOnce({
			returning: mockState.insertReturning,
		});
		mockState.insertReturning.mockResolvedValueOnce([{ id: "period-1" }]);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);

		const result = await createManualTimeEntry({
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			timezone: "America/New_York",
			browserTimezone: "America/New_York",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				type: "clock_in",
				timestamp: new Date("2026-05-04T12:00:00.000Z"),
				timezone: "America/New_York",
				timezoneSource: "browser",
				utcOffsetMinutes: -240,
			}),
			expect.anything(),
		);
	});

	it("uses target employee identity and saved timezone for manager manual entries", async () => {
		mockState.getCurrentSession.mockResolvedValue({
			user: { id: "manager-user" },
		});
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "manager-1",
			userId: "manager-user",
			organizationId: "org-1",
			teamId: "team-1",
			managerId: null,
			role: "manager",
		});
		mockState.findEmployees.mockResolvedValue([
			{
				id: "manager-1",
				userId: "manager-user",
				organizationId: "org-1",
				teamId: "team-1",
				isActive: true,
				role: "manager",
			},
			{
				id: "staff-1",
				userId: "staff-user",
				organizationId: "org-1",
				teamId: "team-1",
				isActive: true,
				role: "employee",
			},
		]);
		mockState.findManagerLinks.mockResolvedValue([{ employeeId: "staff-1" }]);
		mockState.getUserTimezone.mockImplementation(async (userId: string) =>
			userId === "staff-user" ? "Europe/Berlin" : "UTC",
		);
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1" })
			.mockResolvedValueOnce({ id: "clock-out-1" });
		mockState.insertValues.mockReturnValueOnce({
			returning: mockState.insertReturning,
		});
		mockState.insertReturning.mockResolvedValueOnce([{ id: "period-1" }]);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);

		const result = await createManualTimeEntry({
			employeeId: "staff-1",
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			timezone: "America/New_York",
			browserTimezone: "America/New_York",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.getEditCapabilityForPeriod).not.toHaveBeenCalled();
		expect(mockState.validateProjectAssignment).not.toHaveBeenCalled();
		expect(mockState.findWorkPeriods).toHaveBeenCalledWith(
			expect.objectContaining({ where: expect.anything() }),
		);
		expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				employeeId: "staff-1",
				organizationId: "org-1",
				timestamp: new Date("2026-05-04T06:00:00.000Z"),
				timezone: "Europe/Berlin",
				timezoneSource: "manager_target_user_setting",
				utcOffsetMinutes: 120,
			}),
			expect.anything(),
		);
		expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				employeeId: "staff-1",
				organizationId: "org-1",
				timestamp: new Date("2026-05-04T07:00:00.000Z"),
				timezone: "Europe/Berlin",
				timezoneSource: "manager_target_user_setting",
				utcOffsetMinutes: 120,
			}),
			expect.anything(),
		);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "staff-1",
				organizationId: "org-1",
			}),
		);
		expect(mockState.markEmployeeWorkBalanceDirty).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "staff-1",
				organizationId: "org-1",
			}),
		);
	});

	it("rejects same-organization manual entries for unauthorized target employees before writing", async () => {
		mockState.getCurrentSession.mockResolvedValue({
			user: { id: "employee-user" },
		});
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "employee-1",
			userId: "employee-user",
			organizationId: "org-1",
			teamId: "team-1",
			managerId: null,
			role: "employee",
		});
		mockState.findEmployees.mockResolvedValue([
			{
				id: "employee-2",
				userId: "other-user",
				organizationId: "org-1",
				teamId: "team-1",
				isActive: true,
				role: "employee",
			},
		]);
		mockState.findManagerLinks.mockResolvedValue([]);

		const result = await createManualTimeEntry({
			employeeId: "employee-2",
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			timezone: "UTC",
			reason: "Trying to edit another employee",
		});

		expect(result).toEqual({
			success: false,
			error: "Not authorized to create time entries for this employee",
		});
		expect(mockState.validateTimeEntryRange).not.toHaveBeenCalled();
		expect(mockState.getEditCapabilityForPeriod).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("keeps manual entry creation successful when dirty marking fails", async () => {
		mockState.getEditCapabilityForPeriod.mockResolvedValue({
			type: "direct",
			reason: "within_window",
		});
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1" })
			.mockResolvedValueOnce({ id: "clock-out-1" });
		mockState.insertValues.mockReturnValueOnce({
			returning: mockState.insertReturning,
		});
		mockState.insertReturning.mockResolvedValueOnce([{ id: "period-1" }]);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);
		mockState.markEmployeeWorkBalanceDirty.mockRejectedValueOnce(
			new Error("dirty marker failed"),
		);

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

describe("createManualTimeEntry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T10:00:00.000Z"));

		mockState.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
		mockState.getCurrentEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			teamId: null,
		});
		mockState.getUserTimezone.mockResolvedValue("UTC");
		mockState.validateTimeEntryRange.mockResolvedValue({ isValid: true });
		mockState.validateProjectAssignment.mockResolvedValue({ isValid: true });
		mockState.getEditCapabilityForPeriod.mockResolvedValue({
			type: "approval_required",
			daysBack: 7,
		});
		mockState.findWorkPeriods.mockResolvedValue([]);
		mockState.findEmployees.mockResolvedValue([
			{
				id: "employee-1",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
			},
			{
				id: "manager-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
		]);
		mockState.findManagerLinks.mockResolvedValue([
			{ employeeId: "employee-1", managerId: "manager-1", isPrimary: true },
		]);
		mockState.findTeamMemberships.mockResolvedValue([]);
		mockState.findTeams.mockResolvedValue([]);
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1", type: "clock_in" })
			.mockResolvedValueOnce({ id: "clock-out-1", type: "clock_out" });
		mockState.createCanonicalWorkRecord.mockResolvedValue({
			id: "canonical-1",
		});
		mockState.insertValues.mockReturnValue({
			returning: vi.fn().mockResolvedValue([{ id: "period-1" }]),
		});
		mockState.createManualEntryApprovalRequest.mockResolvedValue({
			kind: "default_created",
			approvalRequestId: "approval-1",
		});
		mockState.sendManualEntryApprovalNotifications.mockResolvedValue(undefined);
		mockState.sendManualEntryApprovedNotification.mockResolvedValue(undefined);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);
		mockState.markEmployeeWorkBalanceDirty.mockResolvedValue(undefined);
		mockState.requireBillingForMutation.mockResolvedValue({ canAccess: true });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
		mockState.transaction.mockImplementation(async (callback) =>
			callback({
				insert: vi.fn(() => ({
					values: (...args: unknown[]) => mockState.insertValues(...args),
				})),
			}),
		);
	});

	it("routes approval-required manual entries through the primary manager link", async () => {
		const result = await createManualTimeEntry({
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.createManualEntryApprovalRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				workPeriodId: "period-1",
				employeeId: "employee-1",
				managerId: "manager-1",
				organizationId: "org-1",
			}),
			expect.objectContaining({ notify: false, dbService: expect.anything() }),
		);
		expect(
			mockState.sendManualEntryApprovalNotifications,
		).toHaveBeenCalledOnce();
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				approvalStatus: "pending",
				canonicalRecordId: "canonical-1",
			}),
		);
		expect(mockState.createCanonicalWorkRecord).toHaveBeenCalledWith(
			expect.objectContaining({ approvalState: "pending", origin: "manual" }),
			expect.anything(),
		);
	});

	it("keeps an explicit policy reviewer route pending without a fallback manager", async () => {
		mockState.findManagerLinks.mockResolvedValue([]);
		mockState.createManualEntryApprovalRequest.mockResolvedValue({
			kind: "chain_created",
			approvalRequestId: "approval-1",
			chainInstanceId: "chain-1",
		});

		const result = await createManualTimeEntry({
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: { workPeriodId: "period-1", requiresApproval: true },
		});
		expect(mockState.createManualEntryApprovalRequest).toHaveBeenCalledWith(
			expect.objectContaining({ managerId: null }),
			expect.objectContaining({ notify: false, dbService: expect.anything() }),
		);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				approvalStatus: "pending",
				pendingChanges: expect.objectContaining({ isManualEntry: true }),
			}),
		);
	});

	it("finalizes auto-completed manual approval in the source transaction and notifies after commit", async () => {
		mockState.createManualEntryApprovalRequest.mockResolvedValue({
			kind: "auto_completed",
			approvalRequestId: "approval-1",
			chainInstanceId: null,
			reason: "requester_is_approver",
		});
		mockState.transaction.mockImplementation(async (callback) => {
			mockState.transactionOpen = true;
			try {
				return await callback({
					query: {},
					insert: vi.fn(() => ({
						values: (...args: unknown[]) => mockState.insertValues(...args),
					})),
				});
			} finally {
				mockState.transactionOpen = false;
			}
		});
		mockState.sendManualEntryApprovedNotification.mockImplementation(
			async () => {
				expect(mockState.transactionOpen).toBe(false);
			},
		);

		const result = await createManualTimeEntry({
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: { requiresApproval: false },
		});
		expect(mockState.createManualEntryApprovalRequest).toHaveBeenCalledWith(
			expect.objectContaining({ workPeriodId: "period-1" }),
			expect.objectContaining({ notify: false, dbService: expect.anything() }),
		);
		expect(
			mockState.sendManualEntryApprovedNotification,
		).toHaveBeenCalledOnce();
		expect(
			mockState.sendManualEntryApprovalNotifications,
		).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).toHaveBeenCalledWith(
			"period-1",
			"org-1",
		);
	});

	it("rolls back every manual source row when auto-completion finalization fails", async () => {
		const durableState = {
			entries: [] as string[],
			workPeriods: [] as string[],
			canonicalRecords: [] as string[],
			approvals: [] as string[],
		};
		mockState.createTimeEntry.mockReset();
		mockState.createTimeEntry.mockImplementation(async (input) => {
			const id = input.type === "clock_in" ? "clock-in-1" : "clock-out-1";
			durableState.entries.push(id);
			return { id, type: input.type };
		});
		mockState.createCanonicalWorkRecord.mockImplementation(async () => {
			durableState.canonicalRecords.push("canonical-1");
			return { id: "canonical-1" };
		});
		mockState.insertValues.mockImplementation((values) => {
			durableState.workPeriods.push("period-1");
			return {
				returning: vi.fn().mockResolvedValue([{ id: "period-1", ...values }]),
			};
		});
		mockState.createManualEntryApprovalRequest.mockImplementation(async () => {
			durableState.approvals.push("approval-1");
			throw new Error("auto-completion finalizer failed");
		});
		mockState.transaction.mockImplementation(async (callback) => {
			const snapshot = {
				entries: durableState.entries.length,
				workPeriods: durableState.workPeriods.length,
				canonicalRecords: durableState.canonicalRecords.length,
				approvals: durableState.approvals.length,
			};
			try {
				return await callback({
					query: {},
					insert: vi.fn(() => ({
						values: (...args: unknown[]) => mockState.insertValues(...args),
					})),
				});
			} catch (error) {
				durableState.entries.length = snapshot.entries;
				durableState.workPeriods.length = snapshot.workPeriods;
				durableState.canonicalRecords.length = snapshot.canonicalRecords;
				durableState.approvals.length = snapshot.approvals;
				throw error;
			}
		});

		const result = await createManualTimeEntry({
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to create time entry. Please try again.",
		});
		expect(durableState).toEqual({
			entries: [],
			workPeriods: [],
			canonicalRecords: [],
			approvals: [],
		});
		expect(
			mockState.sendManualEntryApprovedNotification,
		).not.toHaveBeenCalled();
		expect(
			mockState.sendManualEntryApprovalNotifications,
		).not.toHaveBeenCalled();
	});

	it("rolls back approval-required manual entries when no manager or policy approver resolves", async () => {
		mockState.findManagerLinks.mockResolvedValue([]);
		const durableState = {
			entries: [] as string[],
			workPeriods: [] as string[],
			canonicalRecords: [] as string[],
			approvals: [] as string[],
		};
		mockState.createTimeEntry.mockReset();
		mockState.createTimeEntry.mockImplementation(async (input) => {
			const id = input.type === "clock_in" ? "clock-in-1" : "clock-out-1";
			durableState.entries.push(id);
			return { id, type: input.type };
		});
		mockState.createCanonicalWorkRecord.mockImplementation(async () => {
			durableState.canonicalRecords.push("canonical-1");
			return { id: "canonical-1" };
		});
		mockState.insertValues.mockImplementation((values) => {
			durableState.workPeriods.push("period-1");
			return {
				returning: vi.fn().mockResolvedValue([{ id: "period-1", ...values }]),
			};
		});
		mockState.createManualEntryApprovalRequest.mockImplementation(async () => {
			durableState.approvals.push("approval-1");
			throw new ValidationError({
				message: "No manager assigned to approve time changes",
				field: "managerId",
			});
		});
		mockState.transaction.mockImplementation(async (callback) => {
			const snapshot = {
				entries: durableState.entries.length,
				workPeriods: durableState.workPeriods.length,
				canonicalRecords: durableState.canonicalRecords.length,
				approvals: durableState.approvals.length,
			};
			try {
				return await callback({
					query: {},
					insert: vi.fn(() => ({
						values: (...args: unknown[]) => mockState.insertValues(...args),
					})),
				});
			} catch (error) {
				durableState.entries.length = snapshot.entries;
				durableState.workPeriods.length = snapshot.workPeriods;
				durableState.canonicalRecords.length = snapshot.canonicalRecords;
				durableState.approvals.length = snapshot.approvals;
				throw error;
			}
		});

		const result = await createManualTimeEntry({
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "No manager assigned to approve time changes",
		});
		expect(durableState).toEqual({
			entries: [],
			workPeriods: [],
			canonicalRecords: [],
			approvals: [],
		});
	});
});

describe("addBreakToActiveSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.insertReturning.mockReset();
		mockState.createTimeEntry.mockReset();
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
		mockState.updateWhere.mockReturnValue({
			returning: mockState.updateReturning,
		});
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
		mockState.insertValues.mockReturnValueOnce({
			returning: mockState.insertReturning,
		});

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
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_out",
				timestamp: new Date("2026-05-04T09:45:00.000Z"),
				createdBy: "user-1",
			}),
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
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_in",
				timestamp: new Date("2026-05-04T10:00:00.000Z"),
				createdBy: "user-1",
			}),
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
		mockState.insertValues.mockReturnValueOnce({
			returning: mockState.insertReturning,
		});

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
		mockState.insertValues.mockReturnValueOnce({
			returning: mockState.insertReturning,
		});

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
		mockState.insertValues.mockReturnValueOnce({
			returning: mockState.insertReturning,
		});

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
