import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveApprovalWorkflowId } from "@/lib/approvals/workflow/identity";
import { ValidationError } from "@/lib/effect/errors";

const mockState = vi.hoisted(() => ({
	getCurrentSession: vi.fn(),
	getCurrentEmployee: vi.fn(),
	getUserTimezone: vi.fn(),
	getActiveWorkPeriod: vi.fn(),
	validateTimeEntry: vi.fn(),
	validateTimeEntryRange: vi.fn(),
	validateProjectAssignment: vi.fn(),
	findWorkCategory: vi.fn(),
	employeeHasAccessToCategory: vi.fn(),
	createTimeEntry: vi.fn(),
	checkClockOutNeedsApproval: vi.fn(),
	getEditCapabilityForPeriod: vi.fn(),
	createClockOutApprovalRequest: vi.fn(),
	sendClockOutApprovalNotifications: vi.fn(),
	sendClockOutApprovedNotification: vi.fn(),
	createManualEntryApprovalRequest: vi.fn(),
	executeOrdinarySubmission: vi.fn(),
	useRealOrdinarySubmission: false,
	sendManualEntryApprovalNotifications: vi.fn(),
	sendManualEntryApprovedNotification: vi.fn(),
	transactionOpen: false,
	calculateAndPersistSurcharges: vi.fn(),
	checkComplianceAfterClockOut: vi.fn(),
	enforceBreaksAfterClockOut: vi.fn(),
	checkProjectBudgetAfterClockOut: vi.fn(),
	markEmployeeWorkBalanceDirty: vi.fn(),
	reconcileOrdinaryMaintenance: vi.fn(),
	isBillingMutationAllowed: vi.fn(),
	requireBillingForMutation: vi.fn(),
	revalidatePath: vi.fn(),
	insertValues: vi.fn(),
	insertReturning: vi.fn(),
	findWorkPeriods: vi.fn(),
	findExistingPeriod: vi.fn(),
	findPolicyPeriods: vi.fn(),
	findApprovalRequests: vi.fn(),
	findCanonicalRecord: vi.fn(),
	findCanonicalWork: vi.fn(),
	findCanonicalAllocations: vi.fn(),
	findEmployees: vi.fn(),
	findEmployee: vi.fn(),
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
	resolveBreakPolicySnapshot: vi.fn(
		async (input: { endTime: { toString(): string } }) => ({
			version: 1 as const,
			evaluatedAt: input.endTime.toString(),
			resolution: "none" as const,
		}),
	),
	resolveSurchargeSnapshot: vi.fn(
		async (input: { endTime: { toString(): string } }) => ({
			version: 1 as const,
			evaluatedAt: input.endTime.toString(),
			resolution: { kind: "none" as const },
		}),
	),
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("next/cache", () => ({ revalidatePath: mockState.revalidatePath }));

vi.mock(
	"@/lib/time-tracking/policy-clock-out-break-snapshot",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("@/lib/time-tracking/policy-clock-out-break-snapshot")
		>()),
		resolvePolicyClockOutBreakSnapshotInTransaction:
			mockState.resolveBreakPolicySnapshot,
	}),
);

vi.mock(
	"@/lib/time-tracking/policy-clock-out-surcharge-snapshot",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("@/lib/time-tracking/policy-clock-out-surcharge-snapshot")
		>()),
		resolvePolicyClockOutSurchargeSnapshotInTransaction:
			mockState.resolveSurchargeSnapshot,
	}),
);

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: mockState.findEmployee,
				findMany: mockState.findEmployees,
			},
			employeeManagers: { findMany: mockState.findManagerLinks },
			teamMembership: { findMany: mockState.findTeamMemberships },
			team: { findMany: mockState.findTeams },
			workPeriod: { findMany: mockState.findWorkPeriods },
			approvalRequest: { findMany: mockState.findApprovalRequests },
			timeRecord: { findFirst: mockState.findCanonicalRecord },
			timeRecordWork: { findMany: mockState.findCanonicalWork },
			timeRecordAllocation: { findMany: mockState.findCanonicalAllocations },
			workCategory: { findFirst: mockState.findWorkCategory },
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
	approvalRequest: {
		entityId: "approvalRequest.entityId",
		entityType: "approvalRequest.entityType",
		organizationId: "approvalRequest.organizationId",
	},
	timeRecord: {
		id: "timeRecord.id",
		organizationId: "timeRecord.organizationId",
	},
	timeRecordWork: {
		recordId: "timeRecordWork.recordId",
		organizationId: "timeRecordWork.organizationId",
	},
	timeRecordAllocation: {
		recordId: "timeRecordAllocation.recordId",
		organizationId: "timeRecordAllocation.organizationId",
	},
	workCategory: {
		id: "workCategory.id",
		organizationId: "workCategory.organizationId",
		isActive: "workCategory.isActive",
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
	approvalPolicy: {
		organizationId: "approvalPolicy.organizationId",
		priority: "approvalPolicy.priority",
	},
	employeeGroupMember: {
		organizationId: "employeeGroupMember.organizationId",
		employeeId: "employeeGroupMember.employeeId",
	},
	employeeGroup: {
		organizationId: "employeeGroup.organizationId",
		isActive: "employeeGroup.isActive",
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

vi.mock("@/lib/query/work-category.queries", () => ({
	employeeHasAccessToCategory: mockState.employeeHasAccessToCategory,
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

vi.mock("@/lib/approvals/server/work-period-approvals", () => ({
	finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction: vi.fn(),
	reconcileOrdinaryWorkPeriodMaintenanceAfterCommit:
		mockState.reconcileOrdinaryMaintenance,
	completeOrdinaryWorkPeriodDecisionAfterCommit: async (input: {
		execute: () => Promise<{
			postCommit: {
				disposition: "dispatch" | "observe";
				event: string;
				maintenance?: unknown;
			} | null;
		}>;
		dispatch: (execution: unknown) => Promise<void>;
		maintain: (maintenance: unknown) => Promise<void>;
		dispatchPending?: boolean;
		onDispatchError: (error: unknown) => void;
		onMaintenanceError: (error: unknown) => void;
	}) => {
		const execution = await input.execute();
		const tasks: Promise<void>[] = [];
		if (
			execution.postCommit?.disposition === "dispatch" &&
			(execution.postCommit.event !== "pending" ||
				input.dispatchPending === true)
		) {
			tasks.push(input.dispatch(execution).catch(input.onDispatchError));
		}
		if (execution.postCommit?.maintenance) {
			tasks.push(
				input
					.maintain(execution.postCommit.maintenance)
					.catch(input.onMaintenanceError),
			);
		}
		await Promise.all(tasks);
		return execution;
	},
}));

vi.mock(
	"@/lib/approvals/server/work-period-submission",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("@/lib/approvals/server/work-period-submission")
			>();
		return {
			...actual,
			executeOrdinaryWorkPeriodSubmissionInTransaction: (input: never) =>
				mockState.useRealOrdinarySubmission
					? actual.executeOrdinaryWorkPeriodSubmissionInTransaction(input)
					: mockState.executeOrdinarySubmission(input),
		};
	},
);

vi.mock("@/lib/approvals/workflow/runtime", () => ({
	createProductionApprovalWorkflowRuntime: () => ({
		repository: {
			withTransaction: (operation: (context: unknown) => Promise<unknown>) =>
				mockState.transaction((tx: unknown) => {
					const compatibilityWriter = {
						withWriteGate: () => compatibilityWriter,
						mirrorCanonicalToLegacy: vi.fn(),
					};
					return operation({
						dbService: { db: tx },
						writeGate: {
							acquire: async () => ({
								mode: "legacy",
								behavior: {
									writeLegacy: true,
									writeCanonical: false,
									decideCanonical: false,
									observation: "none",
								},
							}),
						},
						compatibilityWriter,
					});
				}),
		},
	}),
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

const {
	addBreakToActiveSession,
	clockIn,
	clockOut: clockOutAction,
	createManualTimeEntry: createManualTimeEntryAction,
} = await import("./clocking");

const defaultSubmissionId = "10000000-0000-4000-8000-000000000099";

function ordinarySubmissionSource(
	kind: "manual_time_submission" | "policy_clock_out",
	periodId = "period-1",
	date = "2026-05-04",
) {
	return {
		id: periodId,
		organizationId: "org-1",
		employeeId: "employee-1",
		requesterUserId: "user-1",
		clockInId: "clock-in-1",
		clockOutId: "clock-out-1",
		canonicalRecordId: "canonical-1",
		approvalWorkflowId: null,
		approvalStatus: "pending",
		pendingChanges: {
			ordinarySubmission: { submissionId: defaultSubmissionId, kind },
			...(kind === "policy_clock_out"
				? {
						breakPolicySnapshot: {
							version: 1,
							evaluatedAt: `${date}T10:00:00Z`,
							resolution: "none",
						},
						surchargeSnapshot: {
							version: 1,
							evaluatedAt: `${date}T10:00:00Z`,
							resolution: { kind: "none" },
						},
					}
				: {}),
		},
		isActive: false,
		startTime: new Date(`${date}T09:00:00.000Z`),
		endTime: new Date(`${date}T10:00:00.000Z`),
		durationMinutes: 60,
		wasAutoAdjusted: false,
		originalEndTime: null,
		deletedAt: null,
		canonicalId: "canonical-1",
		canonicalOrganizationId: "org-1",
		canonicalEmployeeId: "employee-1",
		canonicalRecordKind: "work",
		canonicalStartAt: new Date(`${date}T09:00:00.000Z`),
		canonicalEndAt: new Date(`${date}T10:00:00.000Z`),
		canonicalDurationMinutes: 60,
		canonicalApprovalState: "pending",
		pendingLegacyRequests: [],
		pendingCanonicalWorkflows: [],
		terminalCanonicalWorkflows: [],
		terminalCanonicalReceipts: [],
		terminalLegacyMarkedRequests: [],
		historicalLegacyAutoRequests: [],
		hasMalformedLegacyMarker: false,
	};
}

function ordinarySubmissionQueries() {
	return {
		approvalPolicy: { findMany: vi.fn().mockResolvedValue([]) },
		employeeGroupMember: { findMany: vi.fn().mockResolvedValue([]) },
		employeeGroup: { findMany: vi.fn().mockResolvedValue([]) },
		employee: {
			findMany: vi.fn().mockResolvedValue([
				{
					id: "employee-1",
					userId: "user-1",
					organizationId: "org-1",
					isActive: true,
				},
			]),
		},
		employeeManagers: { findMany: mockState.findManagerLinks },
		teamMembership: { findMany: mockState.findTeamMemberships },
		team: { findMany: mockState.findTeams },
	};
}

function ordinarySubmissionExecute(
	kind: "manual_time_submission" | "policy_clock_out",
	periodId?: string | (() => string),
	date?: string,
) {
	const dialect = new PgDialect();
	return vi.fn(async (query: SQL) => {
		const compiled = dialect.sqlToQuery(query);
		return compiled.sql.includes("pg_advisory_xact_lock")
			? { rows: [{ locked: null }] }
			: {
					rows: [
						ordinarySubmissionSource(
							kind,
							typeof periodId === "function" ? periodId() : periodId,
							date,
						),
					],
				};
	});
}

beforeEach(() => {
	mockState.useRealOrdinarySubmission = false;
});

function approvalRequestMetadata(
	kind: "manual_time_submission" | "policy_clock_out",
	periodId: string,
	submissionId = defaultSubmissionId,
) {
	const key = deriveApprovalWorkflowId({
		organizationId: "org-1",
		workflowType: kind,
		sourceType: "time_entry",
		sourceId: periodId,
		allocationKey: submissionId,
	});
	return {
		timeRequest: { kind },
		...(kind === "policy_clock_out"
			? {
					breakPolicySnapshot: {
						version: 1,
						evaluatedAt: "2026-05-04T10:00:00Z",
						resolution: "none",
					},
					surchargeSnapshot: {
						version: 1,
						evaluatedAt: "2026-05-04T10:00:00Z",
						resolution: { kind: "none" },
					},
				}
			: {}),
		ordinarySubmission: { key, submissionId },
	};
}

function requesterAutoApprovalMetadata(
	kind: "manual_time_submission" | "policy_clock_out",
	periodId: string,
	submissionId = defaultSubmissionId,
) {
	return {
		...approvalRequestMetadata(kind, periodId, submissionId),
		autoApproval: { reason: "requester_is_approver" },
	};
}

function approvalWorkflowId(
	kind: "manual_time_submission" | "policy_clock_out",
	periodId: string,
	submissionId = defaultSubmissionId,
) {
	const submissionKey = deriveApprovalWorkflowId({
		organizationId: "org-1",
		workflowType: kind,
		sourceType: "time_entry",
		sourceId: periodId,
		allocationKey: submissionId,
	});
	return deriveApprovalWorkflowId({
		organizationId: "org-1",
		workflowType: kind,
		sourceType: "time_entry",
		sourceId: periodId,
		allocationKey: submissionKey,
	});
}

function setApprovalRequestEvidence(
	kind: "manual_time_submission" | "policy_clock_out",
	periodId: string,
	submissionId = defaultSubmissionId,
) {
	mockState.findApprovalRequests.mockResolvedValue([
		{ metadata: approvalRequestMetadata(kind, periodId, submissionId) },
	]);
}

function manualSubmissionMetadata(
	overrides: Record<string, unknown> = {},
): string {
	return JSON.stringify({
		ordinarySubmission: {
			submissionId: defaultSubmissionId,
			kind: "manual_time_submission",
		},
		request: {
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
			timezone: null,
			browserTimezone: null,
			projectId: null,
			workCategoryId: null,
			...overrides,
		},
		result: {
			startTime: "2026-05-03T09:00:00.000Z",
			endTime: "2026-05-03T10:00:00.000Z",
			durationMinutes: 60,
			wasAdjusted: false,
		},
	});
}

function setManualReplayEvidence(options?: {
	approvalStatus?: "pending" | "approved";
	approvalWorkflowId?: string | null;
	pendingChanges?: unknown;
	workCategoryId?: string | null;
	projectId?: string | null;
	computationMetadata?: string | null;
}) {
	const startTime = new Date("2026-05-03T09:00:00.000Z");
	const endTime = new Date("2026-05-03T10:00:00.000Z");
	const approvalStatus = options?.approvalStatus ?? "pending";
	mockState.findExistingPeriod.mockResolvedValue({
		id: defaultSubmissionId,
		organizationId: "org-1",
		employeeId: "employee-1",
		clockInId: "clock-in-1",
		clockOutId: "clock-out-1",
		canonicalRecordId: "canonical-1",
		approvalWorkflowId: options?.approvalWorkflowId ?? null,
		startTime,
		endTime,
		durationMinutes: 60,
		projectId: options?.projectId ?? null,
		workCategoryId: options?.workCategoryId ?? null,
		workLocationType: null,
		isActive: false,
		approvalStatus,
		deletedAt: null,
		pendingChanges:
			options && "pendingChanges" in options
				? options.pendingChanges
				: {
						ordinarySubmission: {
							submissionId: defaultSubmissionId,
							kind: "manual_time_submission",
						},
					},
		clockIn: {
			id: "clock-in-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			type: "clock_in",
			timestamp: startTime,
			notes: "Manual entry: Forgot to clock in",
		},
		clockOut: {
			id: "clock-out-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			type: "clock_out",
			timestamp: endTime,
			notes: "Forgot to clock in",
		},
	});
	mockState.findCanonicalRecord.mockResolvedValue({
		id: "canonical-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		recordKind: "work",
		startAt: startTime,
		endAt: endTime,
		durationMinutes: 60,
		approvalState: approvalStatus,
		origin: "manual",
	});
	mockState.findCanonicalWork.mockResolvedValue([
		{
			recordId: "canonical-1",
			organizationId: "org-1",
			recordKind: "work",
			workCategoryId: options?.workCategoryId ?? null,
			workLocationType: null,
			computationMetadata:
				options && "computationMetadata" in options
					? options.computationMetadata
					: manualSubmissionMetadata({
							workCategoryId: options?.workCategoryId ?? null,
							projectId: options?.projectId ?? null,
						}),
		},
	]);
	mockState.findCanonicalAllocations.mockResolvedValue(
		options?.projectId
			? [
					{
						organizationId: "org-1",
						recordId: "canonical-1",
						allocationKind: "project",
						projectId: options.projectId,
						costCenterId: null,
						weightPercent: 100,
					},
				]
			: [],
	);
	mockState.executeOrdinarySubmission.mockResolvedValue({
		result: { kind: "default_created", approvalRequestId: "approval-1" },
		disposition: "replayed",
		postCommit: null,
	});
	if (approvalStatus === "pending") {
		setApprovalRequestEvidence("manual_time_submission", defaultSubmissionId);
	}
}

function policyReplayPeriod(
	submissionId: string,
	pendingChanges: unknown = {
		ordinarySubmission: { submissionId, kind: "policy_clock_out" },
	},
) {
	return {
		id: "period-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		clockInId: "clock-in-1",
		clockOutId: submissionId,
		canonicalRecordId: "canonical-1",
		approvalWorkflowId: null,
		startTime: new Date("2026-05-04T09:00:00.000Z"),
		endTime: new Date("2026-05-04T10:00:00.000Z"),
		durationMinutes: 60,
		projectId: null,
		workCategoryId: null,
		workLocationType: null,
		isActive: false,
		approvalStatus: pendingChanges ? "pending" : "approved",
		deletedAt: null,
		pendingChanges,
		clockIn: {
			id: "clock-in-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			type: "clock_in",
			timestamp: new Date("2026-05-04T09:00:00.000Z"),
		},
		clockOut: {
			id: submissionId,
			employeeId: "employee-1",
			organizationId: "org-1",
			type: "clock_out",
			timestamp: new Date("2026-05-04T10:00:00.000Z"),
		},
	};
}

function setPolicyCanonicalEvidence(options?: {
	computationMetadata?: string | null;
	approvalState?: "pending" | "approved";
}) {
	mockState.findCanonicalRecord.mockResolvedValue({
		id: "canonical-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		recordKind: "work",
		startAt: new Date("2026-05-04T09:00:00.000Z"),
		endAt: new Date("2026-05-04T10:00:00.000Z"),
		durationMinutes: 60,
		approvalState: options?.approvalState ?? "pending",
		origin: "clock",
	});
	mockState.findCanonicalWork.mockResolvedValue([
		{
			recordId: "canonical-1",
			organizationId: "org-1",
			recordKind: "work",
			workCategoryId: null,
			workLocationType: null,
			computationMetadata: options?.computationMetadata ?? null,
		},
	]);
	mockState.findCanonicalAllocations.mockResolvedValue([]);
	if ((options?.approvalState ?? "pending") === "pending") {
		setApprovalRequestEvidence("policy_clock_out", "period-1");
	}
}

function setManualCanonicalDetail() {
	mockState.findCanonicalWork.mockResolvedValue([
		{
			recordId: "canonical-1",
			organizationId: "org-1",
			recordKind: "work",
			workCategoryId: null,
			workLocationType: null,
			computationMetadata: manualSubmissionMetadata(),
		},
	]);
	mockState.findCanonicalAllocations.mockResolvedValue([]);
}

function clockOut(
	projectId?: string,
	workCategoryId?: string,
	actionContext: Parameters<typeof clockOutAction>[2] = {},
) {
	return clockOutAction(projectId, workCategoryId, {
		submissionId: defaultSubmissionId,
		...actionContext,
	});
}

function createManualTimeEntry(
	data: Omit<
		Parameters<typeof createManualTimeEntryAction>[0],
		"submissionId"
	> & {
		submissionId?: string;
	},
) {
	return createManualTimeEntryAction({
		submissionId: defaultSubmissionId,
		...data,
	});
}

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
		mockState.executeOrdinarySubmission.mockReset();
		mockState.createClockOutApprovalRequest.mockReset();
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
				execute: ordinarySubmissionExecute("policy_clock_out"),
				query: {
					...ordinarySubmissionQueries(),
					workPeriod: {
						findFirst: mockState.findExistingPeriod,
						findMany: mockState.findPolicyPeriods,
					},
					approvalRequest: { findMany: mockState.findApprovalRequests },
					timeRecord: { findFirst: mockState.findCanonicalRecord },
					timeRecordWork: { findMany: mockState.findCanonicalWork },
					timeRecordAllocation: {
						findMany: mockState.findCanonicalAllocations,
					},
				},
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
		mockState.findExistingPeriod.mockResolvedValue(null);
		mockState.findPolicyPeriods.mockResolvedValue([]);
		mockState.findApprovalRequests.mockResolvedValue([]);
		mockState.findCanonicalRecord.mockResolvedValue(null);
		mockState.findCanonicalWork.mockResolvedValue([
			{
				recordId: "canonical-1",
				organizationId: "org-1",
				recordKind: "work",
				workCategoryId: null,
				workLocationType: null,
				computationMetadata: null,
			},
		]);
		mockState.findCanonicalAllocations.mockResolvedValue([]);
		mockState.findWorkCategory.mockResolvedValue({
			id: "category-1",
			organizationId: "org-1",
			isActive: true,
		});
		mockState.employeeHasAccessToCategory.mockResolvedValue(true);
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
			affectedWorkPeriodIds: ["period-1"],
		});
		mockState.createCanonicalWorkRecord.mockResolvedValue({
			id: "canonical-1",
		});
		mockState.markEmployeeWorkBalanceDirty.mockResolvedValue(undefined);
		mockState.reconcileOrdinaryMaintenance.mockResolvedValue(undefined);
		mockState.requireBillingForMutation.mockResolvedValue({ canAccess: true });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
		mockState.createClockOutApprovalRequest.mockResolvedValue({
			kind: "default_created",
			approvalRequestId: "approval-1",
		});
		mockState.sendClockOutApprovalNotifications.mockResolvedValue(undefined);
		mockState.sendClockOutApprovedNotification.mockResolvedValue(undefined);
		mockState.executeOrdinarySubmission.mockImplementation(async (input) => {
			const result = await mockState.createClockOutApprovalRequest(input);
			return {
				result,
				disposition: "executed",
				postCommit: {
					disposition: "dispatch",
					event: result.kind === "auto_completed" ? "approved" : "pending",
					dedupeKey: "clock-out-submission:result",
					approverEmployeeId:
						result.kind === "auto_completed" ? "employee-1" : "manager-1",
					maintenance:
						result.kind === "auto_completed"
							? {
									organizationId: "org-1",
									employeeId: "employee-1",
									dirtyFromDate: "2026-05-03",
									decision: "approved",
									surchargePeriodIds: ["period-1"],
									staleSurchargePeriodIds: [],
								}
							: null,
				},
			};
		});
		mockState.clockingClockOut.mockImplementation(async (input) => {
			const activePeriod = {
				id: "period-1",
				startTime: new Date("2026-05-04T09:00:00.000Z"),
			};
			const durationMinutes = 60;
			const transaction = input.transaction;
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
				disposition: "executed",
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
		expect(mockState.clockingClockOut).not.toHaveBeenCalled();
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
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				workPeriodId: "period-1",
				requesterEmployeeId: "employee-1",
				defaultApproverId: null,
				organizationId: "org-1",
				kind: "policy_clock_out",
				dbService: expect.anything(),
				context: expect.anything(),
			}),
		);
		expect(mockState.findManagerLinks).not.toHaveBeenCalled();
		const submission = mockState.executeOrdinarySubmission.mock.calls[0][0];
		expect(submission.dbService.db).toBe(submission.context.dbService.db);
		expect(mockState.clockingClockOut.mock.calls[0][0].transaction).toBe(
			submission.context.dbService.db,
		);
		expect(mockState.clockingClockOut).toHaveBeenCalledWith(
			expect.objectContaining({ actionId: defaultSubmissionId }),
		);
		expect(mockState.revalidatePath).toHaveBeenCalledOnce();
		expect(mockState.revalidatePath).toHaveBeenCalledWith("/time-tracking");
		expect(mockState.enforceBreaksAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.sendClockOutApprovalNotifications).toHaveBeenCalledWith(
			expect.objectContaining({ dedupeKey: "clock-out-submission:result" }),
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
		expect(mockState.enforceBreaksAfterClockOut).not.toHaveBeenCalled();
	});

	it.each([
		{ label: "pending", autoCompleted: false },
		{ label: "requester auto-completed", autoCompleted: true },
	])("preserves policy clock-out parity and exact replay when $label", async ({
		autoCompleted,
	}) => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		if (autoCompleted) {
			mockState.createClockOutApprovalRequest.mockResolvedValue({
				kind: "auto_completed",
				approvalRequestId: "approval-1",
				chainInstanceId: null,
				reason: "requester_is_approver",
			});
		}
		mockState.enforceBreaksAfterClockOut.mockImplementation(async () => {
			mockState.updateSet({
				endTime: new Date("2026-05-04T09:30:00.000Z"),
				durationMinutes: 30,
			});
			return { wasAdjusted: true, adjustment: { breakMinutes: 30 } };
		});

		const first = await clockOut();

		expect(first.success).toBe(true);
		expect(mockState.enforceBreaksAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.updateSet).toHaveBeenCalledTimes(1);
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				pendingChanges: expect.objectContaining({
					originalEndTime: "2026-05-04T10:00:00.000Z",
					originalDurationMinutes: 60,
				}),
			}),
		);
		expect(mockState.createCanonicalWorkRecord).toHaveBeenCalledWith(
			expect.objectContaining({
				endAt: new Date("2026-05-04T10:00:00.000Z"),
				durationMinutes: 60,
			}),
			expect.anything(),
		);

		mockState.findPolicyPeriods.mockResolvedValue([
			policyReplayPeriod(defaultSubmissionId, autoCompleted ? null : undefined),
		]);
		setPolicyCanonicalEvidence({
			approvalState: autoCompleted ? "approved" : "pending",
		});
		mockState.findApprovalRequests.mockResolvedValue([
			{
				metadata: autoCompleted
					? requesterAutoApprovalMetadata("policy_clock_out", "period-1")
					: approvalRequestMetadata("policy_clock_out", "period-1"),
			},
		]);
		mockState.executeOrdinarySubmission.mockResolvedValueOnce({
			result: autoCompleted
				? { kind: "auto_completed", approvalRequestId: "approval-1" }
				: { kind: "default_created", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});

		const replay = await clockOut();

		expect(replay.success).toBe(true);
		expect(mockState.clockingClockOut).toHaveBeenCalledOnce();
		expect(mockState.enforceBreaksAfterClockOut).not.toHaveBeenCalled();
	});

	it("keeps committed clock-out success when post-commit notification fails", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.sendClockOutApprovalNotifications.mockRejectedValueOnce(
			new Error("notification unavailable"),
		);

		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.logger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				workPeriodId: "period-1",
			}),
			"Failed to dispatch clock-out approval notification after commit",
		);
	});

	it("does not repeat post-commit effects for an observed clock-out replay", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.executeOrdinarySubmission.mockResolvedValueOnce({
			result: { kind: "default_created", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});
		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.sendClockOutApprovalNotifications).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.checkComplianceAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.enforceBreaksAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("recovers an exact completed policy source while a later period is active", async () => {
		const submissionId = "10000000-0000-4000-8000-000000000099";
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.getActiveWorkPeriod.mockResolvedValue({
			id: "period-2",
			startTime: new Date("2026-05-04T11:00:00.000Z"),
		});
		mockState.findPolicyPeriods.mockResolvedValue([
			{
				id: "period-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				clockInId: "clock-in-1",
				clockOutId: submissionId,
				canonicalRecordId: "canonical-1",
				startTime: new Date("2026-05-04T09:00:00.000Z"),
				endTime: new Date("2026-05-04T10:00:00.000Z"),
				durationMinutes: 60,
				projectId: null,
				workCategoryId: null,
				isActive: false,
				approvalStatus: "pending",
				deletedAt: null,
				pendingChanges: {
					isNewClockOut: true,
					ordinarySubmission: { submissionId, kind: "policy_clock_out" },
				},
				clockIn: {
					id: "clock-in-1",
					employeeId: "employee-1",
					organizationId: "org-1",
					type: "clock_in",
					timestamp: new Date("2026-05-04T09:00:00.000Z"),
				},
				clockOut: {
					id: submissionId,
					employeeId: "employee-1",
					organizationId: "org-1",
					type: "clock_out",
					timestamp: new Date("2026-05-04T10:00:00.000Z"),
				},
			},
		]);
		mockState.findCanonicalRecord.mockResolvedValue({
			id: "canonical-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			recordKind: "work",
			startAt: new Date("2026-05-04T09:00:00.000Z"),
			endAt: new Date("2026-05-04T10:00:00.000Z"),
			durationMinutes: 60,
			approvalState: "pending",
			origin: "clock",
		});
		mockState.executeOrdinarySubmission.mockResolvedValueOnce({
			result: { kind: "default_created", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});
		setApprovalRequestEvidence("policy_clock_out", "period-1", submissionId);

		const result = await clockOut(undefined, undefined, { submissionId });

		expect(result).toMatchObject({
			success: true,
			data: { id: submissionId },
		});
		expect(mockState.clockingClockOut).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.createCanonicalWorkRecord).not.toHaveBeenCalled();
		expect(mockState.createClockOutApprovalRequest).not.toHaveBeenCalled();
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledOnce();
		expect(mockState.sendClockOutApprovalNotifications).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.checkComplianceAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.enforceBreaksAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
	});

	it("replays a completed non-policy clock-out without creating approval work", async () => {
		const submissionId = "10000000-0000-4000-8000-000000000099";
		mockState.getActiveWorkPeriod.mockResolvedValue(null);
		mockState.findPolicyPeriods.mockResolvedValue([
			{
				id: "period-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				clockInId: "clock-in-1",
				clockOutId: submissionId,
				canonicalRecordId: "canonical-1",
				approvalWorkflowId: "70000000-0000-4000-8000-000000000777",
				startTime: new Date("2026-05-04T09:00:00.000Z"),
				endTime: new Date("2026-05-04T10:00:00.000Z"),
				durationMinutes: 60,
				projectId: null,
				workCategoryId: null,
				isActive: false,
				approvalStatus: "approved",
				deletedAt: null,
				pendingChanges: null,
				clockIn: {
					id: "clock-in-1",
					employeeId: "employee-1",
					organizationId: "org-1",
					type: "clock_in",
					timestamp: new Date("2026-05-04T09:00:00.000Z"),
				},
				clockOut: {
					id: submissionId,
					employeeId: "employee-1",
					organizationId: "org-1",
					type: "clock_out",
					timestamp: new Date("2026-05-04T10:00:00.000Z"),
				},
			},
		]);
		mockState.findCanonicalRecord.mockResolvedValue({
			id: "canonical-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			recordKind: "work",
			startAt: new Date("2026-05-04T09:00:00.000Z"),
			endAt: new Date("2026-05-04T10:00:00.000Z"),
			durationMinutes: 60,
			approvalState: "approved",
			origin: "clock",
		});

		const result = await clockOut(undefined, undefined, { submissionId });

		expect(result).toMatchObject({
			success: true,
			data: { id: submissionId, pendingApproval: undefined },
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("does not repeat non-policy effects for an in-transaction clock-out replay", async () => {
		mockState.findPolicyPeriods
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([policyReplayPeriod(defaultSubmissionId, null)]);
		setPolicyCanonicalEvidence({ approvalState: "approved" });
		mockState.clockingClockOut.mockResolvedValueOnce({
			entry: { id: defaultSubmissionId, type: "clock_out" },
			period: { id: "period-1" },
			durationMinutes: 60,
			disposition: "replayed",
		});

		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.checkComplianceAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.enforceBreaksAfterClockOut).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("preserves auto-completed approval outcome for an in-transaction clock-out replay", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.findPolicyPeriods
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([policyReplayPeriod(defaultSubmissionId)]);
		setPolicyCanonicalEvidence();
		mockState.clockingClockOut.mockResolvedValueOnce({
			entry: { id: defaultSubmissionId, type: "clock_out" },
			period: { id: "period-1" },
			durationMinutes: 60,
			disposition: "replayed",
		});
		mockState.executeOrdinarySubmission.mockResolvedValueOnce({
			result: { kind: "auto_completed", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});

		const result = await clockOut();

		expect(result).toMatchObject({
			success: true,
			data: { pendingApproval: false },
		});
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledOnce();
		expect(mockState.resolveBreakPolicySnapshot).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
	});

	it("uses persisted policy evidence after an in-transaction replay despite policy drift", async () => {
		const submissionId = defaultSubmissionId;
		mockState.checkClockOutNeedsApproval.mockResolvedValue(false);
		mockState.findPolicyPeriods
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([policyReplayPeriod(submissionId)]);
		setPolicyCanonicalEvidence();
		mockState.clockingClockOut.mockResolvedValueOnce({
			entry: { id: submissionId, type: "clock_out" },
			period: { id: "period-1" },
			durationMinutes: 60,
			disposition: "replayed",
		});
		mockState.executeOrdinarySubmission.mockResolvedValueOnce({
			result: { kind: "default_created", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});

		const result = await clockOut(undefined, undefined, { submissionId });

		expect(result).toMatchObject({
			success: true,
			data: { pendingApproval: true },
		});
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledOnce();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
	});

	it("rejects clock-out replay with unexpected canonical work metadata", async () => {
		const submissionId = defaultSubmissionId;
		mockState.getActiveWorkPeriod.mockResolvedValue(null);
		mockState.findPolicyPeriods.mockResolvedValue([
			policyReplayPeriod(submissionId),
		]);
		setPolicyCanonicalEvidence({ computationMetadata: "tampered" });

		const result = await clockOut(undefined, undefined, { submissionId });

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
	});

	it("requires strict approval evidence before replaying a pending policy source", async () => {
		mockState.findPolicyPeriods.mockResolvedValue([
			policyReplayPeriod(defaultSubmissionId),
		]);
		setPolicyCanonicalEvidence();
		mockState.findApprovalRequests.mockResolvedValue([]);

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
	});

	it.each([
		[
			"missing timeRequest",
			(metadata: ReturnType<typeof approvalRequestMetadata>) => ({
				ordinarySubmission: metadata.ordinarySubmission,
			}),
		],
		[
			"wrong request kind",
			(metadata: ReturnType<typeof approvalRequestMetadata>) => ({
				...metadata,
				timeRequest: { kind: "manual_time_submission" },
			}),
		],
		[
			"extra root data",
			(metadata: ReturnType<typeof approvalRequestMetadata>) => ({
				...metadata,
				extra: true,
			}),
		],
		[
			"malformed submission marker",
			(metadata: ReturnType<typeof approvalRequestMetadata>) => ({
				...metadata,
				ordinarySubmission: {
					...metadata.ordinarySubmission,
					extra: true,
				},
			}),
		],
	])("rejects %s before invoking Task 6", async (_label, mutateMetadata) => {
		mockState.findPolicyPeriods.mockResolvedValue([
			policyReplayPeriod(defaultSubmissionId),
		]);
		setPolicyCanonicalEvidence();
		mockState.findApprovalRequests.mockResolvedValue([
			{
				metadata: mutateMetadata(
					approvalRequestMetadata("policy_clock_out", "period-1"),
				),
			},
		]);

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
	});

	it("rejects malformed policy evidence after a valid request before Task 6", async () => {
		const submissionId = defaultSubmissionId;
		mockState.getActiveWorkPeriod.mockResolvedValue(null);
		mockState.findPolicyPeriods.mockResolvedValue([
			policyReplayPeriod(submissionId, null),
		]);
		setPolicyCanonicalEvidence({ approvalState: "approved" });
		mockState.findApprovalRequests.mockResolvedValue([
			{
				metadata: requesterAutoApprovalMetadata(
					"policy_clock_out",
					"period-1",
					submissionId,
				),
			},
			{
				metadata: {
					...requesterAutoApprovalMetadata(
						"policy_clock_out",
						"period-1",
						submissionId,
					),
					autoApproval: {
						reason: "requester_is_approver",
						extra: true,
					},
				},
			},
		]);
		mockState.executeOrdinarySubmission.mockResolvedValue({
			result: { kind: "auto_completed", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});

		const result = await clockOut(undefined, undefined, { submissionId });

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
	});

	it("rolls back an existing policy source when Task 6 executes instead of replaying", async () => {
		const durableState = { approvalWrites: [] as string[] };
		mockState.findPolicyPeriods.mockResolvedValue([
			policyReplayPeriod(defaultSubmissionId),
		]);
		setPolicyCanonicalEvidence();
		mockState.executeOrdinarySubmission.mockImplementation(async () => {
			durableState.approvalWrites.push("approval-2");
			return {
				result: { kind: "default_created", approvalRequestId: "approval-2" },
				disposition: "executed",
				postCommit: null,
			};
		});
		mockState.transaction.mockImplementation(async (callback) => {
			const snapshot = durableState.approvalWrites.length;
			try {
				return await callback({
					query: {
						workPeriod: {
							findFirst: mockState.findExistingPeriod,
							findMany: mockState.findPolicyPeriods,
						},
						approvalRequest: { findMany: mockState.findApprovalRequests },
						timeRecord: { findFirst: mockState.findCanonicalRecord },
						timeRecordWork: { findMany: mockState.findCanonicalWork },
						timeRecordAllocation: {
							findMany: mockState.findCanonicalAllocations,
						},
					},
				});
			} catch (error) {
				durableState.approvalWrites.length = snapshot;
				throw error;
			}
		});

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(durableState.approvalWrites).toEqual([]);
		expect(mockState.clockingClockOut).not.toHaveBeenCalled();
		expect(mockState.sendClockOutApprovalNotifications).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("replays an auto-completed policy source with exact requester-auto evidence", async () => {
		const submissionId = "10000000-0000-4000-8000-000000000099";
		mockState.getActiveWorkPeriod.mockResolvedValue(null);
		mockState.findPolicyPeriods.mockResolvedValue([
			{
				id: "period-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				clockInId: "clock-in-1",
				clockOutId: submissionId,
				canonicalRecordId: "canonical-1",
				approvalWorkflowId: null,
				startTime: new Date("2026-05-04T09:00:00.000Z"),
				endTime: new Date("2026-05-04T10:00:00.000Z"),
				durationMinutes: 60,
				projectId: null,
				workCategoryId: null,
				isActive: false,
				approvalStatus: "approved",
				deletedAt: null,
				pendingChanges: null,
				clockIn: {
					id: "clock-in-1",
					employeeId: "employee-1",
					organizationId: "org-1",
					type: "clock_in",
					timestamp: new Date("2026-05-04T09:00:00.000Z"),
				},
				clockOut: {
					id: submissionId,
					employeeId: "employee-1",
					organizationId: "org-1",
					type: "clock_out",
					timestamp: new Date("2026-05-04T10:00:00.000Z"),
				},
			},
		]);
		mockState.findCanonicalRecord.mockResolvedValue({
			id: "canonical-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			recordKind: "work",
			startAt: new Date("2026-05-04T09:00:00.000Z"),
			endAt: new Date("2026-05-04T10:00:00.000Z"),
			durationMinutes: 60,
			approvalState: "approved",
			origin: "clock",
		});
		mockState.findApprovalRequests.mockResolvedValue([
			{
				metadata: requesterAutoApprovalMetadata(
					"policy_clock_out",
					"period-1",
					submissionId,
				),
			},
		]);
		mockState.executeOrdinarySubmission.mockResolvedValueOnce({
			result: { kind: "auto_completed", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});

		const result = await clockOut(undefined, undefined, { submissionId });

		expect(result).toMatchObject({
			success: true,
			data: { pendingApproval: false },
		});
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledOnce();
	});

	it.each([
		"extra",
		"accessor",
		"prototype",
		"wrong reason",
	] as const)("rejects requester-auto policy evidence with %s before Task 6", async (shape) => {
		const submissionId = defaultSubmissionId;
		const reasonGetter = vi.fn(() => "requester_is_approver");
		let autoApproval: object;
		switch (shape) {
			case "extra":
				autoApproval = { reason: "requester_is_approver", extra: true };
				break;
			case "accessor":
				autoApproval = {};
				Object.defineProperty(autoApproval, "reason", {
					enumerable: true,
					get: reasonGetter,
				});
				break;
			case "prototype":
				autoApproval = Object.assign(Object.create({}), {
					reason: "requester_is_approver",
				});
				break;
			case "wrong reason":
				autoApproval = { reason: "different" };
				break;
		}
		mockState.getActiveWorkPeriod.mockResolvedValue(null);
		mockState.findPolicyPeriods.mockResolvedValue([
			policyReplayPeriod(submissionId, null),
		]);
		setPolicyCanonicalEvidence({ approvalState: "approved" });
		mockState.findApprovalRequests.mockResolvedValue([
			{
				metadata: {
					...approvalRequestMetadata(
						"policy_clock_out",
						"period-1",
						submissionId,
					),
					autoApproval,
				},
			},
		]);

		const result = await clockOut(undefined, undefined, { submissionId });

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
		expect(reasonGetter).not.toHaveBeenCalled();
	});

	it("returns the generic failure for ambiguous policy retry evidence", async () => {
		mockState.getActiveWorkPeriod.mockResolvedValue(null);
		mockState.findPolicyPeriods.mockResolvedValue([
			{ id: "period-1" },
			{ id: "period-2" },
		]);

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
	});

	it.each([
		["surcharge", "calculateAndPersistSurcharges"],
		["compliance", "checkComplianceAfterClockOut"],
		["break enforcement", "enforceBreaksAfterClockOut"],
	] as const)("keeps committed clock-out success when %s maintenance fails", async (_label, effect) => {
		mockState[effect].mockRejectedValueOnce(
			new Error("post-commit unavailable"),
		);

		const result = await clockOut();

		expect(result.success).toBe(true);
	});

	it("lets the shared boundary resolve a custom policy without a default manager", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.findManagerLinks.mockResolvedValue([]);
		mockState.createClockOutApprovalRequest.mockResolvedValue({
			kind: "chain_created",
			approvalRequestId: "approval-1",
			chainInstanceId: "chain-1",
		});

		const result = await clockOut(undefined, undefined, {
			submissionId: "10000000-0000-4000-8000-000000000099",
		});

		expect(result).toMatchObject({
			success: true,
			data: { pendingApproval: true },
		});
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultApproverId: null,
				submissionId: "10000000-0000-4000-8000-000000000099",
			}),
		);
	});

	it("rejects a noncanonical clock-out submission id before source writes", async () => {
		const result = await clockOut(undefined, undefined, {
			submissionId: "a0000000-0000-4000-8000-000000000099".toUpperCase(),
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(mockState.clockingClockOut).not.toHaveBeenCalled();
	});

	it("rejects a missing clock-out submission id before source lookup in non-policy mode", async () => {
		const result = await clockOutAction(
			undefined,
			undefined,
			{} as Parameters<typeof clockOutAction>[2],
		);

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(mockState.getUserTimezone).not.toHaveBeenCalled();
		expect(mockState.getActiveWorkPeriod).not.toHaveBeenCalled();
		expect(mockState.findPolicyPeriods).not.toHaveBeenCalled();
		expect(mockState.clockingClockOut).not.toHaveBeenCalled();
	});

	it("rejects a foreign clock-out work category before source writes", async () => {
		mockState.findWorkCategory.mockResolvedValue(null);

		const result = await clockOut(undefined, "foreign-category");

		expect(result).toEqual({
			success: false,
			error: "Work category not found",
		});
		expect(mockState.employeeHasAccessToCategory).not.toHaveBeenCalled();
		expect(mockState.clockingClockOut).not.toHaveBeenCalled();
		expect(mockState.createCanonicalWorkRecord).not.toHaveBeenCalled();
	});

	it("rejects an inaccessible clock-out work category before source writes", async () => {
		mockState.employeeHasAccessToCategory.mockResolvedValue(false);

		const result = await clockOut(undefined, "category-1");

		expect(result).toEqual({
			success: false,
			error: "Cannot assign to this work category",
		});
		expect(mockState.employeeHasAccessToCategory).toHaveBeenCalledWith(
			"employee-1",
			"category-1",
		);
		expect(mockState.clockingClockOut).not.toHaveBeenCalled();
		expect(mockState.createCanonicalWorkRecord).not.toHaveBeenCalled();
	});

	it("rejects approval-required clock-out when no manager is assigned", async () => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.findManagerLinks.mockResolvedValue([]);
		mockState.useRealOrdinarySubmission = true;

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "No manager assigned to approve time changes",
		});
	});

	it.each([
		new ValidationError({
			field: "managerId",
			message: "private manager resolution detail",
		}),
		new ValidationError({
			field: "approvalPolicyStage.approverType",
			message: "No manager assigned to approve time changes",
		}),
		new ValidationError({
			field: "managerId",
			message: "No manager assigned to approve time changes",
		}),
		Object.assign(Object.create(ValidationError.prototype), {
			field: "managerId",
			message: "No manager assigned to approve time changes",
		}),
	])("redacts non-canonical clock-out validation errors %#", async (error) => {
		mockState.checkClockOutNeedsApproval.mockResolvedValue(true);
		mockState.executeOrdinarySubmission.mockRejectedValueOnce(error);

		const result = await clockOut();

		expect(result).toEqual({
			success: false,
			error: "Failed to clock out. Please try again.",
		});
		expect(JSON.stringify(result)).not.toContain(error.message);
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
		expect(mockState.clockingClockOut).not.toHaveBeenCalled();
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

	it("enforces breaks for ordinary no-approval clock-outs exactly as before", async () => {
		mockState.enforceBreaksAfterClockOut.mockResolvedValueOnce({
			wasAdjusted: true,
			affectedWorkPeriodIds: ["period-1", "period-2"],
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

	it("reconciles every split period after break enforcement and before dirty marking", async () => {
		const snapshot = {
			version: 1 as const,
			evaluatedAt: "2026-05-04T10:00:00Z",
			resolution: { kind: "none" as const },
		};
		mockState.resolveSurchargeSnapshot.mockResolvedValueOnce(snapshot);
		mockState.enforceBreaksAfterClockOut.mockResolvedValueOnce({
			wasAdjusted: true,
			affectedWorkPeriodIds: ["period-1", "period-2"],
			adjustment: { breakMinutes: 30 },
		});

		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.calculateAndPersistSurcharges.mock.calls).toEqual([
			["period-1", "org-1", { employeeId: "employee-1", snapshot }],
			["period-2", "org-1", { employeeId: "employee-1", snapshot }],
		]);
		expect(
			mockState.enforceBreaksAfterClockOut.mock.invocationCallOrder[0],
		).toBeLessThan(
			mockState.calculateAndPersistSurcharges.mock.invocationCallOrder[0],
		);
		expect(
			mockState.calculateAndPersistSurcharges.mock.invocationCallOrder[1],
		).toBeLessThan(
			mockState.markEmployeeWorkBalanceDirty.mock.invocationCallOrder[0],
		);
	});

	it("routes no-approval surcharge evidence through immutable reconciliation", async () => {
		const snapshot = {
			version: 1 as const,
			evaluatedAt: "2026-05-04T10:00:00Z",
			resolution: { kind: "none" as const },
		};
		mockState.resolveSurchargeSnapshot.mockResolvedValueOnce(snapshot);

		const result = await clockOut();

		expect(result.success).toBe(true);
		expect(mockState.calculateAndPersistSurcharges).toHaveBeenCalledWith(
			"period-1",
			"org-1",
			{ employeeId: "employee-1", snapshot },
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
				const transaction = input.transaction;
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
		mockState.useRealOrdinarySubmission = true;

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
		mockState.findExistingPeriod.mockResolvedValue(null);
		mockState.findCanonicalRecord.mockResolvedValue(null);
		mockState.findCanonicalWork.mockResolvedValue([]);
		mockState.findCanonicalAllocations.mockResolvedValue([]);
		mockState.findApprovalRequests.mockResolvedValue([]);
		mockState.findWorkCategory.mockResolvedValue({
			id: "category-1",
			organizationId: "org-1",
			isActive: true,
		});
		mockState.employeeHasAccessToCategory.mockResolvedValue(true);
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
		mockState.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			isActive: true,
			role: "employee",
		});
		mockState.findManagerLinks.mockResolvedValue([]);
		mockState.findTeamMemberships.mockResolvedValue([]);
		mockState.findTeams.mockResolvedValue([]);
		mockState.transaction.mockImplementation(async (callback) =>
			callback({
				execute: ordinarySubmissionExecute("manual_time_submission"),
				query: {
					...ordinarySubmissionQueries(),
					workPeriod: {
						findFirst: mockState.findExistingPeriod,
						findMany: mockState.findPolicyPeriods,
					},
					timeRecord: { findFirst: mockState.findCanonicalRecord },
					timeRecordWork: { findMany: mockState.findCanonicalWork },
					timeRecordAllocation: {
						findMany: mockState.findCanonicalAllocations,
					},
					approvalRequest: { findMany: mockState.findApprovalRequests },
				},
				insert: vi.fn(() => ({
					values: (...args: unknown[]) => mockState.insertValues(...args),
				})),
			}),
		);
		mockState.executeOrdinarySubmission.mockImplementation(async (input) => {
			const result = await mockState.createManualEntryApprovalRequest(input);
			return {
				result,
				disposition: "executed",
				postCommit: {
					disposition: "dispatch",
					event: result.kind === "auto_completed" ? "approved" : "pending",
					dedupeKey: "manual-submission:result",
					approverEmployeeId:
						result.kind === "auto_completed" ? "employee-1" : "manager-1",
					maintenance:
						result.kind === "auto_completed"
							? {
									organizationId: "org-1",
									employeeId: "employee-1",
									dirtyFromDate: "2026-05-03",
									decision: "approved",
									surchargePeriodIds: ["period-1"],
									staleSurchargePeriodIds: [],
								}
							: null,
				},
			};
		});
	});

	it("fails closed for approval-required manual entries when no approver resolves", async () => {
		mockState.useRealOrdinarySubmission = true;
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1", type: "clock_in" })
			.mockResolvedValueOnce({ id: "clock-out-1", type: "clock_out" });
		mockState.createCanonicalWorkRecord.mockResolvedValue({
			id: "canonical-1",
		});
		mockState.insertValues.mockReturnValue({
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

		expect(result).toEqual({
			success: false,
			error: "No manager assigned to approve time changes",
		});
	});

	it.each([
		new ValidationError({
			field: "managerId",
			message: "private manager resolution detail",
		}),
		new ValidationError({
			field: "approvalPolicyStage.approverType",
			message: "No manager assigned to approve time changes",
		}),
		new ValidationError({
			field: "managerId",
			message: "No manager assigned to approve time changes",
		}),
		Object.assign(Object.create(ValidationError.prototype), {
			field: "managerId",
			message: "No manager assigned to approve time changes",
		}),
	])("redacts non-canonical manual-entry validation errors %#", async (error) => {
		mockState.executeOrdinarySubmission.mockRejectedValueOnce(error);
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1", type: "clock_in" })
			.mockResolvedValueOnce({ id: "clock-out-1", type: "clock_out" });
		mockState.createCanonicalWorkRecord.mockResolvedValue({
			id: "canonical-1",
		});
		mockState.insertValues.mockReturnValue({
			returning: mockState.insertReturning,
		});
		mockState.insertReturning.mockResolvedValueOnce([{ id: "period-1" }]);

		const result = await createManualTimeEntry({
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to create time entry. Please try again.",
		});
		expect(JSON.stringify(result)).not.toContain(error.message);
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
		expect(mockState.createCanonicalWorkRecord).not.toHaveBeenCalled();
	});

	it("marks the work balance dirty from the manual clock-in date after creating an approved entry", async () => {
		mockState.getEditCapabilityForPeriod.mockResolvedValue({
			type: "direct",
			reason: "within_window",
		});
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-in-1" })
			.mockResolvedValueOnce({ id: "clock-out-1" });
		mockState.createCanonicalWorkRecord.mockResolvedValue({
			id: "canonical-1",
		});
		mockState.insertValues.mockReturnValue({
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
		mockState.findEmployee.mockResolvedValue({
			id: "staff-1",
			userId: "staff-user",
			organizationId: "org-1",
			teamId: "team-1",
			isActive: true,
			role: "employee",
		});
		mockState.findManagerLinks.mockResolvedValue([{ employeeId: "staff-1" }]);
		mockState.getUserTimezone.mockImplementation(async (userId: string) =>
			userId === "staff-user" ? "Europe/Berlin" : "UTC",
		);
		mockState.createCanonicalWorkRecord.mockResolvedValue({
			id: "canonical-1",
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
			employeeId: "staff-1",
			date: "2026-05-04",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			timezone: "America/New_York",
			browserTimezone: "America/New_York",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.findEmployee).toHaveBeenCalledWith(
			expect.objectContaining({ where: expect.anything() }),
		);
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
		mockState.executeOrdinarySubmission.mockReset();
		mockState.createManualEntryApprovalRequest.mockReset();
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
		mockState.findExistingPeriod.mockResolvedValue(null);
		mockState.findCanonicalRecord.mockResolvedValue(null);
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
		mockState.executeOrdinarySubmission.mockImplementation(async (input) => {
			const result = await mockState.createManualEntryApprovalRequest(input);
			return {
				result,
				disposition: "executed",
				postCommit: {
					disposition: "dispatch",
					event: result.kind === "auto_completed" ? "approved" : "pending",
					dedupeKey: "manual-submission:result",
					approverEmployeeId:
						result.kind === "auto_completed" ? "employee-1" : "manager-1",
					maintenance:
						result.kind === "auto_completed"
							? {
									organizationId: "org-1",
									employeeId: "employee-1",
									dirtyFromDate: "2026-05-03",
									decision: "approved",
									surchargePeriodIds: ["period-1"],
									staleSurchargePeriodIds: [],
								}
							: null,
				},
			};
		});
		mockState.sendManualEntryApprovalNotifications.mockResolvedValue(undefined);
		mockState.sendManualEntryApprovedNotification.mockResolvedValue(undefined);
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);
		mockState.markEmployeeWorkBalanceDirty.mockResolvedValue(undefined);
		mockState.reconcileOrdinaryMaintenance.mockResolvedValue(undefined);
		mockState.requireBillingForMutation.mockResolvedValue({ canAccess: true });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
		mockState.transaction.mockImplementation(async (callback) =>
			callback({
				execute: vi.fn().mockResolvedValue({ rows: [{ locked: null }] }),
				query: {
					workPeriod: {
						findFirst: mockState.findExistingPeriod,
						findMany: mockState.findPolicyPeriods,
					},
					timeRecord: { findFirst: mockState.findCanonicalRecord },
					timeRecordWork: { findMany: mockState.findCanonicalWork },
					timeRecordAllocation: {
						findMany: mockState.findCanonicalAllocations,
					},
					approvalRequest: { findMany: mockState.findApprovalRequests },
				},
				insert: vi.fn(() => ({
					values: (...args: unknown[]) => mockState.insertValues(...args),
				})),
			}),
		);
	});

	it("uses the required canonical submission id as the manual work-period id", async () => {
		const submissionId = "10000000-0000-4000-8000-000000000099";
		mockState.insertValues.mockReturnValueOnce({
			returning: vi.fn().mockResolvedValue([{ id: submissionId }]),
		});

		const result = await createManualTimeEntry({
			submissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: { workPeriodId: submissionId },
		});
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ id: submissionId }),
		);
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledWith(
			expect.objectContaining({ submissionId, workPeriodId: submissionId }),
		);
	});

	it("reuses exact manual source and canonical evidence on a same-token retry", async () => {
		const submissionId = "10000000-0000-4000-8000-000000000099";
		const startTime = new Date("2026-05-03T09:00:00.000Z");
		const endTime = new Date("2026-05-03T10:00:00.000Z");
		mockState.findExistingPeriod.mockResolvedValue({
			id: submissionId,
			organizationId: "org-1",
			employeeId: "employee-1",
			clockInId: "clock-in-1",
			clockOutId: "clock-out-1",
			canonicalRecordId: "canonical-1",
			startTime,
			endTime,
			durationMinutes: 60,
			projectId: null,
			workCategoryId: null,
			isActive: false,
			approvalStatus: "pending",
			deletedAt: null,
			pendingChanges: {
				isManualEntry: true,
				ordinarySubmission: { submissionId, kind: "manual_time_submission" },
			},
			clockIn: {
				id: "clock-in-1",
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_in",
				timestamp: startTime,
				notes: "Manual entry: Forgot to clock in",
			},
			clockOut: {
				id: "clock-out-1",
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_out",
				timestamp: endTime,
				notes: "Forgot to clock in",
			},
		});
		mockState.findCanonicalRecord.mockResolvedValue({
			id: "canonical-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			recordKind: "work",
			startAt: startTime,
			endAt: endTime,
			durationMinutes: 60,
			approvalState: "pending",
			origin: "manual",
		});
		mockState.findCanonicalWork.mockResolvedValue([
			{
				recordId: "canonical-1",
				organizationId: "org-1",
				recordKind: "work",
				workCategoryId: null,
				workLocationType: null,
				computationMetadata: manualSubmissionMetadata(),
			},
		]);
		mockState.findCanonicalAllocations.mockResolvedValue([]);
		mockState.executeOrdinarySubmission.mockResolvedValueOnce({
			result: { kind: "default_created", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});
		setApprovalRequestEvidence(
			"manual_time_submission",
			submissionId,
			submissionId,
		);

		const result = await createManualTimeEntry({
			submissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: { workPeriodId: submissionId, requiresApproval: true },
		});
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(mockState.createCanonicalWorkRecord).not.toHaveBeenCalled();
		expect(mockState.createManualEntryApprovalRequest).not.toHaveBeenCalled();
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledOnce();
		expect(
			mockState.sendManualEntryApprovalNotifications,
		).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
	});

	it("replays committed manual evidence before changed mutable guards", async () => {
		setManualReplayEvidence();
		mockState.validateTimeEntryRange.mockResolvedValue({
			isValid: false,
			error: "New holiday rule",
		});
		mockState.getEditCapabilityForPeriod.mockResolvedValue({
			type: "forbidden",
			daysBack: 0,
		});
		mockState.findWorkPeriods.mockResolvedValue([
			{ id: "later-period", endTime: null },
		]);

		const result = await createManualTimeEntry({
			submissionId: defaultSubmissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: { workPeriodId: defaultSubmissionId, requiresApproval: true },
		});
		expect(mockState.validateTimeEntryRange).not.toHaveBeenCalled();
		expect(mockState.getEditCapabilityForPeriod).not.toHaveBeenCalled();
		expect(mockState.findWorkPeriods).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.createCanonicalWorkRecord).not.toHaveBeenCalled();
	});

	it("rejects a markerless manual token collision without writes or effects", async () => {
		setManualReplayEvidence({
			approvalStatus: "approved",
			pendingChanges: null,
			computationMetadata: null,
		});
		mockState.getEditCapabilityForPeriod.mockResolvedValue({ type: "allowed" });

		const result = await createManualTimeEntry({
			submissionId: defaultSubmissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to create time entry. Please try again.",
		});
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("requires strict approval evidence before replaying a pending manual source", async () => {
		setManualReplayEvidence();
		mockState.findApprovalRequests.mockResolvedValue([]);

		const result = await createManualTimeEntry({
			submissionId: defaultSubmissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to create time entry. Please try again.",
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
	});

	it("rolls back an existing manual source when a replay returns post-commit work", async () => {
		const durableState = { approvalWrites: [] as string[] };
		setManualReplayEvidence();
		mockState.executeOrdinarySubmission.mockImplementation(async () => {
			durableState.approvalWrites.push("approval-2");
			return {
				result: { kind: "default_created", approvalRequestId: "approval-2" },
				disposition: "replayed",
				postCommit: {
					disposition: "dispatch",
					event: "pending",
					approverEmployeeId: "manager-1",
				},
			};
		});
		mockState.transaction.mockImplementation(async (callback) => {
			const snapshot = durableState.approvalWrites.length;
			try {
				return await callback({
					execute: vi.fn().mockResolvedValue({ rows: [{ locked: null }] }),
					query: {
						workPeriod: { findFirst: mockState.findExistingPeriod },
						approvalRequest: { findMany: mockState.findApprovalRequests },
						timeRecord: { findFirst: mockState.findCanonicalRecord },
						timeRecordWork: { findMany: mockState.findCanonicalWork },
						timeRecordAllocation: {
							findMany: mockState.findCanonicalAllocations,
						},
					},
				});
			} catch (error) {
				durableState.approvalWrites.length = snapshot;
				throw error;
			}
		});

		const result = await createManualTimeEntry({
			submissionId: defaultSubmissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to create time entry. Please try again.",
		});
		expect(durableState.approvalWrites).toEqual([]);
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(
			mockState.sendManualEntryApprovalNotifications,
		).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("rejects manual replay when canonical work detail mismatches the source", async () => {
		setManualReplayEvidence({ workCategoryId: "category-1" });
		mockState.findCanonicalWork.mockResolvedValue([
			{
				recordId: "canonical-1",
				organizationId: "org-1",
				recordKind: "work",
				workCategoryId: "different-category",
				workLocationType: null,
				computationMetadata: manualSubmissionMetadata({
					workCategoryId: "category-1",
				}),
			},
		]);

		const result = await createManualTimeEntry({
			submissionId: defaultSubmissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
			workCategoryId: "category-1",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to create time entry. Please try again.",
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
	});

	it("rejects manual replay when canonical project allocation mismatches", async () => {
		setManualReplayEvidence({ projectId: "project-1" });
		mockState.findCanonicalAllocations.mockResolvedValue([
			{
				organizationId: "org-1",
				recordId: "canonical-1",
				allocationKind: "project",
				projectId: "different-project",
				costCenterId: null,
				weightPercent: 100,
			},
		]);

		const result = await createManualTimeEntry({
			submissionId: defaultSubmissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
			projectId: "project-1",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to create time entry. Please try again.",
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
	});

	it("serializes concurrent manual submissions and replays without duplicate writes", async () => {
		let previous = Promise.resolve();
		const order: string[] = [];
		mockState.findExistingPeriod.mockImplementation(async () => {
			order.push("lookup");
			return null;
		});
		mockState.transaction.mockImplementation(async (callback) => {
			const wait = previous;
			let release!: () => void;
			previous = new Promise((resolve) => {
				release = resolve;
			});
			await wait;
			try {
				return await callback({
					execute: vi.fn(async () => {
						order.push("lock");
						return { rows: [{ locked: null }] };
					}),
					query: {
						workPeriod: { findFirst: mockState.findExistingPeriod },
						timeRecord: { findFirst: mockState.findCanonicalRecord },
						timeRecordWork: { findMany: mockState.findCanonicalWork },
						timeRecordAllocation: {
							findMany: mockState.findCanonicalAllocations,
						},
						approvalRequest: { findMany: mockState.findApprovalRequests },
					},
					insert: vi.fn(() => ({
						values: (...args: unknown[]) => mockState.insertValues(...args),
					})),
				});
			} finally {
				release();
			}
		});
		mockState.createTimeEntry
			.mockReset()
			.mockResolvedValueOnce({ id: "clock-in-1", type: "clock_in" })
			.mockResolvedValueOnce({ id: "clock-out-1", type: "clock_out" });
		mockState.createCanonicalWorkRecord.mockResolvedValue({
			id: "canonical-1",
		});
		mockState.insertValues.mockImplementation(() => {
			setManualReplayEvidence();
			mockState.executeOrdinarySubmission
				.mockReset()
				.mockResolvedValueOnce({
					result: { kind: "default_created", approvalRequestId: "approval-1" },
					disposition: "executed",
					postCommit: {
						disposition: "dispatch",
						event: "pending",
						approverEmployeeId: "manager-1",
					},
				})
				.mockResolvedValue({
					result: { kind: "default_created", approvalRequestId: "approval-1" },
					disposition: "replayed",
					postCommit: null,
				});
			return {
				returning: vi.fn().mockResolvedValue([{ id: defaultSubmissionId }]),
			};
		});

		const request = {
			submissionId: defaultSubmissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		};
		const [first, second] = await Promise.all([
			createManualTimeEntry(request),
			createManualTimeEntry(request),
		]);

		expect(first).toMatchObject({
			success: true,
			data: { workPeriodId: defaultSubmissionId },
		});
		expect(second).toEqual(first);
		expect(mockState.createTimeEntry).toHaveBeenCalledTimes(2);
		expect(mockState.createCanonicalWorkRecord).toHaveBeenCalledOnce();
		expect(mockState.insertValues).toHaveBeenCalledOnce();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).toHaveBeenCalledOnce();
		expect(order.slice(0, 2)).toEqual(["lock", "lookup"]);
	});

	it("returns persisted adjusted times when a manual submission appears after waiting", async () => {
		setManualReplayEvidence();
		mockState.findCanonicalRecord.mockResolvedValue({
			id: "canonical-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			recordKind: "work",
			startAt: new Date("2026-05-03T09:15:00.000Z"),
			endAt: new Date("2026-05-03T10:00:00.000Z"),
			durationMinutes: 45,
			approvalState: "pending",
			origin: "manual",
		});
		mockState.findCanonicalWork.mockResolvedValue([
			{
				recordId: "canonical-1",
				organizationId: "org-1",
				recordKind: "work",
				workCategoryId: null,
				workLocationType: null,
				computationMetadata: JSON.stringify({
					ordinarySubmission: {
						submissionId: defaultSubmissionId,
						kind: "manual_time_submission",
					},
					request: {
						date: "2026-05-03",
						clockInTime: "09:00",
						clockOutTime: "10:00",
						reason: "Forgot to clock in",
						timezone: null,
						browserTimezone: null,
						projectId: null,
						workCategoryId: null,
					},
					result: {
						startTime: "2026-05-03T09:15:00.000Z",
						endTime: "2026-05-03T10:00:00.000Z",
						durationMinutes: 45,
						wasAdjusted: true,
					},
				}),
			},
		]);
		mockState.findExistingPeriod.mockResolvedValueOnce(null).mockResolvedValue({
			...policyReplayPeriod(defaultSubmissionId),
			id: defaultSubmissionId,
			clockOutId: "clock-out-1",
			approvalStatus: "pending",
			pendingChanges: {
				ordinarySubmission: {
					submissionId: defaultSubmissionId,
					kind: "manual_time_submission",
				},
			},
			startTime: new Date("2026-05-03T09:15:00.000Z"),
			endTime: new Date("2026-05-03T10:00:00.000Z"),
			durationMinutes: 45,
			clockIn: {
				id: "clock-in-1",
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_in",
				timestamp: new Date("2026-05-03T09:15:00.000Z"),
				notes: "Manual entry: Forgot to clock in",
			},
			clockOut: {
				id: "clock-out-1",
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_out",
				timestamp: new Date("2026-05-03T10:00:00.000Z"),
				notes: "Forgot to clock in",
			},
		});
		mockState.findWorkPeriods.mockResolvedValue([]);

		const result = await createManualTimeEntry({
			submissionId: defaultSubmissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: {
				workPeriodId: defaultSubmissionId,
				wasAdjusted: true,
				adjustedTimes: {
					clockIn: "2026-05-03T09:15:00.000Z",
					clockOut: "2026-05-03T10:00:00.000Z",
					durationMinutes: 45,
				},
			},
		});
	});

	it("preserves persisted manual approval intent when policy becomes permissive", async () => {
		setManualCanonicalDetail();
		const submissionId = "10000000-0000-4000-8000-000000000099";
		const startTime = new Date("2026-05-03T09:00:00.000Z");
		const endTime = new Date("2026-05-03T10:00:00.000Z");
		mockState.getEditCapabilityForPeriod.mockResolvedValue({ type: "allowed" });
		mockState.findExistingPeriod.mockResolvedValue({
			id: submissionId,
			organizationId: "org-1",
			employeeId: "employee-1",
			clockInId: "clock-in-1",
			clockOutId: "clock-out-1",
			canonicalRecordId: "canonical-1",
			startTime,
			endTime,
			durationMinutes: 60,
			projectId: null,
			workCategoryId: null,
			isActive: false,
			approvalStatus: "pending",
			deletedAt: null,
			pendingChanges: {
				ordinarySubmission: { submissionId, kind: "manual_time_submission" },
			},
			clockIn: {
				id: "clock-in-1",
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_in",
				timestamp: startTime,
				notes: "Manual entry: Forgot to clock in",
			},
			clockOut: {
				id: "clock-out-1",
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_out",
				timestamp: endTime,
				notes: "Forgot to clock in",
			},
		});
		mockState.findCanonicalRecord.mockResolvedValue({
			id: "canonical-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			recordKind: "work",
			startAt: startTime,
			endAt: endTime,
			durationMinutes: 60,
			approvalState: "pending",
			origin: "manual",
		});
		mockState.executeOrdinarySubmission.mockResolvedValueOnce({
			result: { kind: "default_created", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});

		const result = await createManualTimeEntry({
			submissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: { workPeriodId: submissionId, requiresApproval: true },
		});
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledOnce();
	});

	it("replays an approved manual requester-auto submission without effects", async () => {
		setManualReplayEvidence({
			approvalStatus: "approved",
			pendingChanges: null,
		});
		mockState.findApprovalRequests.mockResolvedValue([
			{
				metadata: requesterAutoApprovalMetadata(
					"manual_time_submission",
					defaultSubmissionId,
				),
			},
		]);
		mockState.executeOrdinarySubmission.mockResolvedValue({
			result: { kind: "auto_completed", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});

		const result = await createManualTimeEntry({
			submissionId: defaultSubmissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: {
				workPeriodId: defaultSubmissionId,
				requiresApproval: false,
			},
		});
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledOnce();
		expect(
			mockState.sendManualEntryApprovalNotifications,
		).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("replays an approved manual submission with its exact workflow id", async () => {
		setManualReplayEvidence({
			approvalStatus: "approved",
			pendingChanges: null,
			approvalWorkflowId: approvalWorkflowId(
				"manual_time_submission",
				defaultSubmissionId,
			),
		});
		mockState.findApprovalRequests.mockResolvedValue([]);
		mockState.executeOrdinarySubmission.mockResolvedValue({
			result: { kind: "auto_completed", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});

		const result = await createManualTimeEntry({
			submissionId: defaultSubmissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: {
				workPeriodId: defaultSubmissionId,
				requiresApproval: false,
			},
		});
		expect(mockState.findApprovalRequests).not.toHaveBeenCalled();
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledOnce();
		expect(
			mockState.sendManualEntryApprovalNotifications,
		).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("rejects malformed manual evidence after a valid request before Task 6", async () => {
		setManualReplayEvidence({
			approvalStatus: "approved",
			pendingChanges: null,
		});
		const validMetadata = requesterAutoApprovalMetadata(
			"manual_time_submission",
			defaultSubmissionId,
		);
		mockState.findApprovalRequests.mockResolvedValue([
			{ metadata: validMetadata },
			{
				metadata: {
					...validMetadata,
					autoApproval: {
						reason: "requester_is_approver",
						extra: true,
					},
				},
			},
		]);
		mockState.executeOrdinarySubmission.mockResolvedValue({
			result: { kind: "auto_completed", approvalRequestId: "approval-1" },
			disposition: "replayed",
			postCommit: null,
		});

		const result = await createManualTimeEntry({
			submissionId: defaultSubmissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to create time entry. Please try again.",
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
	});

	it("keeps an approved no-approval manual retry outside Task 6", async () => {
		setManualCanonicalDetail();
		mockState.findApprovalRequests.mockResolvedValue([]);
		const submissionId = "10000000-0000-4000-8000-000000000099";
		const startTime = new Date("2026-05-03T09:00:00.000Z");
		const endTime = new Date("2026-05-03T10:00:00.000Z");
		mockState.findExistingPeriod.mockResolvedValue({
			id: submissionId,
			organizationId: "org-1",
			employeeId: "employee-1",
			clockInId: "clock-in-1",
			clockOutId: "clock-out-1",
			canonicalRecordId: "canonical-1",
			startTime,
			endTime,
			durationMinutes: 60,
			projectId: null,
			workCategoryId: null,
			isActive: false,
			approvalStatus: "approved",
			deletedAt: null,
			pendingChanges: null,
			clockIn: {
				id: "clock-in-1",
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_in",
				timestamp: startTime,
				notes: "Manual entry: Forgot to clock in",
			},
			clockOut: {
				id: "clock-out-1",
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "clock_out",
				timestamp: endTime,
				notes: "Forgot to clock in",
			},
		});
		mockState.findCanonicalRecord.mockResolvedValue({
			id: "canonical-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			recordKind: "work",
			startAt: startTime,
			endAt: endTime,
			durationMinutes: 60,
			approvalState: "approved",
			origin: "manual",
		});

		const result = await createManualTimeEntry({
			submissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: { workPeriodId: submissionId, requiresApproval: false },
		});
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
		expect(
			mockState.sendManualEntryApprovalNotifications,
		).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(mockState.revalidatePath).not.toHaveBeenCalled();
	});

	it("revalidates an executed manual entry that does not require approval", async () => {
		mockState.getEditCapabilityForPeriod.mockResolvedValue({ type: "allowed" });

		const result = await createManualTimeEntry({
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.revalidatePath).toHaveBeenCalledOnce();
		expect(mockState.revalidatePath).toHaveBeenCalledWith("/time-tracking");
	});

	it("returns the generic failure for a colliding manual submission id", async () => {
		const submissionId = "10000000-0000-4000-8000-000000000099";
		mockState.findExistingPeriod.mockResolvedValue({
			id: submissionId,
			organizationId: "org-1",
			employeeId: "employee-1",
			startTime: new Date("2026-05-03T08:00:00.000Z"),
			endTime: new Date("2026-05-03T10:00:00.000Z"),
		});

		const result = await createManualTimeEntry({
			submissionId,
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to create time entry. Please try again.",
		});
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.executeOrdinarySubmission).not.toHaveBeenCalled();
	});

	it("routes approval-required manual entries through the primary manager link", async () => {
		const result = await createManualTimeEntry({
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				workPeriodId: "period-1",
				requesterEmployeeId: "employee-1",
				defaultApproverId: null,
				organizationId: "org-1",
				kind: "manual_time_submission",
			}),
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
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledWith(
			expect.objectContaining({ defaultApproverId: null }),
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
					execute: vi.fn().mockResolvedValue({ rows: [{ locked: null }] }),
					query: {
						workPeriod: {
							findFirst: mockState.findExistingPeriod,
							findMany: mockState.findPolicyPeriods,
						},
						approvalRequest: { findMany: mockState.findApprovalRequests },
						timeRecord: { findFirst: mockState.findCanonicalRecord },
						timeRecordWork: { findMany: mockState.findCanonicalWork },
						timeRecordAllocation: {
							findMany: mockState.findCanonicalAllocations,
						},
					},
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
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledWith(
			expect.objectContaining({ workPeriodId: "period-1" }),
		);
		expect(
			mockState.sendManualEntryApprovedNotification,
		).toHaveBeenCalledOnce();
		expect(
			mockState.sendManualEntryApprovalNotifications,
		).not.toHaveBeenCalled();
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
		expect(mockState.reconcileOrdinaryMaintenance).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
				surchargePeriodIds: ["period-1"],
			}),
		);
	});

	it("keeps committed manual-entry success when notification fails", async () => {
		mockState.sendManualEntryApprovalNotifications.mockRejectedValueOnce(
			new Error("notification unavailable"),
		);

		const result = await createManualTimeEntry({
			date: "2026-05-03",
			clockInTime: "09:00",
			clockOutTime: "10:00",
			reason: "Forgot to clock in",
		});

		expect(result.success).toBe(true);
		expect(mockState.logger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				workPeriodId: "period-1",
			}),
			"Failed to dispatch manual-entry approval notification after commit",
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
					execute: vi.fn().mockResolvedValue({ rows: [{ locked: null }] }),
					query: {
						workPeriod: {
							findFirst: mockState.findExistingPeriod,
							findMany: mockState.findPolicyPeriods,
						},
						timeRecord: { findFirst: mockState.findCanonicalRecord },
						timeRecordWork: { findMany: mockState.findCanonicalWork },
						timeRecordAllocation: {
							findMany: mockState.findCanonicalAllocations,
						},
						approvalRequest: { findMany: mockState.findApprovalRequests },
					},
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
		mockState.useRealOrdinarySubmission = true;
		let insertedWorkPeriodId = "";
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
			insertedWorkPeriodId = values.id;
			durableState.workPeriods.push(insertedWorkPeriodId);
			return {
				returning: vi.fn().mockResolvedValue([values]),
			};
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
					execute: ordinarySubmissionExecute(
						"manual_time_submission",
						() => insertedWorkPeriodId,
						"2026-05-03",
					),
					query: {
						...ordinarySubmissionQueries(),
						workPeriod: {
							findFirst: mockState.findExistingPeriod,
							findMany: mockState.findPolicyPeriods,
						},
						timeRecord: { findFirst: mockState.findCanonicalRecord },
						timeRecordWork: { findMany: mockState.findCanonicalWork },
						timeRecordAllocation: {
							findMany: mockState.findCanonicalAllocations,
						},
						approvalRequest: { findMany: mockState.findApprovalRequests },
					},
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
