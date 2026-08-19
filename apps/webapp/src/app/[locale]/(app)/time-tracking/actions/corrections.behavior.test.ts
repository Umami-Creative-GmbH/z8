import { Temporal } from "temporal-polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	employee as employeeTable,
	teamMembership as teamMembershipTable,
	team as teamTable,
	timeRecord as timeRecordTable,
	timeRecordWork as timeRecordWorkTable,
	workCategorySetAssignment as workCategorySetAssignmentTable,
	workCategorySetCategory as workCategorySetCategoryTable,
	workCategorySet as workCategorySetTable,
	workCategory as workCategoryTable,
	workPeriod as workPeriodTable,
} from "@/db/schema";

const state = vi.hoisted(() => ({
	selectLimit: vi.fn(),
	employeeFindFirst: vi.fn(),
	timeEntryFindMany: vi.fn(),
	txSelectForUpdate: vi.fn(),
	txTimeEntryFindFirst: vi.fn(),
	txInsertValues: vi.fn(),
	txDeleteReturning: vi.fn(),
	withTransaction: vi.fn(),
	executeSubmission: vi.fn(),
	getManager: vi.fn(),
	getSession: vi.fn(),
	getTimezone: vi.fn(),
	requireBilling: vi.fn(),
	currentEmployee: vi.fn(),
	pendingApproval: vi.fn(),
	editCapability: vi.fn(),
	directTransaction: vi.fn(),
	createCorrectionEntry: vi.fn(),
	markWorkBalanceDirty: vi.fn(),
	txCategoryFindFirst: vi.fn(),
	txAssignmentsFindMany: vi.fn(),
	txSetCategoryFindFirst: vi.fn(),
	txApprovalWorkflowFindFirst: vi.fn(),
	txApprovalRequestFindMany: vi.fn(),
	directSelectForUpdate: vi.fn(),
	directUpdateCalls: [] as Array<Record<string, unknown>>,
	directSetCalls: [] as Array<Record<string, unknown>>,
	directCanonicalFailure: false,
	nowInstant: vi.fn(),
	sendEmail: vi.fn(),
	maintenance: vi.fn(),
	validateRange: vi.fn(),
	events: [] as string[],
}));

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/datetime/temporal-core")>()),
	systemClock: { nowInstant: state.nowInstant },
}));

vi.mock("next/headers", () => ({
	headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: state.getSession } },
}));

vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: state.getManager,
}));

vi.mock("@/lib/approvals/server/time-correction-approvals", () => ({
	deleteCancelledTimeCorrectionsInTransaction: vi.fn(),
	executeTimeCorrectionSubmissionInTransaction: state.executeSubmission,
	finalizeTimeCorrectionTerminalInTransaction: vi.fn(),
	insertTimeCorrectionSourceEntry: vi.fn(async (input) => {
		const [created] = await input.dbService.db
			.insert()
			.values({
				...input.timezoneCapture,
				id: input.id,
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				type: "correction",
				timestamp: input.timestamp,
				hash: input.hash,
				previousHash: input.previousHash,
				previousEntryId: input.previousEntryId,
				replacesEntryId: input.replacesEntryId,
				isSuperseded: true,
				supersededById: null,
				notes: input.notes,
				location: input.location ?? null,
				ipAddress: input.ipAddress,
				deviceInfo: input.deviceInfo,
				createdBy: input.createdBy,
			})
			.returning();
		return created ?? null;
	}),
	runAutoCompletedTimeCorrectionMaintenance: async (input: unknown) => {
		state.events.push("maintenance");
		return state.maintenance(input);
	},
}));

vi.mock("@/lib/approvals/workflow/runtime", () => ({
	createProductionApprovalWorkflowRuntime: () => ({
		repository: { withTransaction: state.withTransaction },
		transitionEngine: {},
	}),
}));

vi.mock("@/lib/billing/guard", () => ({
	isBillingMutationAllowed: (access: { allowed: boolean }) => access.allowed,
	requireBillingForMutation: state.requireBilling,
}));

vi.mock("./policy-helpers", () => ({
	getEditCapabilityForPeriod: state.editCapability,
}));

vi.mock("../actions.canonical", () => ({
	canonicalTimeEntryClient: {
		createCorrectionEntry: state.createCorrectionEntry,
	},
}));

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: state.markWorkBalanceDirty,
}));

vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: vi.fn().mockResolvedValue("https://example.com"),
}));

vi.mock("@/lib/email/render", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/email/render")>()),
	renderTimeCorrectionPendingApproval: vi.fn().mockResolvedValue("email"),
}));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: async (input: unknown) => {
		state.events.push("email");
		return state.sendEmail(input);
	},
}));

vi.mock("@/lib/time-tracking/validation", () => ({
	validateTimeEntryRange: state.validateRange,
}));

vi.mock("./auth", async (importOriginal) => ({
	...(await importOriginal<typeof import("./auth")>()),
	getCurrentEmployee: state.currentEmployee,
	getCurrentSession: state.getSession,
	getRequestMetadata: vi.fn().mockResolvedValue({
		ipAddress: "127.0.0.1",
		userAgent: "vitest",
	}),
	getUserTimezone: state.getTimezone,
}));

vi.mock("./shared", () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const modularActions = await import("./corrections");
const monolithicActions = await import("../actions");

const defaultCorrectionMetadata = {
	workLocationType: "office" as const,
	workCategoryId: null,
};
const modular = {
	...modularActions,
	requestTimeCorrectionEffect: (
		data: Parameters<typeof modularActions.requestTimeCorrectionEffect>[0],
	) =>
		modularActions.requestTimeCorrectionEffect({
			...defaultCorrectionMetadata,
			...data,
		}),
};
const monolithic = {
	...monolithicActions,
	requestTimeCorrectionEffect: (
		data: Parameters<typeof monolithicActions.requestTimeCorrectionEffect>[0],
	) =>
		monolithicActions.requestTimeCorrectionEffect({
			...defaultCorrectionMetadata,
			...data,
		}),
	requestTimeCorrection: (
		data: Parameters<typeof monolithicActions.requestTimeCorrection>[0],
	) =>
		monolithicActions.requestTimeCorrection({
			...defaultCorrectionMetadata,
			...data,
		}),
};

const ids = {
	employee: "31000000-0000-4000-8000-000000000901",
	manager: "31000000-0000-4000-8000-000000000902",
	period: "31000000-0000-4000-8000-000000000903",
	clockIn: "31000000-0000-4000-8000-000000000904",
	clockOut: "31000000-0000-4000-8000-000000000905",
	team: "31000000-0000-4000-8000-000000000907",
};
const submissionId = "31000000-0000-4000-8000-000000000906";

const categoryId = "31000000-0000-4000-8000-000000000910";
const categorySetId = "31000000-0000-4000-8000-000000000911";

const employee = {
	id: ids.employee,
	userId: "user-1",
	organizationId: "org-1",
	teamId: null,
	isActive: true,
};
const approvedMember = {
	id: "member-1",
	userId: "user-1",
	organizationId: "org-1",
	status: "approved",
};
const period = {
	id: ids.period,
	employeeId: ids.employee,
	organizationId: "org-1",
	clockInId: ids.clockIn,
	clockOutId: ids.clockOut,
	startTime: new Date("2026-07-01T08:00:00.000Z"),
	endTime: new Date("2026-07-01T16:00:00.000Z"),
	workLocationType: "office",
	workCategoryId: null,
	canonicalRecordId: "31000000-0000-4000-8000-000000000909",
	deletedAt: null,
};
const originals = [
	{
		id: ids.clockIn,
		employeeId: ids.employee,
		organizationId: "org-1",
		timestamp: period.startTime,
		isSuperseded: false,
		hash: "clock-in-hash",
		timezone: "Europe/Berlin",
		timezoneSource: "browser",
		utcOffsetMinutes: 120,
	},
	{
		id: ids.clockOut,
		employeeId: ids.employee,
		organizationId: "org-1",
		timestamp: period.endTime,
		isSuperseded: false,
		hash: "clock-out-hash",
		timezone: "America/New_York",
		timezoneSource: "browser",
		utcOffsetMinutes: -240,
	},
];

function transactionDb() {
	const lockedQuery = () => ({
		for: state.txSelectForUpdate,
		limit: vi.fn(() => ({ for: state.txSelectForUpdate })),
	});
	return {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					for: state.txSelectForUpdate,
					limit: vi.fn(() => ({ for: state.txSelectForUpdate })),
					orderBy: vi.fn(lockedQuery),
				})),
			})),
		})),
		insert: vi.fn(() => ({ values: state.txInsertValues })),
		delete: vi.fn(() => ({
			where: vi.fn(() => ({ returning: state.txDeleteReturning })),
		})),
		query: {
			approvalWorkflow: { findFirst: state.txApprovalWorkflowFindFirst },
			approvalRequest: { findMany: state.txApprovalRequestFindMany },
			timeEntry: { findFirst: state.txTimeEntryFindFirst },
			workCategory: { findFirst: state.txCategoryFindFirst
		},
			workCategorySetAssignment: { findMany: state.txAssignmentsFindMany
	},
			workCategorySetCategory: { findFirst: state.txSetCategoryFindFirst },
		},
	};
}

function configure(result: {
	kind: "auto_completed" | "default_created";
	disposition?: "executed" | "replayed";
	authority?: "legacy" | "canonical";
	submittedToEmployeeId?: string | null;
}) {
	state.getSession.mockResolvedValue({
		user: { id: "user-1" },
		session: { activeOrganizationId: "org-1" },
	});
	state.getTimezone.mockResolvedValue("UTC");
	state.nowInstant.mockReturnValue(
		Temporal.Instant.from("2026-07-02T00:00:00Z"),
	);
	state.requireBilling.mockResolvedValue({ allowed: true });
	state.validateRange.mockResolvedValue({ isValid: true });
	state.currentEmployee.mockResolvedValue(employee);
	state.pendingApproval.mockResolvedValue(null);
	state.editCapability.mockResolvedValue({ type: "direct" });
	state.txCategoryFindFirst.mockResolvedValue(null);
	state.txAssignmentsFindMany.mockResolvedValue([]);
	state.txSetCategoryFindFirst.mockResolvedValue(null);
	state.txApprovalWorkflowFindFirst.mockResolvedValue(null);
	state.txApprovalRequestFindMany.mockResolvedValue([]);
	state.markWorkBalanceDirty.mockResolvedValue(undefined);
	state.employeeFindFirst.mockResolvedValue(employee);
	state.selectLimit.mockResolvedValue([period]);
	state.timeEntryFindMany.mockResolvedValue(originals);
	state.txSelectForUpdate.mockReset();
	state.txSelectForUpdate
		.mockResolvedValueOnce([employee])
		.mockResolvedValueOnce([approvedMember])
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([period])
		.mockResolvedValueOnce([originals[0]]);
	state.getManager.mockResolvedValue(ids.manager);
	state.txTimeEntryFindFirst.mockReset();
	state.txTimeEntryFindFirst
		.mockResolvedValueOnce(originals[1])
		.mockResolvedValue(null);
	state.txInsertValues.mockImplementation((values) => ({
		returning: async () => [{ ...values, createdAt: new Date() }],
	}));
	state.txDeleteReturning.mockReset().mockResolvedValue([]);
	const tx = transactionDb();
	state.withTransaction.mockImplementation(async (operation) => {
		state.events.push("transaction");
		const context = { dbService: { db: tx } };
		return operation(context);
	});
	const autoCompletion = {
		period,
		workBalanceDirtyMark: {
			employeeId: ids.employee,
			organizationId: "org-1",
			dirtyFromDate: "2026-07-01",
		},
	};
	state.executeSubmission.mockImplementation(async (input) => {
		expect(input.context.dbService.db).toBe(input.dbService.db);
		expect(input.overtimeRisk).toBeNull();
		state.events.push("boundary");
		return {
			disposition: result.disposition ?? "executed",
			kind: result.kind,
			approvalRequestId: "approval-1",
			...(result.kind === "auto_completed" ? { autoCompletion } : {}),
			postCommit: {
				authority: result.authority ?? "canonical",
				submittedToEmployeeId: result.submittedToEmployeeId ?? null,
				terminal:
					result.kind === "auto_completed" && result.authority === "legacy"
						? {
								kind: "approved",
								dirtyFromDate: "2026-07-01",
								requesterEmployeeId: ids.employee,
							}
						: null,
			},
		};
	});
	state.sendEmail.mockResolvedValue({ success: true });
}

function configureDirectEdit(selectedPeriod = period) {
	configure({ kind: "default_created" });
	state.selectLimit.mockResolvedValue([selectedPeriod]);
	state.timeEntryFindMany.mockResolvedValue([
		{ ...originals[0], timestamp: selectedPeriod.startTime },
		{ ...originals[1], timestamp: selectedPeriod.endTime },
	]);
	state.createCorrectionEntry.mockResolvedValue({ id: "correction-1" });
	state.directUpdateCalls.length = 0;
	state.directSetCalls.length = 0;
	state.directCanonicalFailure = false;
	state.directSelectForUpdate.mockReset();
	state.directSelectForUpdate
		.mockResolvedValueOnce([employee])
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([selectedPeriod])
		.mockResolvedValueOnce([
			{
				id: selectedPeriod.canonicalRecordId,
				organizationId: selectedPeriod.organizationId,
				employeeId: selectedPeriod.employeeId,
				recordKind: "work",
			},
		])
		.mockResolvedValueOnce([
			{
				recordId: selectedPeriod.canonicalRecordId,
				organizationId: selectedPeriod.organizationId,
				recordKind: "work",
				workLocationType: selectedPeriod.workLocationType,
				workCategoryId: selectedPeriod.workCategoryId,
			},
		]);
	state.directTransaction.mockImplementation(async (operation) => {
		const stagedUpdates: Array<Record<string, unknown>> = [];
		const tx = {
			select:

vi.fn(() => ({
				from: vi.fn((table) => ({
					where: vi.fn(() => ({
						for: vi.fn(() => state.directSelectForUpdate(table)),
						limit: vi.fn(() => ({
							for: vi.fn(() => state.directSelectForUpdate(table)),
						})),
						orderBy: vi.fn(() => ({
							for: vi.fn(() => state.directSelectForUpdate(table)),
							limit: vi.fn(() => ({
								for: vi.fn(() => state.directSelectForUpdate(table)),
							})),
						})),
					})),
				})),
			})),
			update: vi.fn(() => ({
				set: vi.fn((values) => {
					state.directSetCalls.push(values);
					return {
						where: vi.fn(() => ({
							returning: async () => {
								stagedUpdates.push(values);
								if (
									state.directCanonicalFailure &&
									stagedUpdates.length === 2
								) {
									throw new Error("canonical update failed");
								}
								return [
									{
										id:
											stagedUpdates.length === 1
												? period.id
												: period.canonicalRecordId,
									},
								];
							},
						})),
					};
				}),
			})),
			query: {
				workCategory: { findFirst: state.txCategoryFindFirst },
				workCategorySetAssignment: { findMany: state.txAssignmentsFindMany },
				workCategorySetCategory: { findFirst: state.txSetCategoryFindFirst },
			},
		};
		const result = await operation(tx);
		state.directUpdateCalls.push(...stagedUpdates);
		return result;
	});
}

function configureDirectCategoryEdit(input: {
	membershipOrganizationId: string;
	teamOrganizationId: string;
}) {
	configureDirectEdit();
	const employeeWithTeam = { ...employee, teamId: ids.team };
	const rows = new Map<unknown, unknown[]>([
		[employeeTable, [employeeWithTeam]],
		[
			teamMembershipTable,
			[
				{
					organizationId: input.membershipOrganizationId,
					employeeId: ids.employee,
					teamId: ids.team,
				},
			],
		],
		[teamTable, [{ id: ids.team, organizationId: input.teamOrganizationId }]],
		[workPeriodTable, [period]],
		[
			workCategoryTable,
			[{ id: categoryId, organizationId: "org-1", isActive: true }],
		],
		[
			workCategorySetAssignmentTable,
			[
				{
					id: "assignment-1",
					assignmentType: "team",
					organizationId: "org-1",
					teamId: ids.team,
					setId: categorySetId,
					isActive: true,
					effectiveFrom: null,
					effectiveUntil: null,
				},
			],
		],
		[
			workCategorySetTable,
			[{ id: categorySetId, organizationId: "org-1", isActive: true }],
		],
		[workCategorySetCategoryTable, [{ id: "set-category-1" }]],
		[
			timeRecordTable,
			[
				{
					id: period.canonicalRecordId,
					organizationId: period.organizationId,
					employeeId: period.employeeId,
					recordKind: "work",
				},
			],
		],
		[
			timeRecordWorkTable,
			[
				{
					recordId: period.canonicalRecordId,
					organizationId: period.organizationId,
					recordKind: "work",
					workLocationType: period.workLocationType,
					workCategoryId: period.workCategoryId,
				},
			],
		],
	]);
	state.directSelectForUpdate
		.mockReset()
		.mockImplementation((table) => rows.get(table) ?? []);
}

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: state.employeeFindFirst },
			timeEntry: { findMany: state.timeEntryFindMany },
			approvalRequest: { findFirst: state.pendingApproval },
			userSettings: { findFirst: vi.fn() },
		},
		transaction: state.directTransaction,
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({ limit: state.selectLimit })),
			})),
		})),
	},
}));

describe("time correction submission actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.events.length = 0;
	});

	it.each([
		["modular", modular.requestTimeCorrectionEffect],
		["monolithic", monolithic.requestTimeCorrectionEffect],
	] as const)("returns the stable pending response from the %s path", async (_name, action) => {
		configure({ kind: "default_created" });

		const result = await action({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toEqual({
			success: true,
			data: { approvalId: "approval-1", status: "pending" },
		});
		expect(state.withTransaction).toHaveBeenCalledOnce();
		expect(state.executeSubmission).toHaveBeenCalledOnce();
		expect(state.events).toEqual(["transaction", "boundary"]);
	});

	it("rejects an active SCIM employee whose organization membership is suspended", async () => {
		configure({ kind: "default_created" });
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([{ ...approvedMember, status: "suspended" }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([originals[0]]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: false });
		expect(state.txInsertValues).not.toHaveBeenCalled();
		expect(state.executeSubmission).not.toHaveBeenCalled();
	});

	it.each([
		["missing", []],
		["duplicate", [approvedMember, { ...approvedMember, id: "member-2" }]],
		["wrong organization", [{ ...approvedMember, organizationId: "org-2" }]],
	] as const)("rejects a %s organization membership before correction insertion", async (_label, members) => {
		configure({ kind: "default_created" });
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce(members);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: false });
		expect(state.txInsertValues).not.toHaveBeenCalled();
		expect(state.executeSubmission).not.toHaveBeenCalled();
	});

	it("returns approved without direct canonical side effects", async () => {
		configure({ kind: "auto_completed" });

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toEqual({
			success: true,
			data: { approvalId: "approval-1", status: "approved" },
		});
		expect(state.maintenance).not.toHaveBeenCalled();
		expect(state.sendEmail).not.toHaveBeenCalled();
	});

	it("rejects an invalid cycle token before opening the repository transaction", async () => {
		configure({ kind: "default_created" });

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId: "not-a-uuid",
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: false });
		expect(state.withTransaction).not.toHaveBeenCalled();
	});

	it.each([
		["missing", []],
		["duplicate", [employee, { ...employee }]],
	] as const)("fails closed when the locked submission target is %s", async (_label, lockedEmployees) => {
		configure({ kind: "default_created" });
		state.txSelectForUpdate.mockReset().mockResolvedValueOnce(lockedEmployees);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: false });
		expect(state.executeSubmission).not.toHaveBeenCalled();
		expect(state.txInsertValues).not.toHaveBeenCalled();
	});

	it("lets Task 7 route a managerless submission", async () => {
		configure({ kind: "default_created" });
		state.getManager.mockResolvedValue(null);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result.success).toBe(true);
		expect(state.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({ defaultApproverId: null }),
		);
	});

	it("routes with the organization-scoped team locked in the transaction", async () => {
		configure({ kind: "default_created" });
		const employeeWithTeam = { ...employee, teamId: ids.team };
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employeeWithTeam])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([
				{ organizationId: "org-1", employeeId: ids.employee, teamId: ids.team },
			])
			.mockResolvedValueOnce([{ id: ids.team, organizationId: "org-1" }])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([originals[0]]);

		await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(state.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: ids.team }),
		);
	});

	it("does not grant approval category access from a stale employee team claim", async () => {
		configure({ kind: "default_created" });
		const employeeWithTeam = { ...employee, teamId: ids.team };
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employeeWithTeam])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([
				{ id: categoryId, organizationId: "org-1", isActive: true },
			])
			.mockResolvedValueOnce([
				{
					id: "assignment-1",
					assignmentType: "team",
					organizationId: "org-1",
					teamId: ids.team,
					setId: categorySetId,
					isActive: true,
					effectiveFrom: null,
					effectiveUntil: null,
				},
			])
			.mockResolvedValueOnce([
				{ id: categorySetId, organizationId: "org-1", isActive: true },
			])
			.mockResolvedValueOnce([{ id: "set-category-1" }])
			.mockResolvedValueOnce([originals[0]]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			workLocationType: "office",
			workCategoryId: categoryId,
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: false });
		expect(state.executeSubmission).not.toHaveBeenCalled();
	});

	it("grants approval category access from valid scoped team evidence", async () => {
		configure({ kind: "default_created" });
		const employeeWithTeam = { ...employee, teamId: ids.team };
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employeeWithTeam])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([
				{ organizationId: "org-1", employeeId: ids.employee, teamId: ids.team },
			])
			.mockResolvedValueOnce([{ id: ids.team, organizationId: "org-1" }])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([originals[0]])
			.mockResolvedValueOnce([
				{ id: categoryId, organizationId: "org-1", isActive: true },
			])
			.mockResolvedValueOnce([
				{
					id: "assignment-1",
					assignmentType: "team",
					organizationId: "org-1",
					teamId: ids.team,
					setId: categorySetId,
					isActive: true,
					effectiveFrom: null,
					effectiveUntil: null,
				},
			])
			.mockResolvedValueOnce([
				{ id: categorySetId, organizationId: "org-1", isActive: true },
			])
			.mockResolvedValueOnce([{ id: "set-category-1" }]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			workLocationType: "office",
			workCategoryId: categoryId,
			reason: "Missed punch",
	});

		expect(result).toMatchObject({ success: true });
		expect(state.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: ids.team }),
		);
	});

	it("uses the fixed system instant for category assignment windows", async () => {
		configure({ kind: "default_created" });
		const employeeWithTeam = { ...employee, teamId: ids.team };
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employeeWithTeam])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([
				{ organizationId: "org-1", employeeId: ids.employee, teamId: ids.team },
			])
			.mockResolvedValueOnce([{ id: ids.team, organizationId: "org-1" }])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([originals[0]])
			.mockResolvedValueOnce([
				{ id: categoryId, organizationId: "org-1", isActive: true },
			])
			.mockResolvedValueOnce([
				{
					id: "assignment-1",
					assignmentType: "team",
					organizationId: "org-1",
					teamId: ids.team,
					setId: categorySetId,
					isActive: true,
					effectiveFrom: new Date("2026-07-01T00:00:00Z"),
					effectiveUntil: new Date("2026-07-03T00:00:00Z"),
				},
			])
			.mockResolvedValueOnce([
				{ id: categorySetId, organizationId: "org-1", isActive: true },
			])
			.mockResolvedValueOnce([{ id: "set-category-1" }]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			workLocationType: "office",
			workCategoryId: categoryId,
			reason: "Missed punch",
		});

		expect(state.nowInstant).toHaveBeenCalled();
		expect(result).toMatchObject({ success: true });
	});

	it("derives the same correction row identity for an exact request retry", async () => {
		configure({ kind: "default_created" });
		const request = {
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		};

		await modular.requestTimeCorrectionEffect(request);
		const firstId = state.txInsertValues.mock.calls.at(-1)?.[0].id;
		configure({ kind: "default_created" });
		await modular.requestTimeCorrectionEffect(request);
		const retryId = state.txInsertValues.mock.calls.at(-1)?.[0].id;

		expect(firstId).toMatch(/^[0-9a-f-]{36}$/);
		expect(retryId).toBe(firstId);
	});

	it("labels newly persisted correction cycles as v2", async () => {
		configure({ kind: "default_created" });

		await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(state.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				submissionKey: expect.stringMatching(/^time-correction-cycle:v2:/),
			}),
		);
	});

	it("replays exact persisted evidence before mutable time-range validation", async () => {
		const request = {
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		};
		configure({ kind: "default_created" });
		await expect(
			modular.requestTimeCorrectionEffect(request),
		).resolves.toMatchObject({
			success: true,
		});
		const existingCorrection = state.txInsertValues.mock.calls.at(-1)?.[0];

		configure({ kind: "default_created", disposition: "replayed" });
		state.txTimeEntryFindFirst
			.mockReset()
			.mockResolvedValueOnce(originals[1])
			.mockResolvedValueOnce(existingCorrection);
		state.validateRange.mockResolvedValue({
			isValid: false,
			error: "mutable policy now rejects this range",
		});

		await expect(
			modular.requestTimeCorrectionEffect(request),
		).resolves.toMatchObject({
			success: true,
		});
		expect(state.executeSubmission).toHaveBeenCalledTimes(2);
	});

	it("validates an approval correction near UTC midnight in the employee timezone", async () => {
		const nearMidnightPeriod = {
			...period,
			startTime: new Date("2026-07-02T06:30:00.000Z"),
			endTime: new Date("2026-07-02T07:30:00.000Z"),
		};
		configure({ kind: "default_created" });
		state.getTimezone.mockResolvedValue("America/Los_Angeles");
		state.nowInstant.mockReturnValue(
			Temporal.Instant.from("2026-07-03T00:00:00Z"),
		);
		state.selectLimit.mockResolvedValue([nearMidnightPeriod]);
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([nearMidnightPeriod])
			.mockResolvedValueOnce([
				{ ...originals[0], timestamp: nearMidnightPeriod.startTime },
			]);

		await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "23:45",
			newClockOutDate: "2026-07-02",
			newClockOutTime: "00:30",
			workLocationType: "office",
			workCategoryId: null,
			reason: "Near-midnight holiday correction",
		});

		expect(state.validateRange).toHaveBeenCalledWith(
			"org-1",
			new Date("2026-07-02T06:45:00.000Z"),
			new Date("2026-07-02T07:30:00.000Z"),
			"America/Los_Angeles",
		);
	});

	it("rejects a year-0001 correction before opening a transaction or checking holidays", async () => {
		configure({ kind: "default_created" });
		state.getTimezone.mockResolvedValue("UTC");

		await expect(
			modular.requestTimeCorrectionEffect({
				workPeriodId: ids.period,
				submissionId,
				newClockInDate: "0001-01-01",
				newClockInTime: "00:00",
				reason: "Adversarial range",
			}),
		).resolves.toEqual({
			success: false,
			error: "Work period cannot exceed 24 hours",
			code: "ValidationError",
		});

		expect(state.withTransaction).not.toHaveBeenCalled();
		expect(state.validateRange).not.toHaveBeenCalled();
	});

	it("replays exact persisted evidence after category entitlement expires", async () => {
		const request = {
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			workLocationType: "office" as const,
			workCategoryId: categoryId,
			reason: "Missed punch",
		};
		const validLocks = () => [
			[employee],
			[approvedMember],
			[],
			[period],
			[originals[0]],
			[{ id: categoryId, organizationId: "org-1", isActive: true }],
			[
				{
					id: "assignment-1",
					assignmentType: "organization",
					organizationId: "org-1",
					setId: categorySetId,
					isActive: true,
					effectiveFrom: null,
					effectiveUntil: null,
				},
			],
			[{ id: categorySetId, organizationId: "org-1", isActive: true }],
			[{ id: "set-category-1" }],
		];
		configure({ kind: "default_created" });
		state.txSelectForUpdate.mockReset();
		for (const rows of validLocks()) {
			state.txSelectForUpdate.mockResolvedValueOnce(rows);
		}
		await expect(
			modular.requestTimeCorrectionEffect(request),
		).resolves.toMatchObject({
			success: true,
		});
		const existingCorrection = state.txInsertValues.mock.calls.at(-1)?.[0];

		configure({ kind: "default_created", disposition: "replayed" });
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([originals[0]]);
		state.txTimeEntryFindFirst
			.mockReset()
			.mockResolvedValueOnce(originals[1])
			.mockResolvedValueOnce(existingCorrection);

		await expect(
			modular.requestTimeCorrectionEffect(request),
		).resolves.toMatchObject({
			success: true,
		});
		expect(state.executeSubmission).toHaveBeenCalledTimes(2);
	});

	it("does not replay the same cycle token when category evidence changes", async () => {
		const request = {
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			workLocationType: "office" as const,
			workCategoryId: null,
			reason: "Missed punch",
		};
		configure({ kind: "default_created" });
		await expect(
			modular.requestTimeCorrectionEffect(request),
		).resolves.toMatchObject({
			success: true,
		});
		const firstSubmissionKey =
			state.executeSubmission.mock.calls[0]?.[0].submissionKey;

		configure({ kind: "default_created" });
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([originals[0]])
			.mockResolvedValueOnce([
				{ id: categoryId, organizationId: "org-1", isActive: true },
			])
			.mockResolvedValueOnce([
				{
					id: "assignment-1",
					assignmentType: "organization",
					organizationId: "org-1",
					setId: categorySetId,
					isActive: true,
					effectiveFrom: null,
					effectiveUntil: null,
				},
			])
			.mockResolvedValueOnce([
				{ id: categorySetId, organizationId: "org-1", isActive: true },
			])
			.mockResolvedValueOnce([]);

		await expect(
			modular.requestTimeCorrectionEffect({
				...request,
				workCategoryId: categoryId,
			}),
		).resolves.toMatchObject({ success: false });

		expect(state.executeSubmission).toHaveBeenCalledTimes(2);
		expect(state.executeSubmission.mock.calls[1]?.[0].submissionKey).not.toBe(
			firstSubmissionKey,
		);
		expect(state.executeSubmission.mock.calls[1]?.[0].submissionKey).toMatch(
			/^time-correction-cycle:v2:/,
		);
	});

	it("replays an exact persisted v1 cycle without creating v2 rows", async () => {
		configure({ kind: "default_created", disposition: "replayed" });
		state.txApprovalWorkflowFindFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "historical-v1-workflow" });
		state.txApprovalRequestFindMany.mockResolvedValue([]);
		state.txTimeEntryFindFirst
			.mockReset()
			.mockResolvedValueOnce(originals[1])
			.mockResolvedValueOnce({
				id: "historical-v1-correction",
				type: "correction",
				replacesEntryId: ids.clockIn,
				timestamp: new Date("2026-07-01T09:00:00.000Z"),
				utcOffsetMinutes: 0,
				timezone: "UTC",
				timezoneSource: "user_setting",
			});

		await expect(
			modular.requestTimeCorrectionEffect({
				workPeriodId: ids.period,
				submissionId,
				newClockInDate: "2026-07-01",
				newClockInTime: "09:00",
				reason: "Missed punch",
			}),
		).resolves.toMatchObject({ success: true });

		expect(state.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				submissionId,
				submissionKey: expect.stringMatching(/^time-correction-cycle:v1:/),
				correction: {
					action: "edit",
					clockInCorrectionId: expect.any(String),
				},
			}),
		);
		expect(state.txInsertValues).not.toHaveBeenCalled();
	});

	it("derives a new correction row identity for a later cycle token", async () => {
		configure({ kind: "default_created" });
		const request = {
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		};
		await modular.requestTimeCorrectionEffect(request);
		const firstId = state.txInsertValues.mock.calls.at(-1)?.[0].id;
		configure({ kind: "default_created" });
		await modular.requestTimeCorrectionEffect({
			...request,
			submissionId: "31000000-0000-4000-8000-000000000908",
		});
		const laterId = state.txInsertValues.mock.calls.at(-1)?.[0].id;

		expect(laterId).not.toBe(firstId);
	});

	it("removes only a correction row inserted by an exact replay", async () => {
		configure({ kind: "default_created", disposition: "replayed" });
		state.txDeleteReturning.mockImplementation(async () => [
			{ id: state.txInsertValues.mock.calls[0]?.[0].id },
		]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result.success).toBe(true);
		expect(state.txInsertValues).toHaveBeenCalledOnce();
		expect(state.txDeleteReturning).toHaveBeenCalledOnce();
		expect(state.maintenance).not.toHaveBeenCalled();
		expect(state.sendEmail).not.toHaveBeenCalled();
	});

	it("preserves a matching correction row that existed before an exact replay", async () => {
		const request = {
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		};
		configure({ kind: "default_created" });
		await modular.requestTimeCorrectionEffect(request);
		const existingCorrection = state.txInsertValues.mock.calls[0]?.[0];

		configure({ kind: "default_created", disposition: "replayed" });
		state.txTimeEntryFindFirst
			.mockReset()
			.mockResolvedValueOnce(originals[1])
			.mockResolvedValueOnce(existingCorrection);

		const replay = await modular.requestTimeCorrectionEffect(request);

		expect(replay.success).toBe(true);
		expect(state.txInsertValues).toHaveBeenCalledOnce();
		expect(state.txDeleteReturning).not.toHaveBeenCalled();
	});

	it("supports a clock-out-only request without inserting a clock-in row", async () => {
		configure({ kind: "default_created" });
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([originals[1]]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "17:00",
			reason: "Late clock-out",
		});

		expect(result.success).toBe(true);
		expect(state.txInsertValues).toHaveBeenCalledOnce();
		expect(state.txInsertValues.mock.calls[0]?.[0].replacesEntryId).toBe(
			ids.clockOut,
		);
	});

	it("dispatches legacy maintenance after commit and preserves success on failure", async () => {
		configure({ kind: "auto_completed", authority: "legacy" });
		state.maintenance.mockRejectedValue(new Error("maintenance unavailable"));

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result.success).toBe(true);
		expect(state.events).toEqual(["transaction", "boundary", "maintenance"]);
	});

	it("sends legacy manager email after commit and preserves success on delivery failure", async () => {
		configure({
			kind: "default_created",
			authority: "legacy",
			submittedToEmployeeId: ids.manager,
		});
		state.employeeFindFirst
			.mockReset()
			.mockResolvedValueOnce(employee)
			.mockResolvedValueOnce({
				...employee,
				id: ids.manager,
				user: { name: "Manager", email: "manager@example.com" },
			})
			.mockResolvedValueOnce({
				...employee,
				user: { name: "Employee", email: "employee@example.com" },
			});
		state.sendEmail.mockRejectedValue(new Error("email unavailable"));

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result.success).toBe(true);
		expect(state.events.slice(0, 2)).toEqual(["transaction", "boundary"]);
		expect(state.events.slice(2).every((event) => event === "email")).toBe(
			true,
		);
	});

	it("does not dispatch side effects when the repository transaction rolls back", async () => {
		configure({ kind: "auto_completed", authority: "legacy" });
		state.withTransaction.mockRejectedValue(new Error("rollback"));

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result.success).toBe(false);
		expect(state.maintenance).not.toHaveBeenCalled();
		expect(state.sendEmail).not.toHaveBeenCalled();
	});

	it("submits deletion through the same boundary with independent endpoint zones", async () => {
		configure({ kind: "default_created" });
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce(originals);

		const result = await modular.requestTimeEntryDeletion({
			workPeriodId: ids.period,
			submissionId,
			reason: "Duplicate entry",
		});

		expect(result).toEqual({
			success: true,
			data: { approvalId: "approval-1", status: "pending" },
		});
		const inserted = state.txInsertValues.mock.calls.map(([value]) => value);
		expect(inserted).toHaveLength(2);
		expect(inserted.map((value) => value.timezone)).toEqual([
			"Europe/Berlin",
			"America/New_York",
		]);
		expect(inserted.every((value) => value.isSuperseded === true)).toBe(true);
	});

	it("preserves the monolithic billing guard result without entering a transaction", async () => {
		configure({ kind: "default_created" });
		state.requireBilling.mockResolvedValue({
			allowed: false,
			reason: "subscription_required",
		});

		const result = await monolithic.requestTimeCorrection({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toEqual({
			success: false,
			error: "billing_required",
			code: "subscription_required",
		});
		expect(state.withTransaction).not.toHaveBeenCalled();
	});

	it("rejects an invalid proposed work location inside the submission transaction", async () => {
		configure({ kind: "default_created"
});

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			workLocationType: "spaceship" as "office",
			workCategoryId: null,
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: false });
		expect(state.withTransaction).toHaveBeenCalledOnce();
		expect(state.executeSubmission).not.toHaveBeenCalled();
	});

	it.each([
		["foreign", { organizationId: "org-2", isActive: true }],
		["inactive", { organizationId: "org-1", isActive: false }],
		["inaccessible", { organizationId: "org-1", isActive: true }],
	] as const)("rejects a %s work category", async (label, category) => {
		configure({ kind: "default_created" });
		const categoryRow = {
			id: "31000000-0000-4000-8000-000000000910",
			...category,
		};
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([categoryRow]);
		if (label === "inaccessible") {
			state.txSelectForUpdate
				.mockResolvedValueOnce([
					{
						id: "assignment-1",
						assignmentType: "organization",
						organizationId: "org-1",
						setId: "31000000-0000-4000-8000-000000000911",
						isActive: true,
						effectiveFrom: null,
						effectiveUntil: null,
					},
				])
				.mockResolvedValueOnce([
					{
						id: "31000000-0000-4000-8000-000000000911",
						organizationId: "org-1",
						isActive: true,
					},
				])
				.mockResolvedValueOnce([]);
		}

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			workLocationType: "office",
			workCategoryId: "31000000-0000-4000-8000-000000000910",
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: false });
		expect(state.executeSubmission).not.toHaveBeenCalled();
	});

	it("allows a time-only correction with an unchanged inaccessible historical category", async () => {
		configure({ kind: "default_created" });
		const historicalPeriod = {
			...period,
			workCategoryId: "31000000-0000-4000-8000-000000000910",
		};
		state.selectLimit.mockResolvedValue([historicalPeriod]);
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([historicalPeriod])
			.mockResolvedValueOnce([originals[0]]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			workLocationType: "office",
			workCategoryId: historicalPeriod.workCategoryId,
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: true });
		expect(state.txSelectForUpdate).toHaveBeenCalledTimes(5);
	});

	it("allows deletion with an unchanged inaccessible historical category", async () => {
		configure({ kind: "default_created" });
		const historicalPeriod = {
			...period,
			workCategoryId: "31000000-0000-4000-8000-000000000910",
		};
		state.selectLimit.mockResolvedValue([historicalPeriod]);
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([historicalPeriod])
			.mockResolvedValueOnce(originals);

		const result = await modular.requestTimeEntryDeletion({
			workPeriodId: ids.period,
			submissionId,
			reason: "Duplicate entry",
		});

		expect(result).toMatchObject({ success: true });
		expect(state.txSelectForUpdate).toHaveBeenCalledTimes(5);
	});

	it("accepts a metadata-only approval submission without changing the period", async () => {
		configure({ kind: "default_created" });

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "home",
			workCategoryId: null,
			reason: "Worked from home",
		});

		expect(result).toMatchObject({ success: true });
		expect(state.txInsertValues).not.toHaveBeenCalled();
		expect(period).toMatchObject({
			workLocationType: "office",
			workCategoryId: null,
		});
		expect(state.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				correction: {
					action: "edit",
					workLocationType: "home",
					workCategoryId: null,
				},
			}),
		);
	});

	it("preserves hidden endpoint precision for a metadata-only approval submission", async () => {
		configure({ kind: "default_created" });
		const precisePeriod = {
			...period,
			startTime: new Date("2026-07-01T08:00:42.123Z"),
			endTime: new Date("2026-07-01T16:00:42.123Z"),
		};
		state.selectLimit.mockResolvedValue([precisePeriod]);
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([precisePeriod])
			.mockResolvedValueOnce([
				{ ...originals[0], timestamp: precisePeriod.startTime },
				{ ...originals[1], timestamp: precisePeriod.endTime },
			]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "home",
			workCategoryId: null,
			reason: "Worked from home",
		});

		expect(result).toMatchObject({ success: true });
		expect(state.txInsertValues).not.toHaveBeenCalled();
		expect(state.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				correction: {
					action: "edit",
					workLocationType: "home",
					workCategoryId: null,
				},
			}),
		);
	});

	it("creates an endpoint correction when the displayed minute changes", async () => {
		configure({ kind: "default_created" });
		const precisePeriod = {
			...period,
			startTime: new Date("2026-07-01T08:00:42.123Z"),
			endTime: new Date("2026-07-01T16:00:42.123Z"),
		};
		state.selectLimit.mockResolvedValue([precisePeriod]);
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([precisePeriod])
			.mockResolvedValueOnce([
				{ ...originals[0], timestamp: precisePeriod.startTime },
			]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:01",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "office",
			workCategoryId: null,
			reason: "Corrected clock in",
		});

		expect(result).toMatchObject({ success: true });
		expect(state.txInsertValues).toHaveBeenCalledOnce();
		expect(state.txInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ timestamp: new Date("2026-07-01T08:01:00.000Z") }),
		);
	});

	it("does not grant direct category access from cross-organization team evidence", async () => {
		configureDirectCategoryEdit({
			membershipOrganizationId: "org-2",
			teamOrganizationId: "org-2",
		});

		const result = await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "office",
			workCategoryId: categoryId,
		});

		expect(result).toMatchObject({ success: false });
		expect(state.directUpdateCalls).toEqual([]);
	});

	it("grants direct category access from valid scoped team evidence", async () => {
		configureDirectCategoryEdit({
			membershipOrganizationId: "org-1",
			teamOrganizationId: "org-1",
		});

		const result = await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "office",
			workCategoryId: categoryId,
		});

		expect(result).toMatchObject({ success: true });
		expect(state.directUpdateCalls).toEqual([
			{ workLocationType: "office", workCategoryId: categoryId },
			{ workLocationType: "office", workCategoryId: categoryId },
		]);
	});

	it("updates legacy and canonical metadata for a direct metadata-only edit", async () => {
		configureDirectEdit();

		const result = await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "home",
			workCategoryId: null,
		});

		expect(result).toMatchObject({ success: true });
		expect(state.createCorrectionEntry).not.toHaveBeenCalled();
		expect(state.directUpdateCalls).toEqual([
			{ workLocationType: "home", workCategoryId: null },
			{ workLocationType: "home", workCategoryId: null },
		]);
		expect(state.markWorkBalanceDirty).not.toHaveBeenCalled();
	});

	it("preserves hidden endpoint precision for a direct metadata-only edit", async () => {
		const precisePeriod = {
			...period,
			startTime: new Date("2026-07-01T08:00:42.123Z"),
			endTime: new Date("2026-07-01T16:00:42.123Z"),
		};
		configureDirectEdit(precisePeriod);

		const result = await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "home",
			workCategoryId: null,
		});

		expect(result).toMatchObject({ success: true });
		expect(state.createCorrectionEntry).not.toHaveBeenCalled();
	});

	it("creates a direct endpoint correction when the displayed minute changes", async () => {
		const precisePeriod = {
			...period,
			startTime: new Date("2026-07-01T08:00:42.123Z"),
			endTime: new Date("2026-07-01T16:00:42.123Z"),
		};
		configureDirectEdit(precisePeriod);
		state.timeEntryFindMany.mockResolvedValue([
			{ ...originals[0], timestamp: precisePeriod.startTime },
		]);

		const result = await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:01",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "office",
			workCategoryId: null,
		});

		expect(result).toMatchObject({ success: true });
		expect(state.createCorrectionEntry).toHaveBeenCalledOnce();
		expect(state.createCorrectionEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				timestamp: new Date("2026-07-01T08:01:00.000Z"),
			}),
			expect.anything(),
		);
	});

	it("validates a direct correction near UTC midnight in the employee timezone", async () => {
		const nearMidnightPeriod = {
			...period,
			startTime: new Date("2026-07-02T06:30:00.000Z"),
			endTime: new Date("2026-07-02T07:30:00.000Z"),
		};
		configureDirectEdit(nearMidnightPeriod);
		state.getTimezone.mockResolvedValue("America/Los_Angeles");
		state.timeEntryFindMany.mockResolvedValue([
			{ ...originals[0], timestamp: nearMidnightPeriod.startTime },
		]);

		await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "23:45",
			newClockOutDate: "2026-07-02",
			newClockOutTime: "00:30",
			workLocationType: "office",
			workCategoryId: null,
		});

		expect(state.validateRange).toHaveBeenCalledWith(
			"org-1",
			new Date("2026-07-02T06:45:00.000Z"),
			new Date("2026-07-02T07:30:00.000Z"),
			"America/Los_Angeles",
		);
	});

	it("keeps a reasoned direct metadata-only edit away from endpoint rows", async () => {
		configureDirectEdit();

		const result = await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "home",
			workCategoryId: null,
			reason: "Worked from home",
		});

		expect(result).toMatchObject({ success: true });
		expect(state.createCorrectionEntry).not.toHaveBeenCalled();
		expect(state.directSetCalls).toEqual([
			{ workLocationType: "home", workCategoryId: null },
			{ workLocationType: "home", workCategoryId: null },
		]);
		expect(state.markWorkBalanceDirty).not.toHaveBeenCalled();
	});

	it("rolls back direct metadata when the canonical update fails", async () => {
		configureDirectEdit();
		state.directCanonicalFailure = true;

		const result = await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "home",
			workCategoryId: null,
		});

		expect(result).toMatchObject({ success: false });
		expect(state.directUpdateCalls).toEqual([]);
		expect(state.createCorrectionEntry).not.toHaveBeenCalled();
	});

	it("fails before writing when direct-edit legacy metadata changed after form load", async () => {
		configureDirectEdit();
		state.directSelectForUpdate.mockReset();
		state.directSelectForUpdate
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ ...period, workLocationType: "remote" }]);

		const result = await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "home",
			workCategoryId: null,
		});

		expect(result).toMatchObject({ success: false });
		expect(state.directSelectForUpdate).toHaveBeenCalledTimes(3);
		expect(state.directUpdateCalls).toEqual([]);
	});

	it("rolls back when canonical work metadata diverges from locked legacy metadata", async () => {
		configureDirectEdit();
		state.directSelectForUpdate.mockReset();
		state.directSelectForUpdate
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([
				{
					id: period.canonicalRecordId,
					organizationId: period.organizationId,
					employeeId: period.employeeId,
					recordKind: "work",
				},
			])
			.mockResolvedValueOnce([
				{
					recordId: period.canonicalRecordId,
					organizationId: period.organizationId,
					recordKind: "work",
					workLocationType: "remote",
					workCategoryId: null,
				},
			]);

		const result = await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "home",
			workCategoryId: null,
		});

		expect(result).toMatchObject({ success: false });
		expect(state.directUpdateCalls).toEqual([]);
		expect(state.createCorrectionEntry).not.toHaveBeenCalled();
	});

	it("allows a time-only direct edit without a canonical metadata extension", async () => {
		configureDirectEdit();
		state.timeEntryFindMany.mockResolvedValue([originals[0]]);
		state.directSelectForUpdate.mockReset();
		state.directSelectForUpdate
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period]);

		const result = await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "office",
			workCategoryId: null,
		});

		expect(result).toMatchObject({ success: true });
		expect(state.directSelectForUpdate).toHaveBeenCalledTimes(3);
		expect(state.directUpdateCalls).toEqual([]);
		expect(state.createCorrectionEntry).toHaveBeenCalledOnce();
	});

	it("rejects a completely unchanged direct edit", async () => {
		configureDirectEdit();

		const result = await modular.editSameDayTimeEntry({
			workPeriodId: ids.period,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "16:00",
			workLocationType: "office",
			workCategoryId: null,
		});

		expect(result).toEqual({
			success: false,
			error: "At least one correction value must change",
		});
		expect(state.directTransaction).not.toHaveBeenCalled();
	});
});
