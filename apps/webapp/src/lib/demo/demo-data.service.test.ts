import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	absenceEntry,
	approvalRequest,
	employee,
	employeeManagers,
	notification,
	team,
	teamMembership,
	timeEntry,
	timeRecord,
	workPeriod,
} from "@/db/schema";
import { calculateHash, validateChain } from "@/lib/time-tracking/blockchain";

type RolloutMode = "legacy" | "shadow" | "ready" | "canonical" | "complete";

const mocks = vi.hoisted(() => ({
	employees: [] as Array<{
		id: string;
		organizationId: string;
		userId: string;
		teamId?: string | null;
		isActive?: boolean;
	}>,
	categories: [] as Array<{
		id: string;
		organizationId: string;
		type: string;
		isActive: boolean;
	}>,
	managerAssignments: [] as Array<{
		id?: string;
		employeeId: string;
		managerId: string;
		isPrimary: boolean;
	}>,
	teamMemberships: [] as Array<{
		id: string;
		organizationId: string;
		employeeId: string;
		teamId: string;
	}>,
	fallbackEmployees: [] as Array<Record<string, unknown>>,
	fallbackMember: null as Record<string, unknown> | null,
	managerQueryLimit: null as number | null,
	fallbackQueryLimit: null as number | null,
	ownerEmployee: null as {
		id: string;
		organizationId: string;
		userId: string;
		isActive?: boolean;
	} | null,
	latestTimeEntry: null as { id: string; hash: string } | null,
	workPeriods: [] as Array<{
		id: string;
		employeeId: string;
		organizationId: string;
		clockInId: string;
		clockOutId: string | null;
		canonicalRecordId?: string;
		startTime: Date;
		endTime: Date | null;
		durationMinutes: number | null;
		isActive: boolean;
		approvalStatus: "approved" | "pending" | "rejected";
		pendingChanges: string | null;
		deletedAt: Date | null;
	}>,
	originalTimeEntries: [] as Array<Record<string, unknown>>,
	canonicalRecords: [] as Array<Record<string, unknown>>,
	lockedWorkPeriod: null as Record<string, unknown> | null,
	lockedWorkPeriods: [] as Array<Record<string, unknown>>,
	sequentialLocks: false,
	lockedOriginalTimeEntry: null as Record<string, unknown> | null,
	transactionCanonicalRecord: null as Record<string, unknown> | null,
	transactionRequester: null as Record<string, unknown> | null,
	transactionTeam: null as Record<string, unknown> | null,
	teams: [] as Array<Record<string, unknown>>,
	existingApprovals: [] as Array<{ entityId: string }>,
	durableApproval: null as Record<string, unknown> | null,
	insertedAbsences: [] as Array<Record<string, unknown>>,
	insertedTimeEntries: [] as Array<Record<string, unknown>>,
	insertedApprovals: [] as Array<Record<string, unknown>>,
	insertedNotifications: [] as Array<Record<string, unknown>>,
	boundaryWrites: [] as string[],
	executedSubmissionKeys: new Set<string>(),
	lockOrder: [] as string[],
	workPeriodOrderBy: [] as unknown[],
	mode: "legacy" as RolloutMode,
	failBoundaryStage: null as string | null,
	notificationFailure: null as Error | null,
	findExistingCorrection: true,
	transactionActive: false,
	transactionDb: null as unknown,
	withTransaction: vi.fn(),
	executeSubmission: vi.fn(),
	createRuntime: vi.fn(),
	lockedChainTail: null as Record<string, unknown> | null,
	ensureDefaultAbsenceCategories: vi.fn(),
}));

vi.mock("@/lib/approvals/server/time-correction-approvals", () => ({
	deleteCancelledTimeCorrectionsInTransaction: vi.fn(),
	finalizeTimeCorrectionTerminalInTransaction: vi.fn(),
	executeTimeCorrectionSubmissionInTransaction: mocks.executeSubmission,
	insertTimeCorrectionSourceEntry: vi.fn(async (input) => {
		const [created] = await input.dbService.db
			.insert(timeEntry)
			.values({
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
				...input.timezoneCapture,
			})
			.returning();
		return created ?? null;
	}),
}));

vi.mock("@/lib/approvals/workflow/runtime", () => ({
	createProductionApprovalWorkflowRuntime: mocks.createRuntime,
}));

vi.mock("@/lib/absences/default-absence-categories", () => ({
	ensureDefaultAbsenceCategoriesForOrganization:
		mocks.ensureDefaultAbsenceCategories,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: vi.fn(async () =>
					mocks.transactionActive
						? mocks.transactionRequester
						: mocks.ownerEmployee,
				),
				findMany: vi.fn(async () => mocks.employees),
			},
			absenceCategory: {
				findMany: vi.fn(async () => mocks.categories),
			},
			employeeManagers: {
				findMany: vi.fn(async (options) => {
					mocks.managerQueryLimit = options?.limit ?? null;
					return mocks.managerAssignments.slice(0, options?.limit);
				}),
			},
			workPeriod: {
				findMany: vi.fn(async (options) => {
					mocks.workPeriodOrderBy =
						options?.orderBy?.(workPeriod, {
							asc: (column: unknown) => column,
						}) ?? [];
					return [...mocks.workPeriods]
						.sort(
							(left, right) =>
								left.startTime.getTime() - right.startTime.getTime() ||
								left.id.localeCompare(right.id),
						)
						.slice(0, options?.limit);
				}),
			},
			timeRecord: {
				findFirst: vi.fn(async () =>
					mocks.transactionActive
						? mocks.transactionCanonicalRecord
						: (mocks.canonicalRecords[0] ?? null),
				),
			},
			team: {
				findFirst: vi.fn(async () =>
					mocks.transactionActive
						? mocks.transactionTeam
						: (mocks.teams[0] ?? null),
				),
			},
			approvalRequest: {
				findMany: vi.fn(async () => mocks.existingApprovals),
				findFirst: vi.fn(async () => mocks.durableApproval),
			},
			notification: {
				findFirst: vi.fn(async () => mocks.insertedNotifications[0] ?? null),
			},
			timeEntry: {
				findFirst: vi.fn(
					async () =>
						(mocks.findExistingCorrection
							? mocks.insertedTimeEntries[0]
							: null) ?? mocks.latestTimeEntry,
				),
				findMany: vi.fn(async () => mocks.originalTimeEntries),
			},
		},
		select: vi.fn(() => ({
			from: vi.fn((table) => {
				let joinedMember = false;
				const builder: Record<string, unknown> = {};
				Object.assign(builder, {
					innerJoin: vi.fn((joinedTable) => {
						joinedMember = joinedTable === member;
						return builder;
					}),
					where: vi.fn(() => builder),
					orderBy: vi.fn(() => builder),
					limit: vi.fn((limit: number) => {
						if (joinedMember) {
							mocks.fallbackQueryLimit = limit;
							return Promise.resolve(mocks.fallbackEmployees.slice(0, limit));
						}
						return builder;
					}),
					for: vi.fn(async () => {
						const label =
							table === employee
								? "employee"
								: table === employeeManagers
									? "employeeManagers"
									: table === teamMembership
										? "teamMembership"
										: table === team
											? "team"
											: table === member
												? "member"
												: table === workPeriod
													? "workPeriod"
													: table === timeEntry
														? "timeEntry"
														: "timeRecord";
						mocks.lockOrder.push(label);
						if (table === employee) {
							return mocks.transactionRequester
								? mocks.employees.map((candidate) =>
										candidate.id === mocks.transactionRequester?.id
											? mocks.transactionRequester
											: candidate,
									)
								: mocks.employees;
						}
						if (table === employeeManagers) return mocks.managerAssignments;
						if (table === teamMembership) return mocks.teamMemberships;
						if (table === team) return mocks.teams;
						if (table === member) {
							return mocks.fallbackMember ? [mocks.fallbackMember] : [];
						}
						if (table === workPeriod) {
							return mocks.sequentialLocks
								? mocks.lockedWorkPeriods.splice(0, 1)
								: mocks.lockedWorkPeriod
									? [mocks.lockedWorkPeriod]
									: [];
						}
						if (table === timeEntry) {
							const timeEntryLockCount = mocks.lockOrder.filter(
								(item) => item === "timeEntry",
							).length;
							const locked =
								timeEntryLockCount > 1
									? (mocks.lockedChainTail ?? mocks.lockedOriginalTimeEntry)
									: mocks.lockedOriginalTimeEntry;
							return locked ? [locked] : [];
						}
						if (table === timeRecord) {
							return mocks.transactionCanonicalRecord
								? [mocks.transactionCanonicalRecord]
								: [];
						}
						return [];
					}),
				});
				return builder;
			}),
		})),
		insert: vi.fn((table) => ({
			values: vi.fn((value: Record<string, unknown>) => {
				if (table === approvalRequest) {
					mocks.insertedApprovals.push(value);
				}

				if (table === notification && !value.idempotencyKey) {
					mocks.insertedNotifications.push(value);
				}

				const returning = vi.fn(async () => {
					if (table === absenceEntry) {
						mocks.insertedAbsences.push(value);
						return [{ id: `absence-${mocks.insertedAbsences.length}` }];
					}

					if (table === timeEntry) {
						mocks.insertedTimeEntries.push(value);
						return [{ ...value }];
					}

					return [];
				});
				return {
					returning,
					onConflictDoNothing: vi.fn(async () => {
						if (table === notification) {
							if (mocks.transactionActive) {
								throw new Error("notification dispatched before commit");
							}
							if (mocks.notificationFailure) throw mocks.notificationFailure;
							if (
								!mocks.insertedNotifications.some(
									(item) => item.idempotencyKey === value.idempotencyKey,
								)
							) {
								mocks.insertedNotifications.push(value);
							}
						}
					}),
				};
			}),
		})),
		delete: vi.fn((table) => ({
			where: vi.fn(() => ({
				returning: vi.fn(async () => {
					if (table !== timeEntry) return [];
					const deleted = mocks.insertedTimeEntries.pop();
					return deleted ? [{ id: deleted.id }] : [];
				}),
			})),
		})),
	},
}));

describe("generateDemoPendingAbsenceApprovals", () => {
	beforeEach(() => {
		mocks.employees = [];
		mocks.categories = [];
		mocks.managerAssignments = [];
		mocks.teamMemberships = [];
		mocks.fallbackEmployees = [];
		mocks.fallbackMember = null;
		mocks.managerQueryLimit = null;
		mocks.fallbackQueryLimit = null;
		mocks.ownerEmployee = null;
		mocks.latestTimeEntry = null;
		mocks.workPeriods = [];
		mocks.lockedWorkPeriod = null;
		mocks.lockedWorkPeriods = [];
		mocks.sequentialLocks = false;
		mocks.lockedOriginalTimeEntry = null;
		mocks.transactionCanonicalRecord = null;
		mocks.transactionRequester = null;
		mocks.transactionTeam = null;
		mocks.durableApproval = null;
		mocks.lockedWorkPeriod = null;
		mocks.lockedWorkPeriods = [];
		mocks.sequentialLocks = false;
		mocks.lockedOriginalTimeEntry = null;
		mocks.transactionCanonicalRecord = null;
		mocks.transactionRequester = null;
		mocks.transactionTeam = null;
		mocks.durableApproval = null;
		mocks.originalTimeEntries = [];
		mocks.canonicalRecords = [];
		mocks.lockedWorkPeriod = null;
		mocks.lockedWorkPeriods = [];
		mocks.sequentialLocks = false;
		mocks.lockedOriginalTimeEntry = null;
		mocks.transactionCanonicalRecord = null;
		mocks.transactionRequester = null;
		mocks.transactionTeam = null;
		mocks.teams = [];
		mocks.existingApprovals = [];
		mocks.durableApproval = null;
		mocks.insertedAbsences = [];
		mocks.insertedTimeEntries = [];
		mocks.insertedApprovals = [];
		mocks.insertedNotifications = [];
		mocks.boundaryWrites = [];
		mocks.executedSubmissionKeys.clear();
		mocks.lockOrder = [];
		mocks.workPeriodOrderBy = [];
		mocks.failBoundaryStage = null;
		mocks.notificationFailure = null;
		mocks.findExistingCorrection = true;
		mocks.transactionActive = false;
		mocks.transactionDb = db;
		mocks.ensureDefaultAbsenceCategories.mockReset();
	});

	it("creates pending absence entries with matching approval requests", async () => {
		const { generateDemoPendingAbsenceApprovals } = await import(
			"./demo-data.service"
		);

		mocks.employees = [
			{ id: "employee-1", organizationId: "org-1", userId: "user-1" },
			{ id: "employee-2", organizationId: "org-1", userId: "user-2" },
		];
		mocks.categories = [
			{
				id: "personal-category",
				organizationId: "org-1",
				type: "personal",
				isActive: true,
			},
			{
				id: "vacation-category",
				organizationId: "org-1",
				type: "vacation",
				isActive: true,
			},
		];
		mocks.managerAssignments = [
			{ employeeId: "employee-1", managerId: "employee-2", isPrimary: true },
			{ employeeId: "employee-2", managerId: "employee-2", isPrimary: true },
		];

		const result = await generateDemoPendingAbsenceApprovals({
			organizationId: "org-1",
			dateRange: { start: new Date("2026-01-01"), end: new Date("2026-01-31") },
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			createdBy: "user-1",
		});

		expect(result).toEqual({ pendingAbsenceApprovalsCreated: 2 });
		expect(mocks.ensureDefaultAbsenceCategories).toHaveBeenCalledWith("org-1");
		expect(mocks.insertedAbsences).toHaveLength(2);
		expect(mocks.insertedAbsences[0]).toMatchObject({
			organizationId: "org-1",
			employeeId: "employee-1",
			categoryId: "vacation-category",
			status: "pending",
			notes: "Demo data - Pending approval request",
		});
		expect(mocks.insertedApprovals).toEqual([
			{
				organizationId: "org-1",
				entityType: "absence_entry",
				entityId: "absence-1",
				requestedBy: "employee-1",
				approverId: "employee-2",
				status: "pending",
				reason: "Demo data - Pending absence approval",
			},
			{
				organizationId: "org-1",
				entityType: "absence_entry",
				entityId: "absence-2",
				requestedBy: "employee-2",
				approverId: "employee-1",
				status: "pending",
				reason: "Demo data - Pending absence approval",
			},
		]);
		expect(mocks.insertedNotifications).toEqual([
			{
				userId: "user-2",
				organizationId: "org-1",
				type: "approval_request_submitted",
				title: "New absence request",
				message: "Demo data - Pending absence request needs approval.",
				entityType: "absence_entry",
				entityId: "absence-1",
				actionUrl: "/approvals/inbox",
			},
			{
				userId: "user-1",
				organizationId: "org-1",
				type: "approval_request_submitted",
				title: "New absence request",
				message: "Demo data - Pending absence request needs approval.",
				entityType: "absence_entry",
				entityId: "absence-2",
				actionUrl: "/approvals/inbox",
			},
		]);
	}, 15_000);
});

describe("generateDemoPendingTimeCorrectionApprovals", () => {
	beforeEach(() => {
		mocks.transactionDb = db;
		mocks.employees = [];
		mocks.categories = [];
		mocks.managerAssignments = [];
		mocks.teamMemberships = [];
		mocks.fallbackEmployees = [];
		mocks.fallbackMember = null;
		mocks.managerQueryLimit = null;
		mocks.fallbackQueryLimit = null;
		mocks.ownerEmployee = null;
		mocks.latestTimeEntry = null;
		mocks.workPeriods = [];
		mocks.originalTimeEntries = [];
		mocks.canonicalRecords = [];
		mocks.lockedWorkPeriod = null;
		mocks.lockedWorkPeriods = [];
		mocks.sequentialLocks = false;
		mocks.lockedOriginalTimeEntry = null;
		mocks.transactionCanonicalRecord = null;
		mocks.teams = [];
		mocks.existingApprovals = [];
		mocks.durableApproval = null;
		mocks.insertedAbsences = [];
		mocks.insertedTimeEntries = [];
		mocks.insertedApprovals = [];
		mocks.insertedNotifications = [];
		mocks.boundaryWrites = [];
		mocks.executedSubmissionKeys.clear();
		mocks.lockOrder = [];
		mocks.workPeriodOrderBy = [];
		mocks.mode = "legacy";
		mocks.failBoundaryStage = null;
		mocks.notificationFailure = null;
		mocks.transactionActive = false;
		mocks.ensureDefaultAbsenceCategories.mockReset();
		mocks.withTransaction.mockReset();
		mocks.executeSubmission.mockReset();
		mocks.createRuntime.mockReset();
		mocks.createRuntime.mockImplementation(() => ({
			repository: { withTransaction: mocks.withTransaction },
		}));
		mocks.lockedChainTail = null;
		vi.mocked(db.query.workPeriod.findMany).mockClear();
		vi.mocked(db.query.employeeManagers.findMany).mockClear();
		vi.mocked(db.query.employee.findMany).mockClear();
		mocks.withTransaction.mockImplementation(async (operation) => {
			const entryCount = mocks.insertedTimeEntries.length;
			const boundaryCount = mocks.boundaryWrites.length;
			mocks.transactionActive = true;
			try {
				return await operation({ dbService: { db: mocks.transactionDb } });
			} catch (error) {
				mocks.insertedTimeEntries.length = entryCount;
				mocks.boundaryWrites.length = boundaryCount;
				throw error;
			} finally {
				mocks.transactionActive = false;
			}
		});
		mocks.executeSubmission.mockImplementation(async (input) => {
			const replay = mocks.executedSubmissionKeys.has(input.submissionKey);
			mocks.executedSubmissionKeys.add(input.submissionKey);
			for (const stage of ["workflow", "binding", "projection", "outbox"]) {
				mocks.boundaryWrites.push(stage);
				if (mocks.failBoundaryStage === stage)
					throw new Error(`${stage} failed`);
			}
			return {
				disposition: replay ? "replayed" : "executed",
				kind: "default_created",
				approvalRequestId: "50000000-0000-4000-8000-000000000001",
				postCommit: {
					authority:
						mocks.mode === "legacy" ||
						mocks.mode === "shadow" ||
						mocks.mode === "ready"
							? "legacy"
							: "canonical",
					submittedToEmployeeId:
						!replay &&
						(mocks.mode === "legacy" ||
							mocks.mode === "shadow" ||
							mocks.mode === "ready")
							? "20000000-0000-4000-8000-000000000002"
							: null,
					terminal: null,
				},
			};
		});
	});

	function seedCorrectionEvidence() {
		mocks.employees = [
			{
				id: "20000000-0000-4000-8000-000000000001",
				organizationId: "org-1",
				userId: "user-1",
				teamId: "30000000-0000-4000-8000-000000000001",
				isActive: true,
			},
			{
				id: "20000000-0000-4000-8000-000000000002",
				organizationId: "org-1",
				userId: "user-2",
				teamId: null,
				isActive: true,
			},
		];
		mocks.workPeriods = [
			{
				id: "10000000-0000-4000-8000-000000000001",
				employeeId: "20000000-0000-4000-8000-000000000001",
				organizationId: "org-1",
				clockInId: "40000000-0000-4000-8000-000000000001",
				clockOutId: "40000000-0000-4000-8000-000000000002",
				canonicalRecordId: "60000000-0000-4000-8000-000000000001",
				startTime: new Date("2026-01-05T08:00:00.000Z"),
				endTime: new Date("2026-01-05T16:00:00.000Z"),
				durationMinutes: 480,
				isActive: false,
				approvalStatus: "approved",
				pendingChanges: null,
				deletedAt: null,
				workLocationType: "office",
				workCategoryId: null,
			},
		];
		mocks.originalTimeEntries = [
			{
				id: "40000000-0000-4000-8000-000000000001",
				employeeId: "20000000-0000-4000-8000-000000000001",
				organizationId: "org-1",
				type: "clock_in",
				timestamp: new Date("2026-01-05T08:00:00.000Z"),
				utcOffsetMinutes: 60,
				timezone: "Europe/Berlin",
				timezoneSource: "browser",
				replacesEntryId: null,
				isSuperseded: false,
				supersededById: null,
				hash: "original-hash",
			},
		];
		mocks.canonicalRecords = [
			{
				id: "60000000-0000-4000-8000-000000000001",
				organizationId: "org-1",
				employeeId: "20000000-0000-4000-8000-000000000001",
				recordKind: "work",
				origin: "clock",
				startAt: new Date("2026-01-05T08:00:00.000Z"),
				endAt: new Date("2026-01-05T16:00:00.000Z"),
				durationMinutes: 480,
				approvalState: "approved",
			},
		];
		mocks.teams = [
			{
				id: "30000000-0000-4000-8000-000000000001",
				organizationId: "org-1",
			},
		];
		mocks.managerAssignments = [
			{
				id: "25000000-0000-4000-8000-000000000001",
				employeeId: "20000000-0000-4000-8000-000000000001",
				managerId: "20000000-0000-4000-8000-000000000002",
				isPrimary: true,
			},
		];
		mocks.teamMemberships = [
			{
				id: "35000000-0000-4000-8000-000000000001",
				organizationId: "org-1",
				employeeId: "20000000-0000-4000-8000-000000000001",
				teamId: "30000000-0000-4000-8000-000000000001",
			},
		];
		mocks.ownerEmployee = {
			id: "20000000-0000-4000-8000-000000000002",
			organizationId: "org-1",
			userId: "user-2",
			isActive: true,
		};
		mocks.lockedWorkPeriod = { ...mocks.workPeriods[0] };
		mocks.lockedOriginalTimeEntry = { ...mocks.originalTimeEntries[0] };
		mocks.transactionCanonicalRecord = { ...mocks.canonicalRecords[0] };
		mocks.transactionRequester = { ...mocks.employees[0] };
		mocks.transactionTeam = { ...mocks.teams[0] };
		mocks.durableApproval = {
			id: "50000000-0000-4000-8000-000000000001",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "10000000-0000-4000-8000-000000000001",
			requestedBy: "20000000-0000-4000-8000-000000000001",
			approverId: "20000000-0000-4000-8000-000000000002",
			status: "pending",
		};
	}

	const options = {
		organizationId: "org-1",
		dateRange: { start: new Date("2026-01-01"), end: new Date("2026-01-31") },
		includeTimeEntries: false,
		includeAbsences: false,
		includeTeams: false,
		includeProjects: false,
		createdBy: "user-1",
	};

	it.each<RolloutMode>([
		"legacy",
		"shadow",
		"ready",
		"canonical",
		"complete",
	])("uses one shared-boundary transaction and valid inactive evidence in %s mode", async (mode) => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.mode = mode;

		const result = await generateDemoPendingTimeCorrectionApprovals(options);

		expect(result).toEqual({ pendingTimeCorrectionApprovalsCreated: 1 });
		expect(mocks.withTransaction).toHaveBeenCalledOnce();
		expect(mocks.executeSubmission).toHaveBeenCalledOnce();
		expect(mocks.insertedTimeEntries).toHaveLength(1);
		expect(mocks.insertedTimeEntries[0]).toMatchObject({
			employeeId: "20000000-0000-4000-8000-000000000001",
			organizationId: "org-1",
			type: "correction",
			timestamp: new Date("2026-01-05T08:15:00.000Z"),
			replacesEntryId: "40000000-0000-4000-8000-000000000001",
			isSuperseded: true,
			utcOffsetMinutes: 60,
			timezone: "Europe/Berlin",
			timezoneSource: "browser",
			notes: "Demo data - Pending time correction",
			createdBy: "user-1",
		});
		expect(mocks.insertedTimeEntries[0]?.id).toEqual(
			expect.stringMatching(/^[0-9a-f-]{36}$/),
		);
		expect(mocks.insertedTimeEntries[0]?.hash).toEqual(expect.any(String));
		expect(mocks.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				requesterEmployeeId: "20000000-0000-4000-8000-000000000001",
				teamId: "30000000-0000-4000-8000-000000000001",
				workPeriodId: "10000000-0000-4000-8000-000000000001",
				defaultApproverId: "20000000-0000-4000-8000-000000000002",
				submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
				submissionKey: expect.stringContaining("time-correction-cycle:v2:"),
				correction: {
					action: "edit",
					clockInCorrectionId: mocks.insertedTimeEntries[0]?.id,
					workLocationType: "office",
					workCategoryId: null,
				},
			}),
		);
		expect(mocks.insertedApprovals).toHaveLength(0);
		expect(mocks.insertedNotifications).toHaveLength(
			mode === "legacy" || mode === "shadow" || mode === "ready" ? 1 : 0,
		);
	});

	it("normalizes historical undefined work metadata at the v2 boundary", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.lockedWorkPeriod = {
			...mocks.lockedWorkPeriod,
			workLocationType: undefined,
			workCategoryId: undefined,
		};

		await generateDemoPendingTimeCorrectionApprovals(options);

		expect(mocks.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				submissionKey: expect.stringMatching(/^time-correction-cycle:v2:/),
				correction: expect.objectContaining({
					workLocationType: "office",
					workCategoryId: null,
				}),
			}),
		);
	});

	it("does not open a transaction for an inactive requester hint", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.employees[0] = { ...mocks.employees[0], isActive: false };

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).resolves.toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.withTransaction).not.toHaveBeenCalled();
	});

	it("rolls back when the requester becomes inactive inside the transaction", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.transactionRequester = {
			...mocks.transactionRequester,
			isActive: false,
		};

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).resolves.toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.insertedTimeEntries).toHaveLength(0);
		expect(mocks.executeSubmission).not.toHaveBeenCalled();
	});

	it("locks period, endpoint, and canonical row in deterministic order", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();

		await generateDemoPendingTimeCorrectionApprovals(options);

		expect(mocks.lockOrder).toEqual([
			"employee",
			"employeeManagers",
			"teamMembership",
			"team",
			"workPeriod",
			"timeEntry",
			"timeRecord",
			"timeEntry",
		]);
	});

	it("omits the team when the locked membership disappeared", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.teamMemberships = [];

		await generateDemoPendingTimeCorrectionApprovals(options);

		expect(mocks.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: null }),
		);
	});

	it("omits cross-organization and mismatched locked team memberships", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.teamMemberships = [
			{
				id: "35000000-0000-4000-8000-000000000099",
				organizationId: "org-2",
				employeeId: "20000000-0000-4000-8000-000000000001",
				teamId: "30000000-0000-4000-8000-000000000001",
			},
			{
				id: "35000000-0000-4000-8000-000000000098",
				organizationId: "org-1",
				employeeId: "20000000-0000-4000-8000-000000000099",
				teamId: "30000000-0000-4000-8000-000000000001",
			},
		];

		await generateDemoPendingTimeCorrectionApprovals(options);

		expect(mocks.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: null }),
		);
	});

	it("uses one bounded approved fallback employee when no manager is assigned", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.managerAssignments = [];
		mocks.fallbackEmployees = [{ ...mocks.employees[1] }];
		mocks.fallbackMember = {
			id: "member-fallback",
			userId: "user-2",
			organizationId: "org-1",
			status: "approved",
		};

		const result = await generateDemoPendingTimeCorrectionApprovals(options);

		expect(result).toEqual({ pendingTimeCorrectionApprovalsCreated: 1 });
		expect(mocks.managerQueryLimit).toBe(3);
		expect(mocks.fallbackQueryLimit).toBe(1);
		expect(mocks.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultApproverId: "20000000-0000-4000-8000-000000000002",
			}),
		);
	});

	it("fails closed when the fallback membership is no longer approved at lock time", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.managerAssignments = [];
		mocks.fallbackEmployees = [{ ...mocks.employees[1] }];
		mocks.fallbackMember = {
			id: "member-fallback",
			userId: "user-2",
			organizationId: "org-1",
			status: "pending",
		};

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).resolves.toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.lockOrder).toContain("member");
		expect(mocks.executeSubmission).not.toHaveBeenCalled();
	});

	it("fails closed when bounded manager discovery overflows", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.managerAssignments = Array.from({ length: 3 }, (_, index) => ({
			id: `25000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
			employeeId: "20000000-0000-4000-8000-000000000001",
			managerId: `20000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`,
			isPrimary: index === 0,
		}));
		mocks.employees.push(
			...mocks.managerAssignments.slice(1).map((assignment, index) => ({
				id: assignment.managerId,
				organizationId: "org-1",
				userId: `extra-user-${index}`,
				teamId: null,
				isActive: true,
			})),
		);

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).resolves.toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.managerQueryLimit).toBe(3);
		expect(mocks.withTransaction).not.toHaveBeenCalled();
	});

	it("appends an old-period correction to the locked latest hash-chain entry", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		const original = mocks.originalTimeEntries[0] as Record<string, unknown>;
		const originalHash = calculateHash({
			employeeId: original.employeeId as string,
			type: original.type as string,
			timestamp: (original.timestamp as Date).toISOString(),
			previousHash: null,
		});
		original.hash = originalHash;
		if (mocks.lockedOriginalTimeEntry) {
			mocks.lockedOriginalTimeEntry.hash = originalHash;
		}
		const newerTimestamp = new Date("2026-01-06T09:00:00.000Z");
		const newerHash = calculateHash({
			employeeId: original.employeeId as string,
			type: "clock_in",
			timestamp: newerTimestamp.toISOString(),
			previousHash: originalHash,
		});
		mocks.lockedChainTail = {
			...original,
			id: "40000000-0000-4000-8000-000000000010",
			timestamp: newerTimestamp,
			type: "clock_in",
			previousEntryId: original.id,
			previousHash: originalHash,
			hash: newerHash,
			createdAt: new Date("2026-01-06T09:00:01.000Z"),
		};

		await generateDemoPendingTimeCorrectionApprovals(options);

		expect(mocks.insertedTimeEntries[0]).toMatchObject({
			previousEntryId: "40000000-0000-4000-8000-000000000010",
			previousHash: newerHash,
		});
		const correction = {
			...mocks.insertedTimeEntries[0],
			createdAt: new Date("2026-01-06T09:00:02.000Z"),
		};
		await expect(
			validateChain([
				{
					...original,
					previousEntryId: null,
					previousHash: null,
					createdAt: new Date("2026-01-05T08:00:01.000Z"),
				},
				mocks.lockedChainTail,
				correction,
			] as never),
		).resolves.toBe(true);
	});

	it("locks employees and routing before source and hash-chain rows", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();

		await generateDemoPendingTimeCorrectionApprovals(options);

		expect(mocks.lockOrder.slice(0, 3)).toEqual([
			"employee",
			"employeeManagers",
			"teamMembership",
		]);
		expect(mocks.lockOrder.indexOf("employee")).toBeLessThan(
			mocks.lockOrder.indexOf("workPeriod"),
		);
	});

	it.each([
		[
			"source status",
			(row: Record<string, unknown>) => (row.approvalStatus = "pending"),
		],
		[
			"source pending changes",
			(row: Record<string, unknown>) => (row.pendingChanges = "stale"),
		],
		[
			"source duration",
			(row: Record<string, unknown>) => (row.durationMinutes = 479),
		],
		[
			"source endpoint position",
			(row: Record<string, unknown>) =>
				(row.clockInId = "40000000-0000-4000-8000-000000000099"),
		],
	])("rolls back without boundary writes when locked %s changed", async (_label, mutate) => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mutate(mocks.lockedWorkPeriod as Record<string, unknown>);

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).resolves.toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.insertedTimeEntries).toHaveLength(0);
		expect(mocks.executeSubmission).not.toHaveBeenCalled();
	});

	it.each([
		["superseded", (row: Record<string, unknown>) => (row.isSuperseded = true)],
		[
			"back link",
			(row: Record<string, unknown>) =>
				(row.supersededById = "40000000-0000-4000-8000-000000000099"),
		],
		[
			"lineage",
			(row: Record<string, unknown>) =>
				(row.replacesEntryId = "40000000-0000-4000-8000-000000000099"),
		],
		[
			"timestamp",
			(row: Record<string, unknown>) =>
				(row.timestamp = new Date("2026-01-05T08:01:00.000Z")),
		],
	])("rolls back without boundary writes for stale endpoint %s", async (_label, mutate) => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mutate(mocks.lockedOriginalTimeEntry as Record<string, unknown>);

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).resolves.toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.insertedTimeEntries).toHaveLength(0);
		expect(mocks.executeSubmission).not.toHaveBeenCalled();
	});

	it.each([
		["source", (row: Record<string, unknown>) => (row.origin = "manual")],
		[
			"start",
			(row: Record<string, unknown>) =>
				(row.startAt = new Date("2026-01-05T08:01:00.000Z")),
		],
		["duration", (row: Record<string, unknown>) => (row.durationMinutes = 479)],
		[
			"status",
			(row: Record<string, unknown>) => (row.approvalState = "pending"),
		],
	])("rolls back without boundary writes for canonical %s mismatch", async (_label, mutate) => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mutate(mocks.transactionCanonicalRecord as Record<string, unknown>);

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).resolves.toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.insertedTimeEntries).toHaveLength(0);
		expect(mocks.executeSubmission).not.toHaveBeenCalled();
	});

	it.each([
		["IANA zone", { timezone: "Not/A_Zone" }],
		["source", { timezoneSource: "viewer" }],
		["integer offset", { utcOffsetMinutes: 60.5 }],
		["offset range", { utcOffsetMinutes: 900 }],
		["instant offset", { utcOffsetMinutes: 120 }],
	])("rejects invalid original timezone %s evidence", async (_label, patch) => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		Object.assign(mocks.originalTimeEntries[0], patch);
		Object.assign(
			mocks.lockedOriginalTimeEntry as Record<string, unknown>,
			patch,
		);

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).resolves.toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.insertedTimeEntries).toHaveLength(0);
		expect(mocks.executeSubmission).not.toHaveBeenCalled();
	});

	it.each([
		"workflow",
		"binding",
		"projection",
		"outbox",
	])("rolls back correction and boundary writes when %s persistence fails", async (stage) => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.failBoundaryStage = stage;

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).rejects.toThrow(`${stage} failed`);

		expect(mocks.insertedTimeEntries).toHaveLength(0);
		expect(mocks.boundaryWrites).toHaveLength(0);
		expect(mocks.insertedApprovals).toHaveLength(0);
		expect(mocks.insertedNotifications).toHaveLength(0);
	});

	it("rolls back a policy auto-completion instead of reporting it as pending", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.executeSubmission.mockResolvedValueOnce({
			kind: "auto_completed",
			approvalRequestId: "50000000-0000-4000-8000-000000000001",
			postCommit: {
				authority: "canonical",
				submittedToEmployeeId: null,
				terminal: null,
			},
		});

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).resolves.toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.insertedTimeEntries).toHaveLength(0);
		expect(mocks.insertedNotifications).toHaveLength(0);
	});

	it("does not redispatch a failed best-effort legacy notification on exact replay", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.notificationFailure = new Error("notification failed");

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).resolves.toEqual({
			pendingTimeCorrectionApprovalsCreated: 1,
		});
		expect(mocks.insertedNotifications).toHaveLength(0);

		mocks.notificationFailure = null;
		const retryResult =
			await generateDemoPendingTimeCorrectionApprovals(options);
		const laterResult =
			await generateDemoPendingTimeCorrectionApprovals(options);

		expect(retryResult).toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(laterResult).toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.insertedNotifications).toHaveLength(0);
		expect(mocks.insertedTimeEntries).toHaveLength(1);
		expect(
			new Set(mocks.insertedTimeEntries.map((entry) => entry.id)).size,
		).toBe(1);
		expect(
			new Set(
				mocks.executeSubmission.mock.calls.map(
					([input]) => input.submissionKey,
				),
			).size,
		).toBe(1);
	});

	it("does not duplicate a freshly persisted notification on replay", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();

		await generateDemoPendingTimeCorrectionApprovals(options);
		await generateDemoPendingTimeCorrectionApprovals(options);

		expect(mocks.insertedNotifications).toHaveLength(1);
		expect(mocks.executeSubmission).toHaveBeenCalledTimes(2);
		expect(
			mocks.executeSubmission.mock.results[1]?.value,
		).resolves.toMatchObject({
			postCommit: { authority: "legacy", submittedToEmployeeId: null },
		});
	});

	it("removes a demo correction row recreated only to identify a cancelled replay", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		await generateDemoPendingTimeCorrectionApprovals(options);
		mocks.insertedTimeEntries.length = 0;

		const replay = await generateDemoPendingTimeCorrectionApprovals(options);

		expect(replay).toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.insertedTimeEntries).toHaveLength(0);
		expect(mocks.insertedNotifications).toHaveLength(1);
	});

	it("accepts deterministic replay by another admin without rewriting creator", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		await generateDemoPendingTimeCorrectionApprovals(options);

		await expect(
			generateDemoPendingTimeCorrectionApprovals({
				...options,
				createdBy: "another-admin-user",
			}),
		).resolves.toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(mocks.insertedTimeEntries).toHaveLength(1);
		expect(mocks.insertedTimeEntries[0]?.createdBy).toBe("user-1");
	});

	it.each([
		["id", { id: "70000000-0000-4000-8000-000000000099" }],
		["organization", { organizationId: "org-2" }],
		["employee", { employeeId: "20000000-0000-4000-8000-000000000099" }],
		[
			"previous entry",
			{ previousEntryId: "40000000-0000-4000-8000-000000000099" },
		],
		["previous hash", { previousHash: "other-previous-hash" }],
		["recomputed hash", { hash: "other-correction-hash" }],
		[
			"superseded back link",
			{ supersededById: "70000000-0000-4000-8000-000000000099" },
		],
	])("rejects existing correction replay with mismatched %s", async (_label, patch) => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		await generateDemoPendingTimeCorrectionApprovals(options);
		Object.assign(mocks.insertedTimeEntries[0], patch);

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).rejects.toThrow(
			"Demo time correction identity conflicts with existing data",
		);
		expect(mocks.executeSubmission).toHaveBeenCalledOnce();
		expect(mocks.insertedTimeEntries).toHaveLength(1);
	});

	it("bounds later seed generation to five deterministic candidates", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.findExistingCorrection = false;
		mocks.workPeriods = Array.from({ length: 6 }, (_, index) => ({
			...mocks.workPeriods[0],
			id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
		}));
		mocks.sequentialLocks = true;
		mocks.lockedWorkPeriods = mocks.workPeriods.map((period) => ({
			...period,
		}));

		const result = await generateDemoPendingTimeCorrectionApprovals(options);

		expect(result).toEqual({ pendingTimeCorrectionApprovalsCreated: 5 });
		expect(mocks.withTransaction).toHaveBeenCalledTimes(5);
		expect(mocks.executeSubmission).toHaveBeenCalledTimes(5);
		expect(mocks.createRuntime).toHaveBeenCalledOnce();
		expect(
			vi.mocked(db.query.workPeriod.findMany).mock.calls[0]?.[0],
		).toMatchObject({
			limit: 20,
		});
		expect(
			vi.mocked(db.query.workPeriod.findMany).mock.invocationCallOrder[0],
		).toBeLessThan(
			vi.mocked(db.query.employeeManagers.findMany).mock
				.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
		);
		expect(
			vi.mocked(db.query.employeeManagers.findMany).mock.invocationCallOrder[0],
		).toBeLessThan(
			vi.mocked(db.query.employee.findMany).mock.invocationCallOrder[0] ??
				Number.POSITIVE_INFINITY,
		);
		expect(
			new Set(
				mocks.executeSubmission.mock.calls.map(
					([input]) => input.submissionKey,
				),
			).size,
		).toBe(5);
	});

	it.each([
		"forward",
		"reverse",
	])("selects the same stable candidates from more than twenty rows in %s input order", async (inputOrder) => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.findExistingCorrection = false;
		const candidates = Array.from({ length: 25 }, (_, index) => ({
			...mocks.workPeriods[0],
			id: `10000000-0000-4000-8000-${String(25 - index).padStart(12, "0")}`,
		}));
		mocks.workPeriods =
			inputOrder === "forward" ? candidates : [...candidates].reverse();
		const sorted = [...candidates].sort((left, right) =>
			left.id.localeCompare(right.id),
		);
		mocks.sequentialLocks = true;
		mocks.lockedWorkPeriods = sorted
			.slice(0, 20)
			.map((period) => ({ ...period }));

		const result = await generateDemoPendingTimeCorrectionApprovals(options);

		expect(result).toEqual({ pendingTimeCorrectionApprovalsCreated: 5 });
		expect(mocks.workPeriodOrderBy).toEqual([
			workPeriod.startTime,
			workPeriod.id,
		]);
		expect(
			mocks.executeSubmission.mock.calls.map(([input]) => input.workPeriodId),
		).toEqual(sorted.slice(0, 5).map((period) => period.id));
	});

	it("rejects foreign evidence without opening a transaction or returning metadata", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.workPeriods[0] = { ...mocks.workPeriods[0], organizationId: "org-2" };

		const result = await generateDemoPendingTimeCorrectionApprovals(options);

		expect(result).toEqual({ pendingTimeCorrectionApprovalsCreated: 0 });
		expect(Object.keys(result)).toEqual([
			"pendingTimeCorrectionApprovalsCreated",
		]);
		expect(mocks.withTransaction).not.toHaveBeenCalled();
	});

	it("does not notify a foreign post-commit recipient", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import(
			"./demo-data.service"
		);
		seedCorrectionEvidence();
		mocks.ownerEmployee = {
			id: "20000000-0000-4000-8000-000000000002",
			organizationId: "org-2",
			userId: "foreign-user",
			isActive: true,
		};

		await expect(
			generateDemoPendingTimeCorrectionApprovals(options),
		).resolves.toEqual({ pendingTimeCorrectionApprovalsCreated: 1 });
		expect(mocks.insertedNotifications).toHaveLength(0);
	});
});

describe("generateDemoData", () => {
	beforeEach(() => {
		mocks.transactionDb = db;
		mocks.findExistingCorrection = true;
		mocks.employees = [];
		mocks.categories = [];
		mocks.managerAssignments = [];
		mocks.ownerEmployee = null;
		mocks.latestTimeEntry = null;
		mocks.workPeriods = [];
		mocks.existingApprovals = [];
		mocks.insertedAbsences = [];
		mocks.insertedTimeEntries = [];
		mocks.insertedApprovals = [];
		mocks.insertedNotifications = [];
		mocks.ensureDefaultAbsenceCategories.mockReset();
		mocks.withTransaction.mockReset();
		mocks.executeSubmission.mockReset();
		mocks.createRuntime.mockReset();
		mocks.createRuntime.mockImplementation(() => ({
			repository: { withTransaction: mocks.withTransaction },
		}));
		mocks.lockedChainTail = null;
		mocks.withTransaction.mockImplementation(async (operation) => {
			mocks.transactionActive = true;
			try {
				return await operation({ dbService: { db: mocks.transactionDb } });
			} finally {
				mocks.transactionActive = false;
			}
		});
		mocks.executeSubmission.mockResolvedValue({
			kind: "default_created",
			approvalRequestId: "50000000-0000-4000-8000-000000000001",
			postCommit: {
				authority: "legacy",
				submittedToEmployeeId: "20000000-0000-4000-8000-000000000002",
				terminal: null,
			},
		});
	});

	it("returns pending approval counts when aggregate options are selected", async () => {
		const { generateDemoData } = await import("./demo-data.service");

		mocks.employees = [
			{
				id: "20000000-0000-4000-8000-000000000001",
				organizationId: "org-1",
				userId: "user-1",
				teamId: null,
				isActive: true,
			},
			{
				id: "20000000-0000-4000-8000-000000000002",
				organizationId: "org-1",
				userId: "user-2",
				teamId: null,
				isActive: true,
			},
		];
		mocks.categories = [
			{
				id: "vacation-category",
				organizationId: "org-1",
				type: "vacation",
				isActive: true,
			},
		];
		mocks.managerAssignments = [
			{
				employeeId: "20000000-0000-4000-8000-000000000001",
				managerId: "20000000-0000-4000-8000-000000000002",
				isPrimary: true,
			},
		];
		mocks.workPeriods = [
			{
				id: "10000000-0000-4000-8000-000000000001",
				employeeId: "20000000-0000-4000-8000-000000000001",
				organizationId: "org-1",
				clockInId: "40000000-0000-4000-8000-000000000001",
				clockOutId: "40000000-0000-4000-8000-000000000002",
				canonicalRecordId: "60000000-0000-4000-8000-000000000001",
				startTime: new Date("2026-01-05T08:00:00.000Z"),
				endTime: new Date("2026-01-05T16:00:00.000Z"),
				durationMinutes: 480,
				isActive: false,
				approvalStatus: "approved",
				pendingChanges: null,
				deletedAt: null,
			},
		];
		mocks.originalTimeEntries = [
			{
				id: "40000000-0000-4000-8000-000000000001",
				employeeId: "20000000-0000-4000-8000-000000000001",
				organizationId: "org-1",
				type: "clock_in",
				timestamp: new Date("2026-01-05T08:00:00.000Z"),
				utcOffsetMinutes: 60,
				timezone: "Europe/Berlin",
				timezoneSource: "browser",
				replacesEntryId: null,
				isSuperseded: false,
				supersededById: null,
				hash: "original-hash",
			},
		];
		mocks.canonicalRecords = [
			{
				id: "60000000-0000-4000-8000-000000000001",
				organizationId: "org-1",
				employeeId: "20000000-0000-4000-8000-000000000001",
				recordKind: "work",
				origin: "clock",
				startAt: new Date("2026-01-05T08:00:00.000Z"),
				endAt: new Date("2026-01-05T16:00:00.000Z"),
				durationMinutes: 480,
				approvalState: "approved",
			},
		];
		mocks.ownerEmployee = {
			id: "20000000-0000-4000-8000-000000000002",
			organizationId: "org-1",
			userId: "user-2",
			isActive: true,
		};
		mocks.lockedWorkPeriod = { ...mocks.workPeriods[0] };
		mocks.lockedOriginalTimeEntry = { ...mocks.originalTimeEntries[0] };
		mocks.transactionCanonicalRecord = { ...mocks.canonicalRecords[0] };
		mocks.transactionRequester = { ...mocks.employees[0] };
		mocks.durableApproval = {
			id: "50000000-0000-4000-8000-000000000001",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "10000000-0000-4000-8000-000000000001",
			requestedBy: "20000000-0000-4000-8000-000000000001",
			approverId: "20000000-0000-4000-8000-000000000002",
			status: "pending",
		};

		const result = await generateDemoData({
			organizationId: "org-1",
			dateRange: { start: new Date("2026-01-01"), end: new Date("2026-01-31") },
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			includePendingAbsenceApprovals: true,
			includePendingTimeCorrectionApprovals: true,
			createdBy: "user-1",
		});

		expect(result.pendingAbsenceApprovalsCreated).toBe(2);
		expect(result.pendingTimeCorrectionApprovalsCreated).toBe(1);
	});
});
