import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalWriteGateResult } from "@/lib/approvals/authority";
import { deriveApprovalWorkflowId } from "@/lib/approvals/workflow/identity";
import { ValidationError } from "@/lib/effect/errors";

const mockState = vi.hoisted(() => ({
	getCurrentSession: vi.fn(),
	getCurrentEmployee: vi.fn(),
	getUserTimezone: vi.fn(),
	findUserSettings: vi.fn(),
	findOrganization: vi.fn(),
	getPrincipalContext: vi.fn(),
	getActiveWorkPeriod: vi.fn(),
	validateTimeEntry: vi.fn(),
	validateTimeEntryRange: vi.fn(),
	validateProjectAssignment: vi.fn(),
	findWorkCategory: vi.fn(),
	employeeHasAccessToCategory: vi.fn(),
	createTimeEntry: vi.fn(),
	getEditCapabilityForPeriod: vi.fn(),
	isOrgAdminCasl: vi.fn(),
	createClockOutApprovalRequest: vi.fn(),
	createManualEntryApprovalRequest: vi.fn(),
	executeOrdinarySubmission: vi.fn(),
	useRealOrdinarySubmission: false,
	useRealApprovalRuntime: false,
	sendManualEntryApprovalNotifications: vi.fn(),
	sendManualEntryApprovedNotification: vi.fn(),
	transactionOpen: false,
	readAppendAdmission: vi.fn(async () => "legacy" as "legacy" | "append"),
	replayCloseActiveWork: vi.fn(async (): Promise<unknown> => null),
	closeActiveWork: vi.fn(),
	calculateAndPersistSurcharges: vi.fn(),
	reconcileImmediateSurcharges: vi.fn(),
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
	acquireApprovalGate: vi.fn(),
	updateReturning: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
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
// No test here reads break status, the one runtime run in this module.
vi.mock("@/lib/effect/runtime", async () =>
	(await import("@/test/effect-runtime")).runtimeModuleOver(),
);

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
			userSettings: { findFirst: mockState.findUserSettings },
			organization: { findFirst: mockState.findOrganization },
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
	approvalChainInstance: {
		id: "approvalChainInstance.id",
		organizationId: "approvalChainInstance.organizationId",
	},
	approvalChainStageInstance: {
		id: "approvalChainStageInstance.id",
		organizationId: "approvalChainStageInstance.organizationId",
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
	userSettings: {
		userId: "userSettings.userId",
	},
}));

// Saved user timezones come from the getUserTimezone mock, keyed by the user id
// in the userSettings lookup, so tests configure one source of saved zones.
mockState.findUserSettings.mockImplementation(
	async ({ where }: { where: SQL }) => {
		const { params } = new PgDialect().sqlToQuery(where);
		return { timezone: await mockState.getUserTimezone(params.at(-1)) };
	},
);
mockState.findOrganization.mockResolvedValue({ timezone: null });

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

vi.mock("@/lib/time-tracking/work-transaction", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/lib/time-tracking/work-transaction")
	>()),
	readAppendAdmission: (...args: unknown[]) =>
		mockState.readAppendAdmission(...(args as [])),
}));

// The operation itself runs against PostgreSQL in the web clock-out integration
// suite; here the action's dispatch and replay order are observed.
vi.mock("@/lib/time-tracking/close-active-work", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/lib/time-tracking/close-active-work")
	>()),
	replayCloseActiveWork: (...args: unknown[]) =>
		mockState.replayCloseActiveWork(...(args as [])),
	closeActiveWork: (...args: unknown[]) =>
		mockState.closeActiveWork(...args),
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

// Evidence capture stays inactive here (no control row), as in production; the
// PostgreSQL suites cover active capture through these same callers.
vi.mock(
	"@/lib/approvals/evidence/work-period-evidence",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("@/lib/approvals/evidence/work-period-evidence")
		>()),
		prepareWorkPeriodSubmissionFacts: async () => null,
	}),
);

vi.mock("@/lib/approvals/workflow/runtime", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/approvals/workflow/runtime")>();
	return {
		createProductionApprovalWorkflowRuntime: (
			input: Parameters<
				typeof actual.createProductionApprovalWorkflowRuntime
			>[0],
		) => {
			if (mockState.useRealApprovalRuntime)
				return actual.createProductionApprovalWorkflowRuntime(input);
			const { db } = input;
			return {
				repository: {
					withTransaction: (
						operation: (context: unknown) => Promise<unknown>,
					) =>
						db.transaction((tx: unknown) => {
							const compatibilityWriter = {
								withWriteGate: () => compatibilityWriter,
								mirrorCanonicalToLegacy: vi.fn(),
							};
							return operation({
								dbService: { db: tx },
								writeGate: {
									acquire: async (scope: unknown) => (
										mockState.acquireApprovalGate(scope),
										approvalWriteGateResult("legacy")
									),
								},
								compatibilityWriter,
							});
						}),
				},
			};
		},
	};
});

vi.mock("@/lib/time-tracking/canonical-work-record", () => ({
	canonicalWorkRecordClient: {
		createForCompletedPeriod: mockState.createCanonicalWorkRecord,
	},
}));

vi.mock("./approvals", () => ({
	createClockOutApprovalRequest: mockState.createClockOutApprovalRequest,
	createManualEntryApprovalRequest: mockState.createManualEntryApprovalRequest,
	sendManualEntryApprovalNotifications:
		mockState.sendManualEntryApprovalNotifications,
	sendManualEntryApprovedNotification:
		mockState.sendManualEntryApprovedNotification,
}));

vi.mock("./auth", () => ({
	getCurrentSession: mockState.getCurrentSession,
	getCurrentEmployee: mockState.getCurrentEmployee,
	getRequestMetadata: async () => ({ ipAddress: "127.0.0.1", userAgent: "test-agent" }),
	getUserTimezone: mockState.getUserTimezone,
}));

vi.mock("@/lib/time-tracking/clock-out-effects", () => ({
	checkComplianceAfterClockOut: mockState.checkComplianceAfterClockOut,
	checkProjectBudgetAfterClockOut: mockState.checkProjectBudgetAfterClockOut,
	enforceBreaksAfterClockOut: mockState.enforceBreaksAfterClockOut,
	reconcileImmediateSurcharges: mockState.reconcileImmediateSurcharges,
}));

vi.mock("./compliance", () => ({
	calculateAndPersistSurcharges: mockState.calculateAndPersistSurcharges,
	calculateBreaksTakenToday: vi.fn(),
}));

vi.mock("./entry-helpers", () => ({
	validateProjectAssignment: mockState.validateProjectAssignment,
}));

vi.mock("@/lib/time-tracking/time-entry-writer", () => ({
	createTimeEntry: mockState.createTimeEntry,
}));

vi.mock("./policy-helpers", () => ({
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

const { createManualTimeEntry: createManualTimeEntryAction } = await import(
	"./clocking"
);

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
			surchargeSnapshot: {
				version: 1,
				evaluatedAt: `${date}T10:00:00Z`,
				resolution: { kind: "none" },
			},
			...(kind === "policy_clock_out"
				? {
						breakPolicySnapshot: {
							version: 1,
							evaluatedAt: `${date}T10:00:00Z`,
							resolution: "none",
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

function clockOutRoutingRows() {
	return [
		{ table: "organization", id: "org-1", binding: "org", source: false },
		{ table: "user", id: "user-1", binding: "user", source: false },
		{ table: "member", id: "member-1", binding: "member", source: false },
		{ table: "employee", id: "employee-1", binding: "employee", source: false },
	];
}

function ordinarySubmissionExecute(
	kind: "manual_time_submission" | "policy_clock_out",
	periodId?: string | (() => string),
	date?: string,
) {
	const dialect = new PgDialect();
	return vi.fn(async (query: SQL) => {
		const compiled = dialect.sqlToQuery(query);
		if (compiled.sql.includes("web-clock-out:route"))
			return { rows: clockOutRoutingRows() };
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
	mockState.useRealApprovalRuntime = false;
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
		surchargeSnapshot: {
			version: 1,
			evaluatedAt: "2026-05-04T10:00:00Z",
			resolution: { kind: "none" },
		},
		...(kind === "policy_clock_out"
			? {
					breakPolicySnapshot: {
						version: 1,
						evaluatedAt: "2026-05-04T10:00:00Z",
						resolution: "none",
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
						surchargeSnapshot: {
							version: 1,
							evaluatedAt: "2026-05-03T10:00:00Z",
							resolution: { kind: "none" },
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

vi.mock("@/lib/auth-helpers", () => ({
	getPrincipalContext: mockState.getPrincipalContext,
	isOrgAdminCasl: mockState.isOrgAdminCasl,
}));

function principalFor(
	actor: {
		id: string;
		userId: string;
		organizationId: string;
		teamId: string | null;
		role: "admin" | "manager" | "employee";
	},
	options: {
		orgRole?: "owner" | "admin" | "member";
		managedEmployeeIds?: string[];
	} = {},
) {
	return {
		userId: actor.userId,
		isPlatformAdmin: false,
		activeOrganizationId: actor.organizationId,
		orgMembership: {
			organizationId: actor.organizationId,
			role: options.orgRole ?? "member",
			status: "active" as const,
		},
		employee: {
			id: actor.id,
			organizationId: actor.organizationId,
			role: actor.role,
			teamId: actor.teamId,
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: options.managedEmployeeIds ?? [],
		customRoles: [],
	};
}

describe("createManualTimeEntry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.transaction.mockReset();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T10:00:00.000Z"));
		mockState.isOrgAdminCasl.mockReset().mockResolvedValue(false);

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
	])(
		"redacts non-canonical manual-entry validation errors %#",
		async (error) => {
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
		},
	);

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

	it("allows an organization owner or admin to create their own entry beyond the approval window", async () => {
		mockState.isOrgAdminCasl.mockResolvedValue(true);
		mockState.getEditCapabilityForPeriod.mockResolvedValue({
			type: "forbidden",
			reason: "beyond_approval_window",
			daysBack: 21,
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

		const result = await createManualTimeEntry({
			date: "2026-04-01",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: { requiresApproval: false },
		});
		expect(mockState.isOrgAdminCasl).toHaveBeenCalledWith("org-1");
	});

	it("fails closed when organization privilege verification fails", async () => {
		mockState.isOrgAdminCasl.mockRejectedValueOnce(
			new Error("authorization unavailable"),
		);

		const result = await createManualTimeEntry({
			date: "2026-04-01",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			reason: "Forgot to clock in",
		});

		expect(result).toEqual({
			success: false,
			error: "Could not verify time approval policy. Please try again.",
		});
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
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
		expect(mockState.resolveSurchargeSnapshot).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
			}),
		);
		expect(mockState.reconcileImmediateSurcharges).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			affectedWorkPeriodIds: ["period-1"],
			snapshot: expect.objectContaining({ resolution: { kind: "none" } }),
		});
		expect(mockState.calculateAndPersistSurcharges).not.toHaveBeenCalled();
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
		mockState.getPrincipalContext.mockResolvedValue(
			principalFor(
				{
					id: "manager-1",
					userId: "manager-user",
					organizationId: "org-1",
					teamId: "team-1",
					role: "manager",
				},
				{ managedEmployeeIds: ["staff-1"] },
			),
		);
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
		mockState.findEmployee.mockResolvedValue({
			id: "employee-2",
			userId: "other-user",
			organizationId: "org-1",
			teamId: "team-1",
			isActive: true,
			role: "employee",
		});
		mockState.getPrincipalContext.mockResolvedValue(
			principalFor({
				id: "employee-1",
				userId: "employee-user",
				organizationId: "org-1",
				teamId: "team-1",
				role: "employee",
			}),
		);

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

	describe("on-behalf target authorization", () => {
		const staff = {
			id: "staff-1",
			userId: "staff-user",
			organizationId: "org-1",
			teamId: "team-1",
			isActive: true,
			role: "employee" as const,
		};

		function arrangeActor(actor: {
			id: string;
			userId: string;
			role: "admin" | "manager" | "employee";
		}) {
			const currentEmployee = {
				...actor,
				organizationId: "org-1",
				teamId: "team-1",
				managerId: null,
			};
			mockState.getCurrentSession.mockResolvedValue({
				user: { id: actor.userId },
			});
			mockState.getCurrentEmployee.mockResolvedValue(currentEmployee);
			mockState.findEmployees.mockResolvedValue([
				{ ...currentEmployee, isActive: true },
				staff,
			]);
			return currentEmployee;
		}

		function arrangeSuccessfulWrite() {
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
		}

		it("lets an organization owner with an ordinary employee role create for an active colleague", async () => {
			const owner = arrangeActor({
				id: "owner-1",
				userId: "owner-user",
				role: "employee",
			});
			mockState.getPrincipalContext.mockResolvedValue(
				principalFor(owner, { orgRole: "owner" }),
			);
			mockState.findEmployee.mockResolvedValue(staff);
			mockState.getUserTimezone.mockImplementation(async (userId: string) =>
				userId === "staff-user" ? "Europe/Berlin" : "UTC",
			);
			arrangeSuccessfulWrite();

			const result = await createManualTimeEntry({
				employeeId: "staff-1",
				date: "2026-05-04",
				clockInTime: "08:00",
				clockOutTime: "09:00",
				timezone: "Europe/Berlin",
				reason: "Entered by the owner",
			});

			expect(result.success).toBe(true);
			expect(mockState.getEditCapabilityForPeriod).not.toHaveBeenCalled();
			expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					employeeId: "staff-1",
					organizationId: "org-1",
					timezoneSource: "manager_target_user_setting",
				}),
				expect.anything(),
			);
		});

		it("rejects a manager creating for a teammate who is not a direct report", async () => {
			const manager = arrangeActor({
				id: "manager-1",
				userId: "manager-user",
				role: "manager",
			});
			// Same team, readable roster, but no direct-report link.
			mockState.getPrincipalContext.mockResolvedValue(
				principalFor(manager, { managedEmployeeIds: [] }),
			);
			mockState.findEmployee.mockResolvedValue(staff);

			const result = await createManualTimeEntry({
				employeeId: "staff-1",
				date: "2026-05-04",
				clockInTime: "08:00",
				clockOutTime: "09:00",
				timezone: "UTC",
				reason: "Not my report",
			});

			expect(result).toEqual({
				success: false,
				error: "Not authorized to create time entries for this employee",
			});
			expect(mockState.validateTimeEntryRange).not.toHaveBeenCalled();
			expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		});

		it("rejects targets that are inactive or outside the active organization", async () => {
			const admin = arrangeActor({
				id: "admin-1",
				userId: "admin-user",
				role: "employee",
			});
			mockState.getPrincipalContext.mockResolvedValue(
				principalFor(admin, { orgRole: "admin" }),
			);
			// The target lookup is scoped to the active organization and active employees.
			mockState.findEmployee.mockResolvedValue(undefined);

			const result = await createManualTimeEntry({
				employeeId: "foreign-employee",
				date: "2026-05-04",
				clockInTime: "08:00",
				clockOutTime: "09:00",
				timezone: "UTC",
				reason: "Foreign target",
			});

			expect(result).toEqual({
				success: false,
				error: "Not authorized to create time entries for this employee",
			});
			expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		});

		it("rejects on-behalf entries when the principal is for another organization", async () => {
			const manager = arrangeActor({
				id: "manager-1",
				userId: "manager-user",
				role: "manager",
			});
			mockState.getPrincipalContext.mockResolvedValue({
				...principalFor(manager, { managedEmployeeIds: ["staff-1"] }),
				activeOrganizationId: "org-2",
			});
			mockState.findEmployee.mockResolvedValue(staff);

			const result = await createManualTimeEntry({
				employeeId: "staff-1",
				date: "2026-05-04",
				clockInTime: "08:00",
				clockOutTime: "09:00",
				timezone: "UTC",
				reason: "Switched organization",
			});

			expect(result.success).toBe(false);
			expect(mockState.findEmployee).not.toHaveBeenCalled();
			expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		});

		it("interprets on-behalf entries in the organization timezone when the target has none", async () => {
			const manager = arrangeActor({
				id: "manager-1",
				userId: "manager-user",
				role: "manager",
			});
			mockState.getPrincipalContext.mockResolvedValue(
				principalFor(manager, { managedEmployeeIds: ["staff-1"] }),
			);
			mockState.findEmployee.mockResolvedValue(staff);
			mockState.findUserSettings.mockResolvedValueOnce(undefined);
			mockState.findOrganization.mockResolvedValueOnce({
				timezone: "America/New_York",
			});
			arrangeSuccessfulWrite();

			// The submitted and browser zones belong to the manager and are ignored.
			const result = await createManualTimeEntry({
				employeeId: "staff-1",
				date: "2026-05-03",
				clockInTime: "08:00",
				clockOutTime: "09:00",
				timezone: "Europe/Berlin",
				browserTimezone: "Europe/Berlin",
				reason: "Forgot to clock in",
			});

			expect(result.success).toBe(true);
			expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					employeeId: "staff-1",
					timestamp: new Date("2026-05-03T12:00:00.000Z"),
					timezone: "America/New_York",
					timezoneSource: "manager_target_user_setting",
					utcOffsetMinutes: -240,
				}),
				expect.anything(),
			);
		});
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
		mockState.isOrgAdminCasl.mockReset().mockResolvedValue(false);
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

	it("submits entries beyond the approval window as pending for their manager", async () => {
		mockState.isOrgAdminCasl.mockResolvedValue(false);
		mockState.getEditCapabilityForPeriod.mockResolvedValue({
			type: "forbidden",
			reason: "beyond_approval_window",
			daysBack: 33,
		});

		const result = await createManualTimeEntry({
			date: "2026-04-01",
			clockInTime: "08:00",
			clockOutTime: "09:00",
			reason: "Forgot to clock in",
		});

		expect(result).toMatchObject({
			success: true,
			data: { requiresApproval: true },
		});
		expect(mockState.createCanonicalWorkRecord).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
				approvalState: "pending",
			}),
			expect.objectContaining({ insert: expect.any(Function) }),
		);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
				approvalStatus: "pending",
			}),
		);
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				requesterEmployeeId: "employee-1",
				kind: "manual_time_submission",
			}),
		);
		expect(mockState.sendManualEntryApprovalNotifications).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
				managerId: "manager-1",
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

	it("captures manual surcharge evidence inside the source transaction before submission", async () => {
		const surchargeSnapshot = {
			version: 1,
			evaluatedAt: "2026-05-03T10:00:00Z",
			resolution: { kind: "none" },
		} as const;
		mockState.resolveSurchargeSnapshot.mockImplementationOnce(async (input) => {
			expect(mockState.transactionOpen).toBe(true);
			expect(mockState.createTimeEntry).toHaveBeenCalledTimes(2);
			expect(input).toMatchObject({
				organizationId: "org-1",
				employeeId: "employee-1",
			});
			expect(input.startTime.toString()).toBe("2026-05-03T09:00:00Z");
			expect(input.endTime.toString()).toBe("2026-05-03T10:00:00Z");
			return surchargeSnapshot;
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
				mockState.transactionOpen = false;
			}
		});

		await expect(
			createManualTimeEntry({
				submissionId: defaultSubmissionId,
				date: "2026-05-03",
				clockInTime: "09:00",
				clockOutTime: "10:00",
				reason: "Forgot to clock in",
			}),
		).resolves.toMatchObject({ success: true });

		expect(mockState.resolveSurchargeSnapshot).toHaveBeenCalledOnce();
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				pendingChanges: expect.objectContaining({ surchargeSnapshot }),
			}),
		);
		expect(mockState.executeOrdinarySubmission).toHaveBeenCalledAfter(
			mockState.resolveSurchargeSnapshot,
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
