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
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/db", () => ({
	db: {
		update: vi.fn(() => ({
			set: mockState.updateSet,
		})),
	},
}));

vi.mock("@/db/schema", () => ({
	workPeriod: {
		id: "workPeriod.id",
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

const { clockOut } = await import("./clocking");

describe("clockOut", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T10:00:00.000Z"));

		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.updateWhere.mockResolvedValue(undefined);
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
});
