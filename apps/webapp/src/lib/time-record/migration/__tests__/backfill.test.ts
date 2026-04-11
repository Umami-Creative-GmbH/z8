import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	insertValues: vi.fn(),
	onConflictDoNothing: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
	deleteWhere: vi.fn(),
	transaction: vi.fn(),
	dbInsert: vi.fn(),
	dbUpdate: vi.fn(),
	dbDelete: vi.fn(),
	absenceCategoryFindMany: vi.fn(),
	absenceEntryFindMany: vi.fn(),
	approvalRequestFindMany: vi.fn(),
	employeeFindMany: vi.fn(),
	workPeriodFindMany: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			absenceCategory: { findMany: mockState.absenceCategoryFindMany },
			absenceEntry: { findMany: mockState.absenceEntryFindMany },
			approvalRequest: { findMany: mockState.approvalRequestFindMany },
			employee: { findMany: mockState.employeeFindMany },
			workPeriod: { findMany: mockState.workPeriodFindMany },
		},
		delete: mockState.dbDelete,
		insert: mockState.dbInsert,
		update: mockState.dbUpdate,
		transaction: mockState.transaction,
	},
	absenceCategory: {
		organizationId: "absence-category-organization-id",
	},
	absenceEntry: {
		id: "absence-entry-id",
	},
	approvalRequest: {
		id: "approval-request-id",
	},
	timeRecord: {
		id: "time-record-id",
	},
	timeRecordAbsence: {
		recordId: "time-record-absence-record-id",
	},
	timeRecordApprovalDecision: {
		recordId: "time-record-approval-decision-record-id",
	},
	timeRecordAllocation: {
		allocationKind: "time-record-allocation-kind",
		recordId: "time-record-allocation-record-id",
	},
	timeRecordWork: {
		recordId: "time-record-work-record-id",
	},
	employee: {
		organizationId: "employee-organization-id",
	},
	workPeriod: {
		id: "work-period-id",
		organizationId: "work-period-organization-id",
	},
}));

import { buildCanonicalBackfillPayload, runCanonicalBackfill } from "@/lib/time-record/migration/backfill";

describe("canonical backfill period normalization", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		mockState.onConflictDoNothing.mockResolvedValue(undefined);
		mockState.insertValues.mockReturnValue({
			onConflictDoNothing: mockState.onConflictDoNothing,
		});
		mockState.dbInsert.mockReturnValue({ values: mockState.insertValues });

		mockState.updateWhere.mockResolvedValue(undefined);
		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.dbUpdate.mockReturnValue({ set: mockState.updateSet });

		mockState.deleteWhere.mockResolvedValue(undefined);
		mockState.dbDelete.mockReturnValue({ where: mockState.deleteWhere });

		mockState.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback({
				delete: mockState.dbDelete,
				insert: mockState.dbInsert,
				update: mockState.dbUpdate,
			}),
		);

		mockState.absenceCategoryFindMany.mockResolvedValue([]);
		mockState.absenceEntryFindMany.mockResolvedValue([]);
		mockState.approvalRequestFindMany.mockResolvedValue([]);
		mockState.employeeFindMany.mockResolvedValue([]);
		mockState.workPeriodFindMany.mockResolvedValue([]);
	});

	it("normalizes legacy morning/afternoon periods to am/pm", () => {
		const payload = buildCanonicalBackfillPayload({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				workPeriods: [],
				absenceEntries: [
					{
						id: "absence-1",
						organizationId: "org-1",
						employeeId: "employee-1",
						categoryId: "category-1",
						startDate: "2026-01-15",
						startPeriod: "morning",
						endDate: "2026-01-15",
						endPeriod: "morning",
						status: "approved",
						createdAt: new Date("2026-01-10T00:00:00.000Z"),
						updatedAt: new Date("2026-01-10T00:00:00.000Z"),
					},
				],
				approvalRequests: [],
				absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
			},
		});

		expect(payload.timeRecordAbsence).toEqual([
			{
				recordId: "absence-1",
				organizationId: "org-1",
				recordKind: "absence",
				absenceCategoryId: "category-1",
				startPeriod: "am",
				endPeriod: "am",
				countsAgainstVacation: true,
			},
		]);

		expect(payload.timeRecords[0]?.durationMinutes).toBe(720);
	});

	it("keeps canonical am/pm periods and preserves half-day duration", () => {
		const payload = buildCanonicalBackfillPayload({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				workPeriods: [],
				absenceEntries: [
					{
						id: "absence-2",
						organizationId: "org-1",
						employeeId: "employee-1",
						categoryId: "category-1",
						startDate: "2026-01-15",
						startPeriod: "pm",
						endDate: "2026-01-15",
						endPeriod: "pm",
						status: "approved",
						createdAt: new Date("2026-01-10T00:00:00.000Z"),
						updatedAt: new Date("2026-01-10T00:00:00.000Z"),
					},
				],
				approvalRequests: [],
				absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
			},
		});

		expect(payload.timeRecordAbsence[0]?.startPeriod).toBe("pm");
		expect(payload.timeRecordAbsence[0]?.endPeriod).toBe("pm");
		expect(payload.timeRecords[0]?.durationMinutes).toBe(720);
	});

	it("maps legacy project assignment to canonical work allocation", () => {
		const payload = buildCanonicalBackfillPayload({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				workPeriods: [
					{
						id: "work-1",
						organizationId: "org-1",
						employeeId: "employee-1",
						startTime: new Date("2026-01-15T08:00:00.000Z"),
						endTime: new Date("2026-01-15T16:00:00.000Z"),
						durationMinutes: 480,
						approvalStatus: "approved",
						projectId: "project-1",
						workCategoryId: null,
						workLocationType: "office",
						createdAt: new Date("2026-01-10T00:00:00.000Z"),
						updatedAt: new Date("2026-01-10T00:00:00.000Z"),
					},
				],
				absenceEntries: [],
				approvalRequests: [],
				absenceCategories: [],
			},
		});

		expect(payload.timeRecordAllocation).toEqual([
			{
				organizationId: "org-1",
				recordId: "work-1",
				allocationKind: "project",
				projectId: "project-1",
				weightPercent: 100,
			},
		]);
	});

	it("builds updates that populate absence_entry.organization_id linkage during cutover", () => {
		const payload = buildCanonicalBackfillPayload({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				workPeriods: [],
				absenceEntries: [
					{
						id: "absence-1",
						organizationId: "org-1",
						employeeId: "employee-1",
						categoryId: "category-1",
						startDate: "2026-01-15",
						startPeriod: "full_day",
						endDate: "2026-01-15",
						endPeriod: "full_day",
						status: "approved",
						createdAt: new Date("2026-01-10T00:00:00.000Z"),
						updatedAt: new Date("2026-01-10T00:00:00.000Z"),
					},
				],
				approvalRequests: [],
				absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
			},
		});

		expect(payload.legacyLinks.absenceEntry).toEqual([
			{ id: "absence-1", canonicalRecordId: "absence-1", organizationId: "org-1" },
		]);
	});

	it("runs canonical inserts and legacy linkage updates inside one transaction", async () => {
		await runCanonicalBackfill({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				workPeriods: [
					{
						id: "work-1",
						organizationId: "org-1",
						employeeId: "employee-1",
						startTime: new Date("2026-01-15T08:00:00.000Z"),
						endTime: new Date("2026-01-15T16:00:00.000Z"),
						durationMinutes: 480,
						approvalStatus: "approved",
						projectId: "project-1",
						workCategoryId: null,
						workLocationType: "office",
						createdAt: new Date("2026-01-10T00:00:00.000Z"),
						updatedAt: new Date("2026-01-10T00:00:00.000Z"),
					},
				],
				absenceEntries: [
					{
						id: "absence-1",
						organizationId: "org-1",
						employeeId: "employee-1",
						categoryId: "category-1",
						startDate: "2026-01-15",
						startPeriod: "full_day",
						endDate: "2026-01-15",
						endPeriod: "full_day",
						status: "approved",
						createdAt: new Date("2026-01-10T00:00:00.000Z"),
						updatedAt: new Date("2026-01-10T00:00:00.000Z"),
					},
				],
				approvalRequests: [],
				absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
			},
		});

		expect(mockState.transaction).toHaveBeenCalledTimes(1);
		expect(mockState.dbInsert).toHaveBeenCalledTimes(4);
		expect(mockState.dbUpdate).toHaveBeenCalledTimes(2);
		expect(mockState.dbDelete).toHaveBeenCalledTimes(1);
		expect(mockState.updateSet).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ canonicalRecordId: "absence-1", organizationId: "org-1" }),
		);
		expect(mockState.onConflictDoNothing).toHaveBeenCalledTimes(3);
	});

	it("returns the generated payload after executing idempotent writes", async () => {
		const result = await runCanonicalBackfill({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				workPeriods: [],
				absenceEntries: [
					{
						id: "absence-1",
						organizationId: "org-1",
						employeeId: "employee-1",
						categoryId: "category-1",
						startDate: "2026-01-15",
						startPeriod: "full_day",
						endDate: "2026-01-15",
						endPeriod: "full_day",
						status: "approved",
						createdAt: new Date("2026-01-10T00:00:00.000Z"),
						updatedAt: new Date("2026-01-10T00:00:00.000Z"),
					},
				],
				approvalRequests: [],
				absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
			},
		});

		expect(result.legacyLinks.absenceEntry).toEqual([
			{ id: "absence-1", canonicalRecordId: "absence-1", organizationId: "org-1" },
		]);
		expect(mockState.dbInsert).toHaveBeenCalledTimes(2);
	});

	it("loads legacy rows from db and repairs null-org absences attributable by employee org", async () => {
		mockState.employeeFindMany.mockResolvedValue([{ id: "employee-1" }]);
		mockState.workPeriodFindMany.mockResolvedValue([]);
		mockState.absenceEntryFindMany
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					id: "absence-1",
					organizationId: null,
					employeeId: "employee-1",
					categoryId: "category-1",
					startDate: "2026-01-15",
					startPeriod: "full_day",
					endDate: "2026-01-15",
					endPeriod: "full_day",
					status: "approved",
					createdAt: new Date("2026-01-10T00:00:00.000Z"),
					updatedAt: new Date("2026-01-10T00:00:00.000Z"),
				},
			]);
		mockState.approvalRequestFindMany.mockResolvedValue([]);
		mockState.absenceCategoryFindMany.mockResolvedValue([
			{ id: "category-1", countsAgainstVacation: true },
		]);

		const result = await runCanonicalBackfill({ organizationId: "org-1", actorId: "actor-1" });

		expect(mockState.employeeFindMany).toHaveBeenCalledTimes(1);
		expect(mockState.absenceEntryFindMany).toHaveBeenCalledTimes(2);
		expect(result.legacyLinks.absenceEntry).toEqual([
			{ id: "absence-1", canonicalRecordId: "absence-1", organizationId: "org-1" },
		]);
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ canonicalRecordId: "absence-1", organizationId: "org-1" }),
		);
	});
});
