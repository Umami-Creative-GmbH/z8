import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	timeRecordTable: {
		id: "time-record-id",
		organizationId: "time-record-organization-id",
	},
	attachMissingWorkRecords: vi.fn(),
	timeRecordInsertValues: vi.fn(),
	detailInsertValues: vi.fn(),
	onConflictDoNothing: vi.fn(),
	onConflictDoUpdate: vi.fn(),
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
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			absenceCategory: { findMany: mockState.absenceCategoryFindMany },
			absenceEntry: { findMany: mockState.absenceEntryFindMany },
			approvalRequest: { findMany: mockState.approvalRequestFindMany },
			employee: { findMany: mockState.employeeFindMany },
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
	timeRecord: mockState.timeRecordTable,
	timeRecordAbsence: {
		recordId: "time-record-absence-record-id",
	},
	timeRecordApprovalDecision: {
		recordId: "time-record-approval-decision-record-id",
	},
	employee: {
		organizationId: "employee-organization-id",
	},
}));

vi.mock("@/lib/time-record/migration/attach-missing-work-records", () => ({
	attachMissingWorkRecords: mockState.attachMissingWorkRecords,
}));

import {
	buildCanonicalBackfillPayload,
	runCanonicalBackfill,
} from "@/lib/time-record/migration/backfill";

const transactionClient = {
	delete: mockState.dbDelete,
	insert: mockState.dbInsert,
	update: mockState.dbUpdate,
};

const absence = {
	id: "absence-1",
	organizationId: "org-1",
	employeeId: "employee-1",
	categoryId: "category-1",
	startDate: "2026-01-15",
	startPeriod: "full_day" as const,
	endDate: "2026-01-15",
	endPeriod: "full_day" as const,
	status: "approved" as const,
	createdAt: new Date("2026-01-10T00:00:00.000Z"),
	updatedAt: new Date("2026-01-10T00:00:00.000Z"),
};

const noWork = { attached: [], closedMonthSkips: [], refused: [] };

describe("the canonical backfill", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		mockState.attachMissingWorkRecords.mockResolvedValue(noWork);
		mockState.onConflictDoNothing.mockResolvedValue(undefined);
		mockState.onConflictDoUpdate.mockResolvedValue(undefined);
		mockState.timeRecordInsertValues.mockReturnValue({
			onConflictDoUpdate: mockState.onConflictDoUpdate,
		});
		mockState.detailInsertValues.mockReturnValue({
			onConflictDoNothing: mockState.onConflictDoNothing,
		});
		mockState.dbInsert.mockImplementation((table) => ({
			values:
				table === mockState.timeRecordTable
					? mockState.timeRecordInsertValues
					: mockState.detailInsertValues,
		}));

		mockState.updateWhere.mockResolvedValue(undefined);
		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.dbUpdate.mockReturnValue({ set: mockState.updateSet });

		mockState.deleteWhere.mockResolvedValue(undefined);
		mockState.dbDelete.mockReturnValue({ where: mockState.deleteWhere });

		mockState.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback(transactionClient),
		);

		mockState.absenceCategoryFindMany.mockResolvedValue([]);
		mockState.absenceEntryFindMany.mockResolvedValue([]);
		mockState.approvalRequestFindMany.mockResolvedValue([]);
		mockState.employeeFindMany.mockResolvedValue([]);
	});

	it("attaches completed work through work records as the system and returns what it did (#1224)", async () => {
		const work = {
			attached: ["work-april"],
			closedMonthSkips: [{ workPeriodId: "work-march", month: "2026-03" }],
			refused: [],
		};
		mockState.attachMissingWorkRecords.mockResolvedValue(work);

		const result = await runCanonicalBackfill({ organizationId: "org-1", actorId: "actor-1" });

		expect(mockState.attachMissingWorkRecords).toHaveBeenCalledExactlyOnceWith({
			organizationId: "org-1",
			actorUserId: null,
		});
		expect(result.work).toBe(work);
	});

	it("stops before the absences when attaching work fails", async () => {
		mockState.attachMissingWorkRecords.mockRejectedValue(new Error("deadlock detected"));

		await expect(
			runCanonicalBackfill({ organizationId: "org-1", actorId: "actor-1" }),
		).rejects.toThrow("deadlock detected");
		expect(mockState.transaction).not.toHaveBeenCalled();
	});

	it("normalizes legacy morning/afternoon periods to am/pm", () => {
		const payload = buildCanonicalBackfillPayload({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				absenceEntries: [{ ...absence, startPeriod: "morning", endPeriod: "morning" }],
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
				absenceEntries: [{ ...absence, id: "absence-2", startPeriod: "pm", endPeriod: "pm" }],
				approvalRequests: [],
				absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
			},
		});

		expect(payload.timeRecordAbsence[0]?.startPeriod).toBe("pm");
		expect(payload.timeRecordAbsence[0]?.endPeriod).toBe("pm");
		expect(payload.timeRecords[0]?.durationMinutes).toBe(720);
	});

	it("builds updates that populate absence_entry.organization_id linkage during cutover", () => {
		const payload = buildCanonicalBackfillPayload({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				absenceEntries: [absence],
				approvalRequests: [],
				absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
			},
		});

		expect(payload.legacyLinks.absenceEntry).toEqual([
			{ id: "absence-1", canonicalRecordId: "absence-1", organizationId: "org-1" },
		]);
	});

	it("records an absence's legacy approval as a decision and links the request; work requests are attach's", () => {
		const request = {
			organizationId: "org-1",
			requestedBy: "employee-1",
			approverId: "manager-1",
			status: "approved" as const,
			reason: null,
			rejectionReason: null,
			approvedAt: new Date("2026-01-11T00:00:00.000Z"),
			createdAt: new Date("2026-01-10T00:00:00.000Z"),
		};
		const payload = buildCanonicalBackfillPayload({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				absenceEntries: [absence],
				approvalRequests: [
					{ ...request, id: "request-1", entityType: "absence_entry", entityId: "absence-1" },
					{ ...request, id: "request-2", entityType: "time_entry", entityId: "work-1" },
				],
				absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
			},
		});

		expect(payload.timeRecordApprovalDecision).toEqual([
			{
				organizationId: "org-1",
				recordId: "absence-1",
				actorEmployeeId: "manager-1",
				action: "approved",
				reason: null,
				createdAt: request.approvedAt,
			},
		]);
		expect(payload.legacyLinks.approvalRequest).toEqual([
			{ id: "request-1", canonicalRecordId: "absence-1" },
		]);
	});

	it("runs the absences' inserts and linkage updates inside one transaction", async () => {
		await runCanonicalBackfill({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: {
				absenceEntries: [absence],
				approvalRequests: [],
				absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
			},
		});

		expect(mockState.transaction).toHaveBeenCalledTimes(1);
		expect(mockState.dbInsert).toHaveBeenCalledTimes(2);
		expect(mockState.dbUpdate).toHaveBeenCalledTimes(1);
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ canonicalRecordId: "absence-1", organizationId: "org-1" }),
		);
		expect(mockState.onConflictDoNothing).toHaveBeenCalledTimes(1);
		expect(mockState.onConflictDoUpdate).toHaveBeenCalledTimes(1);
	});

	it("skips canonical inserts and conflict updates for an empty payload", async () => {
		await runCanonicalBackfill({
			organizationId: "org-1",
			actorId: "actor-1",
			legacy: { absenceEntries: [], approvalRequests: [], absenceCategories: [] },
		});

		expect(mockState.onConflictDoUpdate).not.toHaveBeenCalled();
		expect(mockState.dbInsert).not.toHaveBeenCalled();
	});

	it("loads legacy rows from db and repairs null-org absences attributable by employee org", async () => {
		mockState.employeeFindMany.mockResolvedValue([{ id: "employee-1" }]);
		mockState.absenceEntryFindMany
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ ...absence, organizationId: null }]);
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
