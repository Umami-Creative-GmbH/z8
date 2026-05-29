import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getSession: vi.fn(),
	headers: vi.fn(),
	findCurrentEmployee: vi.fn(),
	findTargetEmployee: vi.fn(),
	findUserSettings: vi.fn(),
	findManagedRecords: vi.fn(),
	findWorkPeriods: vi.fn(),
	findProject: vi.fn(),
	findProjectAssignment: vi.fn(),
	findWorkCategory: vi.fn(),
	employeeHasAccessToCategory: vi.fn(),
	createCanonicalTimeEntry: vi.fn(),
	createCanonicalWorkRecord: vi.fn(),
	insertValues: vi.fn(),
	insertReturning: vi.fn(),
	validateTimeEntryRange: vi.fn(),
	validateProjectAssignment: vi.fn(),
	runPromise: vi.fn(),
	requireBillingForMutation: vi.fn(),
	isBillingMutationAllowed: vi.fn(),
	createManualEntryApprovalRequest: vi.fn(),
	calculateAndPersistSurcharges: vi.fn(),
	markEmployeeWorkBalanceDirty: vi.fn(),
	getPrimaryEligibleManagerIdForRequester: vi.fn(),
	eq: vi.fn((column: unknown, value: unknown) => ({ type: "eq", column, value })),
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("effect", () => ({
	Effect: {
		gen: vi.fn(() => ({ pipe: vi.fn(() => ({})) })),
		provide: vi.fn(),
		runPromise: mockState.runPromise,
	},
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
	desc: vi.fn((column: unknown) => ({ type: "desc", column })),
	eq: mockState.eq,
	gte: vi.fn((column: unknown, value: unknown) => ({ type: "gte", column, value })),
	inArray: vi.fn((column: unknown, values: unknown[]) => ({ type: "inArray", column, values })),
	isNull: vi.fn((column: unknown) => ({ type: "isNull", column })),
	lte: vi.fn((column: unknown, value: unknown) => ({ type: "lte", column, value })),
	or: vi.fn((...conditions: unknown[]) => ({ type: "or", conditions })),
	sql: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: vi.fn((...args: unknown[]) =>
					mockState.findCurrentEmployee.mock.calls.length === 0
						? mockState.findCurrentEmployee(...args)
						: mockState.findTargetEmployee(...args),
				),
			},
			employeeManagers: { findMany: mockState.findManagedRecords },
			userSettings: { findFirst: mockState.findUserSettings },
			project: { findFirst: mockState.findProject },
			projectAssignment: { findFirst: mockState.findProjectAssignment },
			workCategory: { findFirst: mockState.findWorkCategory },
			workPeriod: { findMany: mockState.findWorkPeriods },
		},
		insert: vi.fn(() => ({
			values: (...args: unknown[]) => mockState.insertValues(...args),
		})),
	},
}));

vi.mock("@/db/schema", () => ({
	absenceCategory: {},
	absenceEntry: {},
	approvalRequest: {},
	employee: {
		id: "employee.id",
		isActive: "employee.isActive",
		organizationId: "employee.organizationId",
		userId: "employee.userId",
	},
	employeeManagers: {
		managerId: "employeeManagers.managerId",
	},
	project: {
		id: "project.id",
		organizationId: "project.organizationId",
	},
	projectAssignment: {
		projectId: "projectAssignment.projectId",
		organizationId: "projectAssignment.organizationId",
		employeeId: "projectAssignment.employeeId",
		teamId: "projectAssignment.teamId",
	},
	surchargeCalculation: {},
	timeEntry: {},
	userSettings: { userId: "userSettings.userId" },
	workPeriod: {
		employeeId: "workPeriod.employeeId",
		organizationId: "workPeriod.organizationId",
		startTime: "workPeriod.startTime",
	},
	workPolicy: {},
	workPolicyPresence: {},
	workCategory: {
		id: "workCategory.id",
		organizationId: "workCategory.organizationId",
		isActive: "workCategory.isActive",
	},
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mockState.getSession } },
}));

vi.mock("@/lib/authorization", async () => {
	const actual = await vi.importActual<typeof import("@/lib/authorization")>("@/lib/authorization");
	return actual;
});

vi.mock("@/lib/billing/guard", () => ({
	isBillingMutationAllowed: mockState.isBillingMutationAllowed,
	requireBillingForMutation: mockState.requireBillingForMutation,
}));

vi.mock("@/lib/datetime/drizzle-adapter", () => ({
	dateFromDB: vi.fn(),
	dateToDB: vi.fn((value) => value?.toJSDate?.() ?? value),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: vi.fn(() => mockState.logger),
}));

vi.mock("@/lib/time-tracking/validation", () => ({
	validateTimeEntry: vi.fn(),
	validateTimeEntryRange: mockState.validateTimeEntryRange,
}));

vi.mock("@/lib/query/work-category.queries", () => ({
	employeeHasAccessToCategory: mockState.employeeHasAccessToCategory,
}));

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: mockState.markEmployeeWorkBalanceDirty,
}));

vi.mock("./actions/approvals", () => ({
	createClockOutApprovalRequest: vi.fn(),
	createManualEntryApprovalRequest: mockState.createManualEntryApprovalRequest,
}));

vi.mock("./actions/clocking", () => ({
	addBreakToActiveSession: vi.fn(),
}));

vi.mock("./actions.canonical", () => ({
	canonicalTimeEntryClient: {
		createTimeEntry: mockState.createCanonicalTimeEntry,
	},
	canonicalWorkRecordClient: {
		createForCompletedPeriod: mockState.createCanonicalWorkRecord,
	},
}));

vi.mock("./actions/compliance", () => ({
	calculateAndPersistSurcharges: mockState.calculateAndPersistSurcharges,
}));

vi.mock("./actions/entry-helpers", () => ({
	validateProjectAssignment: mockState.validateProjectAssignment,
}));

vi.mock("@/lib/effect/errors", () => ({
	AuthorizationError: class AuthorizationError extends Error {},
	NotFoundError: class NotFoundError extends Error {},
	ValidationError: class ValidationError extends Error {},
}));

vi.mock("@/lib/effect/result", () => ({
	runServerActionSafe: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", () => ({ AppLayer: {} }));
vi.mock("@/lib/effect/services/auth.service", () => ({ AuthService: {} }));
vi.mock("@/lib/effect/services/break-enforcement.service", () => ({
	BreakEnforcementService: {},
	BreakEnforcementServiceLive: {},
}));
vi.mock("@/lib/effect/services/change-policy.service", () => ({
	ChangePolicyService: {},
	ChangePolicyServiceLive: {},
}));
vi.mock("@/lib/effect/services/database.service", () => ({
	DatabaseService: {},
	DatabaseServiceLive: {},
}));
vi.mock("@/lib/effect/services/email.service", () => ({ EmailService: {} }));
vi.mock("@/lib/effect/services/surcharge.service", () => ({
	SurchargeService: {},
	SurchargeServiceLive: {},
}));
vi.mock("@/lib/effect/services/time-entry.service", () => ({
	TimeEntryService: {},
	TimeEntryServiceLive: {},
}));
vi.mock("@/lib/effect/services/work-policy.service", () => ({
	WorkPolicyService: {},
	WorkPolicyServiceLive: {},
}));

vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: mockState.getPrimaryEligibleManagerIdForRequester,
}));
vi.mock("@/lib/app-url", () => ({ getOrganizationBaseUrl: vi.fn() }));
vi.mock("@/lib/approvals/server/time-correction-approvals", () => ({
	createTimeCorrectionApprovalWorkflow: vi.fn(),
}));
vi.mock("@/lib/email/render", () => ({ renderTimeCorrectionPendingApproval: vi.fn() }));
vi.mock("@/lib/notifications/project-notification-triggers", () => ({
	checkProjectBudgetWarnings: vi.fn(),
	getProjectTotalHours: vi.fn(),
}));
vi.mock("@/lib/time-tracking/timezone-utils", () => ({
	getMonthRangeInTimezone: vi.fn(),
	getTodayRangeInTimezone: vi.fn(),
	getWeekRangeInTimezone: vi.fn(),
}));
vi.mock("@/lib/time-tracking/work-location", () => ({ isWorkLocationType: vi.fn() }));
vi.mock("@/lib/user-preferences/week-start-server", () => ({ getUserWeekStartDay: vi.fn() }));
vi.mock("./actions/presence-status", () => ({
	calculatePresenceStatusSummary: vi.fn(),
	expandApprovedHomeOfficeDates: vi.fn(),
	getPresencePeriodBounds: vi.fn(),
	getPresenceWorkDays: vi.fn(),
	parsePresenceFixedDays: vi.fn(),
	validatePresenceFixedDaysConfig: vi.fn(),
}));

const { createManualTimeEntry } = await import("./actions");

function containsEq(condition: unknown, column: string, value: unknown): boolean {
	if (!condition || typeof condition !== "object") {
		return false;
	}
	if (
		"type" in condition &&
		condition.type === "eq" &&
		"column" in condition &&
		condition.column === column &&
		"value" in condition &&
		condition.value === value
	) {
		return true;
	}
	if ("conditions" in condition && Array.isArray(condition.conditions)) {
		return condition.conditions.some((child) => containsEq(child, column, value));
	}
	return false;
}

describe("createManualTimeEntry manager-on-behalf", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T12:00:00.000Z"));

		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			user: { id: "manager-user", role: "user" },
			session: { activeOrganizationId: "org-1" },
		});
		mockState.findCurrentEmployee.mockResolvedValue({
			id: "manager-1",
			userId: "manager-user",
			organizationId: "org-1",
			teamId: "team-1",
			role: "manager",
			isActive: true,
		});
		mockState.findTargetEmployee.mockResolvedValue({
			id: "staff-1",
			userId: "staff-user",
			organizationId: "org-1",
			teamId: "team-1",
			role: "employee",
			isActive: true,
		});
		mockState.findUserSettings.mockResolvedValue({ timezone: "UTC" });
		mockState.findManagedRecords.mockResolvedValue([{ employeeId: "staff-1" }]);
		mockState.findWorkPeriods.mockResolvedValue([]);
		mockState.findProject.mockResolvedValue({ id: "project-1", status: "active" });
		mockState.findProjectAssignment.mockResolvedValue({ id: "assignment-1" });
		mockState.findWorkCategory.mockResolvedValue({ id: "category-1", isActive: true });
		mockState.employeeHasAccessToCategory.mockResolvedValue(true);
		mockState.validateTimeEntryRange.mockResolvedValue({ isValid: true });
		mockState.validateProjectAssignment.mockResolvedValue({ isValid: true });
		mockState.runPromise.mockResolvedValue({ type: "approval_required", daysBack: 7 });
		mockState.requireBillingForMutation.mockResolvedValue({ canAccess: true });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
		mockState.createCanonicalTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1" })
			.mockResolvedValueOnce({ id: "clock-out-1" });
		mockState.createCanonicalWorkRecord.mockResolvedValue({ id: "canonical-1" });
		mockState.insertValues.mockReturnValue({ returning: mockState.insertReturning });
		mockState.insertReturning.mockResolvedValue([{ id: "period-1" }]);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);
		mockState.markEmployeeWorkBalanceDirty.mockResolvedValue(undefined);
		mockState.createManualEntryApprovalRequest.mockResolvedValue(undefined);
		mockState.getPrimaryEligibleManagerIdForRequester.mockResolvedValue("approval-manager-1");
	});

	it("rejects work categories outside the target organization before writes", async () => {
		mockState.findWorkCategory.mockResolvedValue(null);

		const result = await createManualTimeEntry({
			employeeId: "staff-1",
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "10:00",
			workCategoryId: "foreign-category-1",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({ success: false, error: "Work category not found" });
		expect(mockState.findWorkCategory).toHaveBeenCalledWith({
			where: expect.objectContaining({ type: "and" }),
		});
		expect(
			containsEq(
				mockState.findWorkCategory.mock.calls[0][0].where,
				"workCategory.id",
				"foreign-category-1",
			),
		).toBe(true);
		expect(
			containsEq(
				mockState.findWorkCategory.mock.calls[0][0].where,
				"workCategory.organizationId",
				"org-1",
			),
		).toBe(true);
		expect(mockState.findWorkPeriods).not.toHaveBeenCalled();
		expect(mockState.createCanonicalTimeEntry).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(mockState.employeeHasAccessToCategory).not.toHaveBeenCalled();
	});

	it("rejects work categories outside the target employee effective set before writes", async () => {
		mockState.employeeHasAccessToCategory.mockResolvedValue(false);

		const result = await createManualTimeEntry({
			employeeId: "staff-1",
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "10:00",
			workCategoryId: "category-1",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({ success: false, error: "Cannot assign to this work category" });
		expect(mockState.employeeHasAccessToCategory).toHaveBeenCalledWith("staff-1", "category-1");
		expect(mockState.findWorkPeriods).not.toHaveBeenCalled();
		expect(mockState.createCanonicalTimeEntry).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("accepts work categories in the target employee effective set", async () => {
		const result = await createManualTimeEntry({
			employeeId: "staff-1",
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "10:00",
			workCategoryId: "category-1",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.employeeHasAccessToCategory).toHaveBeenCalledWith("staff-1", "category-1");
		expect(mockState.createCanonicalWorkRecord).toHaveBeenCalledWith(
			expect.objectContaining({ workCategoryId: "category-1" }),
		);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ workCategoryId: "category-1" }),
		);
	});

	it("validates provided projects and assignments in the target organization", async () => {
		const result = await createManualTimeEntry({
			employeeId: "staff-1",
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "10:00",
			projectId: "project-1",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(containsEq(mockState.findProject.mock.calls[0][0].where, "project.id", "project-1"))
			.toBe(true);
		expect(
			containsEq(mockState.findProject.mock.calls[0][0].where, "project.organizationId", "org-1"),
		).toBe(true);
		expect(
			containsEq(
				mockState.findProjectAssignment.mock.calls[0][0].where,
				"projectAssignment.projectId",
				"project-1",
			),
		).toBe(true);
		expect(
			containsEq(
				mockState.findProjectAssignment.mock.calls[0][0].where,
				"projectAssignment.organizationId",
				"org-1",
			),
		).toBe(true);
	});

	it("creates an approved staff entry for an authorized direct report without approval request", async () => {
		const result = await createManualTimeEntry({
			employeeId: "staff-1",
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.createCanonicalTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "staff-1",
				organizationId: "org-1",
				createdBy: "manager-user",
				type: "clock_in",
			}),
		);
		expect(mockState.createCanonicalTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "staff-1",
				organizationId: "org-1",
				createdBy: "manager-user",
				type: "clock_out",
			}),
		);
		expect(mockState.createCanonicalWorkRecord).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "staff-1",
				organizationId: "org-1",
				approvalState: "approved",
				createdBy: "manager-user",
			}),
		);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "staff-1",
				organizationId: "org-1",
				approvalStatus: "approved",
				pendingChanges: null,
			}),
		);
		expect(mockState.findWorkPeriods).toHaveBeenCalled();
		expect(mockState.eq).toHaveBeenCalledWith("workPeriod.employeeId", "staff-1");
		expect(mockState.eq).toHaveBeenCalledWith("workPeriod.organizationId", "org-1");
		expect(mockState.createManualEntryApprovalRequest).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			employeeId: "staff-1",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-04",
		});
	});

	it("parses submitted manual entry times in a valid submitted timezone", async () => {
		vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));

		const result = await createManualTimeEntry({
			employeeId: "staff-1",
			date: "2026-05-29",
			clockInTime: "10:15",
			clockOutTime: "12:45",
			timezone: "Europe/Berlin",
			reason: "Calendar adjustment",
		});

		expect(result.success).toBe(true);
		expect(mockState.createCanonicalTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "clock_in",
				timestamp: new Date("2026-05-29T08:15:00.000Z"),
			}),
		);
		expect(mockState.createCanonicalTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "clock_out",
				timestamp: new Date("2026-05-29T10:45:00.000Z"),
			}),
		);
		expect(mockState.createCanonicalWorkRecord).toHaveBeenCalledWith(
			expect.objectContaining({
				startAt: new Date("2026-05-29T08:15:00.000Z"),
				endAt: new Date("2026-05-29T10:45:00.000Z"),
			}),
		);
	});

	it("rejects invalid submitted timezones before writes", async () => {
		const result = await createManualTimeEntry({
			employeeId: "staff-1",
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "10:00",
			timezone: "Not/AZone",
			reason: "Calendar adjustment",
		});

		expect(result).toEqual({ success: false, error: "Invalid timezone" });
		expect(mockState.validateTimeEntryRange).not.toHaveBeenCalled();
		expect(mockState.findWorkPeriods).not.toHaveBeenCalled();
		expect(mockState.createCanonicalTimeEntry).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("rejects unauthorized target employees before writes and target-scoped checks", async () => {
		mockState.findManagedRecords.mockResolvedValue([]);

		const result = await createManualTimeEntry({
			employeeId: "staff-1",
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "Not authorized to create time entries for this employee",
		});
		expect(mockState.validateTimeEntryRange).not.toHaveBeenCalled();
		expect(mockState.findWorkPeriods).not.toHaveBeenCalled();
		expect(mockState.createCanonicalTimeEntry).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(mockState.createManualEntryApprovalRequest).not.toHaveBeenCalled();
	});

	it("keeps own manual entries approval-required when policy requires approval", async () => {
		mockState.findTargetEmployee.mockResolvedValue(null);
		mockState.findManagedRecords.mockResolvedValue([{ employeeId: "staff-1" }]);

		const result = await createManualTimeEntry({
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.runPromise).toHaveBeenCalled();
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "manager-1",
				approvalStatus: "pending",
				pendingChanges: expect.objectContaining({
					requestedBy: "manager-user",
					isManualEntry: true,
				}),
			}),
		);
		expect(mockState.createManualEntryApprovalRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "manager-1",
				organizationId: "org-1",
			}),
		);
	});
});
