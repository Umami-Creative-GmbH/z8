import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptImportCredential } from "./credential-secret";

const mocks = vi.hoisted(() => ({
	clientConstructor: vi.fn(),
	getAbsences: vi.fn(),
	getEntries: vi.fn(),
	getHolidayQuotas: vi.fn(),
	getImportJobSecret: vi.fn(),
	getNonBusinessDays: vi.fn(),
	getServices: vi.fn(),
	getSurcharges: vi.fn(),
	getTargetHours: vi.fn(),
	getTeams: vi.fn(),
	getUsers: vi.fn(),
	clockodoUserMappingFindMany: vi.fn(),
	insertImportIssues: vi.fn(),
	insertStagedRows: vi.fn(),
	missingClientMethods: new Set<string>(),
}));

vi.mock("@/env", () => ({
	env: { BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-clockodo" },
}));

vi.mock("@/lib/clockodo/client", () => ({
	ClockodoClient: class {
		constructor(email: string, apiKey: string) {
			mocks.clientConstructor(email, apiKey);
			if (!mocks.missingClientMethods.has("getAbsences")) this.getAbsences = mocks.getAbsences;
			if (!mocks.missingClientMethods.has("getEntries")) this.getEntries = mocks.getEntries;
			if (!mocks.missingClientMethods.has("getHolidayQuotas"))
				this.getHolidayQuotas = mocks.getHolidayQuotas;
			if (!mocks.missingClientMethods.has("getNonBusinessDays"))
				this.getNonBusinessDays = mocks.getNonBusinessDays;
			if (!mocks.missingClientMethods.has("getServices")) this.getServices = mocks.getServices;
			if (!mocks.missingClientMethods.has("getSurcharges"))
				this.getSurcharges = mocks.getSurcharges;
			if (!mocks.missingClientMethods.has("getTargetHours"))
				this.getTargetHours = mocks.getTargetHours;
			if (!mocks.missingClientMethods.has("getTeams")) this.getTeams = mocks.getTeams;
			if (!mocks.missingClientMethods.has("getUsers")) this.getUsers = mocks.getUsers;
		}

		getAbsences?: typeof mocks.getAbsences;
		getEntries?: typeof mocks.getEntries;
		getHolidayQuotas?: typeof mocks.getHolidayQuotas;
		getNonBusinessDays?: typeof mocks.getNonBusinessDays;
		getServices?: typeof mocks.getServices;
		getSurcharges?: typeof mocks.getSurcharges;
		getTargetHours?: typeof mocks.getTargetHours;
		getTeams?: typeof mocks.getTeams;
		getUsers?: typeof mocks.getUsers;
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			clockodoUserMapping: {
				findMany: mocks.clockodoUserMappingFindMany,
			},
		},
	},
}));

vi.mock("./repository", () => ({
	getImportJobSecret: mocks.getImportJobSecret,
	insertImportIssues: mocks.insertImportIssues,
	insertStagedRows: mocks.insertStagedRows,
}));

const { scanClockodoImportPartition } = await import("./clockodo-adapter");

const secret = "test-secret-that-is-long-enough-for-clockodo";

function scanJob(overrides: Record<string, unknown> = {}) {
	return {
		type: "import-review-scan",
		batchId: "batch_1",
		jobId: "job_1",
		organizationId: "org_1",
		provider: "clockodo",
		entityType: "employee",
		dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
		secretId: "secret_1",
		...overrides,
	} as Parameters<typeof scanClockodoImportPartition>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getImportJobSecret.mockResolvedValue({
		id: "secret_1",
		organizationId: "org_1",
		...encryptImportCredential(
			JSON.stringify({ email: "admin@example.com", apiKey: "clockodo-api-key" }),
			secret,
			new Date("2099-01-01T00:00:00.000Z"),
		),
	});
	mocks.insertStagedRows.mockImplementation(async ({ rows }) =>
		rows.map((row: unknown, index: number) => ({ id: `row_${index + 1}`, row })),
	);
	mocks.insertImportIssues.mockResolvedValue([]);
	mocks.getAbsences.mockResolvedValue([]);
	mocks.getEntries.mockResolvedValue([]);
	mocks.getHolidayQuotas.mockResolvedValue([]);
	mocks.getNonBusinessDays.mockResolvedValue([]);
	mocks.getServices.mockResolvedValue([]);
	mocks.getSurcharges.mockResolvedValue([]);
	mocks.getTargetHours.mockResolvedValue([]);
	mocks.getTeams.mockResolvedValue([]);
	mocks.getUsers.mockResolvedValue([]);
	mocks.clockodoUserMappingFindMany.mockResolvedValue([]);
	mocks.missingClientMethods.clear();
});

describe("scanClockodoImportPartition", () => {
	it("loads the organization-scoped credential and stages Clockodo users as employee rows", async () => {
		mocks.getUsers.mockResolvedValue([
			{
				id: 1,
				name: "Ada Lovelace",
				number: "A-1",
				email: "ada@example.com",
				role: "user",
				active: true,
				teams_id: 2,
				timezone: "Europe/Berlin",
				wage_type: 1,
				language: "en",
			},
		]);

		const result = await scanClockodoImportPartition(scanJob());

		expect(result).toEqual({ stagedRows: 1, issues: 0 });
		expect(mocks.getImportJobSecret).toHaveBeenCalledWith({
			secretId: "secret_1",
			organizationId: "org_1",
		});
		expect(mocks.clientConstructor).toHaveBeenCalledWith("admin@example.com", "clockodo-api-key");
		expect(mocks.insertStagedRows).toHaveBeenCalledWith({
			batchId: "batch_1",
			organizationId: "org_1",
			rows: [
				expect.objectContaining({
					entityType: "employee",
					providerSourceId: "clockodo:user:1",
					rowStatus: "staged",
					issueSeverity: "none",
					normalizedPayload: expect.objectContaining({
						clockodoUserId: 1,
						email: "ada@example.com",
						name: "Ada Lovelace",
					}),
				}),
			],
		});
		expect(mocks.insertStagedRows.mock.calls[0][0].rows[0].sourcePayloadHash).toBeUndefined();
		expect(mocks.insertStagedRows.mock.calls[0][0].rows[0].sourcePayload.hash).toBeUndefined();
	});

	it("stages only selected Clockodo users as employee rows when provider user IDs are scoped", async () => {
		mocks.getUsers.mockResolvedValue([
			{
				id: 1,
				name: "Ada Lovelace",
				number: "A-1",
				email: "ada@example.com",
				role: "user",
				active: true,
				teams_id: 2,
				timezone: "Europe/Berlin",
				wage_type: 1,
				language: "en",
			},
			{
				id: 2,
				name: "Grace Hopper",
				number: "G-2",
				email: "grace@example.com",
				role: "user",
				active: true,
				teams_id: 2,
				timezone: "Europe/Berlin",
				wage_type: 1,
				language: "en",
			},
		]);

		const result = await scanClockodoImportPartition(scanJob({ employeeIds: ["1"] }));

		expect(result).toEqual({ stagedRows: 1, issues: 0 });
		expect(mocks.insertStagedRows.mock.calls[0][0].rows).toEqual([
			expect.objectContaining({ providerSourceId: "clockodo:user:1" }),
		]);
	});

	it("stages zero Clockodo users when provider user IDs are explicitly empty", async () => {
		mocks.getUsers.mockResolvedValue([
			{
				id: 1,
				name: "Ada Lovelace",
				number: "A-1",
				email: "ada@example.com",
				role: "user",
				active: true,
				teams_id: 2,
				timezone: "Europe/Berlin",
				wage_type: 1,
				language: "en",
			},
		]);

		const result = await scanClockodoImportPartition(scanJob({ employeeIds: [] }));

		expect(result).toEqual({ stagedRows: 0, issues: 0 });
		expect(mocks.insertStagedRows).toHaveBeenCalledWith({
			batchId: "batch_1",
			organizationId: "org_1",
			rows: [],
		});
	});

	it("stages work periods with missing employee mapping as blocking review rows", async () => {
		mocks.getEntries.mockResolvedValue([
			{
				id: 4,
				users_id: 1,
				services_id: 3,
				time_since: "2026-01-05T08:00:00Z",
				time_until: "2026-01-05T16:00:00Z",
				duration: 28800,
			},
		]);

		const result = await scanClockodoImportPartition(scanJob({ entityType: "work_period" }));

		expect(result).toEqual({ stagedRows: 1, issues: 1 });
		expect(mocks.getEntries).toHaveBeenCalledWith("2026-01-01T00:00:00Z", "2026-01-31T23:59:59Z");
		expect(mocks.insertStagedRows.mock.calls[0][0].rows).toEqual([
			expect.objectContaining({
				entityType: "work_period",
				providerSourceId: "clockodo:entry:4",
				rowStatus: "needs_mapping",
				issueSeverity: "blocking",
				matchTarget: { providerEmployeeId: 1, providerServiceId: 3 },
				normalizedPayload: expect.objectContaining({
					employeeId: null,
					startsAt: "2026-01-05T08:00:00Z",
					endsAt: "2026-01-05T16:00:00Z",
					suspiciousFlags: [],
				}),
			}),
		]);
		expect(mocks.insertImportIssues.mock.calls[0][0].issues).toEqual([
			expect.objectContaining({ issueType: "unmatched_employee", severity: "blocking" }),
		]);
	});

	it("stages work periods with mapped employee IDs without unmatched blocking issues", async () => {
		mocks.clockodoUserMappingFindMany.mockResolvedValue([
			{ clockodoUserId: 1, employeeId: "employee_1", mappingType: "manual" },
		]);
		mocks.getEntries.mockResolvedValue([
			{
				id: 6,
				users_id: 1,
				services_id: 3,
				time_since: "2026-01-05T08:00:00Z",
				time_until: "2026-01-05T16:00:00Z",
				duration: 28800,
			},
		]);

		const result = await scanClockodoImportPartition(scanJob({ entityType: "work_period" }));

		expect(result).toEqual({ stagedRows: 1, issues: 0 });
		expect(mocks.clockodoUserMappingFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.insertStagedRows.mock.calls[0][0].rows[0]).toEqual(
			expect.objectContaining({
				providerSourceId: "clockodo:entry:6",
				rowStatus: "staged",
				issueSeverity: "none",
				normalizedPayload: expect.objectContaining({ employeeId: "employee_1" }),
			}),
		);
		expect(mocks.insertImportIssues.mock.calls[0][0].issues).toEqual([]);
	});

	it("stages only selected Clockodo users' work periods and only loads their mappings", async () => {
		mocks.clockodoUserMappingFindMany.mockResolvedValue([
			{ clockodoUserId: 1, employeeId: "employee_1", mappingType: "manual" },
		]);
		mocks.getEntries.mockResolvedValue([
			{
				id: 6,
				users_id: 1,
				services_id: 3,
				time_since: "2026-01-05T08:00:00Z",
				time_until: "2026-01-05T16:00:00Z",
				duration: 28800,
			},
			{
				id: 7,
				users_id: 2,
				services_id: 3,
				time_since: "2026-01-06T08:00:00Z",
				time_until: "2026-01-06T16:00:00Z",
				duration: 28800,
			},
		]);

		const result = await scanClockodoImportPartition(
			scanJob({ entityType: "work_period", employeeIds: ["1"] }),
		);

		expect(result).toEqual({ stagedRows: 1, issues: 0 });
		expect(mocks.clockodoUserMappingFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.insertStagedRows.mock.calls[0][0].rows).toEqual([
			expect.objectContaining({ providerSourceId: "clockodo:entry:6" }),
		]);
	});

	it("stages zero work periods when provider user IDs are explicitly empty", async () => {
		mocks.getEntries.mockResolvedValue([
			{
				id: 6,
				users_id: 1,
				services_id: 3,
				time_since: "2026-01-05T08:00:00Z",
				time_until: "2026-01-05T16:00:00Z",
				duration: 28800,
			},
		]);

		const result = await scanClockodoImportPartition(
			scanJob({ entityType: "work_period", employeeIds: [] }),
		);

		expect(result).toEqual({ stagedRows: 0, issues: 0 });
		expect(mocks.clockodoUserMappingFindMany).not.toHaveBeenCalled();
		expect(mocks.insertStagedRows.mock.calls[0][0].rows).toEqual([]);
	});

	it("treats skipped Clockodo user mappings as unmatched blocking rows", async () => {
		mocks.clockodoUserMappingFindMany.mockResolvedValue([
			{ clockodoUserId: 1, employeeId: null, mappingType: "skipped" },
		]);
		mocks.getEntries.mockResolvedValue([
			{
				id: 7,
				users_id: 1,
				services_id: 3,
				time_since: "2026-01-05T08:00:00Z",
				time_until: "2026-01-05T16:00:00Z",
				duration: 28800,
			},
		]);

		const result = await scanClockodoImportPartition(scanJob({ entityType: "work_period" }));

		expect(result).toEqual({ stagedRows: 1, issues: 1 });
		expect(mocks.insertStagedRows.mock.calls[0][0].rows[0]).toEqual(
			expect.objectContaining({
				providerSourceId: "clockodo:entry:7",
				rowStatus: "needs_mapping",
				issueSeverity: "blocking",
				normalizedPayload: expect.objectContaining({ employeeId: null }),
			}),
		);
		expect(mocks.insertImportIssues.mock.calls[0][0].issues).toEqual([
			expect.objectContaining({ issueType: "unmatched_employee", severity: "blocking" }),
		]);
	});

	it("stages valid multi-day absences without shift-window warnings", async () => {
		mocks.getAbsences.mockResolvedValue([
			{
				id: 5,
				users_id: 1,
				date_since: "2026-01-10",
				date_until: "2026-01-12",
				status: 1,
				type: 1,
				note: null,
				count_days: 3,
				count_hours: null,
			},
		]);

		const result = await scanClockodoImportPartition(scanJob({ entityType: "absence" }));

		expect(result).toEqual({ stagedRows: 1, issues: 1 });
		expect(mocks.getAbsences).toHaveBeenCalledWith(2026);
		expect(mocks.insertStagedRows.mock.calls[0][0].rows[0]).toEqual(
			expect.objectContaining({
				entityType: "absence",
				providerSourceId: "clockodo:absence:5",
				issueSeverity: "blocking",
				rowStatus: "needs_mapping",
				normalizedPayload: expect.objectContaining({
					employeeId: null,
					startsAt: "2026-01-10",
					endsAt: "2026-01-12",
					suspiciousFlags: [],
				}),
			}),
		);
		expect(mocks.insertImportIssues.mock.calls[0][0].issues).toEqual([
			expect.objectContaining({ issueType: "unmatched_employee", severity: "blocking" }),
		]);
	});

	it("stages absences with mapped employee IDs without unmatched blocking issues", async () => {
		mocks.clockodoUserMappingFindMany.mockResolvedValue([
			{ clockodoUserId: 1, employeeId: "employee_1", mappingType: "auto_email" },
		]);
		mocks.getAbsences.mockResolvedValue([
			{
				id: 8,
				users_id: 1,
				date_since: "2026-01-10",
				date_until: "2026-01-12",
				status: 1,
				type: 1,
				note: null,
				count_days: 3,
				count_hours: null,
			},
		]);

		const result = await scanClockodoImportPartition(scanJob({ entityType: "absence" }));

		expect(result).toEqual({ stagedRows: 1, issues: 0 });
		expect(mocks.insertStagedRows.mock.calls[0][0].rows[0]).toEqual(
			expect.objectContaining({
				providerSourceId: "clockodo:absence:8",
				rowStatus: "staged",
				issueSeverity: "none",
				normalizedPayload: expect.objectContaining({
					employeeId: "employee_1",
					suspiciousFlags: [],
				}),
			}),
		);
	});

	it("stages only selected Clockodo users' absences and only loads their mappings", async () => {
		mocks.clockodoUserMappingFindMany.mockResolvedValue([
			{ clockodoUserId: 1, employeeId: "employee_1", mappingType: "auto_email" },
		]);
		mocks.getAbsences.mockResolvedValue([
			{
				id: 8,
				users_id: 1,
				date_since: "2026-01-10",
				date_until: "2026-01-12",
				status: 1,
				type: 1,
				note: null,
				count_days: 3,
				count_hours: null,
			},
			{
				id: 9,
				users_id: 2,
				date_since: "2026-01-10",
				date_until: "2026-01-12",
				status: 1,
				type: 1,
				note: null,
				count_days: 3,
				count_hours: null,
			},
		]);

		const result = await scanClockodoImportPartition(
			scanJob({ entityType: "absence", employeeIds: ["1"] }),
		);

		expect(result).toEqual({ stagedRows: 1, issues: 0 });
		expect(mocks.clockodoUserMappingFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.insertStagedRows.mock.calls[0][0].rows).toEqual([
			expect.objectContaining({ providerSourceId: "clockodo:absence:8" }),
		]);
	});

	it("stages zero absences when provider user IDs are explicitly empty", async () => {
		mocks.getAbsences.mockResolvedValue([
			{
				id: 8,
				users_id: 1,
				date_since: "2026-01-10",
				date_until: "2026-01-12",
				status: 1,
				type: 1,
				note: null,
				count_days: 3,
				count_hours: null,
			},
		]);

		const result = await scanClockodoImportPartition(
			scanJob({ entityType: "absence", employeeIds: [] }),
		);

		expect(result).toEqual({ stagedRows: 0, issues: 0 });
		expect(mocks.clockodoUserMappingFindMany).not.toHaveBeenCalled();
		expect(mocks.insertStagedRows.mock.calls[0][0].rows).toEqual([]);
	});

	it("filters holiday rows to dates within the selected range", async () => {
		mocks.getNonBusinessDays.mockResolvedValue([
			{ id: 1, date: "2025-12-31", name: "Before", half_day: 0, nonbusinessgroups_id: 1 },
			{ id: 2, date: "2026-01-15", name: "Inside", half_day: 0, nonbusinessgroups_id: 1 },
			{ id: 3, date: "2026-02-01", name: "After", half_day: 0, nonbusinessgroups_id: 1 },
		]);

		const result = await scanClockodoImportPartition(scanJob({ entityType: "holiday" }));

		expect(result).toEqual({ stagedRows: 1, issues: 0 });
		expect(mocks.insertStagedRows.mock.calls[0][0].rows).toEqual([
			expect.objectContaining({ providerSourceId: "clockodo:holiday:2" }),
		]);
	});

	it("filters holiday quotas by year overlap across multi-year ranges", async () => {
		mocks.getHolidayQuotas.mockResolvedValue([
			{ id: 1, users_id: 1, year_since: 2024, year_until: 2024, count: 24 },
			{ id: 2, users_id: 1, year_since: 2025, year_until: 2026, count: 24 },
			{ id: 3, users_id: 1, year_since: 2027, year_until: null, count: 24 },
		]);

		const result = await scanClockodoImportPartition(
			scanJob({
				entityType: "holiday_quota",
				dateRange: { startDate: "2025-12-01", endDate: "2026-01-31" },
			}),
		);

		expect(result).toEqual({ stagedRows: 1, issues: 0 });
		expect(mocks.insertStagedRows.mock.calls[0][0].rows).toEqual([
			expect.objectContaining({ providerSourceId: "clockodo:holiday_quota:2" }),
		]);
	});

	it("filters target hours by date range overlap", async () => {
		mocks.getTargetHours.mockResolvedValue([
			{ id: 1, users_id: 1, type: "weekly", date_since: "2025-01-01", date_until: "2025-12-31" },
			{ id: 2, users_id: 1, type: "weekly", date_since: "2026-01-15", date_until: "2026-02-15" },
			{ id: 3, users_id: 1, type: "weekly", date_since: "2026-02-01", date_until: null },
		]);

		const result = await scanClockodoImportPartition(scanJob({ entityType: "target_hours" }));

		expect(result).toEqual({ stagedRows: 1, issues: 0 });
		expect(mocks.insertStagedRows.mock.calls[0][0].rows).toEqual([
			expect.objectContaining({ providerSourceId: "clockodo:target_hours:2" }),
		]);
	});

	it("fails loudly when a required Clockodo reference client method is missing", async () => {
		mocks.missingClientMethods.add("getTargetHours");

		await expect(
			scanClockodoImportPartition(scanJob({ entityType: "target_hours" })),
		).rejects.toThrow("Clockodo client method getTargetHours is not implemented");

		expect(mocks.insertStagedRows).not.toHaveBeenCalled();
		expect(mocks.insertImportIssues).not.toHaveBeenCalled();
	});

	it("rejects unsupported entity types without fetching provider data", async () => {
		await expect(
			scanClockodoImportPartition(scanJob({ entityType: "time_entry" })),
		).rejects.toThrow("Unsupported Clockodo import review entity type: time_entry");

		expect(mocks.clientConstructor).not.toHaveBeenCalled();
		expect(mocks.getUsers).not.toHaveBeenCalled();
		expect(mocks.insertStagedRows).not.toHaveBeenCalled();
		expect(mocks.insertImportIssues).not.toHaveBeenCalled();
	});
});
