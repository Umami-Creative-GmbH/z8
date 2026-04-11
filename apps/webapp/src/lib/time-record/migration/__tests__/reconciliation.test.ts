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
			timeRecordAbsence: { findMany: mockState.canonicalTimeRecordAbsenceFindMany },
			timeRecordAllocation: { findMany: mockState.canonicalTimeRecordAllocationFindMany },
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

describe("reconcileLegacyToCanonical", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.canonicalTimeRecordAbsenceFindMany.mockResolvedValue([]);
		mockState.canonicalTimeRecordAllocationFindMany.mockResolvedValue([]);
		mockState.canonicalTimeRecordWorkFindMany.mockResolvedValue([]);
	});

	it("reports zero mismatches when legacy and canonical counts match", async () => {
		mockState.legacyWorkCount.mockResolvedValue([
			{ id: "work-1", projectId: null, durationMinutes: 480, approvalStatus: "approved" },
		]);
		mockState.employeeFindMany.mockResolvedValue([]);
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
			.mockResolvedValueOnce([
				{ id: "work-1", recordKind: "work", durationMinutes: 480, approvalState: "approved" },
			])
			.mockResolvedValueOnce([
				{ id: "absence-1", recordKind: "absence", durationMinutes: 1440, approvalState: "approved" },
			]);
		mockState.canonicalTimeRecordWorkFindMany.mockResolvedValue([{ recordId: "work-1" }]);
		mockState.canonicalTimeRecordAbsenceFindMany.mockResolvedValue([{ recordId: "absence-1" }]);

		await expect(reconcileLegacyToCanonical("org-1")).resolves.toEqual({
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
		});

		expect(mockState.absenceEntryFindMany).toHaveBeenCalledTimes(3);
		expect(mockState.absenceEntryFindMany).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				columns: {
					id: true,
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

	it("reports id-level cutover gaps including null organization rows", async () => {
		mockState.legacyWorkCount.mockResolvedValue([
			{ id: "work-1", projectId: null, durationMinutes: 480, approvalStatus: "approved" },
			{ id: "work-2", projectId: "project-2", durationMinutes: 300, approvalStatus: "approved" },
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
			.mockResolvedValueOnce([
				{ id: "work-1", recordKind: "work", durationMinutes: 480, approvalState: "approved" },
				{ id: "work-9", recordKind: "work", durationMinutes: 300, approvalState: "approved" },
			])
			.mockResolvedValueOnce([
				{ id: "absence-1", recordKind: "absence", durationMinutes: 1440, approvalState: "approved" },
				{ id: "absence-2", recordKind: "absence", durationMinutes: 1440, approvalState: "pending" },
			]);
		mockState.canonicalTimeRecordWorkFindMany.mockResolvedValue([{ recordId: "work-1" }]);
		mockState.canonicalTimeRecordAbsenceFindMany.mockResolvedValue([{ recordId: "absence-1" }, { recordId: "absence-2" }]);
		mockState.canonicalTimeRecordAllocationFindMany.mockResolvedValue([]);

		await expect(reconcileLegacyToCanonical("org-1")).resolves.toEqual({
			workCountMismatch: 0,
			absenceCountMismatch: 0,
			durationMismatchRecords: 0,
			missingWorkCanonicalRecords: 1,
			missingAbsenceCanonicalRecords: 0,
			missingAbsenceDetailRows: 0,
			approvalStateMismatchRecords: 0,
			missingAbsenceCanonicalLinks: 1,
			missingAbsenceOrganizationIds: 1,
			missingProjectAllocationRows: 1,
			missingWorkDetailRows: 1,
		});
	});

	it("attributes null-org absences to the target org via employee when no canonical row exists", async () => {
		mockState.legacyWorkCount.mockResolvedValue([
			{ id: "work-1", projectId: null, durationMinutes: 480, approvalStatus: "approved" },
		]);
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
			.mockResolvedValueOnce([
				{ id: "work-1", recordKind: "work", durationMinutes: 480, approvalState: "approved" },
			])
			.mockResolvedValueOnce([
				{ id: "absence-1", recordKind: "absence", durationMinutes: 1440, approvalState: "approved" },
			]);
		mockState.canonicalTimeRecordWorkFindMany.mockResolvedValue([{ recordId: "work-1" }]);
		mockState.canonicalTimeRecordAbsenceFindMany.mockResolvedValue([{ recordId: "absence-1" }]);

		await expect(reconcileLegacyToCanonical("org-1")).resolves.toEqual({
			workCountMismatch: 0,
			absenceCountMismatch: 1,
			durationMismatchRecords: 0,
			missingWorkCanonicalRecords: 0,
			missingAbsenceCanonicalRecords: 1,
			missingAbsenceDetailRows: 1,
			approvalStateMismatchRecords: 0,
			missingAbsenceCanonicalLinks: 1,
			missingAbsenceOrganizationIds: 1,
			missingProjectAllocationRows: 0,
			missingWorkDetailRows: 0,
		});
	});

	it("detects duration and approval-state mismatches on matched canonical records", async () => {
		mockState.legacyWorkCount.mockResolvedValue([
			{ id: "work-1", projectId: null, durationMinutes: 480, approvalStatus: "approved" },
		]);
		mockState.employeeFindMany.mockResolvedValue([]);
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
			.mockResolvedValueOnce([
				{ id: "work-1", recordKind: "work", durationMinutes: 450, approvalState: "pending" },
			])
			.mockResolvedValueOnce([
				{ id: "absence-1", recordKind: "absence", durationMinutes: 1440, approvalState: "rejected" },
			]);
		mockState.canonicalTimeRecordWorkFindMany.mockResolvedValue([{ recordId: "work-1" }]);
		mockState.canonicalTimeRecordAbsenceFindMany.mockResolvedValue([{ recordId: "absence-1" }]);

		await expect(reconcileLegacyToCanonical("org-1")).resolves.toEqual({
			workCountMismatch: 0,
			absenceCountMismatch: 0,
			durationMismatchRecords: 1,
			missingWorkCanonicalRecords: 0,
			missingAbsenceCanonicalRecords: 0,
			missingAbsenceDetailRows: 0,
			approvalStateMismatchRecords: 2,
			missingAbsenceCanonicalLinks: 0,
			missingAbsenceOrganizationIds: 0,
			missingProjectAllocationRows: 0,
			missingWorkDetailRows: 0,
		});
	});
});
