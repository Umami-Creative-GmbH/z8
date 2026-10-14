import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	legacyWorkCount: vi.fn(),
	absenceEntryFindMany: vi.fn(),
	canonicalTimeRecordCount: vi.fn(),
	canonicalTimeRecordAbsenceFindMany: vi.fn(),
	canonicalTimeRecordAllocationFindMany: vi.fn(),
	canonicalTimeRecordWorkFindMany: vi.fn(),
	employeeFindMany: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findMany: mockState.employeeFindMany },
			timeRecordAbsence: {
				findMany: mockState.canonicalTimeRecordAbsenceFindMany,
			},
			timeRecordAllocation: {
				findMany: mockState.canonicalTimeRecordAllocationFindMany,
			},
			workPeriod: { findMany: mockState.legacyWorkCount },
			absenceEntry: { findMany: mockState.absenceEntryFindMany },
			timeRecord: { findMany: mockState.canonicalTimeRecordCount },
			timeRecordWork: { findMany: mockState.canonicalTimeRecordWorkFindMany },
		},
	},
	absenceEntry: {
		organizationId: "absence-entry-organization-id",
	},
	timeRecord: {
		organizationId: "time-record-organization-id",
		recordKind: "time-record-record-kind",
	},
	timeRecordAllocation: {
		allocationKind: "time-record-allocation-kind",
		organizationId: "time-record-allocation-organization-id",
		createdAt: "time-record-allocation-created-at",
		id: "time-record-allocation-id",
	},
	timeRecordAbsence: {
		organizationId: "time-record-absence-organization-id",
	},
	timeRecordWork: {
		organizationId: "time-record-work-organization-id",
	},
	workPeriod: {
		organizationId: "work-period-organization-id",
	},
	employee: {
		organizationId: "employee-organization-id",
	},
}));

import { reconcileLegacyToCanonical } from "@/lib/time-record/migration/reconciliation";

const noVehicle = {
	vehicleKind: null,
	vehicleId: null,
	odometerStartKm: null,
	odometerEndKm: null,
	drivenDistanceKm: null,
};

/** A completed, approved eight-hour work period without attribution. */
function legacyWork(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		canonicalRecordId: id,
		isActive: false,
		deletedAt: null,
		startTime: new Date("2026-01-15T08:00:00Z"),
		endTime: new Date("2026-01-15T16:00:00Z"),
		durationMinutes: 480,
		approvalStatus: "approved",
		projectId: null,
		taskId: null,
		isBillable: false,
		workCategoryId: null,
		workLocationType: null,
		...noVehicle,
		unlinkedClosedMonth: null,
		...overrides,
	};
}

/** The canonical work record that agrees with `legacyWork(id)`. */
function canonicalWork(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		startAt: new Date("2026-01-15T08:00:00Z"),
		endAt: new Date("2026-01-15T16:00:00Z"),
		durationMinutes: 480,
		approvalState: "approved",
		...overrides,
	};
}

function workDetail(recordId: string, overrides: Record<string, unknown> = {}) {
	return { recordId, workCategoryId: null, workLocationType: null, ...noVehicle, ...overrides };
}

function projectAllocation(recordId: string, projectId: string, overrides = {}) {
	return {
		recordId,
		allocationKind: "project",
		projectId,
		taskId: null,
		costCenterId: null,
		weightPercent: 100,
		isBillable: false,
		...overrides,
	};
}

const reconciled = {
	workCountMismatch: 0,
	absenceCountMismatch: 0,
	durationMismatchRecords: 0,
	missingWorkCanonicalRecords: 0,
	missingAbsenceCanonicalRecords: 0,
	missingAbsenceDetailRows: 0,
	approvalStateMismatchRecords: 0,
	missingAbsenceCanonicalLinks: 0,
	missingAbsenceOrganizationIds: 0,
	missingProjectAllocationRows: 0,
	missingWorkDetailRows: 0,
	divergentWorkRecords: 0,
	blockingMismatchCount: 0,
};

describe("reconcileLegacyToCanonical", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.canonicalTimeRecordAbsenceFindMany.mockResolvedValue([]);
		mockState.canonicalTimeRecordAllocationFindMany.mockResolvedValue([]);
		mockState.canonicalTimeRecordWorkFindMany.mockResolvedValue([]);
		mockState.employeeFindMany.mockResolvedValue([]);
		mockState.absenceEntryFindMany.mockResolvedValue([]);
		mockState.canonicalTimeRecordCount.mockResolvedValue([]);
	});

	/** Reconciles legacy work against canonical work, with no absences. */
	async function reconcileWork(input: {
		legacy: unknown[];
		canonical: unknown[];
		details?: unknown[];
		allocations?: unknown[];
	}) {
		mockState.legacyWorkCount.mockResolvedValue(input.legacy);
		mockState.canonicalTimeRecordCount
			.mockResolvedValueOnce(input.canonical)
			.mockResolvedValueOnce([]);
		mockState.canonicalTimeRecordWorkFindMany.mockResolvedValue(input.details ?? []);
		mockState.canonicalTimeRecordAllocationFindMany.mockResolvedValue(input.allocations ?? []);
		return reconcileLegacyToCanonical("org-1");
	}

	it("does not require a completed canonical record for healthy live work", async () => {
		const result = await reconcileWork({
			legacy: [
				legacyWork("live-work", {
					canonicalRecordId: null,
					isActive: true,
					endTime: null,
					durationMinutes: null,
					projectId: "project-1",
				}),
			],
			canonical: [],
		});
		expect(Object.values(result).every((count) => count === 0)).toBe(true);
	});

	it("tolerates an unlinked half pair in a closed month but not one in an open month (#1213)", async () => {
		const completed = { canonicalRecordId: null, projectId: "project-1" };

		const result = await reconcileWork({
			legacy: [
				legacyWork("closed-march", { ...completed, unlinkedClosedMonth: "2026-03-01" }),
				legacyWork("open-april", completed),
			],
			canonical: [],
		});

		expect(result).toMatchObject({
			missingWorkCanonicalRecords: 1,
			missingWorkDetailRows: 1,
			missingProjectAllocationRows: 1,
			divergentWorkRecords: 0,
		});
	});

	it("reports zero mismatches when legacy and canonical work agree", async () => {
		mockState.legacyWorkCount.mockResolvedValue([legacyWork("work-1")]);
		mockState.absenceEntryFindMany
			.mockResolvedValueOnce([
				{
					id: "absence-1",
					startDate: "2026-01-15",
					startPeriod: "full_day",
					endDate: "2026-01-15",
					endPeriod: "full_day",
					status: "approved",
				},
			])
			.mockResolvedValueOnce([{ id: "absence-1", canonicalRecordId: "absence-1" }])
			.mockResolvedValueOnce([]);
		mockState.canonicalTimeRecordCount
			.mockResolvedValueOnce([canonicalWork("work-1")])
			.mockResolvedValueOnce([
				{
					id: "absence-1",
					recordKind: "absence",
					durationMinutes: 1440,
					approvalState: "approved",
				},
			]);
		mockState.canonicalTimeRecordWorkFindMany.mockResolvedValue([workDetail("work-1")]);
		mockState.canonicalTimeRecordAbsenceFindMany.mockResolvedValue([{ recordId: "absence-1" }]);

		await expect(reconcileLegacyToCanonical("org-1")).resolves.toEqual(reconciled);

		expect(mockState.absenceEntryFindMany).toHaveBeenCalledTimes(3);
		expect(mockState.absenceEntryFindMany).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				columns: {
					id: true,
					canonicalRecordId: true,
					startDate: true,
					startPeriod: true,
					endDate: true,
					endPeriod: true,
					status: true,
				},
			}),
		);
		expect(mockState.absenceEntryFindMany).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ columns: { id: true, canonicalRecordId: true } }),
		);
		expect(mockState.absenceEntryFindMany).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				columns: {
					id: true,
					employeeId: true,
					canonicalRecordId: true,
					organizationId: true,
					startDate: true,
					startPeriod: true,
					endDate: true,
					endPeriod: true,
					status: true,
				},
			}),
		);
	});

	it("reconciles linked legacy IDs while allowing canonical-native records", async () => {
		const result = await reconcileWork({
			legacy: [
				legacyWork("legacy-work-1", {
					canonicalRecordId: "canonical-work-1",
					projectId: "project-1",
				}),
			],
			canonical: [canonicalWork("canonical-work-1"), canonicalWork("canonical-native-work")],
			details: [workDetail("canonical-work-1"), workDetail("canonical-native-work")],
			allocations: [projectAllocation("canonical-work-1", "project-1")],
		});

		expect(result).toEqual(reconciled);
	});

	it("treats an established canonical link as authoritative", async () => {
		const result = await reconcileWork({
			legacy: [legacyWork("legacy-work-1", { canonicalRecordId: "missing-canonical-work" })],
			canonical: [canonicalWork("legacy-work-1")],
			details: [workDetail("legacy-work-1")],
		});

		expect(result).toMatchObject({
			workCountMismatch: 1,
			missingWorkCanonicalRecords: 1,
			missingWorkDetailRows: 1,
		});
	});

	// Full record agreement is reported in `divergentWorkRecords`; only the checks that
	// blocked before #1217 block until production shows no divergence (#1228).
	it.each<
		[string, Record<string, unknown>, Record<string, unknown>, unknown[], Record<string, number>]
	>([
		["start", {}, { startAt: new Date("2026-01-15T08:30:00Z") }, [], {}],
		["end", {}, { endAt: new Date("2026-01-15T16:30:00Z") }, [], {}],
		["duration", {}, { durationMinutes: 450 }, [], { durationMismatchRecords: 1 }],
		["approval state", {}, { approvalState: "pending" }, [], { approvalStateMismatchRecords: 1 }],
		[
			"project",
			{ projectId: "project-1" },
			{},
			[projectAllocation("work-1", "project-2")],
			{ missingProjectAllocationRows: 1 },
		],
		[
			"task",
			{ projectId: "project-1", taskId: "task-1" },
			{},
			[projectAllocation("work-1", "project-1")],
			{},
		],
		[
			"billable flag",
			{ projectId: "project-1", isBillable: true },
			{},
			[projectAllocation("work-1", "project-1")],
			{ missingProjectAllocationRows: 1 },
		],
		["category", { workCategoryId: "category-1" }, {}, [], {}],
		["location", { workLocationType: "home" }, {}, [], {}],
		["vehicle use", { vehicleKind: "own", odometerStartKm: 100 }, {}, [], {}],
	])(
		"counts linked work disagreeing on its %s as divergent, blocking only as before",
		async (_facet, period, record, allocations, blocking) => {
			const result = await reconcileWork({
				legacy: [legacyWork("work-1", period)],
				canonical: [canonicalWork("work-1", record)],
				details: [workDetail("work-1")],
				allocations,
			});

			expect(result).toEqual({
				...reconciled,
				...blocking,
				divergentWorkRecords: 1,
				blockingMismatchCount: Object.keys(blocking).length,
			});
		},
	);

	it("does not block on a pair that diverges only in task or vehicle use", async () => {
		const result = await reconcileWork({
			legacy: [
				legacyWork("task-only", { projectId: "project-1", taskId: "task-1" }),
				legacyWork("vehicle-only", { vehicleKind: "own", odometerStartKm: 100 }),
			],
			canonical: [canonicalWork("task-only"), canonicalWork("vehicle-only")],
			details: [workDetail("task-only"), workDetail("vehicle-only")],
			allocations: [projectAllocation("task-only", "project-1")],
		});

		expect(result).toMatchObject({ divergentWorkRecords: 2, blockingMismatchCount: 0 });
	});

	it("counts work whose attribution cannot be represented as divergent instead of failing", async () => {
		const result = await reconcileWork({
			legacy: [legacyWork("work-1", { isBillable: true })],
			canonical: [canonicalWork("work-1")],
			details: [workDetail("work-1")],
		});

		expect(result).toEqual({ ...reconciled, divergentWorkRecords: 1 });
	});

	it("does not judge deleted work by the record agreement rule", async () => {
		const result = await reconcileWork({
			legacy: [legacyWork("work-1", { deletedAt: new Date("2026-01-16T00:00:00Z") })],
			canonical: [canonicalWork("work-1", { endAt: new Date("2026-01-15T08:00:00Z") })],
			details: [workDetail("work-1")],
		});

		expect(result).toEqual(reconciled);
	});

	it("reports id-level cutover gaps including null organization rows", async () => {
		mockState.legacyWorkCount.mockResolvedValue([
			legacyWork("work-1"),
			legacyWork("work-2", { projectId: "project-2", durationMinutes: 300 }),
		]);
		mockState.employeeFindMany.mockResolvedValue([{ id: "employee-2" }]);
		mockState.absenceEntryFindMany
			.mockResolvedValueOnce([
				{
					id: "absence-1",
					startDate: "2026-01-15",
					startPeriod: "full_day",
					endDate: "2026-01-15",
					endPeriod: "full_day",
					status: "approved",
				},
				{
					id: "absence-2",
					startDate: "2026-01-16",
					startPeriod: "full_day",
					endDate: "2026-01-16",
					endPeriod: "full_day",
					status: "pending",
				},
			])
			.mockResolvedValueOnce([
				{ id: "absence-1", canonicalRecordId: "absence-1" },
				{ id: "absence-2", canonicalRecordId: null },
			])
			.mockResolvedValueOnce([
				{
					id: "absence-2",
					canonicalRecordId: "absence-2",
					employeeId: "employee-2",
					organizationId: null,
					startDate: "2026-01-16",
					startPeriod: "full_day",
					endDate: "2026-01-16",
					endPeriod: "full_day",
					status: "pending",
				},
			]);
		mockState.canonicalTimeRecordCount
			.mockResolvedValueOnce([canonicalWork("work-1"), canonicalWork("work-9")])
			.mockResolvedValueOnce([
				{
					id: "absence-1",
					recordKind: "absence",
					durationMinutes: 1440,
					approvalState: "approved",
				},
				{ id: "absence-2", recordKind: "absence", durationMinutes: 1440, approvalState: "pending" },
			]);
		mockState.canonicalTimeRecordWorkFindMany.mockResolvedValue([workDetail("work-1")]);
		mockState.canonicalTimeRecordAbsenceFindMany.mockResolvedValue([
			{ recordId: "absence-1" },
			{ recordId: "absence-2" },
		]);

		await expect(reconcileLegacyToCanonical("org-1")).resolves.toEqual({
			...reconciled,
			workCountMismatch: 1,
			missingWorkCanonicalRecords: 1,
			missingAbsenceCanonicalLinks: 1,
			missingAbsenceOrganizationIds: 1,
			missingWorkDetailRows: 1,
			missingProjectAllocationRows: 1,
			blockingMismatchCount: 6,
		});
	});

	it("attributes null-org absences to the target org via employee when no canonical row exists", async () => {
		mockState.legacyWorkCount.mockResolvedValue([legacyWork("work-1")]);
		mockState.employeeFindMany.mockResolvedValue([{ id: "employee-9" }]);
		mockState.absenceEntryFindMany
			.mockResolvedValueOnce([
				{
					id: "absence-1",
					startDate: "2026-01-15",
					startPeriod: "full_day",
					endDate: "2026-01-15",
					endPeriod: "full_day",
					status: "approved",
				},
			])
			.mockResolvedValueOnce([{ id: "absence-1", canonicalRecordId: "absence-1" }])
			.mockResolvedValueOnce([
				{
					id: "absence-9",
					canonicalRecordId: null,
					employeeId: "employee-9",
					organizationId: null,
					startDate: "2026-01-16",
					startPeriod: "full_day",
					endDate: "2026-01-16",
					endPeriod: "full_day",
					status: "approved",
				},
			]);
		mockState.canonicalTimeRecordCount
			.mockResolvedValueOnce([canonicalWork("work-1")])
			.mockResolvedValueOnce([
				{
					id: "absence-1",
					recordKind: "absence",
					durationMinutes: 1440,
					approvalState: "approved",
				},
			]);
		mockState.canonicalTimeRecordWorkFindMany.mockResolvedValue([workDetail("work-1")]);
		mockState.canonicalTimeRecordAbsenceFindMany.mockResolvedValue([{ recordId: "absence-1" }]);

		await expect(reconcileLegacyToCanonical("org-1")).resolves.toEqual({
			...reconciled,
			absenceCountMismatch: 1,
			missingAbsenceCanonicalRecords: 1,
			missingAbsenceDetailRows: 1,
			missingAbsenceCanonicalLinks: 1,
			missingAbsenceOrganizationIds: 1,
			blockingMismatchCount: 5,
		});
	});

	it("detects absence duration and approval-state mismatches on matched canonical records", async () => {
		mockState.legacyWorkCount.mockResolvedValue([]);
		mockState.absenceEntryFindMany
			.mockResolvedValueOnce([
				{
					id: "absence-1",
					startDate: "2026-01-15",
					startPeriod: "full_day",
					endDate: "2026-01-15",
					endPeriod: "full_day",
					status: "approved",
				},
			])
			.mockResolvedValueOnce([{ id: "absence-1", canonicalRecordId: "absence-1" }])
			.mockResolvedValueOnce([]);
		mockState.canonicalTimeRecordCount
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{ id: "absence-1", recordKind: "absence", durationMinutes: 720, approvalState: "rejected" },
			]);
		mockState.canonicalTimeRecordAbsenceFindMany.mockResolvedValue([{ recordId: "absence-1" }]);

		await expect(reconcileLegacyToCanonical("org-1")).resolves.toEqual({
			...reconciled,
			durationMismatchRecords: 1,
			approvalStateMismatchRecords: 1,
			blockingMismatchCount: 2,
		});
	});
});
