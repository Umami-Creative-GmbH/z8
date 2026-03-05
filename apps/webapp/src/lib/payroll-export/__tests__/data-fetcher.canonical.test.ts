import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	timeRecordFindMany: vi.fn(),
	employeeFindMany: vi.fn(),
	workPeriodFindMany: vi.fn(),
	absenceEntryFindMany: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
	}),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			timeRecord: {
				findMany: mockState.timeRecordFindMany,
			},
			employee: {
				findMany: mockState.employeeFindMany,
			},
			workPeriod: {
				findMany: mockState.workPeriodFindMany,
			},
			absenceEntry: {
				findMany: mockState.absenceEntryFindMany,
			},
		},
	},
	employee: {
		organizationId: "employee.organizationId",
		teamId: "employee.teamId",
	},
	payrollExportConfig: {},
	payrollExportFormat: {},
	payrollWageTypeMapping: {},
	workCategory: {},
	workPeriod: {
		organizationId: "workPeriod.organizationId",
		startTime: "workPeriod.startTime",
		isActive: "workPeriod.isActive",
		employeeId: "workPeriod.employeeId",
		projectId: "workPeriod.projectId",
	},
	absenceCategory: {
		organizationId: "absenceCategory.organizationId",
		isActive: "absenceCategory.isActive",
	},
	absenceEntry: {
		employeeId: "absenceEntry.employeeId",
		startDate: "absenceEntry.startDate",
		endDate: "absenceEntry.endDate",
		status: "absenceEntry.status",
	},
}));

vi.mock("@/db/schema", () => ({
	timeRecord: {
		organizationId: "timeRecord.organizationId",
		employeeId: "timeRecord.employeeId",
		recordKind: "timeRecord.recordKind",
		startAt: "timeRecord.startAt",
		approvalState: "timeRecord.approvalState",
	},
}));

const dataFetcher = await import("../data-fetcher");

describe("payroll export canonical data fetching", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches work export rows from canonical time records", async () => {
		mockState.timeRecordFindMany.mockResolvedValue([
			{
				id: "record-1",
				employeeId: "emp-1",
				startAt: new Date("2026-01-10T08:00:00.000Z"),
				endAt: new Date("2026-01-10T16:00:00.000Z"),
				durationMinutes: 480,
				employee: {
					employeeNumber: "E-001",
					firstName: "Ada",
					lastName: "Lovelace",
					teamId: "team-1",
				},
				work: {
					workCategoryId: "wc-1",
					workCategory: {
						name: "Regular",
						factor: "1.00",
					},
				},
				allocations: [
					{
						projectId: "project-1",
						weightPercent: 100,
						project: {
							name: "Apollo",
						},
					},
				],
			},
		]);

		const results = await dataFetcher.fetchWorkPeriodsForExport("org-1", {
			dateRange: {
				start: DateTime.fromISO("2026-01-01T00:00:00.000Z"),
				end: DateTime.fromISO("2026-01-31T23:59:59.999Z"),
			},
			employeeIds: ["emp-1"],
			teamIds: ["team-1"],
			projectIds: ["project-1"],
		});

		expect(mockState.timeRecordFindMany).toHaveBeenCalledTimes(1);
		expect(mockState.workPeriodFindMany).not.toHaveBeenCalled();
		expect(results).toEqual([
			{
				id: "record-1",
				employeeId: "emp-1",
				employeeNumber: "E-001",
				firstName: "Ada",
				lastName: "Lovelace",
				startTime: DateTime.fromISO("2026-01-10T08:00:00.000Z"),
				endTime: DateTime.fromISO("2026-01-10T16:00:00.000Z"),
				durationMinutes: 480,
				workCategoryId: "wc-1",
				workCategoryName: "Regular",
				workCategoryFactor: "1.00",
				projectId: "project-1",
				projectName: "Apollo",
			},
		]);
	});

	it("fetches absence export rows from canonical time records", async () => {
		mockState.timeRecordFindMany.mockResolvedValue([
			{
				id: "record-2",
				employeeId: "emp-2",
				startAt: new Date("2026-01-12T00:00:00.000Z"),
				endAt: new Date("2026-01-13T23:59:59.000Z"),
				approvalState: "approved",
				employee: {
					employeeNumber: "E-002",
					firstName: "Grace",
					lastName: "Hopper",
				},
				absence: {
					absenceCategoryId: "ac-1",
					absenceCategory: {
						name: "Vacation",
						type: "vacation",
					},
				},
			},
		]);

		const results = await dataFetcher.fetchAbsencesForExport("org-1", {
			dateRange: {
				start: DateTime.fromISO("2026-01-01T00:00:00.000Z"),
				end: DateTime.fromISO("2026-01-31T23:59:59.999Z"),
			},
			employeeIds: ["emp-2"],
		});

		expect(mockState.timeRecordFindMany).toHaveBeenCalledTimes(1);
		expect(mockState.absenceEntryFindMany).not.toHaveBeenCalled();
		expect(results).toEqual([
			{
				id: "record-2",
				employeeId: "emp-2",
				employeeNumber: "E-002",
				firstName: "Grace",
				lastName: "Hopper",
				startDate: "2026-01-12",
				endDate: "2026-01-13",
				absenceCategoryId: "ac-1",
				absenceCategoryName: "Vacation",
				absenceType: "vacation",
				status: "approved",
			},
		]);
	});
});
