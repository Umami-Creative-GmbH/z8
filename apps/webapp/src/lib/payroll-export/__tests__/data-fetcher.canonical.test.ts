import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertCanonicalCutoverReady = vi.fn();

const mockState = vi.hoisted(() => ({
	timeRecordFindMany: vi.fn(),
	employeeFindMany: vi.fn(),
	organizationFindFirst: vi.fn(),
	workPeriodFindMany: vi.fn(),
	absenceEntryFindMany: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
	}),
}));

vi.mock("@/lib/time-record/migration/cutover-state", () => ({
	assertCanonicalCutoverReady: mockAssertCanonicalCutoverReady,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findFirst: mockState.organizationFindFirst,
			},
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
	organization: {
		id: "organization.id",
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
		endAt: "timeRecord.endAt",
		approvalState: "timeRecord.approvalState",
	},
}));

const dataFetcher = await import("../data-fetcher");
const { PayrollWorkAllocationBlockedError } = await import("../work-allocation-blocked-error");

describe("payroll export canonical data fetching", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAssertCanonicalCutoverReady.mockResolvedValue(undefined);
		mockState.organizationFindFirst.mockResolvedValue({ timezone: "UTC" });
	});

	it("rejects payroll export reads when canonical cutover is incomplete", async () => {
		mockAssertCanonicalCutoverReady.mockRejectedValue(
			new Error("Canonical time-record backfill is incomplete for organization org-1"),
		);

		await expect(
			dataFetcher.fetchWorkPeriodsForExport("org-1", {
				dateRange: {
					start: DateTime.fromISO("2026-01-01T00:00:00.000Z"),
					end: DateTime.fromISO("2026-01-31T23:59:59.999Z"),
				},
			}),
		).rejects.toThrow("Canonical time-record backfill is incomplete for organization org-1");
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
					user: {
						firstName: "Ada",
						lastName: "Lovelace",
						email: "ada@example.com",
					},
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
				email: "ada@example.com",
				startTime: DateTime.fromISO("2026-01-10T08:00:00.000Z", { zone: "utc" }),
				endTime: DateTime.fromISO("2026-01-10T16:00:00.000Z", { zone: "utc" }),
				durationMinutes: 480,
				workCategoryId: "wc-1",
				workCategoryName: "Regular",
				workCategoryFactor: "1.00",
				projectId: "project-1",
				projectName: "Apollo",
			},
		]);
	});

	it("includes and clips work records that overlap the payroll export range", async () => {
		mockState.timeRecordFindMany.mockResolvedValue([
			{
				id: "record-1",
				employeeId: "emp-1",
				startAt: new Date("2026-01-31T22:00:00.000Z"),
				endAt: new Date("2026-02-01T02:00:00.000Z"),
				durationMinutes: 240,
				employee: {
					employeeNumber: "E-001",
					user: {
						firstName: "Ada",
						lastName: "Lovelace",
						email: "ada@example.com",
					},
					teamId: "team-1",
				},
				work: null,
				allocations: [],
			},
		]);

		const results = await dataFetcher.fetchWorkPeriodsForExport("org-1", {
			dateRange: {
				start: DateTime.fromISO("2026-02-01T00:00:00.000Z", { zone: "utc" }),
				end: DateTime.fromISO("2026-02-28T23:59:59.999Z", { zone: "utc" }),
			},
			employeeIds: ["emp-1"],
		});

		expect(JSON.stringify(mockState.timeRecordFindMany.mock.calls[0]?.[0].where)).toContain(
			"timeRecord.endAt",
		);
		expect(results[0]).toMatchObject({
			id: "record-1",
			startTime: DateTime.fromISO("2026-02-01T00:00:00.000Z", { zone: "utc" }),
			endTime: DateTime.fromISO("2026-02-01T02:00:00.000Z", { zone: "utc" }),
			durationMinutes: 120,
		});
	});

	it("filters and clips work records by each employee's local payroll month", async () => {
		mockState.timeRecordFindMany.mockResolvedValue([
			{
				id: "new-york-april",
				employeeId: "emp-ny",
				startAt: new Date("2026-05-01T02:00:00.000Z"),
				endAt: new Date("2026-05-01T03:00:00.000Z"),
				durationMinutes: 60,
				employee: {
					employeeNumber: "NY-1",
					teamId: null,
					user: { firstName: "New", lastName: "York", email: "ny@example.com" },
					userSettings: { timezone: "America/New_York" },
				},
				work: null,
				allocations: [],
			},
			{
				id: "new-york-may",
				employeeId: "emp-ny",
				startAt: new Date("2026-05-31T22:00:00.000Z"),
				endAt: new Date("2026-06-01T02:00:00.000Z"),
				durationMinutes: 240,
				employee: {
					employeeNumber: "NY-1",
					teamId: null,
					user: { firstName: "New", lastName: "York", email: "ny@example.com" },
					userSettings: { timezone: "America/New_York" },
				},
				work: null,
				allocations: [],
			},
			{
				id: "berlin-may",
				employeeId: "emp-berlin",
				startAt: new Date("2026-04-30T22:30:00.000Z"),
				endAt: new Date("2026-04-30T23:30:00.000Z"),
				durationMinutes: 60,
				employee: {
					employeeNumber: "BER-1",
					teamId: null,
					user: { firstName: "Berlin", lastName: "Worker", email: "berlin@example.com" },
					userSettings: { timezone: "Europe/Berlin" },
				},
				work: null,
				allocations: [],
			},
			{
				id: "zero-boundary",
				employeeId: "emp-utc",
				startAt: new Date("2026-04-30T23:00:00.000Z"),
				endAt: new Date("2026-05-01T00:00:00.000Z"),
				durationMinutes: 60,
				employee: {
					employeeNumber: "UTC-1",
					teamId: null,
					user: { firstName: "UTC", lastName: "Worker", email: "utc@example.com" },
					userSettings: { timezone: "UTC" },
				},
				work: null,
				allocations: [],
			},
			{
				id: "sub-minute-overlap",
				employeeId: "emp-utc",
				startAt: new Date("2026-05-01T00:00:00.000Z"),
				endAt: new Date("2026-05-01T00:00:20.000Z"),
				durationMinutes: 0,
				employee: {
					employeeNumber: "UTC-1",
					teamId: null,
					user: { firstName: "UTC", lastName: "Worker", email: "utc@example.com" },
					userSettings: { timezone: "UTC" },
				},
				work: null,
				allocations: [],
			},
		]);

		const filters = {
			dateRange: {
				start: DateTime.fromISO("2026-05-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-05-31", { zone: "utc" }),
			},
		};
		const results = await dataFetcher.fetchWorkPeriodsForExport("org-1", filters);

		expect(results.map((result) => result.id)).toEqual(["new-york-may", "berlin-may"]);
		expect(results.find((result) => result.id === "berlin-may")).toMatchObject({
			startTime: DateTime.fromISO("2026-04-30T22:30:00.000Z", { zone: "utc" }),
			endTime: DateTime.fromISO("2026-04-30T23:30:00.000Z", { zone: "utc" }),
			durationMinutes: 60,
		});
		expect(results.find((result) => result.id === "new-york-may")).toMatchObject({
			startTime: DateTime.fromISO("2026-05-31T22:00:00.000Z", { zone: "utc" }),
			endTime: DateTime.fromISO("2026-06-01T02:00:00.000Z", { zone: "utc" }),
			durationMinutes: 240,
		});

		await expect(dataFetcher.countWorkPeriods("org-1", filters)).resolves.toBe(2);
	});

	it("exports protected stored minutes for a fully included segment", async () => {
		mockState.timeRecordFindMany.mockResolvedValue([
			{
				id: "record-protected",
				employeeId: "emp-1",
				startAt: new Date("2026-01-10T08:00:00.000Z"),
				endAt: new Date("2026-01-10T09:00:40.000Z"),
				durationMinutes: 60,
				employee: { employeeNumber: "E-001", teamId: null, user: null },
				work: null,
				allocations: [],
			},
		]);

		const results = await dataFetcher.fetchWorkPeriodsForExport("org-1", {
			dateRange: {
				start: DateTime.fromISO("2026-01-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-01-31", { zone: "utc" }),
			},
		});

		expect(results[0]).toMatchObject({ id: "record-protected", durationMinutes: 60 });
	});

	it("conserves stored minutes across adjacent export windows", async () => {
		const crossingRecord = {
			id: "record-crossing",
			employeeId: "emp-1",
			startAt: new Date("2026-01-31T21:07:13.000Z"),
			endAt: new Date("2026-02-01T02:52:51.000Z"),
			durationMinutes: 346,
			employee: {
				employeeNumber: "E-001",
				teamId: null,
				user: null,
				userSettings: { timezone: "Europe/Berlin" },
			},
			work: null,
			allocations: [],
		};
		mockState.timeRecordFindMany.mockResolvedValue([crossingRecord]);

		const [february] = await dataFetcher.fetchWorkPeriodsForExport("org-1", {
			dateRange: {
				start: DateTime.fromISO("2026-02-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-02-28", { zone: "utc" }),
			},
		});
		const [january] = await dataFetcher.fetchWorkPeriodsForExport("org-1", {
			dateRange: {
				start: DateTime.fromISO("2026-01-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-01-31", { zone: "utc" }),
			},
		});

		// Berlin month boundary is 2026-01-31T23:00Z.
		expect(january).toMatchObject({
			startTime: DateTime.fromISO("2026-01-31T21:07:13.000Z", { zone: "utc" }),
			endTime: DateTime.fromISO("2026-01-31T23:00:00.000Z", { zone: "utc" }),
		});
		expect(february?.startTime).toEqual(DateTime.fromISO("2026-01-31T23:00:00.000Z", { zone: "utc" }));
		expect((january?.durationMinutes ?? 0) + (february?.durationMinutes ?? 0)).toBe(346);
	});

	it("blocks the whole export when in-scope work has an unlocated break across the boundary", async () => {
		mockState.timeRecordFindMany.mockResolvedValue([
			{
				id: "record-ok",
				employeeId: "emp-1",
				startAt: new Date("2026-01-10T08:00:00.000Z"),
				endAt: new Date("2026-01-10T16:00:00.000Z"),
				durationMinutes: 480,
				employee: { employeeNumber: "E-001", teamId: null, user: null },
				work: null,
				allocations: [],
			},
			{
				id: "record-unlocated-break",
				employeeId: "emp-2",
				startAt: new Date("2026-01-31T20:00:00.000Z"),
				endAt: new Date("2026-02-01T04:00:00.000Z"),
				durationMinutes: 450,
				employee: { employeeNumber: "E-002", teamId: null, user: null },
				work: null,
				allocations: [],
			},
		]);
		const filters = {
			dateRange: {
				start: DateTime.fromISO("2026-01-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-01-31", { zone: "utc" }),
			},
		};

		const exportAttempt = dataFetcher.fetchWorkPeriodsForExport("org-1", filters);
		await expect(exportAttempt).rejects.toBeInstanceOf(PayrollWorkAllocationBlockedError);
		await expect(exportAttempt).rejects.toMatchObject({
			organizationId: "org-1",
			blockedRecords: [
				{
					recordId: "record-unlocated-break",
					employeeId: "emp-2",
					reason: "unresolved_interval",
				},
			],
		});
		await expect(dataFetcher.countWorkPeriods("org-1", filters)).rejects.toBeInstanceOf(
			PayrollWorkAllocationBlockedError,
		);
	});

	it("blocks completed work without stored minutes instead of exporting zero", async () => {
		mockState.timeRecordFindMany.mockResolvedValue([
			{
				id: "record-missing-minutes",
				employeeId: "emp-1",
				startAt: new Date("2026-01-10T08:00:00.000Z"),
				endAt: new Date("2026-01-10T16:00:00.000Z"),
				durationMinutes: null,
				employee: { employeeNumber: "E-001", teamId: null, user: null },
				work: null,
				allocations: [],
			},
		]);

		await expect(
			dataFetcher.fetchWorkPeriodsForExport("org-1", {
				dateRange: {
					start: DateTime.fromISO("2026-01-01", { zone: "utc" }),
					end: DateTime.fromISO("2026-01-31", { zone: "utc" }),
				},
			}),
		).rejects.toMatchObject({
			blockedRecords: [expect.objectContaining({ reason: "missing_stored_minutes" })],
		});
	});

	it("returns no work export rows for an explicit empty employee scope", async () => {
		mockState.timeRecordFindMany.mockResolvedValue([
			{
				id: "record-1",
				employeeId: "emp-1",
				startAt: new Date("2026-01-10T08:00:00.000Z"),
				endAt: new Date("2026-01-10T16:00:00.000Z"),
				durationMinutes: 480,
				employee: null,
				work: null,
				allocations: [],
			},
		]);

		const results = await dataFetcher.fetchWorkPeriodsForExport("org-1", {
			dateRange: {
				start: DateTime.fromISO("2026-01-01T00:00:00.000Z"),
				end: DateTime.fromISO("2026-01-31T23:59:59.999Z"),
			},
			employeeIds: [],
		});

		expect(results).toEqual([]);
		expect(mockState.timeRecordFindMany).not.toHaveBeenCalled();
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
					user: {
						firstName: "Grace",
						lastName: "Hopper",
						email: "grace@example.com",
					},
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
				email: "grace@example.com",
				startDate: "2026-01-12",
				endDate: "2026-01-13",
				absenceCategoryId: "ac-1",
				absenceCategoryName: "Vacation",
				absenceType: "vacation",
				status: "approved",
			},
		]);
	});

	it("returns no absence export rows for an explicit empty employee scope", async () => {
		mockState.employeeFindMany.mockResolvedValue([{ id: "emp-2" }]);
		mockState.timeRecordFindMany.mockResolvedValue([
			{
				id: "record-2",
				employeeId: "emp-2",
				startAt: new Date("2026-01-12T00:00:00.000Z"),
				endAt: new Date("2026-01-13T23:59:59.000Z"),
				approvalState: "approved",
				employee: null,
				absence: null,
			},
		]);

		const results = await dataFetcher.fetchAbsencesForExport("org-1", {
			dateRange: {
				start: DateTime.fromISO("2026-01-01T00:00:00.000Z"),
				end: DateTime.fromISO("2026-01-31T23:59:59.999Z"),
			},
			employeeIds: [],
		});

		expect(results).toEqual([]);
		expect(mockState.employeeFindMany).not.toHaveBeenCalled();
		expect(mockState.timeRecordFindMany).not.toHaveBeenCalled();
	});

	it("counts work export rows from canonical time records", async () => {
		mockState.timeRecordFindMany.mockResolvedValue([
			{
				id: "record-1",
				employeeId: "emp-1",
				startAt: new Date("2026-01-10T08:00:00.000Z"),
				endAt: new Date("2026-01-10T16:00:00.000Z"),
				durationMinutes: 480,
				employee: { teamId: "team-1", userSettings: { timezone: "UTC" } },
				allocations: [{ projectId: "project-1" }],
			},
			{
				id: "record-2",
				employeeId: "emp-2",
				startAt: new Date("2026-01-10T08:00:00.000Z"),
				endAt: new Date("2026-01-10T16:00:00.000Z"),
				durationMinutes: 480,
				employee: { teamId: "team-2", userSettings: { timezone: "UTC" } },
				allocations: [{ projectId: "project-2" }],
			},
		]);

		const count = await dataFetcher.countWorkPeriods("org-1", {
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
		expect(count).toBe(1);
	});

	it("counts zero work export rows for an explicit empty employee scope", async () => {
		mockState.timeRecordFindMany.mockResolvedValue([
			{
				id: "record-1",
				employee: null,
				allocations: [],
			},
		]);

		const count = await dataFetcher.countWorkPeriods("org-1", {
			dateRange: {
				start: DateTime.fromISO("2026-01-01T00:00:00.000Z"),
				end: DateTime.fromISO("2026-01-31T23:59:59.999Z"),
			},
			employeeIds: [],
		});

		expect(count).toBe(0);
		expect(mockState.timeRecordFindMany).not.toHaveBeenCalled();
	});
});
